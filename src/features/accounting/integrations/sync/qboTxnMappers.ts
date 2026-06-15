/**
 * Pure mappers for the COMPLETENESS pass — the QBO transaction types we don't model
 * as first-class documents (JournalEntry, Deposit, Transfer, CreditMemo, SalesReceipt,
 * RefundReceipt, VendorCredit, Purchase). Each becomes one faithful balanced journal
 * entry tagged source_type='qbo', so the replicated ledger covers EVERYTHING the
 * legacy CSV GL import covered before it is retired.
 *
 * Same fidelity rule as the document mappers: QBO's exact cents post; any residue
 * between itemized lines and the document total folds into the largest line. A
 * transaction that cannot be resolved to balanced lines is problem-flagged — never
 * posted approximately. (assertBalanced + the DB trigger re-verify every entry.)
 */
import type { DefaultAccounts, NewJournalLineInput } from '../../types';
import type { QboJson } from '../../../../services/api/accounting/qboSync';
import { refValue } from './qboApiMappers';
import { centsOf, foldDelta, type DocResolvers } from './qboDocMappers';

// ── Local JSON helpers ────────────────────────────────────────────────────────

const qstr = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

const obj = (v: unknown): Record<string, unknown> | null =>
  v != null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const arr = (v: unknown): QboJson[] => (Array.isArray(v) ? (v as QboJson[]) : []);

const qdate = (v: unknown): string | null => {
  const s = qstr(v);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

const dollars = (cents: number): number => Math.round(cents) / 100;

// ── Output shape ──────────────────────────────────────────────────────────────

export interface MappedTxnJe {
  qboId: string;
  txnDate: string;
  memo: string;
  lines: NewJournalLineInput[];
  problem: string | null;
}

function failTxn(qboId: string, txnDate: string, memo: string, problem: string): MappedTxnJe {
  return { qboId, txnDate, memo, lines: [], problem };
}

/** Common header validation; returns null when ok, else the failure. */
function headerProblem(qboId: string, txnDate: string): string | null {
  if (!qboId) return 'Missing QBO id';
  if (!txnDate) return 'Missing transaction date';
  return null;
}

interface CentLine {
  accountId: string | null;
  netCents: number;
}

/** Drop zero lines, then turn cent-lines into journal debit/credit lines. */
function toJeLines(
  lines: CentLine[],
  side: 'debit' | 'credit',
  memo: string,
  stamp: { customerId?: string | null; vendorId?: string | null }
): NewJournalLineInput[] {
  return lines
    .filter((l) => l.netCents > 0 && l.accountId)
    .map((l) => ({
      accountId: l.accountId!,
      debit: side === 'debit' ? dollars(l.netCents) : 0,
      credit: side === 'credit' ? dollars(l.netCents) : 0,
      lineMemo: memo,
      ...(stamp.customerId ? { customerId: stamp.customerId } : {}),
      ...(stamp.vendorId ? { vendorId: stamp.vendorId } : {}),
    }));
}

/** Sales-side itemized lines (CreditMemo / SalesReceipt / RefundReceipt). */
function salesCentLines(
  json: QboJson,
  r: DocResolvers,
  fallbackAccountId: string | null
): CentLine[] {
  const out: CentLine[] = [];
  for (const line of arr(json.Line)) {
    if (qstr(line.DetailType) !== 'SalesItemLineDetail') continue;
    const cents = centsOf(line.Amount);
    if (cents <= 0) continue;
    const item = r.item(refValue(obj(line.SalesItemLineDetail)?.ItemRef));
    out.push({ accountId: item?.incomeAccountId ?? fallbackAccountId, netCents: cents });
  }
  return out;
}

/** Expense-side itemized lines (VendorCredit / Purchase) — bill-style resolution. */
function expenseCentLines(
  json: QboJson,
  r: DocResolvers,
  fallbackAccountId: string | null
): CentLine[] {
  const out: CentLine[] = [];
  for (const line of arr(json.Line)) {
    const detailType = qstr(line.DetailType);
    const cents = centsOf(line.Amount);
    if (cents <= 0) continue;
    if (detailType === 'AccountBasedExpenseLineDetail') {
      const accountId = r.accountId(refValue(obj(line.AccountBasedExpenseLineDetail)?.AccountRef));
      out.push({ accountId: accountId ?? fallbackAccountId, netCents: cents });
    } else if (detailType === 'ItemBasedExpenseLineDetail') {
      const item = r.item(refValue(obj(line.ItemBasedExpenseLineDetail)?.ItemRef));
      const isInventory = item?.itemType === 'inventory' && item.inventoryAssetAccountId != null;
      const accountId = isInventory
        ? (item?.inventoryAssetAccountId ?? null)
        : (item?.expenseAccountId ?? null);
      out.push({ accountId: accountId ?? fallbackAccountId, netCents: cents });
    }
  }
  return out;
}

/** Reconcile itemized cent-lines to a target total (fold residue, or synthesize). */
function tieToTotal(
  lines: CentLine[],
  targetCents: number,
  fallbackAccountId: string | null
): CentLine[] | null {
  if (targetCents <= 0) return null;
  if (lines.length === 0) {
    if (!fallbackAccountId) return null;
    return [{ accountId: fallbackAccountId, netCents: targetCents }];
  }
  const copy = lines.map((l) => ({ ...l }));
  const delta = targetCents - copy.reduce((s, l) => s + l.netCents, 0);
  if (!foldDelta(copy, delta)) return null;
  return copy.filter((l) => l.netCents > 0);
}

// ── JournalEntry ──────────────────────────────────────────────────────────────

/** QBO manual journal entry → a 1:1 journal entry. */
export function mapQboJournalEntry(json: QboJson, r: DocResolvers): MappedTxnJe {
  const qboId = qstr(json.Id) ?? '';
  const txnDate = qdate(json.TxnDate) ?? '';
  const memo = `Journal entry ${qstr(json.DocNumber) ?? qboId} (QuickBooks)`;
  const bad = headerProblem(qboId, txnDate);
  if (bad) return failTxn(qboId, txnDate, memo, bad);

  const lines: NewJournalLineInput[] = [];
  for (const line of arr(json.Line)) {
    if (qstr(line.DetailType) !== 'JournalEntryLineDetail') continue;
    const detail = obj(line.JournalEntryLineDetail) ?? {};
    const cents = centsOf(line.Amount);
    if (cents <= 0) continue;
    const accountId = r.accountId(refValue(detail.AccountRef));
    if (!accountId) {
      return failTxn(qboId, txnDate, memo, 'A journal line references an unmapped account');
    }
    const posting = qstr(detail.PostingType);
    const entity = obj(detail.Entity);
    const entityType = qstr(entity?.Type);
    const entityId = refValue(entity?.EntityRef);
    lines.push({
      accountId,
      debit: posting === 'Debit' ? dollars(cents) : 0,
      credit: posting === 'Credit' ? dollars(cents) : 0,
      lineMemo: qstr(line.Description),
      ...(entityType === 'Customer' && r.customerId(entityId)
        ? { customerId: r.customerId(entityId) }
        : {}),
      ...(entityType === 'Vendor' && r.vendorId(entityId)
        ? { vendorId: r.vendorId(entityId) }
        : {}),
    });
  }
  if (lines.length < 2) return failTxn(qboId, txnDate, memo, 'Fewer than two mappable lines');
  return { qboId, txnDate, memo, lines, problem: null };
}

// ── Deposit ───────────────────────────────────────────────────────────────────

/**
 * Bank deposit: Dr bank (total) [+ Dr cash-back] / Cr per line. Lines linked to a
 * received payment move Undeposited Funds → bank (the payment already relieved AR);
 * direct-deposit lines credit their own income/other account.
 */
export function mapQboDeposit(json: QboJson, r: DocResolvers, d: DefaultAccounts): MappedTxnJe {
  const qboId = qstr(json.Id) ?? '';
  const txnDate = qdate(json.TxnDate) ?? '';
  const memo = `Deposit ${qboId} (QuickBooks)`;
  const bad = headerProblem(qboId, txnDate);
  if (bad) return failTxn(qboId, txnDate, memo, bad);

  const bankAccountId = r.accountId(refValue(json.DepositToAccountRef));
  if (!bankAccountId) return failTxn(qboId, txnDate, memo, 'Deposit-to account is unmapped');
  const totalCents = centsOf(json.TotalAmt);
  if (totalCents <= 0) return failTxn(qboId, txnDate, memo, 'Zero-amount deposit');

  const credits: CentLine[] = [];
  for (const line of arr(json.Line)) {
    const cents = centsOf(line.Amount);
    if (cents <= 0) continue;
    const linked = arr(line.LinkedTxn).length > 0;
    if (linked) {
      // Undeposited-funds movement (the linked payment/receipt already posted the AR side).
      credits.push({ accountId: d.undepositedFunds, netCents: cents });
    } else {
      const accountId = r.accountId(refValue(obj(line.DepositLineDetail)?.AccountRef));
      credits.push({ accountId: accountId ?? d.salesIncome, netCents: cents });
    }
  }

  // Cash back taken at the teller is an extra debit; credits must equal total + cashback.
  const cashBack = obj(json.CashBack);
  const cashBackCents = centsOf(cashBack?.Amount);
  const cashBackAccountId = cashBackCents > 0 ? r.accountId(refValue(cashBack?.AccountRef)) : null;

  const tied = tieToTotal(credits, totalCents + cashBackCents, d.undepositedFunds);
  if (!tied || tied.some((l) => !l.accountId)) {
    return failTxn(qboId, txnDate, memo, 'Deposit lines cannot be reconciled to the total');
  }

  const lines: NewJournalLineInput[] = [
    { accountId: bankAccountId, debit: dollars(totalCents), credit: 0, lineMemo: 'Bank deposit' },
    ...(cashBackCents > 0 && cashBackAccountId
      ? [
          {
            accountId: cashBackAccountId,
            debit: dollars(cashBackCents),
            credit: 0,
            lineMemo: 'Cash back',
          },
        ]
      : []),
    ...toJeLines(tied, 'credit', 'Deposited funds', {}),
  ];
  if (cashBackCents > 0 && !cashBackAccountId) {
    return failTxn(qboId, txnDate, memo, 'Cash-back account is unmapped');
  }
  return { qboId, txnDate, memo, lines, problem: null };
}

// ── Transfer ──────────────────────────────────────────────────────────────────

export function mapQboTransfer(json: QboJson, r: DocResolvers): MappedTxnJe {
  const qboId = qstr(json.Id) ?? '';
  const txnDate = qdate(json.TxnDate) ?? '';
  const memo = `Transfer ${qboId} (QuickBooks)`;
  const bad = headerProblem(qboId, txnDate);
  if (bad) return failTxn(qboId, txnDate, memo, bad);

  const fromId = r.accountId(refValue(json.FromAccountRef));
  const toId = r.accountId(refValue(json.ToAccountRef));
  const cents = centsOf(json.Amount);
  if (!fromId || !toId) return failTxn(qboId, txnDate, memo, 'Transfer account is unmapped');
  if (cents <= 0) return failTxn(qboId, txnDate, memo, 'Zero-amount transfer');

  return {
    qboId,
    txnDate,
    memo,
    problem: null,
    lines: [
      { accountId: toId, debit: dollars(cents), credit: 0, lineMemo: 'Transfer in' },
      { accountId: fromId, debit: 0, credit: dollars(cents), lineMemo: 'Transfer out' },
    ],
  };
}

// ── CreditMemo ────────────────────────────────────────────────────────────────

/** Credit memo: the inverse of an invoice — Dr income (+ tax) / Cr AR. */
export function mapQboCreditMemo(json: QboJson, r: DocResolvers, d: DefaultAccounts): MappedTxnJe {
  const qboId = qstr(json.Id) ?? '';
  const txnDate = qdate(json.TxnDate) ?? '';
  const memo = `Credit memo ${qstr(json.DocNumber) ?? qboId} (QuickBooks)`;
  const bad = headerProblem(qboId, txnDate);
  if (bad) return failTxn(qboId, txnDate, memo, bad);

  const customerId = r.customerId(refValue(json.CustomerRef));
  const totalCents = centsOf(json.TotalAmt);
  const taxCents = centsOf(obj(json.TxnTaxDetail)?.TotalTax);
  if (totalCents <= 0) return failTxn(qboId, txnDate, memo, 'Zero-amount credit memo');
  if (!d.accountsReceivable) return failTxn(qboId, txnDate, memo, 'AR default account missing');

  const tied = tieToTotal(
    salesCentLines(json, r, d.salesIncome),
    totalCents - taxCents,
    d.salesIncome
  );
  if (!tied || tied.some((l) => !l.accountId)) {
    return failTxn(qboId, txnDate, memo, 'Credit memo lines cannot be reconciled to the total');
  }

  const stamp = { customerId };
  const lines: NewJournalLineInput[] = [
    ...toJeLines(tied, 'debit', 'Revenue credited', stamp),
    ...(taxCents > 0 && d.salesTaxPayable
      ? [
          {
            accountId: d.salesTaxPayable,
            debit: dollars(taxCents),
            credit: 0,
            lineMemo: 'Sales tax credited',
            ...(customerId ? { customerId } : {}),
          },
        ]
      : []),
    {
      accountId: d.accountsReceivable,
      debit: 0,
      credit: dollars(totalCents),
      lineMemo: 'Accounts receivable credited',
      ...(customerId ? { customerId } : {}),
    },
  ];
  if (taxCents > 0 && !d.salesTaxPayable) {
    return failTxn(qboId, txnDate, memo, 'Sales-tax default account missing');
  }
  return { qboId, txnDate, memo, lines, problem: null };
}

// ── SalesReceipt / RefundReceipt ──────────────────────────────────────────────

/** Sales receipt: cash sale — Dr deposit account / Cr income (+ tax). */
export function mapQboSalesReceipt(
  json: QboJson,
  r: DocResolvers,
  d: DefaultAccounts
): MappedTxnJe {
  const qboId = qstr(json.Id) ?? '';
  const txnDate = qdate(json.TxnDate) ?? '';
  const memo = `Sales receipt ${qstr(json.DocNumber) ?? qboId} (QuickBooks)`;
  const bad = headerProblem(qboId, txnDate);
  if (bad) return failTxn(qboId, txnDate, memo, bad);

  const customerId = r.customerId(refValue(json.CustomerRef));
  const depositId = r.accountId(refValue(json.DepositToAccountRef)) ?? d.undepositedFunds ?? d.cash;
  const totalCents = centsOf(json.TotalAmt);
  const taxCents = centsOf(obj(json.TxnTaxDetail)?.TotalTax);
  if (totalCents <= 0) return failTxn(qboId, txnDate, memo, 'Zero-amount sales receipt');
  if (!depositId) return failTxn(qboId, txnDate, memo, 'Deposit-to account is unmapped');

  const tied = tieToTotal(
    salesCentLines(json, r, d.salesIncome),
    totalCents - taxCents,
    d.salesIncome
  );
  if (!tied || tied.some((l) => !l.accountId)) {
    return failTxn(qboId, txnDate, memo, 'Sales receipt lines cannot be reconciled to the total');
  }
  if (taxCents > 0 && !d.salesTaxPayable) {
    return failTxn(qboId, txnDate, memo, 'Sales-tax default account missing');
  }

  const stamp = { customerId };
  return {
    qboId,
    txnDate,
    memo,
    problem: null,
    lines: [
      {
        accountId: depositId,
        debit: dollars(totalCents),
        credit: 0,
        lineMemo: 'Sales receipt',
        ...(customerId ? { customerId } : {}),
      },
      ...toJeLines(tied, 'credit', 'Revenue', stamp),
      ...(taxCents > 0
        ? [
            {
              accountId: d.salesTaxPayable!,
              debit: 0,
              credit: dollars(taxCents),
              lineMemo: 'Sales tax payable',
              ...(customerId ? { customerId } : {}),
            },
          ]
        : []),
    ],
  };
}

/** Refund receipt: the inverse of a sales receipt — Dr income (+ tax) / Cr deposit. */
export function mapQboRefundReceipt(
  json: QboJson,
  r: DocResolvers,
  d: DefaultAccounts
): MappedTxnJe {
  const base = mapQboSalesReceipt(json, r, d);
  if (base.problem) {
    return { ...base, memo: base.memo.replace('Sales receipt', 'Refund receipt') };
  }
  return {
    ...base,
    memo: base.memo.replace('Sales receipt', 'Refund receipt'),
    lines: base.lines.map((l) => ({
      ...l,
      debit: l.credit,
      credit: l.debit,
      lineMemo: l.lineMemo === 'Sales receipt' ? 'Refund paid' : l.lineMemo,
    })),
  };
}

// ── VendorCredit ──────────────────────────────────────────────────────────────

/** Vendor credit: the inverse of a bill — Dr AP / Cr expense lines. */
export function mapQboVendorCredit(
  json: QboJson,
  r: DocResolvers,
  d: DefaultAccounts
): MappedTxnJe {
  const qboId = qstr(json.Id) ?? '';
  const txnDate = qdate(json.TxnDate) ?? '';
  const memo = `Vendor credit ${qstr(json.DocNumber) ?? qboId} (QuickBooks)`;
  const bad = headerProblem(qboId, txnDate);
  if (bad) return failTxn(qboId, txnDate, memo, bad);

  const vendorId = r.vendorId(refValue(json.VendorRef));
  const totalCents = centsOf(json.TotalAmt);
  if (totalCents <= 0) return failTxn(qboId, txnDate, memo, 'Zero-amount vendor credit');
  if (!d.accountsPayable) return failTxn(qboId, txnDate, memo, 'AP default account missing');

  const tied = tieToTotal(
    expenseCentLines(json, r, d.operatingExpenses),
    totalCents,
    d.operatingExpenses
  );
  if (!tied || tied.some((l) => !l.accountId)) {
    return failTxn(qboId, txnDate, memo, 'Vendor credit lines cannot be reconciled to the total');
  }

  return {
    qboId,
    txnDate,
    memo,
    problem: null,
    lines: [
      {
        accountId: d.accountsPayable,
        debit: dollars(totalCents),
        credit: 0,
        lineMemo: 'Accounts payable credited',
        ...(vendorId ? { vendorId } : {}),
      },
      ...toJeLines(tied, 'credit', 'Expense credited', { vendorId }),
    ],
  };
}

// ── Purchase (Check / Expense / Credit-card charge) ───────────────────────────

/** Purchase: Dr expense lines / Cr the pay-from (bank/CC) account; reversed for refunds. */
export function mapQboPurchase(json: QboJson, r: DocResolvers, d: DefaultAccounts): MappedTxnJe {
  const qboId = qstr(json.Id) ?? '';
  const txnDate = qdate(json.TxnDate) ?? '';
  const memo = `Purchase ${qstr(json.DocNumber) ?? qboId} (QuickBooks)`;
  const bad = headerProblem(qboId, txnDate);
  if (bad) return failTxn(qboId, txnDate, memo, bad);

  // EntityRef may name a vendor, customer, or employee; only vendors resolve here.
  const vendorId = r.vendorId(refValue(json.EntityRef));
  const payFromId = r.accountId(refValue(json.AccountRef));
  const totalCents = centsOf(json.TotalAmt);
  if (!payFromId) return failTxn(qboId, txnDate, memo, 'Pay-from account is unmapped');
  if (totalCents <= 0) return failTxn(qboId, txnDate, memo, 'Zero-amount purchase');

  const tied = tieToTotal(
    expenseCentLines(json, r, d.operatingExpenses),
    totalCents,
    d.operatingExpenses
  );
  if (!tied || tied.some((l) => !l.accountId)) {
    return failTxn(qboId, txnDate, memo, 'Purchase lines cannot be reconciled to the total');
  }

  // Credit:true = a refund back onto the card/bank → reverse the entry.
  const isRefund = json.Credit === true;
  const expenseSide = toJeLines(tied, isRefund ? 'credit' : 'debit', 'Expense', { vendorId });
  const payLine: NewJournalLineInput = {
    accountId: payFromId,
    debit: isRefund ? dollars(totalCents) : 0,
    credit: isRefund ? 0 : dollars(totalCents),
    lineMemo: isRefund ? 'Refund received' : 'Payment',
    ...(vendorId ? { vendorId } : {}),
  };
  return { qboId, txnDate, memo, lines: [...expenseSide, payLine], problem: null };
}

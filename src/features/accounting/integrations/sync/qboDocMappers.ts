/**
 * Pure mappers from QBO API DOCUMENT JSON (Invoice, Bill, Estimate, Payment,
 * BillPayment) to the row/ledger shapes the document sync phases persist.
 *
 * FIDELITY RULE: imported documents must carry QuickBooks' EXACT historical money —
 * we never re-derive tax from our tax tables (rates drift over eight years). Each
 * mapper hand-builds the posting totals (InvoiceTotals / BillTotals) in integer cents
 * from the QBO amounts, and any residue between the line sum and the document total
 * (header discounts, shipping, rounding, group lines) is FOLDED into the largest
 * line's income/expense group — so AR/AP and tax always tie to QuickBooks to the
 * penny, while the per-account split stays exact wherever QBO itemized it.
 *
 * Everything here is side-effect-free and unit-tested without network or React.
 */
import { toCents } from '../../accountingViewModel';
import type {
  BillTotals,
  ComputedBillLine,
  ComputedInvoiceLine,
  InvoiceTotals,
} from '../../posting';
import type { QboJson } from '../../../../services/api/accounting/qboSync';
import type { SyncItemInfo } from './syncShared';
import { refValue } from './qboApiMappers';

// ── JSON narrowing helpers (local copies keep this module dependency-free) ────

const qstr = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

const qnum = (v: unknown): number => {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const obj = (v: unknown): Record<string, unknown> | null =>
  v != null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const arr = (v: unknown): QboJson[] => (Array.isArray(v) ? (v as QboJson[]) : []);

/** Dollars → integer cents for a raw QBO numeric field. */
export const centsOf = (v: unknown): number => toCents(qnum(v));

/** QBO TxnDate/DueDate are already YYYY-MM-DD strings. */
const qdate = (v: unknown): string | null => {
  const s = qstr(v);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

// ── Resolvers the phases supply (lookup maps → plain functions) ───────────────

export interface DocResolvers {
  customerId(qboId: string | null): string | null;
  vendorId(qboId: string | null): string | null;
  item(qboId: string | null): SyncItemInfo | null;
  accountId(qboId: string | null): string | null;
}

// ── Delta folding ─────────────────────────────────────────────────────────────

/**
 * Fold `deltaCents` (positive or negative residue) into the LARGEST group of
 * `cents`-carrying entries. Returns false when folding is impossible (no entries,
 * or the fold would drive the target negative) — the caller then problem-flags the
 * document rather than post something that doesn't tie out.
 */
export function foldDelta<T extends { netCents: number }>(lines: T[], deltaCents: number): boolean {
  if (deltaCents === 0) return true;
  if (lines.length === 0) return false;
  let largest = lines[0];
  for (const l of lines) if (l.netCents > largest.netCents) largest = l;
  if (largest.netCents + deltaCents < 0) return false;
  largest.netCents += deltaCents;
  return true;
}

// ── Invoices ──────────────────────────────────────────────────────────────────

/** One persisted invoice/estimate line, with QBO's exact extended amount. */
export interface DocLineRow {
  itemId: string | null;
  description: string | null;
  quantity: number;
  unitPrice: number;
  /** QBO's exact line Amount (dollars). */
  lineTotal: number;
  taxable: boolean;
  incomeAccountId: string | null;
}

export interface MappedInvoiceDoc {
  qboId: string;
  docNumber: string | null;
  customerRowId: string | null;
  txnDate: string;
  dueDate: string | null;
  memo: string | null;
  notes: string | null;
  /** QBO-voided (zero-total) — imported header-only as status 'void', no JE. */
  voided: boolean;
  totalCents: number;
  taxCents: number;
  balanceCents: number;
  lineRows: DocLineRow[];
  /** Hand-built posting totals (null for voided docs / problems). */
  totals: InvoiceTotals | null;
  problem: string | null;
}

/** Map one QBO Invoice. `r` resolves QBO refs to our row ids. */
export function mapQboInvoice(json: QboJson, r: DocResolvers): MappedInvoiceDoc {
  const qboId = qstr(json.Id) ?? '';
  const docNumber = qstr(json.DocNumber);
  const customerRowId = r.customerId(refValue(json.CustomerRef));
  const txnDate = qdate(json.TxnDate) ?? '';
  const totalCents = centsOf(json.TotalAmt);
  const taxCents = centsOf(obj(json.TxnTaxDetail)?.TotalTax);
  const balanceCents = centsOf(json.Balance);

  const base: Omit<MappedInvoiceDoc, 'voided' | 'lineRows' | 'totals' | 'problem'> = {
    qboId,
    docNumber,
    customerRowId,
    txnDate,
    dueDate: qdate(json.DueDate),
    memo: qstr(obj(json.CustomerMemo)?.value),
    notes: qstr(json.PrivateNote),
    totalCents,
    taxCents,
    balanceCents,
  };

  if (!qboId) {
    return { ...base, voided: false, lineRows: [], totals: null, problem: 'Missing QBO id' };
  }
  if (!txnDate) {
    return {
      ...base,
      voided: false,
      lineRows: [],
      totals: null,
      problem: 'Missing transaction date',
    };
  }
  if (!customerRowId) {
    return {
      ...base,
      voided: false,
      lineRows: [],
      totals: null,
      problem: 'Customer not found in synced masters',
    };
  }

  // QBO voids an invoice by zeroing it. Import header-only as 'void' — no ledger post.
  if (totalCents === 0) {
    return { ...base, voided: true, lineRows: [], totals: null, problem: null };
  }

  // Sales-item lines carry the per-item split; everything else (subtotal, discount,
  // shipping, group headers) lands in the fold below.
  const lineRows: DocLineRow[] = [];
  const computed: ComputedInvoiceLine[] = [];
  for (const line of arr(json.Line)) {
    if (qstr(line.DetailType) !== 'SalesItemLineDetail') continue;
    const detail = obj(line.SalesItemLineDetail) ?? {};
    const amountCents = centsOf(line.Amount);
    const item = r.item(refValue(detail.ItemRef));
    const qty = qnum(detail.Qty) || 1;
    const taxable = qstr(obj(detail.TaxCodeRef)?.value) === 'TAX';
    lineRows.push({
      itemId: item?.id ?? null,
      description: qstr(line.Description),
      quantity: qty,
      unitPrice:
        detail.UnitPrice != null ? qnum(detail.UnitPrice) : Math.round(amountCents / qty) / 100,
      lineTotal: amountCents / 100,
      taxable,
      incomeAccountId: item?.incomeAccountId ?? null,
    });
    computed.push({
      incomeAccountId: item?.incomeAccountId ?? null,
      netCents: amountCents,
      taxable,
      taxCents: 0, // tax is carried as the document aggregate below
      jobId: null,
      classId: null,
      locationId: null,
      departmentId: null,
    });
  }

  // The income side must equal total − tax exactly; fold the residue (discounts,
  // shipping, rounding) into the largest line, or synthesize one when QBO gave us
  // no itemized lines at all.
  const incomeCents = totalCents - taxCents;
  if (computed.length === 0) {
    if (incomeCents <= 0) {
      return { ...base, voided: false, lineRows, totals: null, problem: 'No mappable lines' };
    }
    computed.push({
      incomeAccountId: null,
      netCents: incomeCents,
      taxable: taxCents > 0,
      taxCents: 0,
      jobId: null,
      classId: null,
      locationId: null,
      departmentId: null,
    });
  } else {
    const delta = incomeCents - computed.reduce((s, l) => s + l.netCents, 0);
    if (!foldDelta(computed, delta)) {
      return {
        ...base,
        voided: false,
        lineRows,
        totals: null,
        problem: 'Line amounts cannot be reconciled to the document total',
      };
    }
  }

  const totals: InvoiceTotals = {
    subtotalCents: incomeCents,
    discountCents: 0,
    taxCents,
    totalCents,
    lines: computed,
  };
  return { ...base, voided: false, lineRows, totals, problem: null };
}

// ── Bills ─────────────────────────────────────────────────────────────────────

export interface BillLineRow {
  accountId: string | null;
  itemId: string | null;
  description: string | null;
  quantity: number;
  unitCost: number;
  lineTotal: number;
}

export interface MappedBillDoc {
  qboId: string;
  docNumber: string | null;
  vendorRowId: string | null;
  txnDate: string;
  dueDate: string | null;
  memo: string | null;
  voided: boolean;
  totalCents: number;
  balanceCents: number;
  lineRows: BillLineRow[];
  totals: BillTotals | null;
  problem: string | null;
}

/** Map one QBO Bill (account-based and item-based expense lines). */
export function mapQboBill(json: QboJson, r: DocResolvers): MappedBillDoc {
  const qboId = qstr(json.Id) ?? '';
  const docNumber = qstr(json.DocNumber);
  const vendorRowId = r.vendorId(refValue(json.VendorRef));
  const txnDate = qdate(json.TxnDate) ?? '';
  const totalCents = centsOf(json.TotalAmt);
  const balanceCents = centsOf(json.Balance);

  const base: Omit<MappedBillDoc, 'voided' | 'lineRows' | 'totals' | 'problem'> = {
    qboId,
    docNumber,
    vendorRowId,
    txnDate,
    dueDate: qdate(json.DueDate),
    memo: qstr(json.PrivateNote),
    totalCents,
    balanceCents,
  };

  if (!qboId)
    return { ...base, voided: false, lineRows: [], totals: null, problem: 'Missing QBO id' };
  if (!txnDate)
    return {
      ...base,
      voided: false,
      lineRows: [],
      totals: null,
      problem: 'Missing transaction date',
    };
  if (!vendorRowId)
    return {
      ...base,
      voided: false,
      lineRows: [],
      totals: null,
      problem: 'Vendor not found in synced masters',
    };
  if (totalCents === 0) return { ...base, voided: true, lineRows: [], totals: null, problem: null };

  const lineRows: BillLineRow[] = [];
  const computed: ComputedBillLine[] = [];
  for (const line of arr(json.Line)) {
    const detailType = qstr(line.DetailType);
    const amountCents = centsOf(line.Amount);
    if (detailType === 'AccountBasedExpenseLineDetail') {
      const detail = obj(line.AccountBasedExpenseLineDetail) ?? {};
      const accountId = r.accountId(refValue(detail.AccountRef));
      lineRows.push({
        accountId,
        itemId: null,
        description: qstr(line.Description),
        quantity: 1,
        unitCost: amountCents / 100,
        lineTotal: amountCents / 100,
      });
      computed.push({
        debitAccountId: accountId,
        debitAccountType: null,
        netCents: amountCents,
        jobId: null,
        classId: null,
        locationId: null,
        departmentId: null,
      });
    } else if (detailType === 'ItemBasedExpenseLineDetail') {
      const detail = obj(line.ItemBasedExpenseLineDetail) ?? {};
      const item = r.item(refValue(detail.ItemRef));
      const qty = qnum(detail.Qty) || 1;
      // Inventory items capitalize to the inventory-asset account; others expense.
      const isInventory = item?.itemType === 'inventory' && item.inventoryAssetAccountId != null;
      const debitAccountId = isInventory
        ? (item?.inventoryAssetAccountId ?? null)
        : (item?.expenseAccountId ?? null);
      lineRows.push({
        accountId: null,
        itemId: item?.id ?? null,
        description: qstr(line.Description),
        quantity: qty,
        unitCost:
          detail.UnitPrice != null ? qnum(detail.UnitPrice) : Math.round(amountCents / qty) / 100,
        lineTotal: amountCents / 100,
      });
      computed.push({
        debitAccountId,
        // 'asset' keeps the tax/residue fold OFF capitalized inventory (posting.ts rule).
        debitAccountType: isInventory ? 'asset' : null,
        netCents: amountCents,
        jobId: null,
        classId: null,
        locationId: null,
        departmentId: null,
      });
    }
  }

  if (computed.length === 0) {
    return { ...base, voided: false, lineRows, totals: null, problem: 'No mappable lines' };
  }

  // Residue between line sum and TotalAmt: positive residue rides as header "tax"
  // (buildBillExpenseJournalLines folds it into the largest non-inventory debit);
  // negative residue (rare credits/rounding) folds directly into the largest line.
  const lineSum = computed.reduce((s, l) => s + l.netCents, 0);
  let taxCents = totalCents - lineSum;
  if (taxCents < 0) {
    if (!foldDelta(computed, taxCents)) {
      return {
        ...base,
        voided: false,
        lineRows,
        totals: null,
        problem: 'Line amounts cannot be reconciled to the document total',
      };
    }
    taxCents = 0;
  }

  const totals: BillTotals = {
    subtotalCents: totalCents - taxCents,
    taxCents,
    totalCents,
    lines: computed,
  };
  return { ...base, voided: false, lineRows, totals, problem: null };
}

// ── Estimates ─────────────────────────────────────────────────────────────────

export interface MappedEstimateDoc {
  qboId: string;
  docNumber: string | null;
  customerRowId: string | null;
  txnDate: string;
  expiryDate: string | null;
  acceptedAt: string | null;
  memo: string | null;
  notes: string | null;
  /** Our estimate status derived from QBO TxnStatus (+ invoice linkage). */
  status: 'sent' | 'accepted' | 'declined' | 'converted';
  /** QBO id of the invoice this estimate converted into (resolved by the phase). */
  linkedInvoiceQboId: string | null;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  lineRows: DocLineRow[];
  problem: string | null;
}

/** Map one QBO Estimate (non-posting document; mirrors the invoice line shape). */
export function mapQboEstimate(json: QboJson, r: DocResolvers): MappedEstimateDoc {
  const qboId = qstr(json.Id) ?? '';
  const customerRowId = r.customerId(refValue(json.CustomerRef));
  const txnDate = qdate(json.TxnDate) ?? '';
  const totalCents = centsOf(json.TotalAmt);
  const taxCents = centsOf(obj(json.TxnTaxDetail)?.TotalTax);

  // First linked invoice, if QBO recorded the conversion.
  let linkedInvoiceQboId: string | null = null;
  for (const lt of arr(json.LinkedTxn)) {
    if (qstr(lt.TxnType) === 'Invoice') {
      linkedInvoiceQboId = qstr(lt.TxnId);
      break;
    }
  }

  const txnStatus = (qstr(json.TxnStatus) ?? '').toLowerCase();
  const status: MappedEstimateDoc['status'] = linkedInvoiceQboId
    ? 'converted'
    : txnStatus === 'accepted'
      ? 'accepted'
      : txnStatus === 'rejected'
        ? 'declined'
        : txnStatus === 'closed'
          ? 'accepted'
          : 'sent';

  const lineRows: DocLineRow[] = [];
  for (const line of arr(json.Line)) {
    if (qstr(line.DetailType) !== 'SalesItemLineDetail') continue;
    const detail = obj(line.SalesItemLineDetail) ?? {};
    const amountCents = centsOf(line.Amount);
    const item = r.item(refValue(detail.ItemRef));
    const qty = qnum(detail.Qty) || 1;
    lineRows.push({
      itemId: item?.id ?? null,
      description: qstr(line.Description),
      quantity: qty,
      unitPrice:
        detail.UnitPrice != null ? qnum(detail.UnitPrice) : Math.round(amountCents / qty) / 100,
      lineTotal: amountCents / 100,
      taxable: qstr(obj(detail.TaxCodeRef)?.value) === 'TAX',
      incomeAccountId: item?.incomeAccountId ?? null,
    });
  }

  const problem = !qboId
    ? 'Missing QBO id'
    : !txnDate
      ? 'Missing transaction date'
      : !customerRowId
        ? 'Customer not found in synced masters'
        : null;

  return {
    qboId,
    docNumber: qstr(json.DocNumber),
    customerRowId,
    txnDate,
    expiryDate: qdate(json.ExpirationDate),
    acceptedAt: qdate(json.AcceptedDate),
    memo: qstr(obj(json.CustomerMemo)?.value),
    notes: qstr(json.PrivateNote),
    status,
    linkedInvoiceQboId,
    subtotalCents: totalCents - taxCents,
    taxCents,
    totalCents,
    lineRows,
    problem,
  };
}

// ── Customer payments ─────────────────────────────────────────────────────────

export interface MappedPaymentDoc {
  qboId: string;
  customerRowId: string | null;
  txnDate: string;
  amountCents: number;
  reference: string | null;
  memo: string | null;
  /** Our deposit account (DepositToAccountRef → accounts lookup; null → defaults). */
  depositAccountRowId: string | null;
  /** invoice row id → cents applied. */
  applications: Array<{ invoiceRowId: string; amountCents: number }>;
  /** Cents of linked-invoice applications dropped to fit the cash amount (credit memos). */
  creditPortionCents: number;
  /** Linked invoices we could not resolve (logged as warnings). */
  unresolvedInvoiceQboIds: string[];
  problem: string | null;
}

/**
 * Map one QBO Payment. The ledger truth for a payment is Dr deposit / Cr AR for the
 * FULL money amount (an unapplied remainder stays as customer credit on AR — exactly
 * QBO's semantics). Applications allocate the relief to invoices; the portion covered
 * by credit memos is NOT money, so when linked-invoice amounts exceed the cash amount
 * the excess is shaved off the largest application and reported as creditPortionCents.
 */
export function mapQboPayment(
  json: QboJson,
  resolveInvoice: (qboId: string | null) => string | null,
  r: DocResolvers
): MappedPaymentDoc {
  const qboId = qstr(json.Id) ?? '';
  const customerRowId = r.customerId(refValue(json.CustomerRef));
  const txnDate = qdate(json.TxnDate) ?? '';
  const amountCents = centsOf(json.TotalAmt);
  const depositAccountRowId = r.accountId(refValue(json.DepositToAccountRef));

  const applications: Array<{ invoiceRowId: string; amountCents: number }> = [];
  const unresolvedInvoiceQboIds: string[] = [];
  for (const line of arr(json.Line)) {
    const cents = centsOf(line.Amount);
    if (cents <= 0) continue;
    for (const lt of arr(line.LinkedTxn)) {
      if (qstr(lt.TxnType) !== 'Invoice') continue;
      const invoiceQboId = qstr(lt.TxnId);
      const invoiceRowId = resolveInvoice(invoiceQboId);
      if (invoiceRowId) applications.push({ invoiceRowId, amountCents: cents });
      else if (invoiceQboId) unresolvedInvoiceQboIds.push(invoiceQboId);
      break; // one application per payment line
    }
  }

  // Shave any credit-memo-funded portion so Σapplications ≤ the cash amount.
  let creditPortionCents = 0;
  let appliedSum = applications.reduce((s, a) => s + a.amountCents, 0);
  while (appliedSum > amountCents && applications.length > 0) {
    let largest = applications[0];
    for (const a of applications) if (a.amountCents > largest.amountCents) largest = a;
    const excess = appliedSum - amountCents;
    const shave = Math.min(excess, largest.amountCents);
    largest.amountCents -= shave;
    creditPortionCents += shave;
    appliedSum -= shave;
    if (largest.amountCents === 0) {
      applications.splice(applications.indexOf(largest), 1);
    }
  }

  const problem = !qboId
    ? 'Missing QBO id'
    : !txnDate
      ? 'Missing transaction date'
      : !customerRowId
        ? 'Customer not found in synced masters'
        : amountCents <= 0
          ? 'No money received (credit-only application)'
          : null;

  return {
    qboId,
    customerRowId,
    txnDate,
    amountCents,
    reference: qstr(json.PaymentRefNum),
    memo: qstr(json.PrivateNote),
    depositAccountRowId,
    applications: applications.filter((a) => a.amountCents > 0),
    creditPortionCents,
    unresolvedInvoiceQboIds,
    problem,
  };
}

// ── Vendor bill payments ──────────────────────────────────────────────────────

export interface MappedBillPaymentDoc {
  qboId: string;
  vendorRowId: string | null;
  txnDate: string;
  amountCents: number;
  reference: string | null;
  memo: string | null;
  /** Our pay-from account (Check/CreditCard account ref → lookup; null → defaults). */
  payFromAccountRowId: string | null;
  applications: Array<{ billRowId: string; amountCents: number }>;
  unresolvedBillQboIds: string[];
  problem: string | null;
}

/** Map one QBO BillPayment (Check or CreditCard). */
export function mapQboBillPayment(
  json: QboJson,
  resolveBill: (qboId: string | null) => string | null,
  r: DocResolvers
): MappedBillPaymentDoc {
  const qboId = qstr(json.Id) ?? '';
  const vendorRowId = r.vendorId(refValue(json.VendorRef));
  const txnDate = qdate(json.TxnDate) ?? '';
  const amountCents = centsOf(json.TotalAmt);

  const payType = qstr(json.PayType);
  const payFromRef =
    payType === 'CreditCard'
      ? refValue(obj(json.CreditCardPayment)?.CCAccountRef)
      : refValue(obj(json.CheckPayment)?.BankAccountRef);
  const payFromAccountRowId = r.accountId(payFromRef);

  const applications: Array<{ billRowId: string; amountCents: number }> = [];
  const unresolvedBillQboIds: string[] = [];
  for (const line of arr(json.Line)) {
    const cents = centsOf(line.Amount);
    if (cents <= 0) continue;
    for (const lt of arr(line.LinkedTxn)) {
      if (qstr(lt.TxnType) !== 'Bill') continue;
      const billQboId = qstr(lt.TxnId);
      const billRowId = resolveBill(billQboId);
      if (billRowId) applications.push({ billRowId, amountCents: cents });
      else if (billQboId) unresolvedBillQboIds.push(billQboId);
      break;
    }
  }

  // Vendor credits can fund part of a bill payment exactly like customer credit memos.
  let appliedSum = applications.reduce((s, a) => s + a.amountCents, 0);
  while (appliedSum > amountCents && applications.length > 0) {
    let largest = applications[0];
    for (const a of applications) if (a.amountCents > largest.amountCents) largest = a;
    const shave = Math.min(appliedSum - amountCents, largest.amountCents);
    largest.amountCents -= shave;
    appliedSum -= shave;
    if (largest.amountCents === 0) applications.splice(applications.indexOf(largest), 1);
  }

  const problem = !qboId
    ? 'Missing QBO id'
    : !txnDate
      ? 'Missing transaction date'
      : !vendorRowId
        ? 'Vendor not found in synced masters'
        : amountCents <= 0
          ? 'No money paid (credit-only application)'
          : null;

  return {
    qboId,
    vendorRowId,
    txnDate,
    amountCents,
    reference: qstr(json.DocNumber),
    memo: qstr(json.PrivateNote),
    payFromAccountRowId,
    applications: applications.filter((a) => a.amountCents > 0),
    unresolvedBillQboIds,
    problem,
  };
}

/**
 * Pure aggregation helpers for the A3 financial reports (Trial Balance, P&L,
 * Balance Sheet, AR/AP aging).
 *
 * These functions take already-fetched account-balance rows / aging rows and roll
 * them up into the report shapes the UI renders. They are deliberately free of
 * React/Supabase so the statement math is trivially unit-testable
 * (see reportMath.test.ts) and reusable by both the on-screen tables and the
 * PDF/CSV exporters.
 *
 * MONEY: every sum runs in integer cents (accountingViewModel.toCents) and is
 * converted back to dollars only at the boundary, so debits/credits and section
 * subtotals match to the penny exactly the way the GL balance trigger expects.
 * No intermediate value is ever a floating-point dollar amount.
 */
import { toCents } from '../accountingViewModel';
import type {
  AccountBalanceRow,
  AccountLedgerLine,
  AccountLedgerReport,
  AgingBucket,
  AgingReport,
  AgingRow,
  AgingSummary,
  BalanceSheetReport,
  CashFlowCategory,
  CashFlowStatementReport,
  DateRange,
  NormalBalance,
  ProfitAndLossReport,
  ReportLine,
  ReportSection,
  TrialBalanceReport,
} from '../types';
import { AGING_BUCKETS } from '../types';

/** Cents -> dollars at the presentation boundary (rounds half-up like the DB). */
const centsToAmount = (cents: number): number => Math.round(cents) / 100;

/** Signed balance of a row in cents: debit - credit. */
export function rowBalanceCents(
  row: Pick<AccountBalanceRow, 'totalDebit' | 'totalCredit'>
): number {
  return toCents(row.totalDebit) - toCents(row.totalCredit);
}

/**
 * Statement-natural amount of an account in cents, always shown positive on its
 * own statement: debit-normal accounts (asset/expense) read debit - credit;
 * credit-normal accounts (liability/equity/income) read credit - debit. A contra
 * balance (e.g. a negative asset) is therefore allowed to come back negative.
 */
export function naturalAmountCents(row: AccountBalanceRow): number {
  const signed = rowBalanceCents(row);
  return row.normalBalance === 'credit' ? -signed : signed;
}

/**
 * Build a Trial Balance from posted account-balance rows. Every account's signed
 * balance is split into the debit OR credit column (a positive signed balance is a
 * net debit; negative is a net credit), and the grand totals must agree because
 * Σ(debits) − Σ(credits) over a balanced ledger is zero. Accounts with a zero
 * balance are dropped from the listing but do not affect the totals.
 */
export function buildTrialBalance(
  rows: AccountBalanceRow[],
  range: DateRange = {}
): TrialBalanceReport {
  let debitCents = 0;
  let creditCents = 0;
  const out: AccountBalanceRow[] = [];

  for (const row of rows) {
    const signed = rowBalanceCents(row);
    if (signed > 0) debitCents += signed;
    else if (signed < 0) creditCents += -signed;
    if (signed !== 0) {
      out.push({ ...row, balance: centsToAmount(signed) });
    }
  }

  const diffCents = debitCents - creditCents;
  return {
    range,
    rows: out,
    totalDebit: centsToAmount(debitCents),
    totalCredit: centsToAmount(creditCents),
    difference: centsToAmount(diffCents),
    balanced: diffCents === 0,
  };
}

/** Collapse a set of rows into one statement section (lines + cents subtotal). */
function sectionFrom(
  title: string,
  rows: AccountBalanceRow[],
  /** Include zero-amount accounts in the listing? Totals are unaffected either way. */
  keepZero = false
): { section: ReportSection; subtotalCents: number } {
  let subtotalCents = 0;
  const lines: ReportLine[] = [];
  for (const row of rows) {
    const cents = naturalAmountCents(row);
    subtotalCents += cents;
    if (cents !== 0 || keepZero) {
      lines.push({
        accountId: row.accountId,
        accountNumber: row.accountNumber,
        name: row.name,
        amount: centsToAmount(cents),
      });
    }
  }
  return { section: { title, lines, subtotal: centsToAmount(subtotalCents) }, subtotalCents };
}

/**
 * Build a Profit & Loss from posted account-balance rows. Income accounts (credit-
 * natural) and expense accounts (debit-natural) are each shown positive; net income
 * is income − expense. Asset/liability/equity rows are ignored. The window is
 * carried through unchanged (the service is responsible for having filtered to it).
 */
export function buildProfitAndLoss(
  rows: AccountBalanceRow[],
  range: DateRange = {}
): ProfitAndLossReport {
  const incomeRows = rows.filter((r) => r.accountType === 'income');
  const expenseRows = rows.filter((r) => r.accountType === 'expense');

  const { section: income, subtotalCents: incomeCents } = sectionFrom('Income', incomeRows);
  const { section: expense, subtotalCents: expenseCents } = sectionFrom('Expenses', expenseRows);

  const netCents = incomeCents - expenseCents;
  return {
    range,
    income,
    expense,
    totalIncome: centsToAmount(incomeCents),
    totalExpense: centsToAmount(expenseCents),
    netIncome: centsToAmount(netCents),
  };
}

/**
 * Net income (cents) implied by a set of rows — income minus expense. Exposed so
 * the Balance Sheet can roll the same figure into equity without recomputing a
 * full P&L. Asset/liability/equity rows are ignored.
 */
export function netIncomeCents(rows: AccountBalanceRow[]): number {
  let cents = 0;
  for (const row of rows) {
    if (row.accountType === 'income') cents += naturalAmountCents(row);
    else if (row.accountType === 'expense') cents -= naturalAmountCents(row);
  }
  return cents;
}

/**
 * Sentinel id for the Balance Sheet's synthetic "Net income" equity line. It is a
 * presentation figure (not a posted account), so a drill-down link must treat it as
 * non-clickable — AccountLink checks for this id. Exported for that guard.
 */
export const NET_INCOME_LINE_ID = '__net_income__';

/**
 * Build a Balance Sheet from posted account-balance rows. Assets are debit-natural;
 * liabilities and equity are credit-natural; each is shown positive. Current-period
 * net income (income − expense) is folded into equity as a computed "Net income"
 * line — it is a presentation value, NOT a posted journal entry, which is why it is
 * synthesized here rather than read from an account. The report is balanced when
 * assets == liabilities + equity (incl. that net-income line) to the penny.
 */
export function buildBalanceSheet(
  rows: AccountBalanceRow[],
  range: DateRange = {}
): BalanceSheetReport {
  const assetRows = rows.filter((r) => r.accountType === 'asset');
  const liabilityRows = rows.filter((r) => r.accountType === 'liability');
  const equityRows = rows.filter((r) => r.accountType === 'equity');

  const { section: assets, subtotalCents: assetCents } = sectionFrom('Assets', assetRows);
  const { section: liabilities, subtotalCents: liabilityCents } = sectionFrom(
    'Liabilities',
    liabilityRows
  );
  const { section: equityBase, subtotalCents: equityBaseCents } = sectionFrom('Equity', equityRows);

  // Roll current-period net income into equity as a computed line.
  const niCents = netIncomeCents(rows);
  const equityLines: ReportLine[] = [...equityBase.lines];
  if (niCents !== 0) {
    equityLines.push({
      accountId: NET_INCOME_LINE_ID,
      accountNumber: null,
      name: 'Net income',
      amount: centsToAmount(niCents),
    });
  }
  const equityCents = equityBaseCents + niCents;
  const equity: ReportSection = {
    title: 'Equity',
    lines: equityLines,
    subtotal: centsToAmount(equityCents),
  };

  const diffCents = assetCents - (liabilityCents + equityCents);
  return {
    range,
    assets,
    liabilities,
    equity,
    totalAssets: centsToAmount(assetCents),
    totalLiabilities: centsToAmount(liabilityCents),
    totalEquity: centsToAmount(equityCents),
    netIncome: centsToAmount(niCents),
    difference: centsToAmount(diffCents),
    balanced: diffCents === 0,
  };
}

/** An all-buckets-zero summary skeleton (cents accumulator). */
function emptyBucketCents(): Record<AgingBucket, number> {
  return { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
}

/**
 * Summarize aging rows into per-bucket balance-due totals plus a grand total. Used
 * for both AR and AP aging (the row shape is shared). An unrecognized bucket value
 * is ignored defensively rather than crashing the report.
 */
export function summarizeAging(rows: AgingRow[]): AgingSummary {
  const cents = emptyBucketCents();
  let totalCents = 0;
  for (const row of rows) {
    if (!AGING_BUCKETS.includes(row.bucket)) continue;
    const c = toCents(row.balanceDue);
    cents[row.bucket] += c;
    totalCents += c;
  }
  const byBucket = emptyBucketCents();
  for (const b of AGING_BUCKETS) byBucket[b] = centsToAmount(cents[b]);
  return { byBucket, total: centsToAmount(totalCents) };
}

/** Assemble a full aging report (rows + bucket summary) from open-document rows. */
export function buildAgingReport(rows: AgingRow[]): AgingReport {
  return { rows, summary: summarizeAging(rows) };
}

// ── General-ledger account register (#3) ──────────────────────────────────────

/** Light account header the register needs (a subset of Account). */
export interface AccountLedgerMeta {
  accountId: string;
  accountNumber: string | null;
  name: string;
  normalBalance: NormalBalance;
}

/**
 * One posted journal line as supplied to the register builder (debit/credit in
 * dollars, with its parent entry's display fields). The service fetches these for the
 * account within the window, already sorted by entry_date then entry_number.
 */
export interface AccountLedgerLineInput {
  entryId: string;
  entryNumber: number;
  date: string;
  memo: string | null;
  debit: number;
  credit: number;
}

/**
 * Signed movement of a debit/credit pair in the account's NATURAL direction, in cents.
 * A debit-normal account (asset/expense) reads +debit − credit; a credit-normal account
 * (liability/equity/income) reads +credit − debit, so the running balance climbs the way
 * the account naturally accumulates and the register reads intuitively.
 */
function naturalMovementCents(debit: number, credit: number, normalBalance: NormalBalance): number {
  const signed = toCents(debit) - toCents(credit);
  return normalBalance === 'credit' ? -signed : signed;
}

/**
 * Build an account register (#3 GL detail). `openingCents` is the account's signed
 * natural balance as of the day before the window start (0 for an all-time view); each
 * line carries a running balance = opening + Σ natural movements so far, and the closing
 * balance is the final running total. Debit/credit columns are passed through as-is (in
 * dollars) so the register shows gross postings, while the running balance is natural-
 * signed. All math is in integer cents.
 */
export function buildAccountLedger(
  account: AccountLedgerMeta,
  openingCents: number,
  rows: AccountLedgerLineInput[],
  range: DateRange = {}
): AccountLedgerReport {
  let runningCents = openingCents;
  let debitCents = 0;
  let creditCents = 0;
  const lines: AccountLedgerLine[] = [];

  for (const row of rows) {
    runningCents += naturalMovementCents(row.debit, row.credit, account.normalBalance);
    debitCents += toCents(row.debit);
    creditCents += toCents(row.credit);
    lines.push({
      entryId: row.entryId,
      entryNumber: row.entryNumber,
      date: row.date,
      memo: row.memo,
      debit: centsToAmount(toCents(row.debit)),
      credit: centsToAmount(toCents(row.credit)),
      balance: centsToAmount(runningCents),
    });
  }

  return {
    range,
    accountId: account.accountId,
    accountNumber: account.accountNumber,
    accountName: account.name,
    normalBalance: account.normalBalance,
    openingBalance: centsToAmount(openingCents),
    lines,
    totalDebit: centsToAmount(debitCents),
    totalCredit: centsToAmount(creditCents),
    closingBalance: centsToAmount(runningCents),
  };
}

// ── Statement of Cash Flows — indirect method (#5) ─────────────────────────────

/** Input for the cash-flow builder: three balance snapshots + a category lookup. */
export interface CashFlowStatementInput {
  /** Cumulative balances as of the day before the window start (empty when no `from`). */
  openingRows: AccountBalanceRow[];
  /** Cumulative balances as of the window end (the closing snapshot). */
  closingRows: AccountBalanceRow[];
  /** Posted balances WITHIN the window — used only for the period net income line. */
  periodRows: AccountBalanceRow[];
  /** account_id -> cash_flow_category (null for income/expense + not-yet-seeded rows). */
  categoryByAccountId: Map<string, CashFlowCategory | null>;
  range: DateRange;
}

/** Signed (debit − credit) balance of a row in cents, regardless of normal balance. */
function signedBalanceCents(row: AccountBalanceRow): number {
  return toCents(row.totalDebit) - toCents(row.totalCredit);
}

/**
 * Build a Statement of Cash Flows (indirect method) from an opening and a closing
 * cumulative balance snapshot plus the period rows (for net income).
 *
 * THE ONE RULE. For every NON-CASH account, its contribution to cash over the period is
 *   cashEffect = -(closingSignedΔ)        where signedΔ = (closing − opening) in cents.
 * Why one rule covers everything: signed = debit − credit, so an asset INCREASE is a
 * positive Δ and USES cash (−Δ); a liability/equity INCREASE is a negative Δ and PROVIDES
 * cash (−(−Δ) = +Δ). Negating the signed delta therefore gives the correct cash sign for
 * assets AND liabilities/equity alike.
 *
 * Worked example: AR rises 100 (Dr) over the period → signedΔ = +10000c → cashEffect =
 * −10000c (collecting less than billed uses cash). AP rises 100 (Cr) → signedΔ = −10000c
 * → cashEffect = +10000c (deferring payment provides cash). Both correct.
 *
 * Classification: each non-cash account's cashEffect lands in Operating / Investing /
 * Financing by its cash_flow_category. Income/expense accounts (category null) are
 * SKIPPED — their effect is already in net income, which is the Operating section's
 * starting line. A non-income/expense account with a NULL category (added after the
 * seed) is surfaced in a visible "Unclassified — review" Operating line, never dropped.
 *
 * RECONCILIATION: Σ(net income + all section line effects) must equal the signed Δ of the
 * `cash`-category accounts (the actual change in cash). `balanced` asserts that to the
 * penny; any drift means an account is mis-classified or a cash account is missing.
 */
export function buildCashFlowStatement(input: CashFlowStatementInput): CashFlowStatementReport {
  const { openingRows, closingRows, periodRows, categoryByAccountId, range } = input;

  // Index opening balances by account so we can diff against each closing row.
  const openingByAccount = new Map<string, number>();
  for (const row of openingRows) openingByAccount.set(row.accountId, signedBalanceCents(row));

  // Operating starts from period net income (income − expense over the window).
  const netIncome = netIncomeCents(periodRows);

  const operatingLines: ReportLine[] = [];
  const investingLines: ReportLine[] = [];
  const financingLines: ReportLine[] = [];
  let operatingCents = netIncome;
  let investingCents = 0;
  let financingCents = 0;
  let cashDeltaCents = 0;

  for (const row of closingRows) {
    const closing = signedBalanceCents(row);
    const opening = openingByAccount.get(row.accountId) ?? 0;
    const deltaCents = closing - opening;
    const category = categoryByAccountId.get(row.accountId) ?? null;

    if (category === 'cash') {
      // The actual change in cash — the figure the statement must reconcile to.
      cashDeltaCents += deltaCents;
      continue;
    }

    // Income/expense accounts carry no category; their effect is already in net income.
    if (category === null && (row.accountType === 'income' || row.accountType === 'expense')) {
      continue;
    }

    const cashEffect = -deltaCents; // the one rule
    if (cashEffect === 0) continue;

    const line: ReportLine = {
      accountId: row.accountId,
      accountNumber: row.accountNumber,
      name: row.name,
      amount: centsToAmount(cashEffect),
    };

    switch (category) {
      case 'investing':
        investingLines.push(line);
        investingCents += cashEffect;
        break;
      case 'financing':
        financingLines.push(line);
        financingCents += cashEffect;
        break;
      case 'operating':
        operatingLines.push(line);
        operatingCents += cashEffect;
        break;
      default:
        // Unclassified non-cash account (null category, not income/expense, or the
        // 'non_cash' tag): surface it in Operating flagged for review rather than drop it.
        operatingLines.push({ ...line, name: `${row.name} (unclassified — review)` });
        operatingCents += cashEffect;
        break;
    }
  }

  // Net income leads the Operating section as its own labelled line (presentation only).
  const operating: ReportSection = {
    title: 'Operating activities',
    lines: [
      {
        accountId: NET_INCOME_LINE_ID,
        accountNumber: null,
        name: 'Net income',
        amount: centsToAmount(netIncome),
      },
      ...operatingLines,
    ],
    subtotal: centsToAmount(operatingCents),
  };
  const investing: ReportSection = {
    title: 'Investing activities',
    lines: investingLines,
    subtotal: centsToAmount(investingCents),
  };
  const financing: ReportSection = {
    title: 'Financing activities',
    lines: financingLines,
    subtotal: centsToAmount(financingCents),
  };

  const netChangeCents = operatingCents + investingCents + financingCents;
  const diffCents = netChangeCents - cashDeltaCents;

  return {
    range,
    netIncome: centsToAmount(netIncome),
    operating,
    investing,
    financing,
    netOperating: centsToAmount(operatingCents),
    netInvesting: centsToAmount(investingCents),
    netFinancing: centsToAmount(financingCents),
    /** Net change implied by the three sections (should equal the real cash delta). */
    netChangeInCash: centsToAmount(netChangeCents),
    /** Actual signed change in the cash-category accounts over the period. */
    cashChange: centsToAmount(cashDeltaCents),
    difference: centsToAmount(diffCents),
    balanced: diffCents === 0,
  };
}

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
  AgingBucket,
  AgingReport,
  AgingRow,
  AgingSummary,
  BalanceSheetReport,
  DateRange,
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

const NET_INCOME_LINE_ID = '__net_income__';

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

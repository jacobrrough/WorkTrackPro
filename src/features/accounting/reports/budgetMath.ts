/**
 * Pure aggregation helpers for the D2 budgeting & forecasting reports:
 *   • buildBudgetGrid       — assemble the editor grid (accounts × 12 months) from the
 *                             chart of accounts + saved budget lines.
 *   • buildBudgetVsActual   — compare each account's budgeted year against its POSTED
 *                             actual, computed on the SAME basis as the trial balance
 *                             (status = 'posted', natural sign per account type).
 *   • buildCashFlowForecast — project open AR (inflow) minus open AP (outflow) across
 *                             monthly buckets keyed by document due dates.
 *
 * These functions are deliberately free of React/Supabase so the math is trivially
 * unit-testable (see budgetMath.test.ts) and reusable by both the on-screen tables and
 * the PDF/CSV exporters. Budgets move NO money, so nothing here posts a journal entry.
 *
 * MONEY (G6): every sum runs in integer cents (accountingViewModel.toCents) and is
 * converted back to dollars only at the boundary, so budgeted totals, actuals and
 * variances match to the penny and a Budget-vs-Actual actual ties to the trial balance
 * for the same year. No intermediate value is ever a floating-point dollar amount.
 */
import { toCents } from '../accountingViewModel';
import type {
  Account,
  AccountType,
  BudgetGridRow,
  BudgetLine,
  BudgetVsActualRow,
  CashFlowForecast,
  CashFlowItem,
  CashFlowPeriod,
} from '../types';

/** Cents -> dollars at the presentation boundary (rounds half-up like the DB). */
const centsToAmount = (cents: number): number => Math.round(cents) / 100;

/** A fresh dense 12-slot cents accumulator (index 0 = Jan … 11 = Dec). */
function emptyMonths(): number[] {
  return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
}

/** Convert a dense 12-slot cents array to a dollars array for presentation. */
function monthsToAmount(cents: number[]): number[] {
  return cents.map(centsToAmount);
}

/**
 * Sign a posted debit/credit pair into the account's STATEMENT-NATURAL amount in cents —
 * the identical convention the trial balance / P&L use (reportMath.naturalAmountCents):
 * debit-normal accounts (asset/expense) read debit − credit; credit-normal accounts
 * (liability/equity/income) read credit − debit. This is what makes a Budget-vs-Actual
 * actual tie to the trial balance: a revenue budget compares against revenue shown
 * positive, an expense budget against expense shown positive.
 */
export function actualNaturalCents(
  normalBalance: 'debit' | 'credit',
  debit: number,
  credit: number
): number {
  const signed = toCents(debit) - toCents(credit);
  return normalBalance === 'credit' ? -signed : signed;
}

// ── Budget editor grid ────────────────────────────────────────────────────────

/**
 * One account's posted actuals for a budget month, as the service hands them to the
 * BvA builder. `debit`/`credit` are the summed posted journal-line debits/credits for
 * that account in that calendar month (dollars); the builder signs them by the account's
 * normal balance. `month` is 1-12.
 */
export interface MonthlyActualInput {
  accountId: string;
  /** Calendar month 1-12. */
  month: number;
  /** Σ posted debits for the account in the month (dollars). */
  debit: number;
  /** Σ posted credits for the account in the month (dollars). */
  credit: number;
}

/**
 * Build the editor grid: every budgetable account (typically the active chart) as a row
 * with its 12 planned cells filled in from the saved budget lines (0 where blank). The
 * accounts list drives row order/identity, so an account with no saved lines is still a
 * fully-editable all-zero row. `lines` outside the accounts list are ignored. Returns the
 * per-account rows plus per-month and grand totals (all dollars).
 */
export function buildBudgetGrid(
  accounts: Pick<Account, 'id' | 'accountNumber' | 'name' | 'accountType'>[],
  lines: Pick<BudgetLine, 'accountId' | 'periodMonth' | 'amount'>[]
): { rows: BudgetGridRow[]; monthlyTotals: number[]; grandTotal: number } {
  // Index saved cells by account → 12-slot cents array (skip out-of-range months).
  const cellsByAccount = new Map<string, number[]>();
  for (const line of lines) {
    const m = line.periodMonth;
    if (!Number.isInteger(m) || m < 1 || m > 12) continue;
    let months = cellsByAccount.get(line.accountId);
    if (!months) {
      months = emptyMonths();
      cellsByAccount.set(line.accountId, months);
    }
    // A duplicate (accountId, month) cell would only arise from malformed input; sum
    // defensively rather than overwrite so no planned dollars are silently dropped.
    months[m - 1] += toCents(line.amount);
  }

  const monthlyTotals = emptyMonths();
  let grandTotalCents = 0;
  const rows: BudgetGridRow[] = accounts.map((account) => {
    const cents = cellsByAccount.get(account.id) ?? emptyMonths();
    let rowTotal = 0;
    for (let i = 0; i < 12; i++) {
      monthlyTotals[i] += cents[i];
      rowTotal += cents[i];
    }
    grandTotalCents += rowTotal;
    return {
      accountId: account.id,
      accountNumber: account.accountNumber,
      accountName: account.name,
      accountType: account.accountType,
      monthly: monthsToAmount(cents),
      total: centsToAmount(rowTotal),
    };
  });

  return {
    rows,
    monthlyTotals: monthsToAmount(monthlyTotals),
    grandTotal: centsToAmount(grandTotalCents),
  };
}

// ── Budget vs Actual ──────────────────────────────────────────────────────────

/** Minimal account identity the BvA builder needs to label + sign a row. */
export type BvaAccount = Pick<
  Account,
  'id' | 'accountNumber' | 'name' | 'accountType' | 'normalBalance'
>;

/**
 * Build the Budget-vs-Actual rows: one per account that has EITHER a budget line OR posted
 * actuals for the year. For each account, both the 12 budgeted cells and the 12 posted
 * actual cells are filled (0 where absent); the actual is signed to the account's natural
 * statement direction so it compares like-for-like with the plan and ties to the trial
 * balance. variance = actual − budget. Rows are returned ordered by account number (the
 * same order the trial balance lists), with the grand totals.
 *
 * Only accounts present in `accounts` are emitted; budget lines / actuals referencing an
 * unknown account are ignored defensively (a deactivated account can still be referenced
 * by a saved plan, but the service passes the chart it wants reported on).
 */
export function buildBudgetVsActual(
  accounts: BvaAccount[],
  budgetLines: Pick<BudgetLine, 'accountId' | 'periodMonth' | 'amount'>[],
  actuals: MonthlyActualInput[]
): { rows: BudgetVsActualRow[]; totalBudgetCents: number; totalActualCents: number } {
  const accountById = new Map<string, BvaAccount>();
  for (const a of accounts) accountById.set(a.id, a);

  // Per-account 12-slot cents accumulators for budget and actual.
  const budgetByAccount = new Map<string, number[]>();
  const actualByAccount = new Map<string, number[]>();

  for (const line of budgetLines) {
    if (!accountById.has(line.accountId)) continue;
    const m = line.periodMonth;
    if (!Number.isInteger(m) || m < 1 || m > 12) continue;
    let months = budgetByAccount.get(line.accountId);
    if (!months) {
      months = emptyMonths();
      budgetByAccount.set(line.accountId, months);
    }
    months[m - 1] += toCents(line.amount);
  }

  for (const a of actuals) {
    const account = accountById.get(a.accountId);
    if (!account) continue;
    const m = a.month;
    if (!Number.isInteger(m) || m < 1 || m > 12) continue;
    let months = actualByAccount.get(a.accountId);
    if (!months) {
      months = emptyMonths();
      actualByAccount.set(a.accountId, months);
    }
    months[m - 1] += actualNaturalCents(account.normalBalance, a.debit, a.credit);
  }

  // Only accounts with some budget OR some actual appear on the report.
  const accountIds = new Set<string>([...budgetByAccount.keys(), ...actualByAccount.keys()]);

  let totalBudgetCents = 0;
  let totalActualCents = 0;
  const rows: BudgetVsActualRow[] = [];
  for (const id of accountIds) {
    const account = accountById.get(id);
    if (!account) continue;
    const budgetMonthsCents = budgetByAccount.get(id) ?? emptyMonths();
    const actualMonthsCents = actualByAccount.get(id) ?? emptyMonths();
    const budgetCents = budgetMonthsCents.reduce((s, c) => s + c, 0);
    const actualCents = actualMonthsCents.reduce((s, c) => s + c, 0);
    totalBudgetCents += budgetCents;
    totalActualCents += actualCents;
    rows.push({
      accountId: id,
      accountNumber: account.accountNumber,
      accountName: account.name,
      accountType: account.accountType,
      budget: centsToAmount(budgetCents),
      actual: centsToAmount(actualCents),
      variance: centsToAmount(actualCents - budgetCents),
      budgetMonthly: monthsToAmount(budgetMonthsCents),
      actualMonthly: monthsToAmount(actualMonthsCents),
    });
  }

  rows.sort((a, b) => (a.accountNumber ?? '').localeCompare(b.accountNumber ?? ''));

  return { rows, totalBudgetCents, totalActualCents };
}

/** Account-type ordering for any future grouped presentation (kept stable + exported). */
export const BVA_TYPE_ORDER: AccountType[] = ['income', 'expense', 'asset', 'liability', 'equity'];

// ── Cash-flow forecast ────────────────────────────────────────────────────────

/** Zero-pad a 1-12 month to two digits for ISO date assembly. */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Last calendar day (28-31) of a given year/month (month is 1-12). */
function lastDayOfMonth(year: number, month: number): number {
  // Day 0 of the NEXT month is the last day of THIS month.
  return new Date(year, month, 0).getDate();
}

/** Inclusive ISO first day of a year/month, e.g. (2026, 6) -> "2026-06-01". */
function monthStartIso(year: number, month: number): string {
  return `${year}-${pad2(month)}-01`;
}

/** Inclusive ISO last day of a year/month, e.g. (2026, 6) -> "2026-06-30". */
function monthEndIso(year: number, month: number): string {
  return `${year}-${pad2(month)}-${pad2(lastDayOfMonth(year, month))}`;
}

/** Short "Mon YYYY" label for a forecast bucket (e.g. "Jun 2026"). */
const MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
function monthLabel(year: number, month: number): string {
  return `${MONTH_ABBR[month - 1]} ${year}`;
}

/** Parse an ISO `YYYY-MM-DD` into {year, month} (1-12), or null if unparseable. */
function parseYearMonth(iso: string | null | undefined): { year: number; month: number } | null {
  if (!iso || typeof iso !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isInteger(year) || month < 1 || month > 12) return null;
  return { year, month };
}

/** Advance a {year, month} by one calendar month (Dec → next Jan). */
function nextMonth(ym: { year: number; month: number }): { year: number; month: number } {
  return ym.month === 12 ? { year: ym.year + 1, month: 1 } : { year: ym.year, month: ym.month + 1 };
}

/** A 0-based ordinal for a year/month so we can compare/bucket dates as integers. */
function monthOrdinal(year: number, month: number): number {
  return year * 12 + (month - 1);
}

export interface CashFlowForecastOptions {
  /** Cash position the projection starts from, in dollars (default 0). */
  openingBalance?: number;
  /** First month of the horizon as ISO `YYYY-MM-01` (default: the current month). */
  startMonth?: string;
  /** Number of monthly buckets to project (default 6, clamped to 1-36). */
  months?: number;
}

/**
 * Build a simple cash-flow forecast from open AR/AP items. Each item is expected to be
 * collected/paid on its `dueDate`; an item with no due date (or one already past the
 * horizon start) lands in the FIRST bucket (treated as due now / overdue). Inflows are
 * open AR balances (cash IN), outflows are open AP balances (cash OUT). The forecast
 * walks `months` monthly buckets from `startMonth`, accumulating a running cash balance.
 *
 * Anything due BEFORE the horizon start, or with a missing due date, is folded into the
 * first bucket so no open dollars are lost off the left edge. Anything due AFTER the last
 * bucket is folded into the LAST bucket so the ending balance reflects the full open
 * book. This is a projection from currently-open documents only — it books no entry.
 */
export function buildCashFlowForecast(
  items: CashFlowItem[],
  options: CashFlowForecastOptions = {}
): CashFlowForecast {
  const openingCents = toCents(options.openingBalance ?? 0);

  // Resolve the horizon start (default: current calendar month).
  const startYm =
    parseYearMonth(options.startMonth ?? null) ??
    (() => {
      const now = new Date();
      return { year: now.getFullYear(), month: now.getMonth() + 1 };
    })();

  const monthsRequested = options.months ?? 6;
  const bucketCount = Math.max(1, Math.min(36, Math.floor(monthsRequested) || 6));

  // Lay out the bucket months and their ordinals.
  const buckets: {
    year: number;
    month: number;
    ordinal: number;
    inflowCents: number;
    outflowCents: number;
  }[] = [];
  let cursor = startYm;
  for (let i = 0; i < bucketCount; i++) {
    buckets.push({
      year: cursor.year,
      month: cursor.month,
      ordinal: monthOrdinal(cursor.year, cursor.month),
      inflowCents: 0,
      outflowCents: 0,
    });
    cursor = nextMonth(cursor);
  }
  const firstOrdinal = buckets[0].ordinal;
  const lastOrdinal = buckets[bucketCount - 1].ordinal;

  // Distribute each open item into its bucket by due date (clamped into the horizon).
  let totalInflowCents = 0;
  let totalOutflowCents = 0;
  for (const item of items) {
    const cents = Math.abs(toCents(item.amount));
    if (cents === 0) continue;
    const due = parseYearMonth(item.dueDate);
    // No due date → due now (first bucket). Otherwise clamp to [first, last].
    let ordinal = due ? monthOrdinal(due.year, due.month) : firstOrdinal;
    if (ordinal < firstOrdinal) ordinal = firstOrdinal;
    if (ordinal > lastOrdinal) ordinal = lastOrdinal;
    const bucket = buckets[ordinal - firstOrdinal];
    if (item.direction === 'inflow') {
      bucket.inflowCents += cents;
      totalInflowCents += cents;
    } else {
      bucket.outflowCents += cents;
      totalOutflowCents += cents;
    }
  }

  // Walk the buckets accumulating the running balance.
  let runningCents = openingCents;
  const periods: CashFlowPeriod[] = buckets.map((b) => {
    const netCents = b.inflowCents - b.outflowCents;
    runningCents += netCents;
    return {
      label: monthLabel(b.year, b.month),
      periodStart: monthStartIso(b.year, b.month),
      periodEnd: monthEndIso(b.year, b.month),
      inflow: centsToAmount(b.inflowCents),
      outflow: centsToAmount(b.outflowCents),
      net: centsToAmount(netCents),
      runningBalance: centsToAmount(runningCents),
    };
  });

  return {
    openingBalance: centsToAmount(openingCents),
    periods,
    totalInflow: centsToAmount(totalInflowCents),
    totalOutflow: centsToAmount(totalOutflowCents),
    endingBalance: centsToAmount(runningCents),
  };
}

import type {
  AccountBalanceRow,
  AccountLedgerReport,
  AgingReport,
  BalanceSheetReport,
  CashFlowCategory,
  CashFlowStatementReport,
  DateRange,
  NormalBalance,
  ProfitAndLossReport,
  TrialBalanceReport,
} from '../../../features/accounting/types';
import {
  buildAccountLedger,
  buildAgingReport,
  buildBalanceSheet,
  buildCashFlowStatement,
  buildProfitAndLoss,
  buildTrialBalance,
  type AccountLedgerLineInput,
} from '../../../features/accounting/reports/reportMath';
import { toCents } from '../../../features/accounting/accountingViewModel';
import { acct } from './accountingClient';
import { mapAccountBalanceRow, mapApAgingRow, mapArAgingRow, type Row } from './mappers';

/**
 * The calendar day before an ISO `YYYY-MM-DD` date, as ISO. Used to take a cumulative
 * balance "as of the day before the window start" for the opening snapshot of the cash-
 * flow statement and the account register's opening balance. Parsed at UTC noon so a
 * timezone offset can never roll the date across a day boundary.
 */
function dayBefore(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * A3 — read-only financial reporting. Every figure derives from POSTED journal
 * activity (the DB views already filter `status = 'posted'`); nothing here writes.
 *
 * Two account-balance sources, one mapper (`mapAccountBalanceRow`) and the pure
 * reportMath roll-ups feed all three statements:
 *  - ALL-TIME → `accounting.v_trial_balance` (debit/credit summed per account).
 *  - DATE-RANGE → `v_trial_balance` carries no date column, so we read posted
 *    `journal_lines` filtered by the parent entry's `entry_date` (an inner join on
 *    journal_entries) and aggregate debits/credits per account in JS, in cents.
 *    Read-only, no new DB object, backed by idx_acct_je_date / _status / _jl_account.
 *
 * Reads THROW on error so React Query surfaces them (service convention).
 */

/** True when a range actually constrains the window (otherwise it's all-time). */
function hasBound(range?: DateRange | null): boolean {
  return !!(range && (range.from || range.to));
}

/**
 * Posted per-account debit/credit totals over an OPTIONAL entry-date window.
 * Returns one AccountBalanceRow per account that has a chart entry (so a zeroed
 * account still appears, matching the all-time view); the report builders drop
 * zero rows from the listing as appropriate.
 */
async function getAccountBalances(range?: DateRange): Promise<AccountBalanceRow[]> {
  // Fast path: no window → the pre-aggregated trial-balance view.
  if (!hasBound(range)) {
    const { data, error } = await acct()
      .from('v_trial_balance')
      .select('*')
      .order('account_number', { ascending: true, nullsFirst: false });
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapAccountBalanceRow);
  }

  // Windowed path: aggregate SERVER-SIDE. Fetching every posted line to sum in JS times out at
  // production scale (49k+ rows exceed the statement timeout — P&L / Balance Sheet / the QBO
  // verification all pass a date bound and hit this path). The GROUP BY runs in Postgres and
  // returns one row per account — the same shape as the v_trial_balance fast path above.
  const { data, error } = await acct().rpc('report_account_balances', {
    p_from: range?.from ?? null,
    p_to: range?.to ?? null,
  });
  if (error) throw error;
  return ((data ?? []) as Row[])
    .map(mapAccountBalanceRow)
    .sort((x, y) => (x.accountNumber ?? '').localeCompare(y.accountNumber ?? ''));
}

export const reportsService = {
  /** Raw posted account balances (no roll-up) — handy for ad-hoc callers/tests. */
  getAccountBalances,

  /** Trial Balance: per-account debit/credit columns + agreeing grand totals. */
  async getTrialBalance(range: DateRange = {}): Promise<TrialBalanceReport> {
    const rows = await getAccountBalances(range);
    return buildTrialBalance(rows, range);
  },

  /** Profit & Loss: income − expense = net income for the window. */
  async getProfitAndLoss(range: DateRange = {}): Promise<ProfitAndLossReport> {
    const rows = await getAccountBalances(range);
    return buildProfitAndLoss(rows, range);
  },

  /** Balance Sheet: assets = liabilities + equity (period net income folded in). */
  async getBalanceSheet(range: DateRange = {}): Promise<BalanceSheetReport> {
    // A balance sheet is cumulative as of `to`; it must never apply a lower bound, or a
    // preset that carries a `from` would truncate balances to a single period and show
    // wrong (often out-of-balance) totals. Drop `from` for the fetch; keep it for the label.
    const rows = await getAccountBalances({ ...range, from: null });
    return buildBalanceSheet(rows, range);
  },

  /** AR aging (open customer invoices, point-in-time as of today via the view). */
  async getArAging(): Promise<AgingReport> {
    const { data, error } = await acct()
      .from('v_ar_aging')
      .select('*')
      .order('days_overdue', { ascending: false });
    if (error) throw error;
    return buildAgingReport(((data ?? []) as Row[]).map(mapArAgingRow));
  },

  /** AP aging (open vendor bills, point-in-time as of today via the view). */
  async getApAging(): Promise<AgingReport> {
    const { data, error } = await acct()
      .from('v_ap_aging')
      .select('*')
      .order('days_overdue', { ascending: false });
    if (error) throw error;
    return buildAgingReport(((data ?? []) as Row[]).map(mapApAgingRow));
  },

  /**
   * General-ledger account register (#3): every POSTED journal line for one account in
   * the entry-date window, with a running natural-signed balance. The opening balance is
   * the account's cumulative signed natural balance as of the day before the window start
   * (0 when the window has no `from`, i.e. an all-time register). Reads THROW on error.
   */
  async getAccountLedger(accountId: string, range: DateRange = {}): Promise<AccountLedgerReport> {
    // Account header (number/name/normal_balance) — drives the running-balance sign.
    const { data: acctRow, error: acctErr } = await acct()
      .from('accounts')
      .select('id, account_number, name, normal_balance')
      .eq('id', accountId)
      .maybeSingle();
    if (acctErr) throw acctErr;
    const a = (acctRow ?? null) as Row | null;
    const normalBalance = (a?.normal_balance as NormalBalance) ?? 'debit';
    const meta = {
      accountId,
      accountNumber: a?.account_number == null ? null : String(a.account_number),
      name: String(a?.name ?? ''),
      normalBalance,
    };

    // Opening balance: cumulative signed natural balance as of the day before `from`.
    let openingCents = 0;
    if (range.from) {
      const openingRows = await getAccountBalances({ to: dayBefore(range.from), from: null });
      const openingRow = openingRows.find((r) => r.accountId === accountId);
      if (openingRow) {
        const signed = toCents(openingRow.totalDebit) - toCents(openingRow.totalCredit);
        openingCents = normalBalance === 'credit' ? -signed : signed;
      }
    }

    // Posted lines for the account in the window — inner-join the parent entry so we can
    // filter status='posted' + entry_date and read its number/date/memo for display.
    let q = acct()
      .from('journal_lines')
      .select(
        'debit, credit, entry:journal_entries!inner(id, entry_number, entry_date, memo, status)'
      )
      .eq('account_id', accountId)
      .eq('entry.status', 'posted');
    if (range.from) q = q.gte('entry.entry_date', range.from);
    if (range.to) q = q.lte('entry.entry_date', range.to);

    const { data, error } = await q;
    if (error) throw error;

    const lineRows: AccountLedgerLineInput[] = [];
    for (const raw of (data ?? []) as Row[]) {
      const entry = (raw.entry ?? null) as Row | null;
      if (!entry) continue;
      lineRows.push({
        entryId: String(entry.id),
        entryNumber: Number(entry.entry_number ?? 0),
        date: String(entry.entry_date ?? ''),
        memo: entry.memo == null ? null : String(entry.memo),
        debit: Number(raw.debit) || 0,
        credit: Number(raw.credit) || 0,
      });
    }
    // Sort by entry_date then entry_number so the running balance accumulates in order.
    lineRows.sort((x, y) =>
      x.date < y.date ? -1 : x.date > y.date ? 1 : x.entryNumber - y.entryNumber
    );

    return buildAccountLedger(meta, openingCents, lineRows, range);
  },

  /**
   * Statement of Cash Flows (#5), indirect method. Fetches THREE balance sets — an
   * opening cumulative snapshot (day before `from`, or all-zero when no `from`), a
   * closing cumulative snapshot (as of `to`), and the period rows (the window as-is) for
   * net income — plus each account's cash_flow_category, and hands them to the pure
   * builder. Reads THROW on error.
   */
  async getCashFlowStatement(range: DateRange = {}): Promise<CashFlowStatementReport> {
    // Per-account cash-flow category map (income/expense + not-yet-seeded rows are null).
    const { data: catData, error: catErr } = await acct()
      .from('accounts')
      .select('id, cash_flow_category');
    if (catErr) throw catErr;
    const categoryByAccountId = new Map<string, CashFlowCategory | null>();
    for (const raw of (catData ?? []) as Row[]) {
      categoryByAccountId.set(
        String(raw.id),
        raw.cash_flow_category == null ? null : (String(raw.cash_flow_category) as CashFlowCategory)
      );
    }

    const [openingRows, closingRows, periodRows] = await Promise.all([
      // Opening cumulative snapshot: as of the day before `from` (else nothing → all zero).
      range.from
        ? getAccountBalances({ to: dayBefore(range.from), from: null })
        : Promise.resolve([] as AccountBalanceRow[]),
      // Closing cumulative snapshot: as of `to`, never lower-bounded (cumulative).
      getAccountBalances({ ...range, from: null }),
      // Period rows: the window as-is, used only for net income.
      getAccountBalances(range),
    ]);

    return buildCashFlowStatement({
      openingRows,
      closingRows,
      periodRows,
      categoryByAccountId,
      range,
    });
  },
};

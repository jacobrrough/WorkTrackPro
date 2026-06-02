import type {
  AccountBalanceRow,
  AgingReport,
  BalanceSheetReport,
  DateRange,
  ProfitAndLossReport,
  TrialBalanceReport,
} from '../../../features/accounting/types';
import {
  buildAgingReport,
  buildBalanceSheet,
  buildProfitAndLoss,
  buildTrialBalance,
} from '../../../features/accounting/reports/reportMath';
import { acct } from './accountingClient';
import { mapAccountBalanceRow, mapApAgingRow, mapArAgingRow, type Row } from './mappers';

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

  // Windowed path: aggregate posted lines by account in JS (PostgREST can't GROUP BY).
  // Inner-join the parent entry so we can filter on entry_date + status='posted'.
  let q = acct()
    .from('journal_lines')
    .select(
      'debit, credit, account:accounts!inner(id, account_number, name, account_type, normal_balance), entry:journal_entries!inner(entry_date, status)'
    )
    .eq('entry.status', 'posted');
  if (range?.from) q = q.gte('entry.entry_date', range.from);
  if (range?.to) q = q.lte('entry.entry_date', range.to);

  const { data, error } = await q;
  if (error) throw error;

  // Accumulate debit/credit in integer cents keyed by account id.
  interface Acc {
    accountId: string;
    accountNumber: string | null;
    name: string;
    accountType: string;
    normalBalance: string;
    debitCents: number;
    creditCents: number;
  }
  const byAccount = new Map<string, Acc>();
  for (const raw of (data ?? []) as Row[]) {
    const account = (raw.account ?? null) as Row | null;
    if (!account) continue;
    const id = String(account.id);
    let acc = byAccount.get(id);
    if (!acc) {
      acc = {
        accountId: id,
        accountNumber: account.account_number == null ? null : String(account.account_number),
        name: String(account.name ?? ''),
        accountType: String(account.account_type ?? 'asset'),
        normalBalance: String(account.normal_balance ?? 'debit'),
        debitCents: 0,
        creditCents: 0,
      };
      byAccount.set(id, acc);
    }
    acc.debitCents += Math.round((Number(raw.debit) || 0) * 100);
    acc.creditCents += Math.round((Number(raw.credit) || 0) * 100);
  }

  // Re-use the row mapper so the rest of the pipeline is identical to the view path.
  return Array.from(byAccount.values())
    .map((a) =>
      mapAccountBalanceRow({
        account_id: a.accountId,
        account_number: a.accountNumber,
        name: a.name,
        account_type: a.accountType,
        normal_balance: a.normalBalance,
        total_debit: a.debitCents / 100,
        total_credit: a.creditCents / 100,
      })
    )
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
    const rows = await getAccountBalances(range);
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
};

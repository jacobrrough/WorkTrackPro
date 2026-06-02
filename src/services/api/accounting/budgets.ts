import type {
  Budget,
  BudgetCellInput,
  BudgetGrid,
  BudgetLine,
  BudgetVsActualReport,
  CashFlowForecast,
  CashFlowItem,
  NewBudgetInput,
  UpdateBudgetInput,
} from '../../../features/accounting/types';
import {
  buildBudgetGrid,
  buildBudgetVsActual,
  buildCashFlowForecast,
  type BvaAccount,
  type CashFlowForecastOptions,
  type MonthlyActualInput,
} from '../../../features/accounting/reports/budgetMath';
import { toCents } from '../../../features/accounting/accountingViewModel';
import { acct } from './accountingClient';
import { accountsService } from './accounts';
import { mapBudgetLineRow, mapBudgetRow, type Row } from './mappers';

/**
 * D2 — Budgeting & forecasting (accounting.budgets / accounting.budget_lines).
 *
 * A budget is a named plan for a fiscal year; its cells (budget_lines) hold the planned
 * amount per (account, calendar month). Budgets move NO money, so this service has NO
 * posting path — per invariant G3 the post-JE requirement is satisfied vacuously (the
 * only thing persisted is the user-entered plan). The two reports here are READ-ONLY:
 *
 *   • Budget-vs-Actual — actuals are computed from POSTED journal lines (status =
 *     'posted') aggregated by account/month, the SAME basis as accounting.v_trial_balance,
 *     so a BvA actual ties to the trial balance for the same fiscal year.
 *   • Cash-flow forecast — projects open AR (cash in) minus open AP (cash out) from the
 *     v_ar_aging / v_ap_aging views' due_date / balance_due columns.
 *
 * Reads THROW (React Query surfaces them); writes return a result object whose `error`
 * carries the DB message (e.g. the unique (name, fiscal_year) violation) for inline display.
 */

const SELECT_LINE_DETAIL = '*, account:accounts(name, account_number)';

export const budgetsService = {
  // ── Budget headers ──────────────────────────────────────────────────────────

  /** All budgets, newest fiscal year first then name. */
  async list(): Promise<Budget[]> {
    const { data, error } = await acct()
      .from('budgets')
      .select('*')
      .order('fiscal_year', { ascending: false })
      .order('name', { ascending: true });
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapBudgetRow);
  },

  /** A single budget header. */
  async getById(id: string): Promise<Budget | null> {
    const { data, error } = await acct().from('budgets').select('*').eq('id', id).maybeSingle();
    if (error || !data) return null;
    return mapBudgetRow(data as Row);
  },

  /**
   * Create a budget header. `fiscalYear` + `name` are unique together (DB constraint);
   * a collision comes back as `{ budget: null, error }` rather than throwing.
   */
  async create(input: NewBudgetInput): Promise<{ budget: Budget | null; error?: string }> {
    const name = input.name?.trim();
    if (!name) return { budget: null, error: 'A budget needs a name.' };
    if (!Number.isInteger(input.fiscalYear) || input.fiscalYear < 2000 || input.fiscalYear > 2100) {
      return { budget: null, error: 'Fiscal year must be a year between 2000 and 2100.' };
    }
    const { data, error } = await acct()
      .from('budgets')
      .insert({
        name,
        fiscal_year: input.fiscalYear,
        status: input.status ?? 'draft',
        description: input.description?.trim() || null,
      })
      .select('*')
      .single();
    if (error || !data) return { budget: null, error: error?.message ?? 'Failed to create budget.' };
    return { budget: mapBudgetRow(data as Row) };
  },

  /** Patch a budget header (name / fiscal year / status / description). */
  async update(id: string, input: UpdateBudgetInput): Promise<{ budget: Budget | null; error?: string }> {
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) return { budget: null, error: 'A budget needs a name.' };
      patch.name = name;
    }
    if (input.fiscalYear !== undefined) {
      if (!Number.isInteger(input.fiscalYear) || input.fiscalYear < 2000 || input.fiscalYear > 2100) {
        return { budget: null, error: 'Fiscal year must be a year between 2000 and 2100.' };
      }
      patch.fiscal_year = input.fiscalYear;
    }
    if (input.status !== undefined) patch.status = input.status;
    if (input.description !== undefined) patch.description = input.description?.trim() || null;
    if (Object.keys(patch).length === 0) return { budget: await this.getById(id) };

    const { data, error } = await acct().from('budgets').update(patch).eq('id', id).select('*').single();
    if (error || !data) return { budget: null, error: error?.message ?? 'Failed to update budget.' };
    return { budget: mapBudgetRow(data as Row) };
  },

  /** Set just the lifecycle status (draft → active → archived). */
  async setStatus(id: string, status: Budget['status']): Promise<{ budget: Budget | null; error?: string }> {
    return this.update(id, { status });
  },

  /**
   * Delete a budget. budget_lines cascade away (ON DELETE CASCADE). Returns a write-style
   * result; on failure `error` carries the DB message.
   */
  async remove(id: string): Promise<{ ok: boolean; error?: string }> {
    const { error } = await acct().from('budgets').delete().eq('id', id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  // ── Budget lines (the cells) ──────────────────────────────────────────────────

  /** Raw saved cells for a budget (account name/number hydrated), for ad-hoc callers/tests. */
  async listLines(budgetId: string): Promise<BudgetLine[]> {
    const { data, error } = await acct()
      .from('budget_lines')
      .select(SELECT_LINE_DETAIL)
      .eq('budget_id', budgetId)
      .order('period_month', { ascending: true });
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapBudgetLineRow);
  },

  /**
   * Assemble the editor grid: the budget header + every active chart account as a row
   * with its 12 planned cells (0 where blank), plus per-month and grand totals. The UI
   * lane renders this with CurrencyInput; this only builds the data. Throws if the
   * budget id is unknown (so the screen can show a not-found state).
   */
  async getGrid(budgetId: string): Promise<BudgetGrid> {
    const budget = await this.getById(budgetId);
    if (!budget) throw new Error('Budget not found.');
    const [accounts, lines] = await Promise.all([accountsService.getAll(), this.listLines(budgetId)]);
    // Budget the ACTIVE chart (an inactive account can still hold legacy cells, but the
    // grid is the editable plan going forward — matches how the dimensions UI budgets).
    const activeAccounts = accounts.filter((a) => a.isActive);
    const { rows, monthlyTotals, grandTotal } = buildBudgetGrid(activeAccounts, lines);
    return { budget, rows, monthlyTotals, grandTotal };
  },

  /**
   * Save the editor grid: replace this budget's lines with exactly the non-zero cells
   * passed in. Zero/blank cells are NOT persisted (a cleared cell is simply absent), so
   * the table is the single source of truth for the plan. Implemented as delete-all +
   * insert-non-zero in one logical save (mirrors how the invoice/bill services replace
   * their line sets). Moves no money → posts no journal entry. Returns the saved count.
   */
  async replaceLines(
    budgetId: string,
    cells: BudgetCellInput[]
  ): Promise<{ ok: boolean; saved: number; error?: string }> {
    const budget = await this.getById(budgetId);
    if (!budget) return { ok: false, saved: 0, error: 'Budget not found.' };

    // Keep only valid, non-zero cells; collapse any duplicate (account, month) by summing
    // cents so a malformed grid can never violate the unique key or silently lose dollars.
    const byKey = new Map<string, { accountId: string; periodMonth: number; cents: number }>();
    for (const c of cells) {
      const m = c.periodMonth;
      if (!c.accountId || !Number.isInteger(m) || m < 1 || m > 12) continue;
      const cents = toCents(c.amount);
      if (cents === 0) continue;
      const key = `${c.accountId}:${m}`;
      const existing = byKey.get(key);
      if (existing) existing.cents += cents;
      else byKey.set(key, { accountId: c.accountId, periodMonth: m, cents });
    }

    // Replace the whole set: clear existing cells, then insert the kept ones.
    const { error: delErr } = await acct().from('budget_lines').delete().eq('budget_id', budgetId);
    if (delErr) return { ok: false, saved: 0, error: delErr.message };

    const rows = Array.from(byKey.values()).map((c) => ({
      budget_id: budgetId,
      account_id: c.accountId,
      period_month: c.periodMonth,
      amount: c.cents / 100,
    }));
    if (rows.length === 0) return { ok: true, saved: 0 };

    const { error: insErr } = await acct().from('budget_lines').insert(rows);
    if (insErr) return { ok: false, saved: 0, error: insErr.message };
    return { ok: true, saved: rows.length };
  },

  // ── Budget vs Actual report ───────────────────────────────────────────────────

  /**
   * Budget-vs-Actual for a budget's fiscal year. Actuals are read from POSTED journal
   * lines (status = 'posted') joined to their entry, filtered to the fiscal-year window
   * [Jan 1, Dec 31], and aggregated by account + entry-date month in JS (PostgREST can't
   * GROUP BY) — the SAME posted basis as accounting.v_trial_balance, so the report's
   * actual column ties to the trial balance for the year. Read-only; nothing posts.
   */
  async getBudgetVsActual(budgetId: string): Promise<BudgetVsActualReport> {
    const budget = await this.getById(budgetId);
    if (!budget) throw new Error('Budget not found.');

    const fy = budget.fiscalYear;
    const yearStart = `${fy}-01-01`;
    const yearEnd = `${fy}-12-31`;

    const [accounts, lines, actuals] = await Promise.all([
      accountsService.getAll(),
      this.listLines(budgetId),
      fetchMonthlyActuals(yearStart, yearEnd),
    ]);

    // Report on the same chart the grid budgets against (active accounts), but also keep
    // any account that already carries a saved budget line so an archived/legacy plan
    // still shows its actual. The pure builder drops accounts with neither.
    const budgetedIds = new Set(lines.map((l) => l.accountId));
    const reportable: BvaAccount[] = accounts
      .filter((a) => a.isActive || budgetedIds.has(a.id))
      .map((a) => ({
        id: a.id,
        accountNumber: a.accountNumber,
        name: a.name,
        accountType: a.accountType,
        normalBalance: a.normalBalance,
      }));

    const { rows, totalBudgetCents, totalActualCents } = buildBudgetVsActual(reportable, lines, actuals);
    return {
      budgetId,
      budgetName: budget.name,
      fiscalYear: fy,
      rows,
      totalBudget: Math.round(totalBudgetCents) / 100,
      totalActual: Math.round(totalActualCents) / 100,
      totalVariance: Math.round(totalActualCents - totalBudgetCents) / 100,
    };
  },

  // ── Cash-flow forecast ────────────────────────────────────────────────────────

  /** Open AR/AP items (balance_due > 0) with their due dates, for the forecast. */
  async getCashFlowItems(): Promise<CashFlowItem[]> {
    const [ar, ap] = await Promise.all([
      acct().from('v_ar_aging').select('invoice_id, invoice_number, customer_name, due_date, balance_due'),
      acct().from('v_ap_aging').select('bill_id, bill_number, vendor_name, due_date, balance_due'),
    ]);
    if (ar.error) throw ar.error;
    if (ap.error) throw ap.error;

    const inflows: CashFlowItem[] = ((ar.data ?? []) as Row[]).map((r) => ({
      documentId: String(r.invoice_id ?? ''),
      documentNumber: r.invoice_number == null ? null : String(r.invoice_number),
      partyName: String(r.customer_name ?? ''),
      dueDate: r.due_date == null ? null : String(r.due_date),
      amount: Number(r.balance_due) || 0,
      direction: 'inflow',
    }));
    const outflows: CashFlowItem[] = ((ap.data ?? []) as Row[]).map((r) => ({
      documentId: String(r.bill_id ?? ''),
      documentNumber: r.bill_number == null ? null : String(r.bill_number),
      partyName: String(r.vendor_name ?? ''),
      dueDate: r.due_date == null ? null : String(r.due_date),
      amount: Number(r.balance_due) || 0,
      direction: 'outflow',
    }));
    return [...inflows, ...outflows];
  },

  /**
   * Cash-flow forecast: project the opening cash position forward across monthly buckets
   * using open AR (inflows) and AP (outflows) due dates. The opening balance defaults to
   * 0 (the UI lane can pass the current cash/bank balance). Read-only projection — books
   * nothing. See buildCashFlowForecast for the bucketing rules.
   */
  async getCashFlowForecast(options: CashFlowForecastOptions = {}): Promise<CashFlowForecast> {
    const items = await this.getCashFlowItems();
    return buildCashFlowForecast(items, options);
  },
};

/**
 * Read posted journal lines in [from, to] and aggregate them by account + entry-date
 * month into MonthlyActualInput rows (debit/credit dollars per account/month). Mirrors
 * the windowed path in reportsService.getAccountBalances: inner-join the parent entry so
 * we can filter on entry_date + status='posted', then group in JS (cents) — the same
 * posted basis as accounting.v_trial_balance. Exported indirectly via the service.
 */
async function fetchMonthlyActuals(from: string, to: string): Promise<MonthlyActualInput[]> {
  const { data, error } = await acct()
    .from('journal_lines')
    .select('debit, credit, account_id, entry:journal_entries!inner(entry_date, status)')
    .eq('entry.status', 'posted')
    .gte('entry.entry_date', from)
    .lte('entry.entry_date', to);
  if (error) throw error;

  // Accumulate debit/credit cents keyed by `${accountId}:${month}`.
  interface Acc {
    accountId: string;
    month: number;
    debitCents: number;
    creditCents: number;
  }
  const byKey = new Map<string, Acc>();
  for (const raw of (data ?? []) as Row[]) {
    const accountId = String(raw.account_id ?? '');
    if (!accountId) continue;
    const entry = (raw.entry ?? null) as Row | null;
    const entryDate = entry ? String(entry.entry_date ?? '') : '';
    const month = monthOf(entryDate);
    if (month < 1 || month > 12) continue;
    const key = `${accountId}:${month}`;
    let acc = byKey.get(key);
    if (!acc) {
      acc = { accountId, month, debitCents: 0, creditCents: 0 };
      byKey.set(key, acc);
    }
    acc.debitCents += toCents(Number(raw.debit) || 0);
    acc.creditCents += toCents(Number(raw.credit) || 0);
  }

  return Array.from(byKey.values()).map((a) => ({
    accountId: a.accountId,
    month: a.month,
    debit: a.debitCents / 100,
    credit: a.creditCents / 100,
  }));
}

/** Calendar month 1-12 from an ISO `YYYY-MM-DD` (0 if unparseable). */
function monthOf(iso: string): number {
  const m = /^\d{4}-(\d{2})-\d{2}/.exec(iso);
  return m ? Number(m[1]) : 0;
}

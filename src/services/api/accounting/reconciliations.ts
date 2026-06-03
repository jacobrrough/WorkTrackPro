import type {
  NewReconciliationInput,
  Reconciliation,
  ReconciliationSummary,
} from '../../../features/accounting/types';
import { computeReconciliationSummary } from '../../../features/accounting/posting';
import { acct } from './accountingClient';
import { mapReconciliationRow, type Row } from './mappers';

/**
 * Statement reconciliations (accounting.reconciliations). A reconciliation is a
 * statement header; transactions are cleared against it by stamping
 * bank_transactions.reconciliation_id + cleared_at (migration 012). The live
 * reconcile math (beginning + Σ cleared == ending) is computed by the pure
 * computeReconciliationSummary so the difference is penny-exact.
 *
 * Reconciliation does NOT post journal entries — it is a matching/clearing exercise
 * over transactions that already posted when they were categorized. Completing a
 * reconciliation only flips status, stamps reconciled_at, and updates the bank
 * account's last_reconciled_at.
 *
 * Reads throw; writes return a result object carrying any DB error.
 */
export const reconciliationsService = {
  async list(bankAccountId?: string, limit = 100): Promise<Reconciliation[]> {
    let q = acct()
      .from('reconciliations')
      .select('*')
      .order('statement_date', { ascending: false })
      .limit(limit);
    if (bankAccountId) q = q.eq('bank_account_id', bankAccountId);
    const { data, error } = await q;
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapReconciliationRow);
  },

  async getById(id: string): Promise<Reconciliation | null> {
    const { data, error } = await acct()
      .from('reconciliations')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    return mapReconciliationRow(data as Row);
  },

  /**
   * Start a reconciliation. When `beginningBalance` is omitted it defaults to the
   * prior completed reconciliation's ending balance (or 0 if this is the first), so
   * statements chain without re-keying the opening figure.
   */
  async create(
    input: NewReconciliationInput
  ): Promise<{ reconciliation: Reconciliation | null; error?: string }> {
    let beginning = input.beginningBalance;
    if (beginning == null) {
      const { data: prior } = await acct()
        .from('reconciliations')
        .select('statement_ending_balance')
        .eq('bank_account_id', input.bankAccountId)
        .eq('status', 'completed')
        .order('statement_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      const v = (prior as Row | null)?.statement_ending_balance;
      beginning = v == null ? 0 : Number(v);
    }
    const { data, error } = await acct()
      .from('reconciliations')
      .insert({
        bank_account_id: input.bankAccountId,
        statement_date: input.statementDate,
        statement_ending_balance: input.statementEndingBalance ?? null,
        beginning_balance: beginning,
        status: 'in_progress',
      })
      .select('*')
      .single();
    if (error || !data) {
      return { reconciliation: null, error: error?.message ?? 'Failed to start reconciliation.' };
    }
    return { reconciliation: mapReconciliationRow(data as Row) };
  },

  /** Patch the statement figures while a reconciliation is in progress. */
  async update(
    id: string,
    patch: {
      statementDate?: string;
      statementEndingBalance?: number | null;
      beginningBalance?: number | null;
    }
  ): Promise<{ reconciliation: Reconciliation | null; error?: string }> {
    const row: Record<string, unknown> = {};
    if (patch.statementDate !== undefined) row.statement_date = patch.statementDate;
    if (patch.statementEndingBalance !== undefined)
      row.statement_ending_balance = patch.statementEndingBalance;
    if (patch.beginningBalance !== undefined) row.beginning_balance = patch.beginningBalance;
    const { data, error } = await acct()
      .from('reconciliations')
      .update(row)
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) {
      return { reconciliation: null, error: error?.message ?? 'Failed to update reconciliation.' };
    }
    return { reconciliation: mapReconciliationRow(data as Row) };
  },

  /**
   * Mark a transaction cleared (or uncleared) against this reconciliation. Clearing
   * stamps reconciliation_id + cleared_at; unclearing nulls both. Only posted/matched
   * or categorized transactions should be cleared (the UI restricts this), but the DB
   * accepts the stamp on any of the bank account's rows.
   */
  async setCleared(
    reconciliationId: string,
    bankTransactionId: string,
    cleared: boolean
  ): Promise<{ ok: boolean; error?: string }> {
    const rec = await this.getById(reconciliationId);
    if (!rec) return { ok: false, error: 'Reconciliation not found.' };
    const row = cleared
      ? { reconciliation_id: reconciliationId, cleared_at: new Date().toISOString() }
      : { reconciliation_id: null, cleared_at: null };
    // Scope to the reconciliation's own account so a transaction id from another
    // bank account can never be stamped into (or unstamped from) this reconcile.
    const { error } = await acct()
      .from('bank_transactions')
      .update(row)
      .eq('id', bankTransactionId)
      .eq('bank_account_id', rec.bankAccountId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  /** Clear/unclear many transactions at once (e.g. "clear all matched"). */
  async setClearedMany(
    reconciliationId: string,
    bankTransactionIds: string[],
    cleared: boolean
  ): Promise<{ ok: boolean; error?: string }> {
    if (bankTransactionIds.length === 0) return { ok: true };
    const rec = await this.getById(reconciliationId);
    if (!rec) return { ok: false, error: 'Reconciliation not found.' };
    const row = cleared
      ? { reconciliation_id: reconciliationId, cleared_at: new Date().toISOString() }
      : { reconciliation_id: null, cleared_at: null };
    // Scope to the reconciliation's own account so ids belonging to other bank
    // accounts in the batch are silently skipped rather than mis-stamped.
    const { error } = await acct()
      .from('bank_transactions')
      .update(row)
      .in('id', bankTransactionIds)
      .eq('bank_account_id', rec.bankAccountId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  /**
   * The transactions currently cleared against a reconciliation (for the screen).
   * Scoped to the reconciliation's bank account so a stray cross-account stamp can
   * never leak into the reconcile math. Callers that already hold the reconciliation
   * (e.g. getSummary) can pass `bankAccountId` to skip the lookup; otherwise it is
   * resolved here and an unknown reconciliation yields no amounts.
   */
  async clearedAmounts(reconciliationId: string, bankAccountId?: string): Promise<number[]> {
    let accountId = bankAccountId;
    if (accountId == null) {
      const rec = await this.getById(reconciliationId);
      if (!rec) return [];
      accountId = rec.bankAccountId;
    }
    const { data, error } = await acct()
      .from('bank_transactions')
      .select('amount')
      .eq('reconciliation_id', reconciliationId)
      .eq('bank_account_id', accountId);
    if (error) throw error;
    return ((data ?? []) as Row[]).map((r) => Number(r.amount) || 0);
  },

  /** Live reconcile math: beginning + Σ(cleared) vs. the statement ending balance. */
  async getSummary(id: string): Promise<ReconciliationSummary | null> {
    const rec = await this.getById(id);
    if (!rec) return null;
    const amounts = await this.clearedAmounts(id, rec.bankAccountId);
    return computeReconciliationSummary({
      beginningBalance: rec.beginningBalance,
      statementEndingBalance: rec.statementEndingBalance,
      clearedAmounts: amounts,
    });
  },

  /**
   * Complete a reconciliation. Refuses unless the cleared transactions reconcile the
   * statement to the penny (difference == 0). On success: flips status to `completed`,
   * stamps reconciled_at, and updates the bank account's last_reconciled_at so the
   * next statement's beginning balance can chain from here.
   */
  async complete(id: string): Promise<{ reconciliation: Reconciliation | null; error?: string }> {
    const rec = await this.getById(id);
    if (!rec) return { reconciliation: null, error: 'Reconciliation not found.' };
    if (rec.status === 'completed') return { reconciliation: rec };

    const summary = await this.getSummary(id);
    if (!summary) return { reconciliation: null, error: 'Reconciliation not found.' };
    if (!summary.reconciled) {
      return {
        reconciliation: null,
        error: `Statement is off by ${summary.difference.toFixed(2)} — clear/uncluster transactions until the difference is 0.00.`,
      };
    }

    const now = new Date().toISOString();
    const { data, error } = await acct()
      .from('reconciliations')
      .update({ status: 'completed', reconciled_at: now })
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) {
      return {
        reconciliation: null,
        error: error?.message ?? 'Failed to complete reconciliation.',
      };
    }
    // Best-effort: stamp the bank account's last_reconciled_at (non-fatal if it fails).
    await acct()
      .from('bank_accounts')
      .update({ last_reconciled_at: rec.statementDate })
      .eq('id', rec.bankAccountId);
    return { reconciliation: mapReconciliationRow(data as Row) };
  },
};

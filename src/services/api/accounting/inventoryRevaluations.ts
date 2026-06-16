import type {
  InventoryRevaluation,
  InventoryRevaluationStatus,
  PostRevaluationResult,
} from '../../../features/accounting/types';
import { acct } from './accountingClient';
import { mapInventoryRevaluationRow, type Row } from './mappers';

/**
 * Gated inventory revaluations (migration 20260616000002–03, decision 1 "Gated
 * revaluation"). When the per-unit COST of stock already on hand changes, the cost VALUE
 * is synced on both sides instantly (by the price-history trigger), but the JOURNAL ENTRY
 * that moves GL 1300 is NOT auto-posted — a PENDING row lands in
 * accounting.inventory_revaluations and an accountant posts it in an APPROVED batch here.
 *
 *  • listPending()  → the queue the reconciliation screen shows (at most one pending row
 *                     per stock item; successive cost edits collapse into it).
 *  • postBatch(ids) → accounting.post_inventory_revaluation(uuid[]): posts ONE BALANCED JE
 *                     for the batch (Dr/Cr 1300 ↔ 1310 by the signed net), re-marks each
 *                     affected item's open FIFO layers to the new cost, and closes the
 *                     pending rows. Returns the posted journal_entry_id, or null when the
 *                     batch nets to zero cents (no GL movement — rows still close). Skips
 *                     ids that are not pending, so a re-run is a no-op.
 *
 * The DB owns the money math + atomic layer re-marking; this service is the thin app seam.
 * Reads THROW so React Query surfaces them; postBatch returns a result object whose `error`
 * carries the DB message (an RLS denial, missing default accounts, …) for inline display.
 * Only accounting.* is written.
 */

/** A scalar-returning RPC call surfaces its uuid|null payload as a plain string|null. */
function rpcScalar(data: unknown): string | null {
  return data == null ? null : String(data);
}

export const inventoryRevaluationsService = {
  /**
   * The pending-revaluation work list (newest-enqueued first), optionally filtered to one
   * stock item. Each row carries the previewed Δ (on_hand_qty × (new − old)); the poster
   * recomputes the actual GL movement in cents at post time.
   */
  async listPending(sourceInventoryId?: string, limit = 200): Promise<InventoryRevaluation[]> {
    let q = acct()
      .from('inventory_revaluations')
      .select('*')
      .eq('status', 'pending' satisfies InventoryRevaluationStatus)
      .order('enqueued_at', { ascending: false })
      .limit(limit);
    if (sourceInventoryId) q = q.eq('source_inventory_id', sourceInventoryId);
    const { data, error } = await q;
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapInventoryRevaluationRow);
  },

  /**
   * Revaluation rows by status (default 'posted'), for an audit/history view. Posted rows
   * carry their journal_entry_id (null for a zero-Δ no-op post).
   */
  async listByStatus(
    status: InventoryRevaluationStatus = 'posted',
    limit = 200
  ): Promise<InventoryRevaluation[]> {
    const { data, error } = await acct()
      .from('inventory_revaluations')
      .select('*')
      .eq('status', status)
      .order('posted_at', { ascending: false, nullsFirst: false })
      .limit(limit);
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapInventoryRevaluationRow);
  },

  /** A single revaluation row, or null when absent. */
  async getById(id: string): Promise<InventoryRevaluation | null> {
    const { data, error } = await acct()
      .from('inventory_revaluations')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    return mapInventoryRevaluationRow(data as Row);
  },

  /**
   * Post a batch of pending revaluations. Delegates entirely to
   * accounting.post_inventory_revaluation, which posts the single balanced JE and re-marks
   * the open layers atomically.
   *
   * Interpreting the RPC's scalar return:
   *   • a uuid → the batch's revaluation JE was posted (a non-zero net moved GL 1300).
   *   • null   → either the batch netted to zero cents (no JE, rows still closed) OR no
   *              targeted id was still pending (idempotent re-run). Both are successful
   *              no-money outcomes; `posted` reflects whether anything was actionable —
   *              we cannot distinguish them from the scalar alone, so an empty id list is
   *              treated as not-posted and a non-empty call as posted (rows were closed or
   *              already closed). The UI invalidates either way.
   * A DB error (RLS denial, missing default accounts, an unbalanced entry — which cannot
   * happen here by construction) is returned as `error`.
   */
  async postBatch(revaluationIds: string[]): Promise<PostRevaluationResult> {
    if (revaluationIds.length === 0) {
      return { journalEntryId: null, posted: false };
    }
    const { data, error } = await acct().rpc('post_inventory_revaluation', {
      p_revaluation_ids: revaluationIds,
    });
    if (error) return { journalEntryId: null, posted: false, error: error.message };
    const journalEntryId = rpcScalar(data);
    // A uuid means a JE posted; a null means net-zero/no-op — both ran without error, so
    // the batch is considered processed (the rows were closed or were already not pending).
    return { journalEntryId, posted: true };
  },

  /** Post every currently-pending revaluation (the "post all" action). */
  async postAllPending(): Promise<PostRevaluationResult> {
    const pending = await this.listPending(undefined, 1000);
    return this.postBatch(pending.map((r) => r.id));
  },
};

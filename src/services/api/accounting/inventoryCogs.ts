import type {
  ConsumableJob,
  ConsumeJobCogsResult,
  InventoryCogsEvent,
  InventoryValuationRow,
  ReceiveLayerResult,
} from '../../../features/accounting/types';
import { supabase } from '../supabaseClient';
import { acct } from './accountingClient';
import {
  mapInventoryCogsEventRow,
  mapInventoryValuationRow,
  type Row,
} from './mappers';

/**
 * B3 — inventory valuation (FIFO) → COGS. Bridges the EXISTING public job-consumption
 * moment to double-entry COGS, additively and read-only against public.* (G1/G4).
 *
 * The DB owns the money math; this service is the thin app seam that invokes it:
 *
 *  • receiveLayerFromBillLine(billLineId)
 *      → accounting.receive_inventory_layer(uuid): seeds a FIFO cost LAYER from a posted
 *        inventory bill line's unit_cost. Idempotent (re-receiving returns the same layer).
 *        Posts NO journal entry — the 1300 inventory-asset debit was already booked when
 *        the bill posted (A2: Dr 1300 / Cr 2000). Receiving only records cost for later
 *        FIFO relief, so there is no double-count.
 *
 *  • consumeJobCogs(jobId)
 *      → accounting.consume_job_cogs(uuid): reads public.jobs.consumed_at + public.job_inventory
 *        READ-ONLY, FIFO-depletes open cost layers oldest-first under row locks, and posts ONE
 *        BALANCED journal entry through accounting.post_journal_entry —
 *            Dr 5000 Cost of Goods Sold   = FIFO-consumed cost
 *            Cr 1300 Inventory Asset      = FIFO-consumed cost
 *        — recording one immutable inventory_cogs_events row per consumed stock item. The RPC
 *        is the ONLY safe place to do this (atomic layer depletion + balanced post in one
 *        transaction). It returns the posted journal_entry_id, the existing one on an idempotent
 *        re-call, or NULL when nothing is costable (legacy/opening stock received outside a bill
 *        → no layer). A NULL is surfaced here as an UNCOSTED job (no phantom cost is booked) so
 *        the work list can flag it for an opening-cost-layer seed.
 *
 *  • valuation() / getValuationFor() — read accounting.v_inventory_valuation (asset value
 *    ties to GL 1300; weighted-avg cost; lifetime COGS).
 *  • listCogsEvents() — the audit trail of posted COGS, optionally per job.
 *  • listConsumableJobs() — the work list: jobs whose stock was consumed (public.jobs.consumed_at)
 *    and whether COGS has been posted yet (an event exists).
 *
 * Reads THROW so React Query surfaces them; the two RPC writers return result objects whose
 * `error` carries the DB message (e.g. an unbalanced-entry rejection, an RLS denial) so the UI
 * can show it inline. Only accounting.* is written; public.* is read read-only.
 */

/** A scalar-returning RPC call surfaces its uuid|null payload as a plain string|null. */
function rpcScalar(data: unknown): string | null {
  return data == null ? null : String(data);
}

export const inventoryCogsService = {
  /**
   * Seed (or fetch) the FIFO cost layer for a posted inventory bill line. Idempotent:
   * the DB returns the existing layer id if one already exists for the line. Returns the
   * layer id, or an error message (no source_inventory_id, non-positive qty, RLS, …).
   * Posts no JE by design.
   */
  async receiveLayerFromBillLine(billLineId: string): Promise<ReceiveLayerResult> {
    const { data, error } = await acct().rpc('receive_inventory_layer', {
      p_bill_line_id: billLineId,
    });
    if (error) return { layerId: null, error: error.message };
    return { layerId: rpcScalar(data) };
  },

  /**
   * Post FIFO COGS for a job that has consumed inventory. Delegates entirely to
   * accounting.consume_job_cogs, which posts the balanced Dr 5000 / Cr 1300 entry and
   * records the consumption events atomically.
   *
   * Interpreting the RPC's scalar return:
   *   • a uuid  → a COGS entry is posted (or already existed); costed = true.
   *   • null    → nothing was costable (no open layers / opening stock with no bill);
   *               costed = false, uncosted = true (the UI should offer an opening layer).
   * A DB error (RLS denial, job not consumed yet, missing default accounts, an unbalanced
   * entry) is returned as `error` with costed/uncosted both false.
   */
  async consumeJobCogs(jobId: string): Promise<ConsumeJobCogsResult> {
    const { data, error } = await acct().rpc('consume_job_cogs', { p_job_id: jobId });
    if (error) {
      return { jobId, journalEntryId: null, costed: false, uncosted: false, error: error.message };
    }
    const journalEntryId = rpcScalar(data);
    return {
      jobId,
      journalEntryId,
      costed: journalEntryId != null,
      uncosted: journalEntryId == null,
    };
  },

  /**
   * Per-stock-item inventory valuation (accounting.v_inventory_valuation). On-hand qty,
   * FIFO asset value (ties to GL 1300), weighted-avg unit cost, and lifetime COGS. Rows
   * with zero on-hand AND zero lifetime COGS are dropped (nothing to show). Sorted by
   * asset value descending so the most valuable stock leads the report.
   */
  async valuation(): Promise<InventoryValuationRow[]> {
    const { data, error } = await acct().from('v_inventory_valuation').select('*');
    if (error) throw error;
    const rows = ((data ?? []) as Row[]).map(mapInventoryValuationRow);
    return rows
      .filter((r) => r.qtyOnHand !== 0 || r.cogsTotal !== 0 || r.qtyReceivedTotal !== 0)
      .sort((a, b) => b.assetValue - a.assetValue);
  },

  /** One stock item's valuation row (for a detail drill-down), or null when absent. */
  async getValuationFor(sourceInventoryId: string): Promise<InventoryValuationRow | null> {
    const { data, error } = await acct()
      .from('v_inventory_valuation')
      .select('*')
      .eq('source_inventory_id', sourceInventoryId)
      .maybeSingle();
    if (error || !data) return null;
    return mapInventoryValuationRow(data as Row);
  },

  /**
   * Posted COGS consumption events (newest first), optionally for a single job. Each row
   * is one consumed stock item tied to its balanced COGS journal entry — the audit trail
   * behind cogs_total in the valuation view.
   */
  async listCogsEvents(jobId?: string, limit = 200): Promise<InventoryCogsEvent[]> {
    let query = acct()
      .from('inventory_cogs_events')
      .select('*')
      .order('consumed_at', { ascending: false })
      .limit(limit);
    if (jobId) query = query.eq('job_id', jobId);
    const { data, error } = await query;
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapInventoryCogsEventRow);
  },

  /**
   * The COGS work list: jobs that have CONSUMED stock (public.jobs.consumed_at IS NOT NULL),
   * each flagged with whether COGS has already been posted (a consumption event exists).
   *
   * ISOLATION: public.jobs is read READ-ONLY via the default client (the core app reads it
   * the same way); only accounting.inventory_cogs_events is read via the accounting client.
   * The "costed" join is computed in JS (one event row per consumed item all share the job's
   * single COGS JE, so we collapse to job → journal_entry_id). Newest-consumed first.
   */
  async listConsumableJobs(limit = 200): Promise<ConsumableJob[]> {
    const { data: jobRows, error: jErr } = await supabase
      .from('jobs')
      .select('id, job_code, name, status, consumed_at')
      .not('consumed_at', 'is', null)
      .order('consumed_at', { ascending: false })
      .limit(limit);
    if (jErr) throw jErr;

    const jobs = (jobRows ?? []) as Row[];
    if (jobs.length === 0) return [];

    // Which of these jobs already have a posted COGS entry? One read of the events table,
    // scoped to just the jobs in hand, collapsed to job_id → journal_entry_id.
    const jobIds = jobs.map((j) => String(j.id));
    const { data: eventRows, error: eErr } = await acct()
      .from('inventory_cogs_events')
      .select('job_id, journal_entry_id')
      .in('job_id', jobIds);
    if (eErr) throw eErr;

    const postedByJob = new Map<string, string>();
    for (const r of (eventRows ?? []) as Row[]) {
      const jid = r.job_id == null ? null : String(r.job_id);
      if (jid && !postedByJob.has(jid)) postedByJob.set(jid, String(r.journal_entry_id));
    }

    return jobs.map((j): ConsumableJob => {
      const id = String(j.id);
      const journalEntryId = postedByJob.get(id) ?? null;
      return {
        jobId: id,
        jobCode: j.job_code == null ? null : String(j.job_code),
        name: j.name == null ? '' : String(j.name),
        status: j.status == null ? null : String(j.status),
        consumedAt: j.consumed_at == null ? '' : String(j.consumed_at),
        costed: journalEntryId != null,
        journalEntryId,
      };
    });
  },
};

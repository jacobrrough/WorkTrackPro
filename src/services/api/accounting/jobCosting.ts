import type { JobCostingRow } from '../../../features/accounting/types';
import { sortJobCosting } from '../../../features/accounting/jobCosting';
import { acct } from './accountingClient';
import { mapJobCostingRow, type Row } from './mappers';

/**
 * B1 — read-only job costing. Every figure derives from the already-shipped
 * `accounting.v_job_costing` view (security_invoker, so the caller's RLS applies:
 * accounting.can_read on accounting tables, public.is_approved_user on the core
 * tables the view reads). This service NEVER writes — there is no money movement
 * and no journal entry on this surface; it is a pure reporting read.
 *
 * The view supplies revenue, material_cost, labor_minutes, labor_cost and margin
 * per job; the derived margin % and any sorting/totaling live in the pure
 * src/features/accounting/jobCosting.ts helpers (integer-cents math).
 *
 * Reads THROW on error so React Query surfaces them (service convention).
 *
 * NOTE (caption in the UI): `labor_cost` is a reporting approximation (worked
 * minutes ÷ 60 × org labor_rate); authoritative costing is calculatePartQuote.
 * `revenue` includes lines of non-void invoices (drafts included), so it can be
 * higher than sent/posted revenue.
 */
export const jobCostingService = {
  /**
   * Per-job profitability rows, sorted most-profitable-first (margin desc) by
   * default so the dashboard leads with its headline. Callers may re-sort client
   * side via sortJobCosting without another round-trip.
   */
  async list(): Promise<JobCostingRow[]> {
    const { data, error } = await acct().from('v_job_costing').select('*');
    if (error) throw error;
    const rows = ((data ?? []) as Row[]).map(mapJobCostingRow);
    return sortJobCosting(rows, 'margin', 'desc');
  },

  /**
   * One job's costing row (for the per-job detail screen), or null when the job
   * has no row (e.g. an unknown id). The view is keyed 1:1 on public.jobs.id.
   */
  async getByJobId(jobId: string): Promise<JobCostingRow | null> {
    const { data, error } = await acct()
      .from('v_job_costing')
      .select('*')
      .eq('job_id', jobId)
      .maybeSingle();
    if (error || !data) return null;
    return mapJobCostingRow(data as Row);
  },
};

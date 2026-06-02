/**
 * Pure job-costing helpers (B1). No React, no Supabase — trivially unit-testable
 * (see jobCosting.test.ts). All ratio/threshold math runs in integer cents so a
 * margin percentage never drifts on floating-point error, mirroring the rest of
 * the accounting module (accountingViewModel.toCents, reportMath).
 */
import type { JobCostingRow, JobCostingSortKey, SortDirection } from './types';
import { toCents } from './accountingViewModel';

/**
 * Margin as a percentage of revenue, computed in integer cents.
 *
 *   marginPct = round( margin / revenue * 100, 1 )   when revenue > 0
 *
 * DIVIDE-BY-ZERO: a job with zero revenue has no meaningful margin ratio, so this
 * returns `null` (the UI shows an em-dash) rather than Infinity/NaN — even when a
 * cost was incurred (margin would be negative). Callers that sort treat null as
 * the lowest value so unworked/unbilled jobs sink to the bottom on a desc sort.
 *
 * Returns a number rounded to one decimal place (e.g. 42.5 for 42.5%), or null.
 */
export function marginPct(row: Pick<JobCostingRow, 'revenue' | 'margin'>): number | null {
  const revenueCents = toCents(row.revenue);
  if (revenueCents === 0) return null;
  const marginCents = toCents(row.margin);
  // ×1000 then ÷10 keeps one decimal place of precision using integer math.
  return Math.round((marginCents * 1000) / revenueCents) / 10;
}

/** The comparable scalar a sort key resolves to for a row (null sorts lowest). */
function sortValue(row: JobCostingRow, key: JobCostingSortKey): number | string | null {
  switch (key) {
    case 'name':
      return row.name ?? '';
    case 'status':
      return row.status ?? '';
    case 'revenue':
      return row.revenue;
    case 'materialCost':
      return row.materialCost;
    case 'laborCost':
      return row.laborCost;
    case 'margin':
      return row.margin;
    case 'marginPct':
      return marginPct(row);
    default:
      return null;
  }
}

/**
 * Compare two sort values. Strings compare case-insensitively (locale); numbers
 * numerically. `null` (e.g. marginPct with zero revenue) is always treated as the
 * lowest value so such rows land last on a desc sort and first on asc.
 */
function compareValues(a: number | string | null, b: number | string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  if (typeof a === 'string' || typeof b === 'string') {
    return String(a).localeCompare(String(b), undefined, { sensitivity: 'base' });
  }
  return a - b;
}

/**
 * Return a NEW array of rows sorted by `key` in `direction` (default desc, which
 * surfaces the most/least profitable jobs first for the dashboard). The sort is
 * stable: rows that tie on the key keep their input order, with the original index
 * as the deterministic tiebreaker. Pure — never mutates the input.
 */
export function sortJobCosting(
  rows: JobCostingRow[],
  key: JobCostingSortKey = 'margin',
  direction: SortDirection = 'desc'
): JobCostingRow[] {
  const factor = direction === 'asc' ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((x, y) => {
      const cmp = compareValues(sortValue(x.row, key), sortValue(y.row, key));
      if (cmp !== 0) return cmp * factor;
      return x.index - y.index; // stable: preserve input order on ties
    })
    .map((entry) => entry.row);
}

/** Grand totals across a set of job-costing rows, summed in integer cents. */
export interface JobCostingTotals {
  revenue: number;
  materialCost: number;
  laborCost: number;
  margin: number;
  /** Blended margin % over the totals (null when total revenue is zero). */
  marginPct: number | null;
}

/**
 * Sum revenue / material / labor / margin across rows (cents-accurate) and the
 * blended margin %. Useful for a dashboard footer. Pure.
 */
export function totalJobCosting(rows: JobCostingRow[]): JobCostingTotals {
  let revenueCents = 0;
  let materialCents = 0;
  let laborCents = 0;
  let marginCents = 0;
  for (const r of rows) {
    revenueCents += toCents(r.revenue);
    materialCents += toCents(r.materialCost);
    laborCents += toCents(r.laborCost);
    marginCents += toCents(r.margin);
  }
  const revenue = revenueCents / 100;
  const margin = marginCents / 100;
  return {
    revenue,
    materialCost: materialCents / 100,
    laborCost: laborCents / 100,
    margin,
    marginPct: marginPct({ revenue, margin }),
  };
}

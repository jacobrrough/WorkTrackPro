import { formatMoney, toCents } from '../accountingViewModel';
import {
  DEPRECIATION_METHOD_LABELS,
  FIXED_ASSET_STATUS_LABELS,
  type DepreciationMethod,
  type FixedAssetRegisterRow,
  type FixedAssetStatus,
} from '../types';

/**
 * Small pure presenters shared by the D3 fixed-asset screens. Money sums run in integer
 * cents (G6) so the register footer (cost / accumulated depreciation / net book value)
 * ties to the GL exactly, never drifting on floating-point error. No React, no Supabase —
 * trivially unit-testable.
 */

/** Grand totals for the asset-register footer. All money figures in dollars (cents-summed). */
export interface FixedAssetRegisterTotals {
  /** Number of assets in the register. */
  assetCount: number;
  /** Σ acquisition cost across assets, in dollars. */
  cost: number;
  /** Σ accumulated depreciation (posted) across assets, in dollars. */
  accumulatedDepreciation: number;
  /** Σ net book value across assets, in dollars (each NBV already floored at its salvage). */
  netBookValue: number;
  /** Σ still-unposted (remaining planned) depreciation across assets, in dollars. */
  remainingPlanned: number;
  /** Σ salvage value across assets, in dollars. */
  salvageValue: number;
}

/**
 * Sum the register rows in integer cents, then convert back to dollars. Net book value is
 * summed from each row's already-clamped NBV (cost − accumulated, floored at salvage), so
 * the footer never double-floors.
 */
export function totalFixedAssetRegister(rows: FixedAssetRegisterRow[]): FixedAssetRegisterTotals {
  let costCents = 0;
  let accumCents = 0;
  let nbvCents = 0;
  let remainingCents = 0;
  let salvageCents = 0;
  for (const r of rows) {
    costCents += toCents(r.cost);
    accumCents += toCents(r.accumulatedDepreciation);
    nbvCents += toCents(r.netBookValue);
    remainingCents += toCents(r.remainingPlanned);
    salvageCents += toCents(r.salvageValue);
  }
  return {
    assetCount: rows.length,
    cost: costCents / 100,
    accumulatedDepreciation: accumCents / 100,
    netBookValue: nbvCents / 100,
    remainingPlanned: remainingCents / 100,
    salvageValue: salvageCents / 100,
  };
}

/** Human label for a depreciation method (with a clear note that DB schedules straight-line). */
export function methodLabel(method: DepreciationMethod): string {
  return DEPRECIATION_METHOD_LABELS[method] ?? method;
}

/**
 * Which depreciation methods are actually IMPLEMENTED end-to-end (real schedule math). Only
 * straight-line is — `declining_balance` is an accepted enum value but both the JS preview
 * (computeStraightLineSchedule) and the DB generator (accounting.generate_depreciation_schedule)
 * currently emit a STRAIGHT-LINE plan for it, so its interim expense/NBV would be wrong. Until a
 * real declining-balance generator lands it must not be saveable.
 */
export const IMPLEMENTED_DEPRECIATION_METHODS: DepreciationMethod[] = ['straight_line'];

/** True when `method` has a faithful schedule generator (i.e. is safe to save). */
export function isDepreciationMethodSupported(method: DepreciationMethod): boolean {
  return IMPLEMENTED_DEPRECIATION_METHODS.includes(method);
}

/**
 * Guard the chosen depreciation method before a save. Returns an error message when the method
 * is accepted by the type/DB but not yet faithfully implemented (today: `declining_balance`),
 * steering the user to straight-line; returns null when the method is safe to save. Keeps a
 * user from silently persisting an asset whose declining-balance schedule would actually be
 * straight-line. Mirror of the figures guard in fixedAssets.ts (validateAssetFigures).
 */
export function validateDepreciationMethod(method: DepreciationMethod): string | null {
  if (isDepreciationMethodSupported(method)) return null;
  return `${methodLabel(method)} depreciation is not supported yet — choose Straight-line.`;
}

/** Human label for an asset's lifecycle status. */
export function statusLabel(status: FixedAssetStatus): string {
  return FIXED_ASSET_STATUS_LABELS[status] ?? status;
}

/**
 * Tailwind classes for a status pill: green = active (depreciating), slate = fully
 * depreciated (at salvage), amber = disposed (retired). Mirrors the badge palette used by
 * the other accounting list screens.
 */
export function statusBadgeClass(status: FixedAssetStatus): string {
  switch (status) {
    case 'active':
      return 'bg-emerald-500/15 text-emerald-300';
    case 'fully_depreciated':
      return 'bg-slate-500/15 text-muted';
    case 'disposed':
      return 'bg-amber-500/15 text-amber-300';
    default:
      return 'bg-slate-500/15 text-muted';
  }
}

/**
 * Format an in-service / period-end ISO `YYYY-MM-DD` (or a longer timestamp) to a short
 * local date for display. Falls back to the raw string when it is not a parseable date.
 * Parsed as UTC noon so the calendar day never shifts across the local timezone.
 */
export function formatAssetDate(value: string | null | undefined): string {
  if (!value) return '—';
  const iso = String(value).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return String(value);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Depreciation progress as a 0..1 fraction of the depreciable base recognized so far
 * (accumulated ÷ (cost − salvage)), computed in integer cents and clamped to [0, 1]. A
 * zero/negative base (salvage ≥ cost, nothing to depreciate) reads as fully complete (1).
 */
export function depreciationProgress(
  cost: number,
  salvageValue: number,
  accumulatedDepreciation: number
): number {
  const baseCents = toCents(cost) - toCents(salvageValue);
  if (baseCents <= 0) return 1;
  const accumCents = Math.max(0, toCents(accumulatedDepreciation));
  return Math.min(1, accumCents / baseCents);
}

/** Re-export the dollar formatter so the fixed-asset screens import money helpers from one place. */
export { formatMoney };

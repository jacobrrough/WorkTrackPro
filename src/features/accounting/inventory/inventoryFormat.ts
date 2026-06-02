import { formatMoney, toCents } from '../accountingViewModel';
import type { InventoryValuationRow } from '../types';

/**
 * Small pure presenters shared by the B3 inventory screens. Money sums are done in
 * integer cents (G6) so the report footer ties to the GL exactly, never drifting on
 * floating-point error.
 */

/** Grand totals for the valuation report footer (asset value ties to GL 1300). */
export interface InventoryValuationTotals {
  /** Distinct stock items with a row. */
  itemCount: number;
  /** Σ FIFO asset value across items, in dollars (cents-summed). Ties to GL 1300. */
  assetValue: number;
  /** Σ lifetime COGS booked across items, in dollars (cents-summed). */
  cogsTotal: number;
  /** Σ units currently on hand. */
  qtyOnHand: number;
}

/** Sum the valuation rows in integer cents, then convert back to dollars. */
export function totalInventoryValuation(rows: InventoryValuationRow[]): InventoryValuationTotals {
  let assetCents = 0;
  let cogsCents = 0;
  let qtyOnHand = 0;
  for (const r of rows) {
    assetCents += toCents(r.assetValue);
    cogsCents += toCents(r.cogsTotal);
    qtyOnHand += r.qtyOnHand;
  }
  return {
    itemCount: rows.length,
    assetValue: assetCents / 100,
    cogsTotal: cogsCents / 100,
    qtyOnHand,
  };
}

/**
 * Compact quantity formatter: integers print clean (12), fractional units keep up to
 * three decimals without trailing zeros (1.5, 0.125). Mirrors how the FIFO layers carry
 * fractional qty (numeric) without forcing a fixed scale on whole-unit stock.
 */
export function formatQty(qty: number): string {
  if (!Number.isFinite(qty)) return '0';
  return Number(qty.toFixed(3)).toLocaleString('en-US', { maximumFractionDigits: 3 });
}

/** Per-unit cost with sub-cent precision (FIFO layers are numeric(14,4)). */
export function formatUnitCost(cost: number): string {
  const safe = Number.isFinite(cost) ? cost : 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(safe);
}

/**
 * Format a `consumed_at` / `created_at` timestamp to a short local date for display.
 * Falls back to the raw string when it is not a parseable timestamp.
 */
export function formatEventDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Re-export the dollar formatter so the inventory screens import money helpers from one place. */
export { formatMoney };

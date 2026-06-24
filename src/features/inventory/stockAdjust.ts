import type { InventoryItem } from '@/core/types';

/** Quick stock-adjust direction used by the scan-first Stock In / Stock Out flow. */
export type StockAdjustMode = 'in' | 'out';

export interface StockTarget {
  /** Absolute new in-stock count to persist (clamped so stock never goes negative). */
  target: number;
  /** Quantity actually applied. For 'out' this is clamped so it can't exceed current stock. */
  appliedQty: number;
  /** Human-readable note stored on the stock-history row. */
  reason: string;
}

/**
 * Resolve a scanned or typed code to an inventory item, matching the established app pattern:
 * an item's id OR its barcode (both trimmed). Returns undefined when nothing matches.
 */
export function resolveScannedItem(
  inventory: InventoryItem[],
  code: string
): InventoryItem | undefined {
  const trimmed = code.trim();
  if (!trimmed) return undefined;
  return inventory.find((item) => item.id === trimmed || item.barcode?.trim() === trimmed);
}

/**
 * Compute the absolute stock target for a quick in/out adjustment.
 * - 'in' adds qty to the current count.
 * - 'out' subtracts qty, clamped at 0 so stock never goes negative.
 * Quantities are taken as-is (decimals allowed for materials measured in ft/lbs/etc.);
 * invalid or non-positive input is treated as 0, yielding a no-op target.
 */
export function computeStockTarget(
  mode: StockAdjustMode,
  current: number,
  qty: number,
  unit?: string
): StockTarget {
  const safeQty = Number.isFinite(qty) && qty > 0 ? qty : 0;
  const unitSuffix = unit?.trim() ? ` ${unit.trim()}` : '';
  if (mode === 'in') {
    return {
      target: current + safeQty,
      appliedQty: safeQty,
      reason: `Stock in: +${safeQty}${unitSuffix} (quick adjust)`,
    };
  }
  const appliedQty = Math.min(safeQty, Math.max(0, current));
  return {
    target: Math.max(0, current - safeQty),
    appliedQty,
    reason: `Stock out: -${appliedQty}${unitSuffix} (quick adjust)`,
  };
}

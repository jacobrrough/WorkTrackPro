import type { InventoryItem, Part } from '@/core/types';
import { calculatePartQuote } from './partsCalculations';

/** Fields a no-variant ("synthetic") part edit can carry, mirrored from the variant editor. */
export interface SyntheticUpdateInput {
  laborHours?: number;
  cncTimeHours?: number;
  requiresCNC?: boolean;
  printer3DTimeHours?: number;
  requires3DPrint?: boolean;
  pricePerVariant?: number;
}

export interface SyntheticUpdateOptions {
  /** Only financial roles may write a price (manual or resynced). */
  canViewFinancials: boolean;
  /** Inventory finished loading; false means material prices would resolve to $0. */
  inventoryLoaded: boolean;
  /** Org-settings rates finished hydrating; false means rates may be defaults. */
  settingsReady: boolean;
  inventoryItems: InventoryItem[];
  laborRate: number;
  cncRate: number;
  printer3DRate: number;
}

/**
 * Decide which columns to persist for a no-variant ("synthetic") part edit. Pure: no React,
 * no I/O.
 *
 * Forward math (materials + labor + machine) is the source of truth for these parts, so
 * any labor/CNC/3D change resyncs the stored price to the forward total — keeping the
 * Quick Reference, Quote Calculator, and stored pricePerSet in agreement. A manually typed
 * price is honored as-is. Guards: a tab-through that re-sends an unchanged value is dropped;
 * the resync waits for inventory + rates (else materials/rates price wrong) and never writes
 * a $0 total over the only stored price — the next cost edit resyncs once data is ready.
 */
export function buildSyntheticPartUpdates(
  updates: SyntheticUpdateInput,
  basePart: Part,
  opts: SyntheticUpdateOptions
): Partial<Part> {
  const partUpdates: Partial<Part> = {};
  if (updates.laborHours !== undefined) partUpdates.laborHours = updates.laborHours;
  if (updates.cncTimeHours !== undefined) partUpdates.cncTimeHours = updates.cncTimeHours;
  if (updates.requiresCNC !== undefined) partUpdates.requiresCNC = updates.requiresCNC;
  if (updates.printer3DTimeHours !== undefined)
    partUpdates.printer3DTimeHours = updates.printer3DTimeHours;
  if (updates.requires3DPrint !== undefined) partUpdates.requires3DPrint = updates.requires3DPrint;
  // Drop unchanged fields so a tab-through (e.g. an empty-CNC blur re-sending
  // requiresCNC: false) never counts as a cost change or triggers a resync.
  for (const key of Object.keys(partUpdates) as (keyof Part)[]) {
    if (partUpdates[key] === basePart[key]) delete partUpdates[key];
  }
  const hasCostChange = Object.keys(partUpdates).length > 0;
  const priceCleared =
    Object.prototype.hasOwnProperty.call(updates, 'pricePerVariant') &&
    updates.pricePerVariant === undefined;

  if (opts.canViewFinancials) {
    if (updates.pricePerVariant !== undefined && Number.isFinite(updates.pricePerVariant)) {
      // Admin typed a manual price — honor it as the stored set price.
      partUpdates.pricePerSet = updates.pricePerVariant;
    } else if (
      (hasCostChange || priceCleared) &&
      opts.settingsReady &&
      (opts.inventoryLoaded || (basePart.materials ?? []).length === 0)
    ) {
      // Resync the stored price to forward math. (When inventory/rates aren't ready the
      // cost change still saves; the price stays put until a later edit resyncs it.)
      const mergedPart = { ...basePart, ...partUpdates };
      const forward = calculatePartQuote(mergedPart, 1, opts.inventoryItems, {
        laborRate: opts.laborRate,
        cncRate: opts.cncRate,
        printer3DRate: opts.printer3DRate,
        overrideLaborHours: mergedPart.laborHours,
      });
      if (forward && Number.isFinite(forward.total)) {
        const nextPrice = Number(forward.total.toFixed(2));
        // An automatic resync (a cost edit) must never wipe the only stored price to $0 —
        // wait for real cost data. But an explicit "Use auto" (priceCleared) is the admin
        // dropping their manual price, so honor it even when forward math is $0.
        const allowWrite = nextPrice > 0 || (priceCleared && nextPrice === 0);
        // Skip a no-op price write so an unrelated field edit doesn't churn pricePerSet.
        if (
          allowWrite &&
          (basePart.pricePerSet == null || Math.abs(basePart.pricePerSet - nextPrice) > 0.01)
        ) {
          partUpdates.pricePerSet = nextPrice;
        }
      }
    }
  }
  return partUpdates;
}

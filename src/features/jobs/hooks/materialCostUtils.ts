import type { InventoryItem, JobInventoryItem, Part } from '../../../core/types';
import {
  getDashQuantity,
  normalizeDashQuantities,
  quantityPerUnit,
} from '../../../lib/variantMath';

interface ComputeMaterialCostsParams {
  linkedPart: Part | null;
  selectedVariantSuffix?: string;
  dashQuantities: Record<string, number>;
  inventoryById: Map<string, InventoryItem>;
  jobInventoryItems: JobInventoryItem[];
  materialUpcharge: number;
  isAdmin: boolean;
}

/**
 * Material cost for display when job is linked to a part: sum over part variants × dash quantities
 * of (variant materials × inventory price × upcharge). Ensures Materials line is consistent with
 * part-derived Total (both from part), so material cost does not exceed total.
 * Returns null when part has no variants with materials (fall back to job-inventory-based cost).
 */
export function computePartDerivedMaterialTotal(
  part: Part & {
    variants?: Array<{
      variantSuffix: string;
      materials?: Array<{ inventoryId: string; quantityPerUnit?: number; quantity?: number }>;
    }>;
  },
  dashQuantities: Record<string, number> | null | undefined,
  inventoryById: Map<string, InventoryItem>,
  materialUpcharge: number
): number | null {
  const normalizedDash = normalizeDashQuantities(dashQuantities);
  const variants = part?.variants ?? [];
  if (variants.length === 0) return null;

  const useFirstVariantForAll =
    part.variantsAreCopies === true &&
    variants.length > 0 &&
    (variants[0]?.materials?.length ?? 0) > 0;

  let total = 0;
  if (useFirstVariantForAll) {
    const first = variants[0];
    if (!first?.materials?.length) return null;
    const totalQty = Object.values(normalizedDash).reduce((s, q) => s + q, 0);
    if (totalQty <= 0) return null;
    for (const mat of first.materials) {
      const inv = inventoryById.get(mat.inventoryId);
      const price = inv?.price ?? 0;
      const qtyPerUnit = quantityPerUnit(mat as { quantityPerUnit?: number; quantity?: number });
      total += totalQty * qtyPerUnit * price * materialUpcharge;
    }
    return Math.round(total * 100) / 100;
  }

  for (const variant of variants) {
    const qty = getDashQuantity(normalizedDash, variant.variantSuffix);
    if (qty <= 0 || !variant.materials?.length) continue;
    for (const mat of variant.materials) {
      const inv = inventoryById.get(mat.inventoryId);
      const price = inv?.price ?? 0;
      const qtyPerUnit = quantityPerUnit(mat as { quantityPerUnit?: number; quantity?: number });
      total += qty * qtyPerUnit * price * materialUpcharge;
    }
  }

  return total > 0 ? Math.round(total * 100) / 100 : null;
}

/**
 * Material cost = sum over job material usage of (quantity × price × upcharge).
 * Uses only job.inventoryItems so the total always matches the BOM shown on the job card.
 * materialUpcharge comes from Admin Settings (Organization) and controls the displayed total.
 */
export function computeMaterialCosts({
  linkedPart,
  dashQuantities,
  inventoryById,
  jobInventoryItems,
  materialUpcharge,
  isAdmin,
}: ComputeMaterialCostsParams): Map<string, number> {
  const costs = new Map<string, number>();

  if (!isAdmin) return costs;

  for (const jobMaterial of jobInventoryItems || []) {
    const invItem = inventoryById.get(jobMaterial.inventoryId);
    if (invItem?.price != null && jobMaterial.quantity > 0) {
      const lineCost = jobMaterial.quantity * invItem.price * materialUpcharge;
      const existing = costs.get(jobMaterial.inventoryId) || 0;
      costs.set(jobMaterial.inventoryId, existing + lineCost);
    }
  }

  return costs;
}

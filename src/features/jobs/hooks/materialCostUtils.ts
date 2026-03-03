import type { InventoryItem, JobInventoryItem, Part } from '../../../core/types';

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
 * Material cost = sum over job material usage of (quantity × price × upcharge).
 * Uses only job.inventoryItems so the total always matches the BOM shown on the job card.
 * materialUpcharge comes from Admin Settings (Organization) and controls the displayed total.
 */
export function computeMaterialCosts({
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

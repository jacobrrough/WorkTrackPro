import type { InventoryItem, JobInventoryItem, Part } from '../../../core/types';
import { quantityPerUnit, toDashSuffix } from '../../../lib/variantMath';

interface ComputeMaterialCostsParams {
  linkedPart: Part | null;
  selectedVariantSuffix?: string;
  dashQuantities: Record<string, number>;
  inventoryById: Map<string, InventoryItem>;
  jobInventoryItems: JobInventoryItem[];
  materialUpcharge: number;
  isAdmin: boolean;
}

function totalDashQty(dashQuantities: Record<string, number>): number {
  return Object.values(dashQuantities).reduce((sum, qty) => sum + (Number(qty) || 0), 0);
}

export function computeMaterialCosts({
  linkedPart,
  selectedVariantSuffix,
  dashQuantities,
  inventoryById,
  jobInventoryItems,
  materialUpcharge,
  isAdmin,
}: ComputeMaterialCostsParams): Map<string, number> {
  const costs = new Map<string, number>();
  const requiredQtyByInventory = new Map<string, number>();
  if (!isAdmin || !linkedPart) return costs;

  if (dashQuantities && Object.keys(dashQuantities).length > 0 && linkedPart.variants) {
    const useFirstVariantForAll =
      (linkedPart as Part & { variantsAreCopies?: boolean }).variantsAreCopies === true &&
      linkedPart.variants.length > 0 &&
      (linkedPart.variants[0]?.materials?.length ?? 0) > 0;

    for (const [suffix, qty] of Object.entries(dashQuantities)) {
      if (qty <= 0) continue;
      const variant = useFirstVariantForAll
        ? linkedPart.variants[0]
        : linkedPart.variants.find((v) => toDashSuffix(v.variantSuffix) === toDashSuffix(suffix));
      if (!variant?.materials) continue;
      for (const material of variant.materials) {
        const invItem = inventoryById.get(material.inventoryId);
        const existingRequiredQty = requiredQtyByInventory.get(material.inventoryId) || 0;
        if (invItem && invItem.price) {
          const requiredQty =
            quantityPerUnit(material as { quantityPerUnit?: number; quantity?: number }) * qty;
          requiredQtyByInventory.set(material.inventoryId, existingRequiredQty + requiredQty);
          const cost = requiredQty * invItem.price * materialUpcharge;
          const existing = costs.get(material.inventoryId) || 0;
          costs.set(material.inventoryId, existing + cost);
        }
      }
    }

    if (!useFirstVariantForAll) {
      const totalQty = totalDashQty(dashQuantities);
      if (linkedPart.materials) {
        for (const material of linkedPart.materials) {
          if (material.usageType !== 'per_set') continue;
          const invItem = inventoryById.get(material.inventoryId);
          const existingRequiredQty = requiredQtyByInventory.get(material.inventoryId) || 0;
          if (invItem && invItem.price) {
            const requiredQty =
              quantityPerUnit(material as { quantityPerUnit?: number; quantity?: number }) *
              totalQty;
            requiredQtyByInventory.set(material.inventoryId, existingRequiredQty + requiredQty);
            const cost = requiredQty * invItem.price * materialUpcharge;
            const existing = costs.get(material.inventoryId) || 0;
            costs.set(material.inventoryId, existing + cost);
          }
        }
      }
    }
  } else {
    const variant =
      selectedVariantSuffix && linkedPart.variants
        ? linkedPart.variants.find(
            (v) => toDashSuffix(v.variantSuffix) === toDashSuffix(selectedVariantSuffix)
          )
        : null;
    const materials = variant?.materials || linkedPart.materials || [];
    for (const material of materials) {
      const invItem = inventoryById.get(material.inventoryId);
      if (invItem && invItem.price) {
        const requiredQty = quantityPerUnit(
          material as { quantityPerUnit?: number; quantity?: number }
        );
        requiredQtyByInventory.set(material.inventoryId, requiredQty);
        const cost = requiredQty * invItem.price * materialUpcharge;
        costs.set(material.inventoryId, cost);
      }
    }
  }

  // When a part is linked, materials cost is from part BOM only; do not add job-inventory-based cost.
  if (!linkedPart) {
    for (const jobMaterial of jobInventoryItems || []) {
      const invItem = inventoryById.get(jobMaterial.inventoryId);
      if (invItem && invItem.price) {
        const requiredQty = requiredQtyByInventory.get(jobMaterial.inventoryId) || 0;
        const extraManualQty = Math.max(0, jobMaterial.quantity - requiredQty);
        if (extraManualQty <= 0) continue;
        const existingCost = costs.get(jobMaterial.inventoryId) || 0;
        const additionalCost = extraManualQty * invItem.price * materialUpcharge;
        costs.set(jobMaterial.inventoryId, existingCost + additionalCost);
      }
    }
  }

  return costs;
}

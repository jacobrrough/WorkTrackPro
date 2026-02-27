import type { PartVariant, PartMaterial } from '@/core/types';

const norm = (s: string) => s.replace(/^-/, '');

/**
 * Calculate set price from variant prices and set composition.
 * Set price = sum of (variant.pricePerVariant × setComposition[variant]) for each variant in composition.
 * When useFirstVariantPriceForAll is true (e.g. variantsAreCopies), use first variant's price for every unit in the set.
 */
export function calculateSetPriceFromVariants(
  variants: PartVariant[],
  setComposition: Record<string, number> | null | undefined,
  useFirstVariantPriceForAll?: boolean
): number | undefined {
  if (!variants?.length || !setComposition || Object.keys(setComposition).length === 0) {
    return undefined;
  }
  if (useFirstVariantPriceForAll && variants[0].pricePerVariant != null) {
    const totalUnits = Object.values(setComposition).reduce((a, b) => a + (Number(b) || 0), 0);
    return totalUnits > 0 ? variants[0].pricePerVariant! * totalUnits : undefined;
  }
  let total = 0;
  for (const v of variants) {
    const suffixNorm = norm(v.variantSuffix);
    const qtyInSet = Object.entries(setComposition).find(([s]) => norm(s) === suffixNorm)?.[1] ?? 0;
    if (qtyInSet > 0 && v.pricePerVariant != null) {
      total += v.pricePerVariant * qtyInSet;
    }
  }
  return total > 0 ? total : undefined;
}

/**
 * Compute each variant's price from a set price (proportional by set composition).
 * Returns list of { variantId, price } to apply so set price = sum(variant price × qty in set).
 */
export function variantPricesFromSetPrice(
  setPrice: number,
  setComposition: Record<string, number> | null | undefined,
  variants: PartVariant[]
): Array<{ variantId: string; price: number }> {
  if (
    setPrice <= 0 ||
    !setComposition ||
    Object.keys(setComposition).length === 0 ||
    !variants?.length
  ) {
    return [];
  }
  const totalUnits = Object.values(setComposition).reduce((a, b) => a + b, 0);
  if (totalUnits <= 0) return [];
  const pricePerUnit = setPrice / totalUnits;
  const out: Array<{ variantId: string; price: number }> = [];
  for (const v of variants) {
    const suffixNorm = norm(v.variantSuffix);
    const qtyInSet = Object.entries(setComposition).find(([s]) => norm(s) === suffixNorm)?.[1] ?? 0;
    if (qtyInSet > 0) {
      out.push({
        variantId: v.id,
        price: Math.round(pricePerUnit * qtyInSet * 100) / 100,
      });
    }
  }
  return out;
}

/**
 * Get distribution ratios per variant from set composition (proportional split).
 * e.g. setComposition { "01": 1, "02": 2, "03": 1 } => { "01": 0.25, "02": 0.5, "03": 0.25 }
 */
export function getMaterialDistributionRatios(
  setComposition: Record<string, number> | null | undefined
): Record<string, number> {
  if (!setComposition || Object.keys(setComposition).length === 0) return {};
  const total = Object.values(setComposition).reduce((a, b) => a + b, 0);
  if (total <= 0) return {};
  const ratios: Record<string, number> = {};
  for (const [suffix, qty] of Object.entries(setComposition)) {
    if (qty > 0) ratios[suffix] = qty / total;
  }
  return ratios;
}

/**
 * Distribute a total quantity across variants proportionally to set composition.
 * Returns map of variantSuffix -> quantity (variant's share).
 */
export function distributeQuantityProportionally(
  totalQuantity: number,
  setComposition: Record<string, number> | null | undefined
): Record<string, number> {
  const ratios = getMaterialDistributionRatios(setComposition);
  const out: Record<string, number> = {};
  for (const [suffix, ratio] of Object.entries(ratios)) {
    out[suffix] = Math.round(totalQuantity * ratio * 1000) / 1000;
  }
  return out;
}

/**
 * Distribute labor evenly among variants, excluding the one with manually set labor.
 * Returns map of variantId -> labor hours.
 */
export function distributeLaborEvenly(
  variants: PartVariant[],
  totalLaborHours: number,
  excludeVariantId?: string
): Record<string, number> {
  const targets = variants.filter((v) => v.id !== excludeVariantId);
  if (targets.length === 0 || totalLaborHours <= 0) return {};
  const perVariant = totalLaborHours / targets.length;
  const out: Record<string, number> = {};
  targets.forEach((v) => {
    out[v.id] = Math.round(perVariant * 100) / 100;
  });
  return out;
}

/**
 * Compute variant's share of set labor from set composition (proportional).
 * Set labor is the total; each variant gets (variantQtyInSet / totalUnitsInSet) * setLabor.
 */
export function variantLaborFromSetComposition(
  variantSuffix: string,
  setLaborHours: number,
  setComposition: Record<string, number> | null | undefined
): number | undefined {
  if (setLaborHours <= 0 || !setComposition || Object.keys(setComposition).length === 0)
    return undefined;
  const suffixNorm = norm(variantSuffix);
  const variantQty = Object.entries(setComposition).find(([s]) => norm(s) === suffixNorm)?.[1] ?? 0;
  const totalUnits = Object.values(setComposition).reduce((a, b) => a + b, 0);
  if (totalUnits <= 0 || variantQty <= 0) return undefined;
  return Math.round(((setLaborHours * variantQty) / totalUnits) * 100) / 100;
}

/**
 * Compute variant's share of set CNC hours from set composition (proportional).
 * Same logic as variantLaborFromSetComposition but for machine/CNC time.
 */
export function variantCncFromSetComposition(
  variantSuffix: string,
  setCncHours: number,
  setComposition: Record<string, number> | null | undefined
): number | undefined {
  if (setCncHours <= 0 || !setComposition || Object.keys(setComposition).length === 0)
    return undefined;
  const suffixNorm = norm(variantSuffix);
  const variantQty = Object.entries(setComposition).find(([s]) => norm(s) === suffixNorm)?.[1] ?? 0;
  const totalUnits = Object.values(setComposition).reduce((a, b) => a + b, 0);
  if (totalUnits <= 0 || variantQty <= 0) return undefined;
  return Math.round(((setCncHours * variantQty) / totalUnits) * 100) / 100;
}

/**
 * Compute variant's share of set 3D printer hours from set composition (proportional).
 */
export function variantPrinter3DFromSetComposition(
  variantSuffix: string,
  setPrinter3DHours: number,
  setComposition: Record<string, number> | null | undefined
): number | undefined {
  if (setPrinter3DHours <= 0 || !setComposition || Object.keys(setComposition).length === 0)
    return undefined;
  const suffixNorm = norm(variantSuffix);
  const variantQty = Object.entries(setComposition).find(([s]) => norm(s) === suffixNorm)?.[1] ?? 0;
  const totalUnits = Object.values(setComposition).reduce((a, b) => a + b, 0);
  if (totalUnits <= 0 || variantQty <= 0) return undefined;
  return Math.round(((setPrinter3DHours * variantQty) / totalUnits) * 100) / 100;
}

/**
 * Calculate set labor from variant labor hours and set composition.
 * Set labor = sum of (variant.laborHours × setComposition[variant]) for each variant.
 */
export function calculateSetLaborFromVariants(
  variants: PartVariant[],
  setComposition: Record<string, number> | null | undefined,
  useFirstVariantLaborForAll?: boolean
): number | undefined {
  if (!variants?.length || !setComposition || Object.keys(setComposition).length === 0) {
    return undefined;
  }
  if (useFirstVariantLaborForAll && variants[0].laborHours != null) {
    const totalUnits = Object.values(setComposition).reduce((a, b) => a + (Number(b) || 0), 0);
    return totalUnits > 0 ? variants[0].laborHours! * totalUnits : undefined;
  }
  let total = 0;
  for (const v of variants) {
    const suffixNorm = norm(v.variantSuffix);
    const qtyInSet = Object.entries(setComposition).find(([s]) => norm(s) === suffixNorm)?.[1] ?? 0;
    if (qtyInSet > 0 && v.laborHours != null) {
      total += v.laborHours * qtyInSet;
    }
  }
  return total > 0 ? total : undefined;
}

/**
 * Calculate set CNC hours from variant cncTimeHours and set composition.
 * Set CNC = sum of (variant.cncTimeHours × setComposition[variant]) for variants with requiresCNC.
 */
export function calculateSetCncFromVariants(
  variants: PartVariant[],
  setComposition: Record<string, number> | null | undefined
): number | undefined {
  if (!variants?.length || !setComposition || Object.keys(setComposition).length === 0) {
    return undefined;
  }
  let total = 0;
  for (const v of variants) {
    const suffixNorm = norm(v.variantSuffix);
    const qtyInSet = Object.entries(setComposition).find(([s]) => norm(s) === suffixNorm)?.[1] ?? 0;
    if (qtyInSet > 0 && v.requiresCNC && v.cncTimeHours != null) {
      total += v.cncTimeHours * qtyInSet;
    }
  }
  return total > 0 ? total : undefined;
}

/**
 * Copy material definitions (inventoryId, quantityPerUnit, unit) from source variant to target variants.
 * Only adds materials that the target variant doesn't already have (by inventoryId).
 * Returns list of { variantId, inventoryId, quantity, unit } to add (caller persists via API).
 */
export function copyVariantMaterialsToOthers(
  sourceMaterials: PartMaterial[],
  targetVariants: PartVariant[]
): Array<{ variantId: string; inventoryId: string; quantity: number; unit: string }> {
  const toAdd: Array<{ variantId: string; inventoryId: string; quantity: number; unit: string }> =
    [];
  const qty = (m: PartMaterial) => m.quantityPerUnit ?? (m as { quantity?: number }).quantity ?? 1;
  for (const target of targetVariants) {
    const targetInvIds = new Set((target.materials ?? []).map((m) => m.inventoryId));
    for (const mat of sourceMaterials) {
      if (mat.usageType === 'per_set') continue;
      if (targetInvIds.has(mat.inventoryId)) continue;
      toAdd.push({
        variantId: target.id,
        inventoryId: mat.inventoryId,
        quantity: qty(mat),
        unit: mat.unit ?? 'units',
      });
    }
  }
  return toAdd;
}

/**
 * Distribute a set-level material quantity to all variants as an even per-unit value.
 * Each variant in the set gets the same quantityPerUnit, and setComposition is used only
 * to determine which variants are included (qtyInSet > 0) and the total unit count.
 * Returns list of { variantId, inventoryId, quantity, unit } to add to each variant.
 */
export function distributeSetMaterialToVariants(
  variants: PartVariant[],
  setComposition: Record<string, number> | null | undefined,
  inventoryId: string,
  totalQuantity: number,
  unit: string
): Array<{ variantId: string; inventoryId: string; quantity: number; unit: string }> {
  if (!variants?.length || !setComposition || Object.keys(setComposition).length === 0) {
    return [];
  }
  const totalUnits = Object.values(setComposition).reduce((sum, rawQty) => {
    const qty = Number(rawQty);
    return Number.isFinite(qty) && qty > 0 ? sum + qty : sum;
  }, 0);
  if (totalUnits <= 0 || totalQuantity <= 0) return [];

  const quantityPerUnit = Math.round((totalQuantity / totalUnits) * 1000) / 1000;
  const toAdd: Array<{ variantId: string; inventoryId: string; quantity: number; unit: string }> =
    [];
  for (const v of variants) {
    const suffixNorm = norm(v.variantSuffix);
    const qtyInSet = Object.entries(setComposition).find(([s]) => norm(s) === suffixNorm)?.[1] ?? 0;
    if (qtyInSet > 0) {
      toAdd.push({
        variantId: v.id,
        inventoryId,
        quantity: quantityPerUnit,
        unit: unit || 'units',
      });
    }
  }
  return toAdd;
}

/**
 * Parts calculations — single source of truth for Part-related math.
 *
 * Use this module as the canonical reference for:
 * - Required material quantities (part + dash → job BOM)
 * - Set completion, set/variant price and labor/CNC
 * - Part and variant quotes (material cost roll-up, labor, total)
 *
 * All quantity-per-unit values used in requirements and cost roll-ups are treated as
 * non-negative (zero or positive). Negative or non-finite values are clamped to 0.
 *
 * Where used:
 * - Part detail: quote, set price/labor, variant targets
 * - Job BOM sync: required materials, set completion
 * - Part form / PartMaterialLink: live subtotals (via part quote or materialRequirementsForOneSet)
 */

import type { Part, PartVariant, PartMaterial, InventoryItem } from '@/core/types';
import {
  computeRequiredMaterials as computeRequiredMaterialsRaw,
  syncJobInventoryFromPart as syncJobInventoryFromPartRaw,
} from '@/lib/materialFromPart';
import { calculateSetCompletion } from '@/lib/formatJob';
import {
  calculatePartQuote as calculatePartQuoteRaw,
  calculateVariantQuote as calculateVariantQuoteRaw,
  type PartQuoteResult,
} from '@/lib/calculatePartQuote';
import {
  calculateSetPriceFromVariants,
  variantPricesFromSetPrice,
  calculateSetLaborFromVariants,
  calculateSetCncFromVariants,
  variantLaborFromSetComposition,
  variantCncFromSetComposition,
  variantPrinter3DFromSetComposition,
  getMaterialDistributionRatios,
  distributeQuantityProportionally,
  distributeSetMaterialToVariants,
} from '@/lib/partDistribution';
import {
  buildEffectiveSetComposition,
  seedMissingVariantPrices,
  calculateVariantLaborTargets,
  calculateVariantCncTargets,
} from '@/lib/variantPricingAuto';
import { quantityPerUnit as quantityPerUnitRaw } from '@/lib/variantMath';

// ——— Re-exports (pass-through) ———

/**
 * Required materials for a job from part and dash quantities.
 * Uses safe quantity per unit (non-negative). Used by Job BOM sync and Part detail.
 */
export function computeRequiredMaterials(
  part: Part & { variants?: PartVariant[]; setComposition?: Record<string, number> | null },
  dashQuantities: Record<string, number>
): Map<string, { quantity: number; unit: string }> {
  const sanitized = sanitizePartQuantities(part);
  return computeRequiredMaterialsRaw(sanitized, dashQuantities);
}

/**
 * Sync job_inventory from part and dash quantities. Uses safe material quantities.
 * Used by JobDetail, AdminCreateJob, useMaterialSync.
 */
export async function syncJobInventoryFromPart(
  jobId: string,
  part: Part & { variants?: PartVariant[] },
  dashQuantities: Record<string, number>
): Promise<void> {
  const sanitized = sanitizePartQuantities(part);
  return syncJobInventoryFromPartRaw(jobId, sanitized, dashQuantities);
}

export { calculateSetCompletion };
export type { PartQuoteResult };
export {
  calculateSetPriceFromVariants,
  variantPricesFromSetPrice,
  calculateSetLaborFromVariants,
  calculateSetCncFromVariants,
  variantLaborFromSetComposition,
  variantCncFromSetComposition,
  variantPrinter3DFromSetComposition,
  getMaterialDistributionRatios,
  distributeQuantityProportionally,
  distributeSetMaterialToVariants,
};
export {
  buildEffectiveSetComposition,
  seedMissingVariantPrices,
  calculateVariantLaborTargets,
  calculateVariantCncTargets,
};
export { normalizeDashQuantities } from '@/lib/variantMath';

/**
 * Safe quantity per unit for a material: clamps to >= 0 so that negative or
 * non-finite values from the DB do not produce negative requirements or costs.
 * Used by computeRequiredMaterials and calculatePartQuote internally.
 */
export function quantityPerUnit(material: { quantityPerUnit?: number; quantity?: number }): number {
  const raw = quantityPerUnitRaw(material);
  return Number.isFinite(raw) && raw >= 0 ? raw : 0;
}

/**
 * Part quote for a given quantity (number of sets). Uses safe material quantities.
 * Used by Part detail QuoteCalculator and set price/labor propagation.
 */
export function calculatePartQuote(
  part: Part & { variants?: PartVariant[] },
  quantity: number,
  inventoryItems: InventoryItem[],
  options?: Parameters<typeof calculatePartQuoteRaw>[3]
): PartQuoteResult | null {
  const sanitized = sanitizePartQuantities(part);
  return calculatePartQuoteRaw(sanitized, quantity, inventoryItems, options);
}

/**
 * Variant quote for a given quantity. Uses safe material quantities.
 * Used by Part detail variant rows and labor reverse-calculation.
 */
export function calculateVariantQuote(
  partNumber: string,
  variant: PartVariant & { materials?: PartMaterial[] },
  quantity: number,
  inventoryItems: InventoryItem[],
  options?: Parameters<typeof calculateVariantQuoteRaw>[4]
): PartQuoteResult | null {
  const sanitizedVariant = sanitizeVariantQuantities(variant);
  return calculateVariantQuoteRaw(partNumber, sanitizedVariant, quantity, inventoryItems, options);
}

/**
 * Material cost for one set (roll-up from part materials × inventory prices).
 * Used by Part detail BOM total and PartMaterialLink subtotals.
 */
export function getPartMaterialCostForOneSet(
  part: Part & { variants?: PartVariant[]; materials?: PartMaterial[] },
  inventoryItems: InventoryItem[],
  _setComposition?: Record<string, number> | null
): number {
  const quote = calculatePartQuote(part, 1, inventoryItems, { laborRate: 0 });
  return quote?.materialCostOur ?? 0;
}

/** Clone part with all material quantityPerUnit values clamped to >= 0. */
function sanitizePartQuantities(
  part: Part & { variants?: PartVariant[]; materials?: PartMaterial[] }
): Part & { variants?: PartVariant[]; materials?: PartMaterial[] } {
  const materials = part.materials?.map((m) => ({
    ...m,
    quantityPerUnit: quantityPerUnit(m),
  }));
  const variants = part.variants?.map((v) => sanitizeVariantQuantities(v));
  return {
    ...part,
    materials: materials ?? part.materials,
    variants: variants ?? part.variants,
  };
}

/** Clone variant with all material quantityPerUnit values clamped to >= 0. */
function sanitizeVariantQuantities(
  variant: PartVariant & { materials?: PartMaterial[] }
): PartVariant & { materials?: PartMaterial[] } {
  const materials = variant.materials?.map((m) => ({
    ...m,
    quantityPerUnit: quantityPerUnit(m),
  }));
  return { ...variant, materials: materials ?? variant.materials };
}

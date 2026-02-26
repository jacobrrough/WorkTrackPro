import type { PartVariant } from '@/core/types';

const normalizeSuffix = (suffix: string): string =>
  String(suffix ?? '')
    .replace(/^-/, '')
    .trim();

const round2 = (value: number): number => Math.round(value * 100) / 100;

const unitsInComposition = (composition: Record<string, number>): number =>
  Object.values(composition).reduce((sum, rawQty) => {
    const qty = Number(rawQty);
    return Number.isFinite(qty) && qty > 0 ? sum + qty : sum;
  }, 0);

const qtyInSetForVariant = (composition: Record<string, number>, variantSuffix: string): number => {
  const target = normalizeSuffix(variantSuffix);
  for (const [rawSuffix, rawQty] of Object.entries(composition)) {
    if (normalizeSuffix(rawSuffix) !== target) continue;
    const qty = Number(rawQty);
    return Number.isFinite(qty) && qty > 0 ? qty : 0;
  }
  return 0;
};

export function buildEffectiveSetComposition(
  variants: PartVariant[],
  setComposition: Record<string, number> | null | undefined
): Record<string, number> {
  if (setComposition && Object.keys(setComposition).length > 0) {
    return setComposition;
  }

  const fallback: Record<string, number> = {};
  for (const variant of variants) {
    fallback[variant.variantSuffix] = 1;
  }
  return fallback;
}

/**
 * Returns updates for variants that have no price set. Never overwrites an existing variant price:
 * manually entered variant totals must stay exactly as the user set them.
 */
export function seedMissingVariantPrices(
  variants: PartVariant[],
  sourceVariantId: string
): Array<{ variantId: string; price: number }> {
  const sourcePrice = variants.find((variant) => variant.id === sourceVariantId)?.pricePerVariant;
  if (sourcePrice == null || !Number.isFinite(sourcePrice) || sourcePrice < 0) {
    return [];
  }

  return variants
    .filter((variant) => variant.id !== sourceVariantId && variant.pricePerVariant == null)
    .map((variant) => ({
      variantId: variant.id,
      price: round2(sourcePrice),
    }));
}

export function calculateVariantLaborTargets(
  variants: PartVariant[],
  setComposition: Record<string, number> | null | undefined,
  setLaborHours: number
): Array<{ variantId: string; laborHours: number }> {
  if (!Number.isFinite(setLaborHours) || setLaborHours <= 0 || variants.length === 0) {
    return [];
  }

  const composition = buildEffectiveSetComposition(variants, setComposition);
  const totalUnits = unitsInComposition(composition);
  if (totalUnits <= 0) return [];

  const targets: Array<{ variantId: string; laborHours: number }> = [];
  for (const variant of variants) {
    const qtyInSet = qtyInSetForVariant(composition, variant.variantSuffix);
    if (qtyInSet <= 0) continue;
    targets.push({
      variantId: variant.id,
      laborHours: round2((setLaborHours * qtyInSet) / totalUnits),
    });
  }
  return targets;
}

export function calculateVariantCncTargets(
  variants: PartVariant[],
  setComposition: Record<string, number> | null | undefined,
  setCncHours: number
): Array<{ variantId: string; cncTimeHours: number }> {
  if (!Number.isFinite(setCncHours) || setCncHours <= 0 || variants.length === 0) {
    return [];
  }

  const composition = buildEffectiveSetComposition(variants, setComposition);
  const totalUnits = unitsInComposition(composition);
  if (totalUnits <= 0) return [];

  const targets: Array<{ variantId: string; cncTimeHours: number }> = [];
  for (const variant of variants) {
    const qtyInSet = qtyInSetForVariant(composition, variant.variantSuffix);
    if (qtyInSet <= 0) continue;
    targets.push({
      variantId: variant.id,
      cncTimeHours: round2((setCncHours * qtyInSet) / totalUnits),
    });
  }
  return targets;
}

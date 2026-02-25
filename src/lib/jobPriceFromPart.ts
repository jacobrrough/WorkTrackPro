import type { Part, PartVariant } from '@/core/types';
import {
  getDashQuantity,
  normalizeDashQuantities,
  normalizeVariantSuffix,
  toDashSuffix,
} from './variantMath';

export type PriceSource = 'variant_prices' | 'set_price' | 'derived_set_price';

export interface JobPriceFromPartResult {
  totalPrice: number;
  source: PriceSource;
  setCount?: number;
  missingVariantPrices: string[];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function compositionQtyForSuffix(
  setComposition: Record<string, number> | null | undefined,
  suffix: string
): number {
  if (!setComposition) return 0;
  const normalizedSuffix = normalizeVariantSuffix(suffix);
  for (const [rawSuffix, rawQty] of Object.entries(setComposition)) {
    if (normalizeVariantSuffix(rawSuffix) === normalizedSuffix) {
      const qty = Number(rawQty);
      return Number.isFinite(qty) && qty > 0 ? qty : 0;
    }
  }
  return 0;
}

function buildEffectiveSetComposition(
  part: Part & { variants?: PartVariant[] }
): Record<string, number> | null {
  if (part.setComposition && Object.keys(part.setComposition).length > 0) {
    return part.setComposition;
  }
  if (!part.variants?.length) return null;
  const fallback: Record<string, number> = {};
  for (const variant of part.variants) {
    fallback[toDashSuffix(variant.variantSuffix)] = 1;
  }
  return fallback;
}

export function deriveSetCountFromDashQuantities(
  setComposition: Record<string, number> | null | undefined,
  dashQuantities: Record<string, number> | null | undefined
): number | null {
  const normalizedDash = normalizeDashQuantities(dashQuantities);
  const dashKeys = Object.keys(normalizedDash);
  if (!setComposition || Object.keys(setComposition).length === 0 || dashKeys.length === 0) return null;

  let ratio: number | null = null;

  for (const [rawSuffix, rawQtyInSet] of Object.entries(setComposition)) {
    const qtyInSet = Number(rawQtyInSet);
    if (!Number.isFinite(qtyInSet) || qtyInSet <= 0) continue;
    const dashQty = getDashQuantity(normalizedDash, rawSuffix);
    if (dashQty <= 0) return null;
    const nextRatio = dashQty / qtyInSet;
    if (!Number.isFinite(nextRatio) || nextRatio <= 0) return null;
    if (ratio == null) {
      ratio = nextRatio;
      continue;
    }
    if (Math.abs(nextRatio - ratio) > 0.0001) return null;
  }

  if (ratio == null) return null;

  // If any selected variant is not in set composition, it is not a clean "set count" match.
  for (const suffix of dashKeys) {
    if (compositionQtyForSuffix(setComposition, suffix) <= 0) return null;
  }

  return ratio;
}

export function calculateJobPriceFromPart(
  part: Part & { variants?: PartVariant[] },
  dashQuantities: Record<string, number> | null | undefined
): JobPriceFromPartResult | null {
  const normalizedDash = normalizeDashQuantities(dashQuantities);
  const selectedDashKeys = Object.keys(normalizedDash);
  if (selectedDashKeys.length === 0) return null;

  const effectiveSetComposition = buildEffectiveSetComposition(part);
  const selectedVariants =
    part.variants
      ?.map((variant) => ({
        variant,
        quantity: getDashQuantity(normalizedDash, variant.variantSuffix),
      }))
      .filter((entry) => entry.quantity > 0) ?? [];

  if (selectedVariants.length === 0) return null;

  const missingVariantPrices = selectedVariants
    .filter(({ variant }) => variant.pricePerVariant == null)
    .map(({ variant }) => `-${normalizeVariantSuffix(variant.variantSuffix)}`);

  const allSelectedVariantsHavePricing = missingVariantPrices.length === 0;
  if (allSelectedVariantsHavePricing) {
    const total = selectedVariants.reduce(
      (sum, { variant, quantity }) => sum + quantity * (variant.pricePerVariant ?? 0),
      0
    );
    return {
      totalPrice: round2(total),
      source: 'variant_prices',
      setCount: deriveSetCountFromDashQuantities(effectiveSetComposition, normalizedDash) ?? undefined,
      missingVariantPrices: [],
    };
  }

  if (part.pricePerSet == null) return null;

  const exactSetCount = deriveSetCountFromDashQuantities(effectiveSetComposition, normalizedDash);
  if (exactSetCount != null) {
    return {
      totalPrice: round2(exactSetCount * part.pricePerSet),
      source: 'set_price',
      setCount: exactSetCount,
      missingVariantPrices,
    };
  }

  // Fallback: derive per-variant prices from set composition share.
  if (effectiveSetComposition && Object.keys(effectiveSetComposition).length > 0) {
    const totalUnitsPerSet = Object.values(effectiveSetComposition).reduce((sum, rawQty) => {
      const qty = Number(rawQty);
      return Number.isFinite(qty) && qty > 0 ? sum + qty : sum;
    }, 0);

    if (totalUnitsPerSet <= 0) return null;

    let derivedTotal = 0;
    for (const { variant, quantity } of selectedVariants) {
      if (variant.pricePerVariant != null) {
        derivedTotal += quantity * variant.pricePerVariant;
        continue;
      }
      const qtyInSet = compositionQtyForSuffix(effectiveSetComposition, variant.variantSuffix);
      if (qtyInSet <= 0) return null;
      const derivedVariantPrice = part.pricePerSet * (qtyInSet / totalUnitsPerSet);
      derivedTotal += quantity * derivedVariantPrice;
    }

    return {
      totalPrice: round2(derivedTotal),
      source: 'derived_set_price',
      missingVariantPrices,
    };
  }

  return null;
}

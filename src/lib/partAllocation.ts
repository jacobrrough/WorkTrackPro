import type { Part, PartVariant } from '@/core/types';
import { getDashQuantity, normalizeDashQuantities, toDashSuffix } from './variantMath';

/** A part with its variants loaded — the shape the quantity editors operate on. */
export type PartWithVariants = Part & {
  variants?: PartVariant[];
  setComposition?: Record<string, number> | null;
};

/** How a part's quantity was entered, surfaced so a parent form can mirror it. */
export interface PartAllocationMeta {
  mode: 'sets' | 'variants';
  /** Number of sets when mode === 'sets' (0 otherwise / when not derivable). */
  setCount: number;
}

/** Synthetic dash key used when a part has no real variants. Matches the create-job form. */
export const NO_VARIANT_DASH_KEY = '-01';

/**
 * The per-variant "one set" composition for a part, or null when the part has no variants
 * (i.e. sets mode is not applicable). Prefers an explicit setComposition (minus the '_'
 * no-variant sentinel) and falls back to one of each variant. Shared by PartSelector and
 * PartQuantityEditor so the two never disagree about what a "set" is.
 */
export function getEffectiveSetComposition(part: PartWithVariants): Record<string, number> | null {
  if (part.setComposition && Object.keys(part.setComposition).length > 0) {
    const real = Object.fromEntries(Object.entries(part.setComposition).filter(([k]) => k !== '_'));
    if (Object.keys(real).length > 0) return real;
  }
  if (!part.variants?.length) return null;
  const fallback: Record<string, number> = {};
  part.variants.forEach((variant) => {
    fallback[toDashSuffix(variant.variantSuffix)] = 1;
  });
  return fallback;
}

/** Expand a set count into per-variant dash quantities (empty when no sets / no variants). */
export function buildDashQuantitiesFromSetCount(
  part: PartWithVariants,
  count: number
): Record<string, number> {
  const effectiveSetComposition = getEffectiveSetComposition(part);
  if (!part.variants?.length || !effectiveSetComposition) return {};
  const normalizedCount = Math.max(0, Math.floor(count));
  if (normalizedCount <= 0) return {};
  const fromSets: Record<string, number> = {};
  part.variants.forEach((variant) => {
    const perSetQty = getDashQuantity(effectiveSetComposition, variant.variantSuffix);
    if (perSetQty > 0) {
      fromSets[toDashSuffix(variant.variantSuffix)] = perSetQty * normalizedCount;
    }
  });
  return normalizeDashQuantities(fromSets);
}

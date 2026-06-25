import type { Part } from '@/core/types';
import { getDashQuantity, normalizeDashQuantities, toDashSuffix } from './variantMath';

/**
 * Parse a leading numeric value out of a free-text quantity field (e.g. "126", "50 sets",
 * "40 pcs"). Returns 0 when there is no positive number (so "Proposal" / "" → 0). Shared so
 * the job screens and the estimate/invoice builder read the same number off `job.qty`.
 */
export function parseQuantityFromText(value: string | undefined | null): number {
  const match = String(value ?? '').match(/(\d+(?:\.\d+)?)/);
  if (!match) return 0;
  const parsed = Number.parseFloat(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Resolve the dash quantities a part is actually being made at, applying the SAME `qty`-text
 * fallback the job-create and job-detail screens use so a downstream consumer (notably the
 * estimate/invoice line builder) prices and counts a part exactly like the on-screen quote.
 *
 * Precedence:
 *  1. If the raw dash map already has positive entries, use it (normalized).
 *  2. Otherwise fall back to the job's free-text `qty` (e.g. "126"):
 *     - no-variant (master) part → a single -01 line of that quantity,
 *     - multi-variant with a set composition → expand qty across variants (qtyPerSet × qty),
 *     - copy / single-variant part → that quantity on the lone variant.
 *  3. If none apply, return the (empty) normalized dash.
 *
 * Pure (no React/Supabase). Previously duplicated inline in AdminCreateJob + JobDetail; the
 * line builder ignored it, which is why a qty-only job (empty dash_quantities) billed quantity 1.
 */
export function buildEffectivePartQuantities(
  part: Pick<Part, 'variants' | 'setComposition' | 'variantsAreCopies'> | null | undefined,
  dashQuantities: Record<string, number> | null | undefined,
  qtyText: string | undefined | null
): Record<string, number> {
  const normalizedDash = normalizeDashQuantities(dashQuantities);
  if (Object.values(normalizedDash).some((qty) => qty > 0)) return normalizedDash;
  if (!part) return normalizedDash;

  const totalQty = parseQuantityFromText(qtyText);
  if (totalQty <= 0) return normalizedDash;

  if (!part.variants?.length) {
    return { '-01': totalQty };
  }

  // Multi-variant fallback: derive dash quantities from set composition × set qty.
  if (part.setComposition && Object.keys(part.setComposition).length > 0) {
    const fromSetCount: Record<string, number> = {};
    for (const variant of part.variants) {
      const qtyPerSet = getDashQuantity(part.setComposition, variant.variantSuffix);
      if (qtyPerSet > 0) {
        fromSetCount[toDashSuffix(variant.variantSuffix)] = qtyPerSet * totalQty;
      }
    }
    const normalizedFromSetCount = normalizeDashQuantities(fromSetCount);
    if (Object.keys(normalizedFromSetCount).length > 0) return normalizedFromSetCount;
  }

  // Copy/single-variant fallback when set composition is missing.
  if (part.variantsAreCopies || part.variants.length === 1) {
    return { [toDashSuffix(part.variants[0].variantSuffix)]: totalQty };
  }

  return normalizedDash;
}

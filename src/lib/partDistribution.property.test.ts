import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { PartVariant } from '@/core/types';
import { distributeLaborEvenly, distributeSetMaterialToVariants } from './partDistribution';

const makeVariant = (id: string, suffix: string): PartVariant => ({
  id,
  partId: 'part-1',
  variantSuffix: suffix,
});

const roundTo = (value: number, decimals: number): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

describe('distributeLaborEvenly (property-based)', () => {
  it('per-variant hours always sum to round(totalLaborHours) — no rounding leakage', () => {
    fc.assert(
      fc.property(
        // 1..12 variants, positive labor hours
        fc.integer({ min: 1, max: 12 }),
        fc.double({ min: 0.001, max: 100_000, noNaN: true }),
        (count, totalLaborHours) => {
          const variants = Array.from({ length: count }, (_, i) =>
            makeVariant(`v${i}`, String(i + 1).padStart(2, '0'))
          );

          const out = distributeLaborEvenly(variants, totalLaborHours);

          const distributedSum = Object.values(out).reduce((a, b) => a + b, 0);
          // Distributed parts must reconstruct the rounded input total exactly.
          expect(roundTo(distributedSum, 2)).toBe(roundTo(totalLaborHours, 2));
          // Every variant must receive a finite, non-negative share.
          for (const v of variants) {
            expect(Number.isFinite(out[v.id])).toBe(true);
            expect(out[v.id]).toBeGreaterThanOrEqual(0);
          }
        }
      )
    );
  });

  it('excluding a variant still partitions the total across the rest', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 12 }),
        fc.double({ min: 0.001, max: 100_000, noNaN: true }),
        (count, totalLaborHours) => {
          const variants = Array.from({ length: count }, (_, i) =>
            makeVariant(`v${i}`, String(i + 1).padStart(2, '0'))
          );
          const excludeId = variants[0].id;

          const out = distributeLaborEvenly(variants, totalLaborHours, excludeId);

          expect(out[excludeId]).toBeUndefined();
          const distributedSum = Object.values(out).reduce((a, b) => a + b, 0);
          expect(roundTo(distributedSum, 2)).toBe(roundTo(totalLaborHours, 2));
        }
      )
    );
  });
});

const sumPerSet = (
  distributed: Array<{ variantId: string; quantity: number }>,
  variants: PartVariant[],
  composition: Record<string, number>
): number => {
  const qtyByVariantId = new Map(distributed.map((r) => [r.variantId, r.quantity]));
  return variants.reduce((sum, variant) => {
    const qtyInSet =
      Object.entries(composition).find(
        ([suffix]) => suffix.replace(/^-/, '') === variant.variantSuffix
      )?.[1] ?? 0;
    return sum + (qtyByVariantId.get(variant.id) ?? 0) * qtyInSet;
  }, 0);
};

describe('distributeSetMaterialToVariants (property-based)', () => {
  it('reconstruction never goes negative and stays bounded (no accumulating leakage)', () => {
    fc.assert(
      fc.property(
        // composition: 1..10 entries, each unit count 1..20
        fc.array(fc.integer({ min: 1, max: 20 }), { minLength: 1, maxLength: 10 }),
        fc.double({ min: 0.001, max: 1_000_000, noNaN: true }),
        (qtys, totalQuantity) => {
          const variants = qtys.map((_, i) => makeVariant(`v${i}`, String(i + 1).padStart(2, '0')));
          const composition: Record<string, number> = {};
          qtys.forEach((qty, i) => {
            composition[`-${String(i + 1).padStart(2, '0')}`] = qty;
          });
          const totalUnits = qtys.reduce((a, b) => a + b, 0);

          const distributed = distributeSetMaterialToVariants(
            variants,
            composition,
            'inv-1',
            totalQuantity,
            'units'
          );

          // One row per included variant; all quantities finite and non-negative
          // (a per-unit quantity must never be negative — it would create negative cost).
          expect(distributed.length).toBe(variants.length);
          for (const r of distributed) {
            expect(Number.isFinite(r.quantity)).toBe(true);
            expect(r.quantity).toBeGreaterThanOrEqual(0);
          }

          // The reconstruction error is bounded by the per-unit rounding granularity
          // (1e-3) times the number of units in the set — it does NOT compound beyond the
          // unavoidable 3-decimal grid. The original code rounded every variant the same
          // way with no remainder handling, producing systematic, larger leakage.
          const totalPerSet = sumPerSet(distributed, variants, composition);
          const residual = Math.abs(roundTo(totalPerSet, 3) - roundTo(totalQuantity, 3));
          expect(residual).toBeLessThanOrEqual(1e-3 * totalUnits + 1e-9);
        }
      )
    );
  });

  it('reconstructs EXACTLY for cleanly divisible totals (where the old code leaked)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 20 }), { minLength: 1, maxLength: 10 }),
        // base per-unit on the 1e-3 grid so total = base * totalUnits is exactly representable
        fc.integer({ min: 1, max: 100_000 }),
        (qtys, baseMilli) => {
          const variants = qtys.map((_, i) => makeVariant(`v${i}`, String(i + 1).padStart(2, '0')));
          const composition: Record<string, number> = {};
          qtys.forEach((qty, i) => {
            composition[`-${String(i + 1).padStart(2, '0')}`] = qty;
          });
          const totalUnits = qtys.reduce((a, b) => a + b, 0);
          const perUnitBase = baseMilli / 1000; // exact multiple of 1e-3
          const totalQuantity = roundTo(perUnitBase * totalUnits, 3);

          const distributed = distributeSetMaterialToVariants(
            variants,
            composition,
            'inv-1',
            totalQuantity,
            'units'
          );

          const totalPerSet = sumPerSet(distributed, variants, composition);
          // For an evenly representable total, distribution must reconstruct exactly.
          expect(roundTo(totalPerSet, 3)).toBe(roundTo(totalQuantity, 3));
        }
      )
    );
  });
});

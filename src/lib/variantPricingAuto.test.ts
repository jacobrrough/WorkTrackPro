import { describe, expect, it } from 'vitest';
import type { PartVariant } from '@/core/types';
import { calculateSetPriceFromVariants } from './partDistribution';
import {
  buildEffectiveSetComposition,
  seedMissingVariantPrices,
  calculateVariantLaborTargets,
} from './variantPricingAuto';

const makeVariant = (
  id: string,
  suffix: string,
  pricePerVariant?: number,
  laborHours?: number
): PartVariant => ({
  id,
  partId: 'part-1',
  variantSuffix: suffix,
  pricePerVariant,
  laborHours,
});

describe('buildEffectiveSetComposition', () => {
  it('uses explicit set composition when present', () => {
    const variants = [makeVariant('v1', '01'), makeVariant('v2', '02')];
    const composition = buildEffectiveSetComposition(variants, { '-01': 1, '-02': 2 });
    expect(composition).toEqual({ '-01': 1, '-02': 2 });
  });

  it('falls back to one-per-variant when set composition is missing', () => {
    const variants = [makeVariant('v1', '01'), makeVariant('v2', '02')];
    const composition = buildEffectiveSetComposition(variants, null);
    expect(composition).toEqual({ '01': 1, '02': 1 });
  });
});

describe('seedMissingVariantPrices', () => {
  it('seeds missing variant prices from updated variant', () => {
    const variants = [
      makeVariant('v1', '01', 205),
      makeVariant('v2', '02'),
      makeVariant('v3', '03'),
      makeVariant('v4', '04', 220),
    ];

    const updates = seedMissingVariantPrices(variants, 'v1');
    expect(updates).toEqual([
      { variantId: 'v2', price: 205 },
      { variantId: 'v3', price: 205 },
    ]);
  });

  it('supports seeded defaults then explicit override for set total math', () => {
    const variants = [
      makeVariant('v1', '01', 205),
      makeVariant('v2', '02'),
      makeVariant('v3', '03'),
      makeVariant('v4', '04'),
    ];
    const composition = { '-01': 1, '-02': 1, '-03': 1, '-04': 1 };

    const seeded = seedMissingVariantPrices(variants, 'v1');
    const seededMap = new Map(seeded.map((entry) => [entry.variantId, entry.price]));
    const afterSeed = variants.map((variant) => ({
      ...variant,
      pricePerVariant: variant.pricePerVariant ?? seededMap.get(variant.id),
    }));
    expect(calculateSetPriceFromVariants(afterSeed, composition)).toBe(820);

    const afterOverride = afterSeed.map((variant) =>
      variant.id === 'v4' ? { ...variant, pricePerVariant: 220 } : variant
    );
    expect(calculateSetPriceFromVariants(afterOverride, composition)).toBe(835);
  });
});

describe('calculateVariantLaborTargets', () => {
  it('splits set labor by set composition quantities', () => {
    const variants = [makeVariant('v1', '01'), makeVariant('v2', '02'), makeVariant('v3', '03')];
    const targets = calculateVariantLaborTargets(variants, { '-01': 1, '-02': 2, '-03': 1 }, 8);
    expect(targets).toEqual([
      { variantId: 'v1', laborHours: 2 },
      { variantId: 'v2', laborHours: 4 },
      { variantId: 'v3', laborHours: 2 },
    ]);
  });
});

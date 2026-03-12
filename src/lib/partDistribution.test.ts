import { describe, expect, it } from 'vitest';
import type { Part, PartVariant } from '@/core/types';
import {
  distributeSetMaterialToVariants,
  getEffectiveSetPricingForDisplay,
} from './partDistribution';

const makeVariant = (
  id: string,
  suffix: string,
  overrides: Partial<PartVariant> = {}
): PartVariant => ({
  id,
  partId: 'part-1',
  variantSuffix: suffix,
  ...overrides,
});

describe('distributeSetMaterialToVariants', () => {
  it('applies an even per-unit quantity across included variants', () => {
    const variants = [makeVariant('v1', '01'), makeVariant('v2', '02'), makeVariant('v3', '03')];
    const composition = { '-01': 1, '-02': 2, '-03': 1 };

    const distributed = distributeSetMaterialToVariants(variants, composition, 'inv-1', 12, 'ft');

    expect(distributed).toEqual([
      { variantId: 'v1', inventoryId: 'inv-1', quantity: 3, unit: 'ft' },
      { variantId: 'v2', inventoryId: 'inv-1', quantity: 3, unit: 'ft' },
      { variantId: 'v3', inventoryId: 'inv-1', quantity: 3, unit: 'ft' },
    ]);
  });

  it('reconstructs to the original per-set total using set composition', () => {
    const variants = [makeVariant('v1', '01'), makeVariant('v2', '02')];
    const composition = { '-01': 1, '-02': 2 };

    const distributed = distributeSetMaterialToVariants(variants, composition, 'inv-1', 9, 'units');

    const qtyByVariantId = new Map(distributed.map((row) => [row.variantId, row.quantity]));
    const totalPerSet = variants.reduce((sum, variant) => {
      const qtyInSet =
        Object.entries(composition).find(
          ([suffix]) => suffix.replace(/^-/, '') === variant.variantSuffix
        )?.[1] ?? 0;
      return sum + (qtyByVariantId.get(variant.id) ?? 0) * qtyInSet;
    }, 0);

    expect(totalPerSet).toBeCloseTo(9, 3);
  });
});

describe('getEffectiveSetPricingForDisplay', () => {
  it('returns part row values for part with no variants', () => {
    const part: Part = {
      id: 'p1',
      partNumber: 'P-001',
      name: 'Single',
      pricePerSet: 100,
      laborHours: 2,
      requiresCNC: true,
      cncTimeHours: 0.5,
      variants: [],
    };
    const out = getEffectiveSetPricingForDisplay(part);
    expect(out.pricePerSet).toBe(100);
    expect(out.laborHours).toBe(2);
    expect(out.cncTimeHours).toBe(0.5);
    expect(out.requiresCNC).toBe(true);
  });

  it('returns variant-derived set price and labor when part has variants and set composition', () => {
    const part: Part = {
      id: 'p1',
      partNumber: 'P-002',
      name: 'Set',
      setComposition: { '-01': 1, '-02': 2 },
      variants: [
        makeVariant('v1', '01', { pricePerVariant: 60, laborHours: 1 }),
        makeVariant('v2', '02', { pricePerVariant: 40, laborHours: 0.5 }),
      ],
    };
    const out = getEffectiveSetPricingForDisplay(part);
    expect(out.pricePerSet).toBe(60 * 1 + 40 * 2);
    expect(out.laborHours).toBe(1 * 1 + 0.5 * 2);
  });

  it('returns undefined values for null part', () => {
    const out = getEffectiveSetPricingForDisplay(null);
    expect(out.pricePerSet).toBeUndefined();
    expect(out.laborHours).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import type { PartVariant } from '@/core/types';
import { distributeSetMaterialToVariants } from './partDistribution';

const makeVariant = (id: string, suffix: string): PartVariant => ({
  id,
  partId: 'part-1',
  variantSuffix: suffix,
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

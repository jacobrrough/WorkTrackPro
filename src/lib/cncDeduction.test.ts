import { describe, it, expect } from 'vitest';
import type { Job, Part, InventoryItem } from '@/core/types';
import {
  unitCountsByVariant,
  totalUnits,
  buildDistributedBom,
  cncableVariantKeys,
  jobHasCncableMaterial,
  cncDeltas,
  unitDeltas,
  isCncFullyComplete,
  NO_VARIANT_KEY,
} from './cncDeduction';

const inv = (id: string, category: InventoryItem['category']): InventoryItem =>
  ({
    id,
    name: id,
    category,
    inStock: 0,
    available: 0,
    disposed: 0,
    onOrder: 0,
    unit: 'units',
  }) as InventoryItem;

const cncCats = new Set(['foam']);

describe('unitCountsByVariant', () => {
  it('reads dash variants', () => {
    const job = { dashQuantities: { '-01': 4, '-04': 2 }, qty: '99' } as Pick<
      Job,
      'dashQuantities' | 'qty'
    >;
    expect(unitCountsByVariant(job)).toEqual({ '01': 4, '04': 2 });
    expect(totalUnits(job)).toBe(6);
  });

  it('falls back to a single no-variant group using job qty', () => {
    const job = { dashQuantities: {}, qty: '5' } as Pick<Job, 'dashQuantities' | 'qty'>;
    expect(unitCountsByVariant(job)).toEqual({ [NO_VARIANT_KEY]: 5 });
  });
});

describe('buildDistributedBom — even split fallback (no part spec)', () => {
  it('splits the padded BOM total evenly across all units', () => {
    const job = {
      dashQuantities: { '-01': 2, '-02': 2 },
      qty: '4',
      inventoryItems: [{ id: 'l1', inventoryId: 'foam1', quantity: 8, unit: 'units' }],
    } as unknown as Job;
    const bom = buildDistributedBom({
      job,
      part: null,
      inventoryById: new Map([['foam1', inv('foam1', 'foam')]]),
      cncAbleCategories: cncCats,
    });
    // 8 total / 4 units = 2 per unit, classed cncable (foam)
    expect(bom['01'].cncable.foam1).toBe(2);
    expect(bom['02'].cncable.foam1).toBe(2);
    expect(jobHasCncableMaterial(bom)).toBe(true);
  });
});

describe('buildDistributedBom — distribute only across variants that use a material', () => {
  it('material used by some variants distributes only to them, scaled to the padded total', () => {
    // Spec: -01 uses 1/unit of foam1, -02 uses 0, -03 uses 1/unit. Job has 1 of each variant.
    // Natural spec total for foam1 = 1*1 + 0 + 1*1 = 2. Padded job BOM = 10 → scale 5.
    const part = {
      id: 'p',
      variants: [
        {
          id: 'v1',
          partId: 'p',
          variantSuffix: '-01',
          materials: [
            {
              id: 'm1',
              inventoryId: 'foam1',
              quantityPerUnit: 1,
              unit: 'units',
              usageType: 'per_variant',
            },
          ],
        },
        { id: 'v2', partId: 'p', variantSuffix: '-02', materials: [] },
        {
          id: 'v3',
          partId: 'p',
          variantSuffix: '-03',
          materials: [
            {
              id: 'm3',
              inventoryId: 'foam1',
              quantityPerUnit: 1,
              unit: 'units',
              usageType: 'per_variant',
            },
          ],
        },
      ],
    } as unknown as Part;
    const job = {
      dashQuantities: { '-01': 1, '-02': 1, '-03': 1 },
      qty: '3',
      inventoryItems: [{ id: 'l1', inventoryId: 'foam1', quantity: 10, unit: 'units' }],
    } as unknown as Job;
    const bom = buildDistributedBom({
      job,
      part,
      inventoryById: new Map([['foam1', inv('foam1', 'foam')]]),
      cncAbleCategories: cncCats,
    });
    expect(bom['01'].cncable.foam1).toBe(5); // 1 * scale(5)
    expect(bom['02'].cncable.foam1).toBeUndefined(); // doesn't use it
    expect(bom['03'].cncable.foam1).toBe(5);
    // Sum over all units = 5 + 5 = 10 = padded total.
    expect(cncableVariantKeys(bom).sort()).toEqual(['01', '03']);
  });
});

describe('cncable vs non-cncable classification', () => {
  it('splits materials into buckets by category', () => {
    const job = {
      dashQuantities: { '-01': 2 },
      qty: '2',
      inventoryItems: [
        { id: 'l1', inventoryId: 'foam1', quantity: 4, unit: 'units' },
        { id: 'l2', inventoryId: 'bolt1', quantity: 8, unit: 'units' },
      ],
    } as unknown as Job;
    const bom = buildDistributedBom({
      job,
      part: null,
      inventoryById: new Map([
        ['foam1', inv('foam1', 'foam')],
        ['bolt1', inv('bolt1', 'hardware')],
      ]),
      cncAbleCategories: cncCats,
    });
    expect(bom['01'].cncable).toEqual({ foam1: 2 });
    expect(bom['01'].nonCncable).toEqual({ bolt1: 4 });
  });
});

describe('cncDeltas / unitDeltas', () => {
  const job = {
    dashQuantities: { '-01': 4 },
    qty: '4',
    inventoryItems: [
      { id: 'l1', inventoryId: 'foam1', quantity: 8, unit: 'units' },
      { id: 'l2', inventoryId: 'bolt1', quantity: 4, unit: 'units' },
    ],
  } as unknown as Job;
  const bom = buildDistributedBom({
    job,
    part: null,
    inventoryById: new Map([
      ['foam1', inv('foam1', 'foam')],
      ['bolt1', inv('bolt1', 'hardware')],
    ]),
    cncAbleCategories: cncCats,
  });

  it('cncDeltas pulls only foam', () => {
    expect(cncDeltas(bom, '01', 2)).toEqual({ foam1: 4 }); // 2/unit * 2
  });

  it('unitDeltas without alsoCnc pulls only hardware', () => {
    expect(unitDeltas(bom, '01', 2, false)).toEqual({ bolt1: 2 }); // 1/unit * 2
  });

  it('unitDeltas with alsoCnc pulls both', () => {
    expect(unitDeltas(bom, '01', 1, true)).toEqual({ bolt1: 1, foam1: 2 });
  });

  it('negative delta restores', () => {
    expect(cncDeltas(bom, '01', -1)).toEqual({ foam1: -2 });
  });
});

describe('isCncFullyComplete', () => {
  const job = { dashQuantities: { '-01': 2, '-02': 2 }, qty: '4' } as unknown as Job;
  const bom = buildDistributedBom({
    job,
    part: null,
    inventoryById: new Map([['foam1', inv('foam1', 'foam')]]),
    cncAbleCategories: cncCats,
  });
  // give every variant foam via an even-split BOM
  const jobWithBom = {
    ...job,
    inventoryItems: [{ id: 'l', inventoryId: 'foam1', quantity: 4, unit: 'u' }],
  } as unknown as Job;
  const fullBom = buildDistributedBom({
    job: jobWithBom,
    part: null,
    inventoryById: new Map([['foam1', inv('foam1', 'foam')]]),
    cncAbleCategories: cncCats,
  });

  it('false until all cnc-able units done', () => {
    expect(isCncFullyComplete(fullBom, { '01': 2, '02': 1 }, jobWithBom)).toBe(false);
    expect(isCncFullyComplete(fullBom, { '01': 2, '02': 2 }, jobWithBom)).toBe(true);
  });

  it('false when there is no cnc-able material', () => {
    expect(isCncFullyComplete(bom, {}, job)).toBe(false); // bom has no inventoryItems -> no cncable
  });
});

import { describe, it, expect } from 'vitest';
import type { Job, Part, InventoryItem, PartMaterial } from '@/core/types';
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

/** Build a machineBreakdownByVariant giving each listed suffix some CNC hours. */
const cncHours = (...suffixes: string[]): Job['machineBreakdownByVariant'] =>
  Object.fromEntries(
    suffixes.map((s) => [
      s,
      {
        qty: 1,
        cncHoursPerUnit: 1,
        cncHoursTotal: 1,
        printer3DHoursPerUnit: 0,
        printer3DHoursTotal: 0,
      },
    ])
  );

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
      machineBreakdownByVariant: cncHours('-01', '-02'),
      inventoryItems: [{ id: 'l1', inventoryId: 'foam1', quantity: 8, unit: 'units' }],
    } as unknown as Job;
    const bom = buildDistributedBom({
      job,
      part: null,
      inventoryById: new Map([['foam1', inv('foam1', 'foam')]]),
      cncAbleCategories: cncCats,
    });
    // 8 total / 4 units = 2 per unit, classed cncable (foam + variant has CNC hours)
    expect(bom['01'].cncable.foam1).toBe(2);
    expect(bom['02'].cncable.foam1).toBe(2);
    expect(jobHasCncableMaterial(bom)).toBe(true);
  });
});

describe('CNC milestone is gated by CNC hours, not foam presence', () => {
  it('a variant with foam but NO CNC hours deducts foam on unit-done, not CNC', () => {
    const job = {
      dashQuantities: { '-01': 2 },
      qty: '2',
      machineBreakdownByVariant: {}, // no CNC hours anywhere
      inventoryItems: [{ id: 'l1', inventoryId: 'foam1', quantity: 4, unit: 'units' }],
    } as unknown as Job;
    const bom = buildDistributedBom({
      job,
      part: null,
      inventoryById: new Map([['foam1', inv('foam1', 'foam')]]),
      cncAbleCategories: cncCats,
    });
    expect(bom['01'].hasCncHours).toBe(false);
    expect(bom['01'].cncable).toEqual({});
    expect(bom['01'].nonCncable).toEqual({ foam1: 2 });
    expect(cncableVariantKeys(bom)).toEqual([]);
    expect(jobHasCncableMaterial(bom)).toBe(false);
  });

  it('a variant with CNC hours but NO foam still appears in the CNC checklist (deducts nothing)', () => {
    const job = {
      dashQuantities: { '-01': 2 },
      qty: '2',
      machineBreakdownByVariant: cncHours('-01'),
      inventoryItems: [{ id: 'l1', inventoryId: 'bolt1', quantity: 4, unit: 'units' }],
    } as unknown as Job;
    const bom = buildDistributedBom({
      job,
      part: null,
      inventoryById: new Map([['bolt1', inv('bolt1', 'hardware')]]),
      cncAbleCategories: cncCats,
    });
    expect(cncableVariantKeys(bom)).toEqual(['01']);
    expect(bom['01'].cncable).toEqual({}); // no foam to pull
    expect(cncDeltas(bom, '01', 2)).toEqual({}); // CNC milestone deducts nothing
    expect(bom['01'].nonCncable).toEqual({ bolt1: 2 });
  });

  it('only the CNC-hour variants pull foam on the CNC milestone', () => {
    // -01 has CNC hours, -02 does not. Both use foam.
    const job = {
      dashQuantities: { '-01': 2, '-02': 2 },
      qty: '4',
      machineBreakdownByVariant: cncHours('-01'),
      inventoryItems: [{ id: 'l1', inventoryId: 'foam1', quantity: 8, unit: 'units' }],
    } as unknown as Job;
    const bom = buildDistributedBom({
      job,
      part: null,
      inventoryById: new Map([['foam1', inv('foam1', 'foam')]]),
      cncAbleCategories: cncCats,
    });
    expect(cncableVariantKeys(bom)).toEqual(['01']);
    expect(bom['01'].cncable.foam1).toBe(2); // CNC variant -> foam on CNC milestone
    expect(bom['02'].cncable).toEqual({}); // no CNC hours -> foam falls to unit-done
    expect(bom['02'].nonCncable.foam1).toBe(2);
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
      // -01 and -03 run CNC; -02 does not.
      machineBreakdownByVariant: cncHours('-01', '-03'),
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

describe('per-material requiresCnc slider overrides the CNC-hours fallback', () => {
  const foamMat = (id: string, requiresCnc?: boolean): PartMaterial => ({
    id,
    inventoryId: 'foam1',
    quantityPerUnit: 1,
    unit: 'units',
    usageType: 'per_variant',
    ...(requiresCnc !== undefined && { requiresCnc }),
  });

  const inventoryById = new Map([['foam1', inv('foam1', 'foam')]]);

  it('flagged foam on a variant with NO CNC hours still deducts on the CNC step + shows in checklist', () => {
    const part = {
      id: 'p',
      variants: [{ id: 'v1', partId: 'p', variantSuffix: '-01', materials: [foamMat('m1', true)] }],
    } as unknown as Part;
    const job = {
      dashQuantities: { '-01': 2 },
      qty: '2',
      machineBreakdownByVariant: {}, // no CNC hours anywhere
      inventoryItems: [{ id: 'l1', inventoryId: 'foam1', quantity: 4, unit: 'units' }],
    } as unknown as Job;
    const bom = buildDistributedBom({ job, part, inventoryById, cncAbleCategories: cncCats });
    expect(bom['01'].hasCncHours).toBe(false);
    expect(bom['01'].cncable).toEqual({ foam1: 2 }); // flagged -> CNC milestone despite no hours
    expect(bom['01'].nonCncable).toEqual({});
    expect(cncableVariantKeys(bom)).toEqual(['01']); // shown via flagged material
    expect(jobHasCncableMaterial(bom)).toBe(true);
    expect(cncDeltas(bom, '01', 2)).toEqual({ foam1: 4 });
  });

  it('explicitly-unflagged foam on a CNC-hour variant falls to unit-done (slider overrides hours)', () => {
    const part = {
      id: 'p',
      variants: [
        { id: 'v1', partId: 'p', variantSuffix: '-01', materials: [foamMat('m1', false)] },
      ],
    } as unknown as Part;
    const job = {
      dashQuantities: { '-01': 2 },
      qty: '2',
      machineBreakdownByVariant: cncHours('-01'), // variant runs CNC...
      inventoryItems: [{ id: 'l1', inventoryId: 'foam1', quantity: 4, unit: 'units' }],
    } as unknown as Job;
    const bom = buildDistributedBom({ job, part, inventoryById, cncAbleCategories: cncCats });
    expect(bom['01'].cncable).toEqual({}); // ...but this foam isn't the CNC'd material
    expect(bom['01'].nonCncable).toEqual({ foam1: 2 });
    expect(cncableVariantKeys(bom)).toEqual(['01']); // variant still shown (it has CNC hours)
    expect(cncDeltas(bom, '01', 2)).toEqual({}); // CNC step pulls nothing for this material
  });

  it('a part-level (per_set) flagged foam applies to every variant', () => {
    const part = {
      id: 'p',
      materials: [
        {
          id: 'pm1',
          partId: 'p',
          inventoryId: 'foam1',
          quantityPerUnit: 1,
          unit: 'units',
          usageType: 'per_set',
          requiresCnc: true,
        },
      ],
      variants: [
        { id: 'v1', partId: 'p', variantSuffix: '-01', materials: [] },
        { id: 'v2', partId: 'p', variantSuffix: '-02', materials: [] },
      ],
    } as unknown as Part;
    const job = {
      dashQuantities: { '-01': 1, '-02': 1 },
      qty: '2',
      machineBreakdownByVariant: {}, // no hours; the flag alone drives CNC
      inventoryItems: [{ id: 'l1', inventoryId: 'foam1', quantity: 2, unit: 'units' }],
    } as unknown as Job;
    const bom = buildDistributedBom({ job, part, inventoryById, cncAbleCategories: cncCats });
    expect(bom['01'].cncable.foam1).toBe(1);
    expect(bom['02'].cncable.foam1).toBe(1);
    expect(cncableVariantKeys(bom).sort()).toEqual(['01', '02']);
  });

  it('falls back to the CNC-hours gate when the part has no spec entry for the material', () => {
    // Part exists but doesn't spec foam1 -> requiresCnc is undefined -> use the hours gate.
    const part = {
      id: 'p',
      variants: [{ id: 'v1', partId: 'p', variantSuffix: '-01', materials: [] }],
    } as unknown as Part;
    const withHours = buildDistributedBom({
      job: {
        dashQuantities: { '-01': 2 },
        qty: '2',
        machineBreakdownByVariant: cncHours('-01'),
        inventoryItems: [{ id: 'l1', inventoryId: 'foam1', quantity: 4, unit: 'units' }],
      } as unknown as Job,
      part,
      inventoryById,
      cncAbleCategories: cncCats,
    });
    expect(withHours['01'].cncable.foam1).toBe(2); // hours -> CNC
    const noHours = buildDistributedBom({
      job: {
        dashQuantities: { '-01': 2 },
        qty: '2',
        machineBreakdownByVariant: {},
        inventoryItems: [{ id: 'l1', inventoryId: 'foam1', quantity: 4, unit: 'units' }],
      } as unknown as Job,
      part,
      inventoryById,
      cncAbleCategories: cncCats,
    });
    expect(noHours['01'].cncable).toEqual({}); // no hours, no flag -> not CNC
    expect(noHours['01'].nonCncable).toEqual({ foam1: 2 });
    expect(cncableVariantKeys(noHours)).toEqual([]);
  });
});

describe('cncable vs non-cncable classification', () => {
  it('splits materials into buckets by category (foam on a CNC variant)', () => {
    const job = {
      dashQuantities: { '-01': 2 },
      qty: '2',
      machineBreakdownByVariant: cncHours('-01'),
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
    machineBreakdownByVariant: cncHours('-01'),
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

describe('no-variant job', () => {
  it('attributes CNC hours to the single unit group', () => {
    const job = {
      dashQuantities: {},
      qty: '3',
      // No-variant jobs may key their breakdown by a synthetic suffix; any CNC hours belong to the
      // single group.
      machineBreakdownByVariant: cncHours('-01'),
      inventoryItems: [{ id: 'l1', inventoryId: 'foam1', quantity: 6, unit: 'units' }],
    } as unknown as Job;
    const bom = buildDistributedBom({
      job,
      part: null,
      inventoryById: new Map([['foam1', inv('foam1', 'foam')]]),
      cncAbleCategories: cncCats,
    });
    expect(cncableVariantKeys(bom)).toEqual([NO_VARIANT_KEY]);
    expect(bom[NO_VARIANT_KEY].cncable.foam1).toBe(2); // 6 / 3 units
  });
});

describe('isCncFullyComplete', () => {
  const job = {
    dashQuantities: { '-01': 2, '-02': 2 },
    qty: '4',
    machineBreakdownByVariant: cncHours('-01', '-02'),
  } as unknown as Job;
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

  it('false when no variant has CNC hours', () => {
    const noCncJob = { dashQuantities: { '-01': 2 }, qty: '2' } as unknown as Job;
    const noCncBom = buildDistributedBom({
      job: noCncJob,
      part: null,
      inventoryById: new Map([['foam1', inv('foam1', 'foam')]]),
      cncAbleCategories: cncCats,
    });
    expect(isCncFullyComplete(noCncBom, {}, noCncJob)).toBe(false);
  });
});

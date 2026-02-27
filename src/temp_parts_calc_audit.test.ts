/**
 * Temporary Parts calculation audit — comprehensive scenarios for Parts Section Surgical Refresh.
 * Run: npm run test -- temp_parts_calc_audit
 * Do not modify Inventory, stock, or job_inventory persistence; only assert calculation behavior.
 */

import { describe, expect, it } from 'vitest';
import type { InventoryItem, Part, PartMaterial, PartVariant } from '@/core/types';
import { computeRequiredMaterials } from '@/lib/partsCalculations';
import { calculateSetCompletion } from '@/lib/formatJob';
import { calculatePartQuote, calculateVariantQuote } from '@/lib/calculatePartQuote';
import {
  calculateSetPriceFromVariants,
  variantPricesFromSetPrice,
  calculateSetLaborFromVariants,
} from '@/lib/partDistribution';
import { buildEffectiveSetComposition } from '@/lib/variantPricingAuto';
import { normalizeDashQuantities, quantityPerUnit } from '@/lib/variantMath';

// ——— Fixtures ———

function makeInventory(id: string, price: number): InventoryItem {
  return {
    id,
    name: `Inv-${id}`,
    category: 'rawMaterial',
    inStock: 100,
    available: 100,
    disposed: 0,
    onOrder: 0,
    unit: 'ea',
    price,
  } as InventoryItem;
}

function makePartMaterial(
  id: string,
  inventoryId: string,
  quantityPerUnit: number,
  usageType: 'per_set' | 'per_variant' = 'per_variant'
): PartMaterial {
  return {
    id,
    inventoryId,
    quantityPerUnit,
    unit: 'ea',
    usageType,
  };
}

/** Part with 5 materials (2 variant-level per variant, 1 part-level per_set). */
function makePartWithFiveMaterials(
  priceInv1 = 10,
  priceInv2 = 20,
  priceInv3 = 5
): {
  part: Part & { variants: PartVariant[]; materials: PartMaterial[] };
  inventory: InventoryItem[];
} {
  const inv1 = makeInventory('inv-1', priceInv1);
  const inv2 = makeInventory('inv-2', priceInv2);
  const inv3 = makeInventory('inv-3', priceInv3);
  const inv4 = makeInventory('inv-4', 1);
  const inv5 = makeInventory('inv-5', 2);
  const inventory = [inv1, inv2, inv3, inv4, inv5];

  const variant01: PartVariant & { materials: PartMaterial[] } = {
    id: 'var-01',
    partId: 'part-1',
    variantSuffix: '01',
    materials: [
      makePartMaterial('m1', 'inv-1', 2, 'per_variant'),
      makePartMaterial('m2', 'inv-2', 1, 'per_variant'),
    ],
  };
  const variant05: PartVariant & { materials: PartMaterial[] } = {
    id: 'var-05',
    partId: 'part-1',
    variantSuffix: '05',
    materials: [
      makePartMaterial('m3', 'inv-3', 3, 'per_variant'),
      makePartMaterial('m4', 'inv-4', 0.5, 'per_variant'),
    ],
  };
  const part: Part & { variants: PartVariant[]; materials: PartMaterial[] } = {
    id: 'part-1',
    partNumber: 'P-100',
    name: 'Part 100',
    laborHours: 1,
    requiresCNC: false,
    requires3DPrint: false,
    setComposition: { '01': 2, '05': 1 },
    variants: [variant01, variant05],
    materials: [makePartMaterial('m5', 'inv-5', 1, 'per_set')],
  };
  return { part, inventory };
}

// ——— Scenarios ———

describe('Parts calculation audit', () => {
  describe('Part with 5 materials — change one material price', () => {
    it('part quote total updates when one material price changes', () => {
      const { part, inventory } = makePartWithFiveMaterials(10, 20, 5);
      const q1 = calculatePartQuote(part, 1, inventory);
      expect(q1).not.toBeNull();
      const totalBefore = q1!.materialCostOur;

      const inventoryNewPrice = inventory.map((i) => (i.id === 'inv-1' ? { ...i, price: 25 } : i));
      const q2 = calculatePartQuote(part, 1, inventoryNewPrice);
      expect(q2).not.toBeNull();
      const totalAfter = q2!.materialCostOur;
      expect(totalAfter).toBeGreaterThan(totalBefore);
      expect(totalAfter - totalBefore).toBeCloseTo((25 - 10) * 4, 5); // 2 per variant × 2 in set for -01
    });

    it('variant quote total updates when material price changes', () => {
      const { part, inventory } = makePartWithFiveMaterials(10, 20, 5);
      const v = part.variants[0];
      const q1 = calculateVariantQuote('P-100', v, 5, inventory);
      expect(q1).not.toBeNull();
      const totalBefore = q1!.materialCostOur;

      const inventoryNew = inventory.map((i) => (i.id === 'inv-2' ? { ...i, price: 40 } : i));
      const q2 = calculateVariantQuote('P-100', v, 5, inventoryNew);
      expect(q2).not.toBeNull();
      expect(q2!.materialCostOur).toBeGreaterThan(totalBefore);
      expect(q2!.materialCostOur - totalBefore).toBeCloseTo((40 - 20) * 5, 5);
    });
  });

  describe('Required material quantities — allocate part to job', () => {
    it('computeRequiredMaterials matches variant qty × dash + per_set × complete sets', () => {
      const { part } = makePartWithFiveMaterials();
      const dash = { '-01': 4, '-05': 2 };
      const required = computeRequiredMaterials(part, dash);
      expect(required.size).toBeGreaterThan(0);
      // -01: 4 units × (inv-1: 2, inv-2: 1) = inv-1: 8, inv-2: 4
      expect(required.get('inv-1')?.quantity).toBe(8);
      expect(required.get('inv-2')?.quantity).toBe(4);
      // -05: 2 units × (inv-3: 3, inv-4: 0.5) = inv-3: 6, inv-4: 1
      expect(required.get('inv-3')?.quantity).toBe(6);
      expect(required.get('inv-4')?.quantity).toBe(1);
      // per_set: complete sets = min(4/2, 2/1) = 2; inv-5: 1 per set => 2
      expect(required.get('inv-5')?.quantity).toBe(2);
    });

    it('required quantities are consistent with set composition', () => {
      const { part } = makePartWithFiveMaterials();
      const dash = { '-01': 2, '-05': 2 };
      const required = computeRequiredMaterials(part, dash);
      const completeSets = calculateSetCompletion(
        normalizeDashQuantities(dash),
        part.setComposition ?? {}
      );
      expect(completeSets.completeSets).toBe(1);
      expect(required.get('inv-5')?.quantity).toBe(1);
    });
  });

  describe('Set completion and job BOM consistency', () => {
    it('calculateSetCompletion gives complete sets from dash and set composition', () => {
      const dash = { '-01': 4, '-05': 2 };
      const setComp = { '01': 2, '05': 1 };
      const { completeSets } = calculateSetCompletion(normalizeDashQuantities(dash), setComp);
      expect(completeSets).toBe(2);
    });

    it('zero dash quantities yield empty required materials', () => {
      const { part } = makePartWithFiveMaterials();
      const required = computeRequiredMaterials(part, {});
      expect(required.size).toBe(0);
    });
  });

  describe('Set price and variant price calculations', () => {
    it('calculateSetPriceFromVariants sums variant price × set composition', () => {
      const variants: PartVariant[] = [
        { id: 'v1', partId: 'p1', variantSuffix: '01', pricePerVariant: 10 },
        { id: 'v2', partId: 'p1', variantSuffix: '05', pricePerVariant: 20 },
      ];
      const setComp = { '01': 2, '05': 1 };
      const setPrice = calculateSetPriceFromVariants(variants, setComp);
      expect(setPrice).toBe(2 * 10 + 1 * 20);
    });

    it('variantPricesFromSetPrice distributes set price proportionally', () => {
      const variants: PartVariant[] = [
        { id: 'v1', partId: 'p1', variantSuffix: '01' },
        { id: 'v2', partId: 'p1', variantSuffix: '05' },
      ];
      const setComp = { '01': 1, '05': 1 };
      const prices = variantPricesFromSetPrice(50, setComp, variants);
      expect(prices.length).toBe(2);
      const sum = prices.reduce((s, p) => s + p.price, 0);
      expect(sum).toBeCloseTo(50, 2);
    });

    it('calculateSetLaborFromVariants sums variant labor × set composition', () => {
      const variants: PartVariant[] = [
        { id: 'v1', partId: 'p1', variantSuffix: '01', laborHours: 1 },
        { id: 'v2', partId: 'p1', variantSuffix: '05', laborHours: 2 },
      ];
      const setComp = { '01': 2, '05': 1 };
      const labor = calculateSetLaborFromVariants(variants, setComp);
      expect(labor).toBe(2 * 1 + 1 * 2);
    });
  });

  describe('Effective set composition', () => {
    it('buildEffectiveSetComposition returns fallback 1 per variant when empty', () => {
      const variants: PartVariant[] = [
        { id: 'v1', partId: 'p1', variantSuffix: '01' },
        { id: 'v2', partId: 'p1', variantSuffix: '05' },
      ];
      const comp = buildEffectiveSetComposition(variants, null);
      expect(comp['01']).toBe(1);
      expect(comp['05']).toBe(1);
    });
  });

  describe('Edge cases: negative, zero, fractional quantities', () => {
    it('normalizeDashQuantities drops non-positive and non-finite', () => {
      const normalized = normalizeDashQuantities({
        '-01': 5,
        '-02': 0,
        '-03': -1,
        '-04': NaN,
      });
      expect(normalized['-01']).toBe(5);
      expect(normalized['-02']).toBeUndefined();
      expect(normalized['-03']).toBeUndefined();
    });

    it('computeRequiredMaterials ignores zero and negative dash qty', () => {
      const { part } = makePartWithFiveMaterials();
      const required = computeRequiredMaterials(part, { '-01': 0, '-05': -1 });
      expect(required.size).toBe(0);
    });

    it('calculatePartQuote returns null for quantity <= 0', () => {
      const { part, inventory } = makePartWithFiveMaterials();
      expect(calculatePartQuote(part, 0, inventory)).toBeNull();
      expect(calculatePartQuote(part, -1, inventory)).toBeNull();
    });

    it('quantityPerUnit falls back to 1 when missing', () => {
      expect(quantityPerUnit({})).toBe(1);
      expect(quantityPerUnit({ quantityPerUnit: 2 })).toBe(2);
      expect(
        quantityPerUnit({ quantity: 3 } as { quantityPerUnit?: number; quantity?: number })
      ).toBe(3);
    });

    it('part quote uses fractional material quantities correctly', () => {
      const part: Part & { variants: PartVariant[]; materials: PartMaterial[] } = {
        id: 'p1',
        partNumber: 'P',
        name: 'P',
        setComposition: { '01': 1 },
        variants: [
          {
            id: 'v1',
            partId: 'p1',
            variantSuffix: '01',
            materials: [makePartMaterial('m1', 'inv-1', 0.25, 'per_variant')],
          },
        ],
        materials: [],
      };
      const inv = [makeInventory('inv-1', 4)];
      const q = calculatePartQuote(part, 8, inv, { laborRate: 0 });
      expect(q).not.toBeNull();
      expect(q!.materialCostOur).toBeCloseTo(0.25 * 8 * 4, 5);
    });
  });
});

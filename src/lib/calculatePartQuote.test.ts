import { describe, expect, it } from 'vitest';
import type { InventoryItem, Part, PartVariant } from '@/core/types';
import { calculatePartQuote, calculateVariantQuote } from './calculatePartQuote';

const makeInventory = (id: string, price: number): InventoryItem =>
  ({
    id,
    name: `INV-${id}`,
    category: 'rawMaterial',
    currentStock: 100,
    minStockLevel: 1,
    unit: 'ea',
    price,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }) as InventoryItem;

const makeVariant = (): PartVariant & {
  materials: Array<{ inventoryId: string; quantityPerUnit: number }>;
} =>
  ({
    id: 'variant-1',
    partId: 'part-1',
    variantSuffix: '01',
    laborHours: 1,
    materials: [{ inventoryId: 'inv-1', quantityPerUnit: 2 }],
  }) as PartVariant & { materials: Array<{ inventoryId: string; quantityPerUnit: number }> };

describe('calculateVariantQuote', () => {
  it('auto-adjusts labor hours when manual variant price is provided', () => {
    const variant = makeVariant();
    const inventory = [makeInventory('inv-1', 5)];
    const result = calculateVariantQuote('P-100', variant, 1, inventory, {
      laborRate: 100,
      manualVariantPrice: 200,
    });

    expect(result).not.toBeNull();
    expect(result?.isReverseCalculated).toBe(true);
    expect(result?.isLaborAutoAdjusted).toBe(true);
    // material customer = (2 * 5) * 2.25 = 22.5, target labor cost = 177.5, at 100/hr => 1.775h
    expect(result?.laborHours).toBeCloseTo(1.775, 3);
    expect(result?.total).toBeCloseTo(200, 3);
  });
});

describe('calculatePartQuote', () => {
  it('treats manual set price as the final total', () => {
    const part = {
      id: 'part-1',
      partNumber: 'P-100',
      name: 'Part 100',
      laborHours: 1,
      requiresCNC: false,
      requires3DPrint: false,
      materials: [
        { id: 'm-1', inventoryId: 'inv-1', quantityPerUnit: 2, unit: 'ea', usageType: 'per_set' },
      ],
      variants: [],
      setComposition: {},
    } as unknown as Part;
    const inventory = [makeInventory('inv-1', 5)];

    const result = calculatePartQuote(part, 1, inventory, {
      laborRate: 175,
      manualSetPrice: 9300,
    });

    expect(result).not.toBeNull();
    expect(result?.isReverseCalculated).toBe(true);
    expect(result?.total).toBeCloseTo(9300, 2);
  });
});

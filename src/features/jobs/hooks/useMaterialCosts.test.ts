import { describe, expect, it } from 'vitest';
import type { InventoryItem, JobInventoryItem, Part } from '@/core/types';
import { computeMaterialCosts } from './materialCostUtils';

const inventoryItem = (id: string, price: number): InventoryItem => ({
  id,
  name: id,
  category: 'material',
  inStock: 100,
  available: 100,
  disposed: 0,
  onOrder: 0,
  unit: 'ea',
  price,
});

describe('computeMaterialCosts', () => {
  it('computes variant, per_set, and manual material costs for admins', () => {
    const part: Part = {
      id: 'part-1',
      partNumber: 'ABC-100',
      name: 'Part A',
      variants: [
        {
          id: 'var-1',
          partId: 'part-1',
          variantSuffix: '-01',
          materials: [
            {
              id: 'mat-1',
              inventoryId: 'inv-1',
              quantityPerUnit: 2,
              unit: 'ea',
            },
          ],
        },
      ],
      materials: [
        {
          id: 'mat-set',
          inventoryId: 'inv-2',
          quantityPerUnit: 1,
          unit: 'ea',
          usageType: 'per_set',
        },
      ],
    };
    const inventoryById = new Map<string, InventoryItem>([
      ['inv-1', inventoryItem('inv-1', 10)],
      ['inv-2', inventoryItem('inv-2', 5)],
      ['inv-3', inventoryItem('inv-3', 20)],
    ]);
    const jobInventoryItems: JobInventoryItem[] = [
      { id: 'job-mat-1', inventoryId: 'inv-1', quantity: 1, unit: 'ea' },
      { id: 'job-mat-2', inventoryId: 'inv-3', quantity: 2, unit: 'ea' },
    ];

    const costs = computeMaterialCosts({
      linkedPart: part,
      selectedVariantSuffix: '-01',
      dashQuantities: { '-01': 3 },
      inventoryById,
      jobInventoryItems,
      materialUpcharge: 1,
      isAdmin: true,
    });

    expect(costs.get('inv-1')).toBe(60);
    expect(costs.get('inv-2')).toBe(15);
    expect(costs.get('inv-3')).toBe(40);
  });

  it('short-circuits all financial computation for non-admin users', () => {
    const costs = computeMaterialCosts({
      linkedPart: null,
      selectedVariantSuffix: undefined,
      dashQuantities: {},
      inventoryById: new Map(),
      jobInventoryItems: [],
      materialUpcharge: 1,
      isAdmin: false,
    });
    expect(costs.size).toBe(0);
  });
});

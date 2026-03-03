import { describe, expect, it } from 'vitest';
import type { InventoryItem, JobInventoryItem } from '@/core/types';
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
  it('computes cost from job inventory only: quantity × price × upcharge per line', () => {
    const inventoryById = new Map<string, InventoryItem>([
      ['inv-1', inventoryItem('inv-1', 10)],
      ['inv-2', inventoryItem('inv-2', 5)],
      ['inv-3', inventoryItem('inv-3', 20)],
    ]);
    const jobInventoryItems: JobInventoryItem[] = [
      { id: 'ji-1', inventoryId: 'inv-1', quantity: 6, unit: 'ea' },
      { id: 'ji-2', inventoryId: 'inv-2', quantity: 3, unit: 'ea' },
    ];
    const materialUpcharge = 1;

    const costs = computeMaterialCosts({
      linkedPart: null,
      selectedVariantSuffix: undefined,
      dashQuantities: {},
      inventoryById,
      jobInventoryItems,
      materialUpcharge,
      isAdmin: true,
    });

    expect(costs.get('inv-1')).toBe(6 * 10 * 1);
    expect(costs.get('inv-2')).toBe(3 * 5 * 1);
    expect(costs.get('inv-3')).toBeUndefined();
    const total = Array.from(costs.values()).reduce((sum, c) => sum + c, 0);
    expect(total).toBe(60 + 15);
  });

  it('includes all job inventory lines in cost total', () => {
    const inventoryById = new Map<string, InventoryItem>([
      ['inv-1', inventoryItem('inv-1', 10)],
      ['inv-2', inventoryItem('inv-2', 5)],
      ['inv-3', inventoryItem('inv-3', 20)],
    ]);
    const jobInventoryItems: JobInventoryItem[] = [
      { id: 'ji-1', inventoryId: 'inv-1', quantity: 6, unit: 'ea' },
      { id: 'ji-2', inventoryId: 'inv-2', quantity: 3, unit: 'ea' },
      { id: 'ji-3', inventoryId: 'inv-3', quantity: 2, unit: 'ea' },
    ];

    const costs = computeMaterialCosts({
      linkedPart: null,
      selectedVariantSuffix: undefined,
      dashQuantities: {},
      inventoryById,
      jobInventoryItems,
      materialUpcharge: 1,
      isAdmin: true,
    });

    expect(costs.get('inv-1')).toBe(60);
    expect(costs.get('inv-2')).toBe(15);
    expect(costs.get('inv-3')).toBe(40);
    const total = Array.from(costs.values()).reduce((sum, c) => sum + c, 0);
    expect(total).toBe(115);
  });

  it('sums multiple lines for same inventoryId', () => {
    const inventoryById = new Map<string, InventoryItem>([
      ['inv-set', inventoryItem('inv-set', 10)],
    ]);
    const jobInventoryItems: JobInventoryItem[] = [
      { id: 'ji-1', inventoryId: 'inv-set', quantity: 2, unit: 'ea' },
    ];

    const costs = computeMaterialCosts({
      linkedPart: null,
      selectedVariantSuffix: undefined,
      dashQuantities: {},
      inventoryById,
      jobInventoryItems,
      materialUpcharge: 1,
      isAdmin: true,
    });

    expect(costs.get('inv-set')).toBe(2 * 10 * 1);
  });

  it('returns empty map when job has no inventory lines', () => {
    const costs = computeMaterialCosts({
      linkedPart: null,
      selectedVariantSuffix: undefined,
      dashQuantities: {},
      inventoryById: new Map([['inv-1', inventoryItem('inv-1', 10)]]),
      jobInventoryItems: [],
      materialUpcharge: 1,
      isAdmin: true,
    });
    expect(costs.size).toBe(0);
  });

  it('short-circuits all financial computation for non-admin users', () => {
    const costs = computeMaterialCosts({
      linkedPart: null,
      selectedVariantSuffix: undefined,
      dashQuantities: {},
      inventoryById: new Map(),
      jobInventoryItems: [{ id: 'ji-1', inventoryId: 'inv-1', quantity: 5, unit: 'ea' }],
      materialUpcharge: 1,
      isAdmin: false,
    });
    expect(costs.size).toBe(0);
  });
});

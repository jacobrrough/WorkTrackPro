import { describe, it, expect } from 'vitest';
import { calculateAllocated, calculateAvailable } from './inventoryCalculations';
import type { Job, InventoryItem } from '@/core/types';

const mockJob = (
  id: string,
  status: Job['status'],
  inventoryItems: Array<{ inventory: string; quantity: number }>
): Job => ({
  id,
  jobCode: 1,
  name: 'Test Job',
  active: true,
  status,
  attachments: [],
  attachmentCount: 0,
  comments: [],
  commentCount: 0,
  inventoryItems: [],
  assignedUsers: [],
  isRush: false,
  workers: [],
  expand: {
    job_inventory_via_job: inventoryItems.map((ji, idx) => ({
      id: `ji_${idx}`,
      job: id,
      inventory: ji.inventory,
      quantity: ji.quantity,
      unit: 'units',
    })),
  },
});

const mockInventoryItem = (id: string, inStock: number): InventoryItem => ({
  id,
  name: 'Test Item',
  category: 'material',
  inStock,
  available: inStock,
  disposed: 0,
  onOrder: 0,
  unit: 'units',
  hasImage: false,
});

describe('calculateAllocated', () => {
  it('calculates allocated from active jobs', () => {
    const jobs: Job[] = [
      mockJob('j1', 'inProgress', [{ inventory: 'inv1', quantity: 10 }]),
      mockJob('j2', 'pod', [{ inventory: 'inv1', quantity: 5 }]),
      mockJob('j3', 'delivered', [{ inventory: 'inv1', quantity: 3 }]), // delivered doesn't count
    ];
    const allocated = calculateAllocated('inv1', jobs);
    expect(allocated).toBe(15); // 10 + 5, delivered doesn't count
  });

  it('returns 0 when no jobs allocate the item', () => {
    const jobs: Job[] = [mockJob('j1', 'inProgress', [{ inventory: 'inv2', quantity: 10 }])];
    const allocated = calculateAllocated('inv1', jobs);
    expect(allocated).toBe(0);
  });

  it('handles empty jobs array', () => {
    expect(calculateAllocated('inv1', [])).toBe(0);
  });
});

describe('calculateAvailable', () => {
  it('calculates available as inStock - allocated', () => {
    const item = mockInventoryItem('inv1', 100);
    const allocated = 30;
    const available = calculateAvailable(item, allocated);
    expect(available).toBe(70);
  });

  it('never returns negative', () => {
    const item = mockInventoryItem('inv1', 10);
    const allocated = 30; // more than in stock
    const available = calculateAvailable(item, allocated);
    expect(available).toBe(0); // not -20
  });

  it('handles zero stock', () => {
    const item = mockInventoryItem('inv1', 0);
    const allocated = 0;
    const available = calculateAvailable(item, allocated);
    expect(available).toBe(0);
  });
});

describe('low stock detection', () => {
  it('available at or below reorderPoint indicates low stock', () => {
    const item = mockInventoryItem('inv1', 10);
    (item as { reorderPoint?: number }).reorderPoint = 10;
    const allocated = 0;
    const available = calculateAvailable(item, allocated);
    expect(available).toBe(10);
    const reorderPoint = (item as { reorderPoint?: number }).reorderPoint ?? 0;
    expect(reorderPoint > 0 && available <= reorderPoint).toBe(true);
  });
});

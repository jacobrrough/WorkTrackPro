import { describe, it, expect } from 'vitest';
import {
  calculateAllocated,
  calculateAvailable,
  isConsumedStatus,
  isProductionStatus,
  allowMaterialAllocation,
  isAllocationActiveStatus,
} from './inventoryCalculations';
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
  boardType: 'shopFloor' as const,
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

// ---- Status boundary tests (post-trigger architecture) ----

describe('isAllocationActiveStatus — status set boundaries', () => {
  it('includes onHold (paused job still holds stock)', () => {
    expect(isAllocationActiveStatus('onHold')).toBe(true);
  });

  it('excludes finished (consumed: trigger already decremented inStock)', () => {
    expect(isAllocationActiveStatus('finished')).toBe(false);
  });

  it('excludes delivered', () => {
    expect(isAllocationActiveStatus('delivered')).toBe(false);
  });

  it('excludes waitingForPayment (finance state, not production)', () => {
    expect(isAllocationActiveStatus('waitingForPayment')).toBe(false);
  });

  it('excludes projectCompleted (finance state, not production)', () => {
    expect(isAllocationActiveStatus('projectCompleted')).toBe(false);
  });

  it('excludes paid (finance state, not production)', () => {
    expect(isAllocationActiveStatus('paid')).toBe(false);
  });

  it('includes all production statuses', () => {
    for (const s of ['pod', 'rush', 'pending', 'inProgress', 'qualityControl']) {
      expect(isAllocationActiveStatus(s)).toBe(true);
    }
  });
});

describe('isConsumedStatus', () => {
  it('returns true for finished', () => expect(isConsumedStatus('finished')).toBe(true));
  it('returns true for delivered', () => expect(isConsumedStatus('delivered')).toBe(true));
  it('returns true for waitingForPayment', () =>
    expect(isConsumedStatus('waitingForPayment')).toBe(true));
  it('returns true for projectCompleted', () =>
    expect(isConsumedStatus('projectCompleted')).toBe(true));
  it('returns true for paid', () => expect(isConsumedStatus('paid')).toBe(true));
  it('returns false for inProgress', () => expect(isConsumedStatus('inProgress')).toBe(false));
  it('returns false for onHold', () => expect(isConsumedStatus('onHold')).toBe(false));
  it('returns false for pod', () => expect(isConsumedStatus('pod')).toBe(false));
});

describe('isProductionStatus', () => {
  it('returns true for qualityControl (restore is valid)', () =>
    expect(isProductionStatus('qualityControl')).toBe(true));
  it('returns false for onHold (finished->onHold is admin pause, not rework)', () =>
    expect(isProductionStatus('onHold')).toBe(false));
  it('returns false for finished', () => expect(isProductionStatus('finished')).toBe(false));
  it('returns false for delivered', () => expect(isProductionStatus('delivered')).toBe(false));
});

describe('allowMaterialAllocation', () => {
  it('allows production statuses', () => {
    for (const s of ['pod', 'rush', 'pending', 'inProgress', 'qualityControl']) {
      expect(allowMaterialAllocation(s)).toBe(true);
    }
  });

  it('does not allow onHold (keep onHold out of allocation write path)', () => {
    expect(allowMaterialAllocation('onHold')).toBe(false);
  });

  it('does not allow finished', () => expect(allowMaterialAllocation('finished')).toBe(false));
  it('does not allow delivered', () => expect(allowMaterialAllocation('delivered')).toBe(false));
  it('does not allow waitingForPayment', () =>
    expect(allowMaterialAllocation('waitingForPayment')).toBe(false));
  it('does not allow projectCompleted', () =>
    expect(allowMaterialAllocation('projectCompleted')).toBe(false));
  it('does not allow paid', () => expect(allowMaterialAllocation('paid')).toBe(false));
});

describe('calculateAllocated — finished excluded, onHold included', () => {
  it('does NOT count finished job materials as allocated', () => {
    const jobs: Job[] = [mockJob('j1', 'finished', [{ inventory: 'inv1', quantity: 10 }])];
    expect(calculateAllocated('inv1', jobs)).toBe(0);
  });

  it('DOES count onHold job materials as allocated', () => {
    const jobs: Job[] = [mockJob('j1', 'onHold', [{ inventory: 'inv1', quantity: 7 }])];
    expect(calculateAllocated('inv1', jobs)).toBe(7);
  });

  it('sums inProgress + onHold but not finished', () => {
    const jobs: Job[] = [
      mockJob('j1', 'inProgress', [{ inventory: 'inv1', quantity: 10 }]),
      mockJob('j2', 'onHold', [{ inventory: 'inv1', quantity: 5 }]),
      mockJob('j3', 'finished', [{ inventory: 'inv1', quantity: 3 }]),
    ];
    expect(calculateAllocated('inv1', jobs)).toBe(15); // 10 + 5; finished excluded
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

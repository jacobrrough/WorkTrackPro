import { describe, expect, it } from 'vitest';
import type { InventoryItem, Job } from '@/core/types';
import { buildReconciliationMutations } from './inventoryReconciliation';

const mockInventory = (id: string, inStock: number): InventoryItem => ({
  id,
  name: 'Test Material',
  category: 'material',
  inStock,
  available: inStock,
  disposed: 0,
  onOrder: 0,
  unit: 'units',
  hasImage: false,
});

const mockJob = (
  id: string,
  status: Job['status'],
  lines: Array<{ inventoryId: string; quantity: number }>
): Job => ({
  id,
  jobCode: 101,
  name: 'Test Job',
  active: true,
  status,
  attachments: [],
  attachmentCount: 0,
  comments: [],
  commentCount: 0,
  inventoryItems: lines.map((line, idx) => ({
    id: `ji-${idx}`,
    jobId: id,
    inventoryId: line.inventoryId,
    quantity: line.quantity,
    unit: 'units',
  })),
  assignedUsers: [],
  isRush: false,
  workers: [],
});

describe('buildReconciliationMutations', () => {
  it('is reversible for delivered -> not delivered transitions', () => {
    const inv = mockInventory('inv-1', 5);
    const job = mockJob('job-1', 'inProgress', [{ inventoryId: 'inv-1', quantity: 10 }]);

    const consume = buildReconciliationMutations({
      job,
      inventory: [inv],
      jobsAfterStatusUpdate: [{ ...job, status: 'delivered' }],
      direction: 'consume',
    });
    expect(consume[0]?.newInStock).toBe(-5);
    expect(consume[0]?.changeAmount).toBe(-10);

    const restore = buildReconciliationMutations({
      job,
      inventory: [{ ...inv, inStock: consume[0].newInStock }],
      jobsAfterStatusUpdate: [job],
      direction: 'restore',
    });
    expect(restore[0]?.newInStock).toBe(5);
    expect(restore[0]?.changeAmount).toBe(10);
  });
});

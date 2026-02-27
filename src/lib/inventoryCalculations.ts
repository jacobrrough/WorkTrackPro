/**
 * Inventory allocated/available calculations.
 * Single source of truth — use from AppContext or hooks instead of inlining.
 */
import type { Job, InventoryItem } from '@/core/types';

export const ACTIVE_ALLOCATION_STATUSES: Set<string> = new Set([
  'pod',
  'rush',
  'pending',
  'inProgress',
  'qualityControl',
  'finished',
]);

export function isAllocationActiveStatus(status: string): boolean {
  return ACTIVE_ALLOCATION_STATUSES.has(status);
}

export function buildAllocatedByInventoryId(jobs: Job[]): Map<string, number> {
  const allocatedByInventoryId = new Map<string, number>();

  for (const job of jobs) {
    if (!isAllocationActiveStatus(job.status)) continue;
    const jobInv = job.expand?.job_inventory_via_job ?? job.expand?.job_inventory ?? [];
    for (const ji of jobInv) {
      const invId =
        typeof ji.inventory === 'string' ? ji.inventory : (ji.inventory as { id?: string })?.id;
      if (!invId) continue;
      allocatedByInventoryId.set(
        invId,
        (allocatedByInventoryId.get(invId) ?? 0) + (ji.quantity ?? 0)
      );
    }
  }

  return allocatedByInventoryId;
}

/**
 * Sum of quantity allocated to active (non-delivered) jobs for the given inventory id.
 */
export function calculateAllocated(inventoryId: string, jobs: Job[]): number {
  return buildAllocatedByInventoryId(jobs).get(inventoryId) ?? 0;
}

/**
 * Available = inStock - allocated (never negative).
 */
export function calculateAvailable(item: InventoryItem, allocated: number): number {
  return Math.max(0, item.inStock - allocated);
}

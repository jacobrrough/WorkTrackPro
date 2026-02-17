/**
 * Inventory allocated/available calculations.
 * Single source of truth — use from AppContext or hooks instead of inlining.
 */
import type { Job, InventoryItem } from '@/core/types';

const ACTIVE_STATUSES: Set<string> = new Set([
  'pod',
  'rush',
  'pending',
  'inProgress',
  'qualityControl',
  'finished',
]);

/**
 * Sum of quantity allocated to active (non-delivered) jobs for the given inventory id.
 */
export function calculateAllocated(inventoryId: string, jobs: Job[]): number {
  let allocated = 0;
  for (const job of jobs) {
    if (!ACTIVE_STATUSES.has(job.status)) continue;
    const jobInv = job.expand?.job_inventory_via_job ?? job.expand?.job_inventory ?? [];
    for (const ji of jobInv) {
      const invId =
        typeof ji.inventory === 'string' ? ji.inventory : (ji.inventory as { id?: string })?.id;
      if (invId === inventoryId) {
        allocated += ji.quantity ?? 0;
      }
    }
  }
  return allocated;
}

/**
 * Available = inStock - allocated (never negative).
 */
export function calculateAvailable(item: InventoryItem, allocated: number): number {
  return Math.max(0, item.inStock - allocated);
}

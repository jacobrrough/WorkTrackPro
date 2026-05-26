/**
 * Inventory allocated/available calculations.
 * Single source of truth — use from AppContext or hooks instead of inlining.
 */
import type { Job, InventoryItem } from '@/core/types';

/**
 * Statuses where a job's materials count as "allocated" (reserved from available stock).
 * 'finished' excluded: once consumed the DB trigger decrements inStock, so the job no
 * longer double-counts in the allocated calculation.
 * 'onHold' included: a paused job still holds its reserved materials.
 */
export const ACTIVE_ALLOCATION_STATUSES: Set<string> = new Set([
  'pod',
  'rush',
  'pending',
  'inProgress',
  'qualityControl',
  'onHold',
]);

export function isAllocationActiveStatus(status: string): boolean {
  return ACTIVE_ALLOCATION_STATUSES.has(status);
}

/**
 * Statuses where inStock has been permanently decremented (materials physically consumed).
 * Includes all post-production finance states — stock was deducted at 'finished' and
 * these states follow it, so they must also be treated as consumed to correctly trigger
 * stock restoration on rework (is_consumed_status(OLD) AND is_production_status(NEW)).
 */
export const CONSUMED_STATUSES: Set<string> = new Set([
  'finished',
  'delivered',
  'waitingForPayment',
  'projectCompleted',
  'paid',
]);

export function isConsumedStatus(status: string): boolean {
  return CONSUMED_STATUSES.has(status);
}

/**
 * Statuses where a restore (rework) is valid when leaving a consumed state.
 * 'onHold' excluded: finished→onHold is an admin pause, not a material return.
 */
export const PRODUCTION_STATUSES: Set<string> = new Set([
  'pod',
  'rush',
  'pending',
  'inProgress',
  'qualityControl',
]);

export function isProductionStatus(status: string): boolean {
  return PRODUCTION_STATUSES.has(status);
}

/**
 * Statuses that allow writing job_inventory (allocate/edit materials).
 * All active production statuses — rush jobs and mid-build adjustments are legitimate.
 * Finance/post-production states excluded: materials already consumed by that point.
 */
export const ALLOW_MATERIAL_ALLOCATION_STATUSES: Set<string> = new Set([
  'pod',
  'rush',
  'pending',
  'inProgress',
  'qualityControl',
]);

export function allowMaterialAllocation(status: string): boolean {
  return ALLOW_MATERIAL_ALLOCATION_STATUSES.has(status);
}

export function buildAllocatedByInventoryId(jobs: Job[]): Map<string, number> {
  const allocatedByInventoryId = new Map<string, number>();

  for (const job of jobs) {
    if (!isAllocationActiveStatus(job.status)) continue;
    const jobInv = job.expand?.job_inventory_via_job ?? job.expand?.job_inventory ?? [];
    for (const ji of jobInv) {
      const invId =
        typeof ji.inventory === 'string'
          ? ji.inventory
          : ((ji as { inventory_id?: string }).inventory_id ??
            (ji.inventory as unknown as { id?: string })?.id);
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

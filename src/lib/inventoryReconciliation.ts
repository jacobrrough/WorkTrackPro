import type { InventoryItem, Job } from '@/core/types';
import { buildAllocatedByInventoryId, calculateAvailable } from './inventoryCalculations';

interface ReconciliationMutation {
  inventoryId: string;
  previousInStock: number;
  newInStock: number;
  previousAvailable: number;
  newAvailable: number;
  changeAmount: number;
}

function getJobInventoryTotals(job: Job): Map<string, number> {
  const totals = new Map<string, number>();
  const inventoryLines = job.expand?.job_inventory ?? job.inventoryItems ?? [];

  for (const line of inventoryLines) {
    const inventoryId = line.inventoryId ?? line.inventory;
    if (!inventoryId) continue;
    totals.set(inventoryId, (totals.get(inventoryId) ?? 0) + (line.quantity ?? 0));
  }

  return totals;
}

export function buildReconciliationMutations(args: {
  job: Job;
  inventory: InventoryItem[];
  jobsAfterStatusUpdate: Job[];
  direction: 'consume' | 'restore';
}): ReconciliationMutation[] {
  const { job, inventory, jobsAfterStatusUpdate, direction } = args;
  const sign = direction === 'consume' ? -1 : 1;
  const totals = getJobInventoryTotals(job);
  const allocatedAfterUpdate = buildAllocatedByInventoryId(jobsAfterStatusUpdate);
  const byId = new Map(inventory.map((item) => [item.id, item] as const));

  const updates: ReconciliationMutation[] = [];
  for (const [inventoryId, qty] of totals.entries()) {
    if (qty <= 0) continue;
    const item = byId.get(inventoryId);
    if (!item) continue;

    const previousInStock = item.inStock;
    // Preserve reversible delivered <-> non-delivered transitions.
    // We intentionally allow temporary negative inStock so a restore can return to the exact prior value.
    const newInStock = previousInStock + sign * qty;
    const previousAvailable = calculateAvailable(item, allocatedAfterUpdate.get(inventoryId) ?? 0);
    const nextAvailable = calculateAvailable(
      { ...item, inStock: newInStock },
      allocatedAfterUpdate.get(inventoryId) ?? 0
    );

    updates.push({
      inventoryId,
      previousInStock,
      newInStock,
      previousAvailable,
      newAvailable: nextAvailable,
      changeAmount: sign * qty,
    });
  }

  return updates;
}

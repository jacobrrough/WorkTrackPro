import type { InventoryItem, Job } from '@/core/types';
import { buildAllocatedByInventoryId, calculateAvailable } from '@/lib/inventoryCalculations';

export type InventoryWithComputed = InventoryItem & { allocated: number };

export function withComputedInventory(
  inventory: InventoryItem[],
  jobs: Job[]
): InventoryWithComputed[] {
  const allocatedByInventoryId = buildAllocatedByInventoryId(jobs);
  return inventory.map((item) => {
    const allocated = allocatedByInventoryId.get(item.id) ?? 0;
    return {
      ...item,
      allocated,
      available: calculateAvailable(item, allocated),
    };
  });
}

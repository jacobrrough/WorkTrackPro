import { useCallback } from 'react';
import type { InventoryItem, Job } from '@/core/types';
import {
  calculateAllocated as calcAllocated,
  calculateAvailable as calcAvailable,
} from '@/lib/inventoryCalculations';

/**
 * Thin wrappers around inventory allocation math; depends on current jobs list.
 */
export function useInventoryAllocation(jobs: Job[]) {
  const calculateAllocated = useCallback(
    (inventoryId: string): number => calcAllocated(inventoryId, jobs),
    [jobs]
  );

  const calculateAvailable = useCallback(
    (item: InventoryItem): number => calcAvailable(item, calcAllocated(item.id, jobs)),
    [jobs]
  );

  return { calculateAvailable, calculateAllocated };
}

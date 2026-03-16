import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { InventoryItem, Job, User } from '@/core/types';
import { inventoryService } from '@/services/api/inventory';
import { inventoryHistoryService } from '@/services/api/inventoryHistory';
import { jobService } from '@/services/api/jobs';
import { partsService } from '@/services/api/parts';

export interface UseInventoryMutationsParams {
  inventory: InventoryItem[];
  jobs: Job[];
  currentUser: User | null;
  refreshJobs: () => Promise<void>;
  refreshInventory: () => Promise<void>;
  calculateAvailable: (item: InventoryItem) => number;
  calculateAllocated: (inventoryId: string) => number;
  showToast: (message: string, type?: 'info' | 'success' | 'error') => void;
}

export function useInventoryMutations({
  inventory,
  jobs,
  currentUser,
  refreshJobs,
  refreshInventory,
  calculateAvailable,
  calculateAllocated,
  showToast,
}: UseInventoryMutationsParams) {
  const queryClient = useQueryClient();

  const createInventory = useCallback(
    async (data: Partial<InventoryItem>): Promise<InventoryItem | null> => {
      try {
        const inStock = data.inStock ?? 0;
        const item = await inventoryService.createInventory({
          ...data,
          inStock,
          available: inStock,
          onOrder: data.onOrder ?? 0,
        });
        if (item) {
          queryClient.setQueryData<InventoryItem[]>(['inventory'], (prev) =>
            prev ? [item, ...prev] : [item]
          );
        }
        return item;
      } catch (error) {
        console.error('Create inventory error:', error);
        return null;
      }
    },
    [queryClient]
  );

  const updateInventoryItem = useCallback(
    async (id: string, data: Partial<InventoryItem>): Promise<InventoryItem | null> => {
      try {
        const updatedItem = await inventoryService.updateInventory(id, data);
        if (updatedItem) {
          queryClient.setQueryData<InventoryItem[]>(['inventory'], (prev) =>
            prev ? prev.map((i) => (i.id === id ? updatedItem : i)) : []
          );
          if ('price' in data) {
            try {
              await partsService.clearVariantPricesForInventory(id);
            } catch (cascadeErr) {
              console.warn('Clear variant prices after inventory price update:', cascadeErr);
            }
          }
        }
        return updatedItem;
      } catch (error) {
        console.error('Update inventory error:', error);
        return null;
      }
    },
    [queryClient]
  );

  const updateInventoryStock = useCallback(
    async (id: string, inStock: number, reason?: string): Promise<void> => {
      try {
        const currentItem = inventory.find((i) => i.id === id);
        if (!currentItem) {
          console.error('Inventory item not found');
          return;
        }
        const previousInStock = currentItem.inStock;
        const previousAvailable = calculateAvailable(currentItem);
        const changeAmount = inStock - previousInStock;

        queryClient.setQueryData<InventoryItem[]>(['inventory'], (prev) =>
          prev ? prev.map((i) => (i.id === id ? { ...i, inStock } : i)) : []
        );

        await inventoryService.updateStock(id, inStock);

        if (currentUser && changeAmount !== 0) {
          await inventoryHistoryService.createHistory({
            inventory: id,
            user: currentUser.id,
            action: 'manual_adjust',
            reason: reason || 'Stock adjusted manually',
            previousInStock,
            newInStock: inStock,
            previousAvailable,
            newAvailable: Math.max(0, inStock - calculateAllocated(id)),
            changeAmount,
          });
        }

        await refreshInventory();
      } catch (error) {
        console.error('Update inventory stock error:', error);
        await refreshInventory();
      }
    },
    [inventory, currentUser, calculateAvailable, calculateAllocated, queryClient, refreshInventory]
  );

  const addJobInventory = useCallback(
    async (jobId: string, inventoryId: string, quantity: number, unit: string): Promise<void> => {
      try {
        const item = inventory.find((i) => i.id === inventoryId);
        if (item) {
          const available = calculateAvailable(item);
          if (quantity > available) return;
        }
        await jobService.addJobInventory(jobId, inventoryId, quantity, unit);
        await refreshJobs();
        await refreshInventory();
      } catch (error) {
        console.error('Add job inventory error:', error);
      }
    },
    [inventory, calculateAvailable, refreshJobs, refreshInventory]
  );

  const allocateInventoryToJob = useCallback(
    async (
      jobId: string,
      inventoryId: string,
      quantity: number,
      notes?: string
    ): Promise<boolean> => {
      try {
        const item = inventory.find((inv) => inv.id === inventoryId);
        const job = jobs.find((j) => j.id === jobId);
        if (!item || !job || quantity <= 0) return false;

        const previousAvailable = calculateAvailable(item);
        if (quantity > previousAvailable) return false;

        await jobService.addJobInventory(jobId, inventoryId, quantity, item.unit || 'units');

        if (currentUser) {
          const currentAllocated = calculateAllocated(inventoryId);
          const nextAllocated = currentAllocated + quantity;
          const newAvailable = Math.max(0, item.inStock - nextAllocated);
          await inventoryHistoryService.createHistory({
            inventory: inventoryId,
            user: currentUser.id,
            action: 'allocated_to_job',
            reason: notes?.trim() || `Allocated ${quantity} ${item.unit} to Job #${job.jobCode}`,
            previousInStock: item.inStock,
            newInStock: item.inStock,
            previousAvailable,
            newAvailable,
            changeAmount: 0,
            relatedJob: jobId,
            relatedPO: job.po,
          });
        }

        await refreshJobs();
        await refreshInventory();
        return true;
      } catch (error: unknown) {
        const err = error as { message?: string; code?: string };
        const msg = err?.message ?? '';
        if (
          msg.includes('insufficient_stock') ||
          err?.code === 'check_violation' ||
          msg.includes('cannot allocate')
        ) {
          showToast(
            'Someone else allocated this stock first. Stock was updated — please refresh and try again.',
            'error'
          );
        } else {
          console.error('Allocate inventory to job error:', error);
          showToast('Failed to allocate. Please try again.', 'error');
        }
        return false;
      }
    },
    [
      inventory,
      jobs,
      currentUser,
      calculateAvailable,
      calculateAllocated,
      refreshJobs,
      refreshInventory,
      showToast,
    ]
  );

  const removeJobInventory = useCallback(
    async (jobId: string, jobInventoryId: string): Promise<void> => {
      try {
        await jobService.removeJobInventory(jobId, jobInventoryId);
        await refreshJobs();
        await refreshInventory();
      } catch (error) {
        console.error('Remove job inventory error:', error);
      }
    },
    [refreshJobs, refreshInventory]
  );

  const markInventoryOrdered = useCallback(
    async (id: string, quantity: number): Promise<boolean> => {
      try {
        const item = inventory.find((i) => i.id === id);
        if (!item) {
          console.error('Inventory item not found');
          return false;
        }
        const newOnOrder = (item.onOrder || 0) + quantity;
        await inventoryService.updateInventory(id, { onOrder: newOnOrder });
        if (currentUser) {
          await inventoryHistoryService.createHistory({
            inventory: id,
            user: currentUser.id,
            action: 'order_placed',
            reason: `Ordered ${quantity} ${item.unit}`,
            previousInStock: item.inStock,
            newInStock: item.inStock,
            previousAvailable: calculateAvailable(item),
            newAvailable: calculateAvailable(item),
            changeAmount: 0,
          });
        }
        await refreshInventory();
        return true;
      } catch (error) {
        console.error('Mark inventory ordered error:', error);
        await refreshInventory();
        return false;
      }
    },
    [inventory, currentUser, refreshInventory, calculateAvailable]
  );

  const receiveInventoryOrder = useCallback(
    async (id: string, receivedQuantity: number): Promise<boolean> => {
      try {
        const item = inventory.find((i) => i.id === id);
        if (!item) {
          console.error('Inventory item not found');
          return false;
        }
        const previousAvailable = calculateAvailable(item);
        const newInStock = item.inStock + receivedQuantity;
        const newOnOrder = Math.max(0, (item.onOrder || 0) - receivedQuantity);
        await inventoryService.updateInventory(id, { inStock: newInStock, onOrder: newOnOrder });
        if (currentUser) {
          await inventoryHistoryService.createHistory({
            inventory: id,
            user: currentUser.id,
            action: 'order_received',
            reason: `Received ${receivedQuantity} ${item.unit}`,
            previousInStock: item.inStock,
            newInStock: newInStock,
            previousAvailable: previousAvailable,
            newAvailable: Math.max(0, newInStock - calculateAllocated(id)),
            changeAmount: receivedQuantity,
          });
        }
        await refreshInventory();
        return true;
      } catch (error) {
        console.error('Receive inventory order error:', error);
        await refreshInventory();
        return false;
      }
    },
    [inventory, currentUser, refreshInventory, calculateAvailable, calculateAllocated]
  );

  return {
    createInventory,
    updateInventoryItem,
    updateInventoryStock,
    addJobInventory,
    allocateInventoryToJob,
    removeJobInventory,
    markInventoryOrdered,
    receiveInventoryOrder,
  };
}

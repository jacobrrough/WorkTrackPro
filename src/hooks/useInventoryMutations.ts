import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { InventoryHistoryAction, InventoryItem, Job, User } from '@/core/types';
import { inventoryService, type DeleteInventoryResult } from '@/services/api/inventory';
import { inventoryHistoryService } from '@/services/api/inventoryHistory';
import { jobService } from '@/services/api/jobs';
import { partsService } from '@/services/api/parts';
import { isConsumedStatus } from '@/lib/inventoryCalculations';
import { isAuthError } from '@/lib/authErrors';
import { enqueueAction } from '@/lib/offlineActionQueue';
import { isOffline, OFFLINE_WRITE_TIMEOUT_MS } from '@/lib/networkStatus';
import { withTimeout } from '@/lib/withTimeout';

export interface UseInventoryMutationsParams {
  inventory: InventoryItem[];
  jobs: Job[];
  currentUser: User | null;
  refreshJobs: () => Promise<void>;
  refreshInventory: () => Promise<void>;
  calculateAvailable: (item: InventoryItem) => number;
  calculateAllocated: (inventoryId: string) => number;
  showToast: (
    message: string,
    type: 'info' | 'success' | 'error' | 'warning',
    duration?: number
  ) => void;
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

  // Absolute-set path: used ONLY by the InventoryDetail edit form for a manual stock-count
  // override (the user declares the authoritative count). All adjust-by-amount flows
  // (quick +/-, order, receive) go through applyStockDelta instead, which is lost-update-safe.
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

  // Shared pipeline for the three atomic delta-based stock writes (manual adjust, order
  // placement, receive). Applies in_stock/on_order deltas via the lost-update-safe
  // adjust_inventory_stock RPC, then records an inventory_history row derived ENTIRELY from
  // the authoritative post-RPC values — so previousInStock/newInStock and their available
  // counterparts always share one baseline and can't contradict each other under a
  // concurrent write. Returns the post-RPC row, or null on failure (after toast + refetch).
  const applyStockDelta = useCallback(
    async (
      id: string,
      inStockDelta: number,
      onOrderDelta: number,
      history: { action: InventoryHistoryAction; reason: string },
      opts: { optimistic?: boolean; failToast: string }
    ): Promise<{ inStock: number; onOrder: number } | null> => {
      // Snapshot so an optimistic cache write can be rolled back if the RPC fails, rather
      // than leaving a phantom value on screen until refetch (and surviving a failed refetch).
      const snapshot = opts.optimistic
        ? queryClient.getQueryData<InventoryItem[]>(['inventory'])
        : undefined;

      // Stable id for the idempotent RPC. Reused by an offline-queue replay so a lost ACK
      // (write landed server-side but never answered) is deduped instead of double-applied.
      const clientActionId = crypto.randomUUID();

      // Queue the delta for replay and KEEP the optimistic value (rendered as pending)
      // rather than rolling back. Returns the projected post-state so callers treat the
      // action as accepted. Only possible with an attributable user.
      const queueOffline = (): { inStock: number; onOrder: number } | null => {
        if (!currentUser) {
          if (snapshot) queryClient.setQueryData(['inventory'], snapshot);
          showToast(opts.failToast, 'error');
          return null;
        }
        enqueueAction({
          type: 'inventory_delta',
          entityId: id,
          userId: currentUser.id,
          createdAt: new Date().toISOString(),
          inStockDelta,
          onOrderDelta,
          clientActionId,
          history: { action: history.action, reason: history.reason },
        });
        const current = (queryClient.getQueryData<InventoryItem[]>(['inventory']) ?? []).find(
          (i) => i.id === id
        );
        return { inStock: current?.inStock ?? inStockDelta, onOrder: current?.onOrder ?? 0 };
      };

      try {
        if (opts.optimistic && inStockDelta !== 0) {
          queryClient.setQueryData<InventoryItem[]>(['inventory'], (prev) =>
            prev
              ? prev.map((i) => (i.id === id ? { ...i, inStock: i.inStock + inStockDelta } : i))
              : []
          );
        }

        const result = await withTimeout(
          inventoryService.adjustStockIdempotent(id, inStockDelta, onOrderDelta, clientActionId),
          OFFLINE_WRITE_TIMEOUT_MS
        );
        if (!result) {
          // Genuine offline → queue + keep optimistic. Online business failure → revert.
          if (isOffline()) return queueOffline();
          if (snapshot) queryClient.setQueryData(['inventory'], snapshot);
          showToast(opts.failToast, 'error');
          await refreshInventory();
          return null;
        }

        // applied === false means the delta was already recorded (a deduped replay or
        // re-fire); skip the audit row so we don't log the same change twice.
        if (currentUser && result.applied) {
          const allocated = calculateAllocated(id);
          const prevInStock = result.inStock - inStockDelta; // authoritative previous
          await inventoryHistoryService.createHistory({
            inventory: id,
            user: currentUser.id,
            action: history.action,
            reason: history.reason,
            previousInStock: prevInStock,
            newInStock: result.inStock,
            previousAvailable: Math.max(0, prevInStock - allocated),
            newAvailable: Math.max(0, result.inStock - allocated),
            changeAmount: inStockDelta,
          });
        }

        await refreshInventory();
        return { inStock: result.inStock, onOrder: result.onOrder };
      } catch (error) {
        // Auth expiry is not a connectivity problem — revert and surface it.
        if (isAuthError(error)) {
          if (snapshot) queryClient.setQueryData(['inventory'], snapshot);
          showToast(opts.failToast, 'error');
          await refreshInventory();
          return null;
        }
        // Lie-fi timeout / network throw → queue + keep optimistic.
        console.error(`${history.action} stock error:`, error);
        return queueOffline();
      }
    },
    [currentUser, calculateAllocated, queryClient, refreshInventory, showToast]
  );

  const addJobInventory = useCallback(
    async (jobId: string, inventoryId: string, quantity: number, unit: string): Promise<void> => {
      try {
        const item = inventory.find((i) => i.id === inventoryId);
        if (item) {
          const available = calculateAvailable(item);
          if (quantity > available) {
            showToast('Not enough available stock to allocate.', 'warning');
            return;
          }
        }
        await jobService.addJobInventory(jobId, inventoryId, quantity, unit);
        await refreshJobs();
        await refreshInventory();
      } catch (error) {
        const msg = (error as Error)?.message ?? '';
        if (msg.includes('job_is_consumed')) {
          showToast('This job is already finished — materials cannot be added.', 'warning');
        } else {
          console.error('Add job inventory error:', error);
          showToast('Failed to add material. Please try again.', 'error');
        }
      }
    },
    [inventory, calculateAvailable, refreshJobs, refreshInventory, showToast]
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

        if (isConsumedStatus(job.status)) {
          showToast(
            'Cannot allocate materials to a job that is already finished or in payment.',
            'error'
          );
          return false;
        }

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
        if (msg.includes('job_is_consumed')) {
          // Cache was stale — job finished by the time the allocation reached the server.
          showToast('This job is already finished — materials cannot be added.', 'warning');
        } else if (
          msg.includes('insufficient_stock') ||
          err?.code === '23514' ||
          msg.includes('cannot allocate')
        ) {
          // Check violation from insufficient_stock (not consumed guard — that matches above).
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
        const msg = (error as Error)?.message ?? '';
        if (msg.includes('job_is_consumed')) {
          showToast('This job is already finished — materials cannot be removed.', 'warning');
        } else {
          console.error('Remove job inventory error:', error);
          showToast('Failed to remove material. Please try again.', 'error');
        }
      }
    },
    [refreshJobs, refreshInventory, showToast]
  );

  const markInventoryOrdered = useCallback(
    async (id: string, quantity: number): Promise<boolean> => {
      // Reject non-finite / non-positive quantities before they reach the RPC (NaN would
      // serialize to a null delta arg and corrupt on_order).
      if (!Number.isFinite(quantity) || quantity <= 0) return false;
      const item = inventory.find((i) => i.id === id);
      if (!item) {
        console.error('Inventory item not found');
        return false;
      }
      // Order placement bumps on_order only (in_stock delta 0).
      const result = await applyStockDelta(
        id,
        0,
        quantity,
        { action: 'order_placed', reason: `Ordered ${quantity} ${item.unit}` },
        { failToast: 'Failed to update order' }
      );
      return result !== null;
    },
    [inventory, applyStockDelta]
  );

  const receiveInventoryOrder = useCallback(
    async (id: string, receivedQuantity: number): Promise<boolean> => {
      // Reject non-finite / non-positive quantities before they reach the RPC.
      if (!Number.isFinite(receivedQuantity) || receivedQuantity <= 0) return false;
      const item = inventory.find((i) => i.id === id);
      if (!item) {
        console.error('Inventory item not found');
        return false;
      }
      // Receiving bumps in_stock and draws down on_order.
      const result = await applyStockDelta(
        id,
        receivedQuantity,
        -receivedQuantity,
        { action: 'order_received', reason: `Received ${receivedQuantity} ${item.unit}` },
        { failToast: 'Failed to receive order' }
      );
      return result !== null;
    },
    [inventory, applyStockDelta]
  );

  const setInventoryImage = useCallback(
    async (id: string, file: File): Promise<InventoryItem | null> => {
      try {
        const updatedItem = await inventoryService.setImage(id, file);
        if (updatedItem) {
          queryClient.setQueryData<InventoryItem[]>(['inventory'], (prev) =>
            prev ? prev.map((i) => (i.id === id ? updatedItem : i)) : []
          );
        }
        return updatedItem;
      } catch (error) {
        console.error('Set inventory image error:', error);
        return null;
      }
    },
    [queryClient]
  );

  const clearInventoryImage = useCallback(
    async (id: string): Promise<InventoryItem | null> => {
      try {
        const updatedItem = await inventoryService.clearImage(id);
        if (updatedItem) {
          queryClient.setQueryData<InventoryItem[]>(['inventory'], (prev) =>
            prev ? prev.map((i) => (i.id === id ? updatedItem : i)) : []
          );
        }
        return updatedItem;
      } catch (error) {
        console.error('Clear inventory image error:', error);
        return null;
      }
    },
    [queryClient]
  );

  // Permanent delete. The server refuses (without deleting) when the item is referenced by a job
  // or part, so we only drop it from the cache when the RPC reports ok. The caller surfaces the
  // reason (in_use / forbidden / error) to the user.
  const deleteInventoryItem = useCallback(
    async (id: string): Promise<DeleteInventoryResult> => {
      try {
        const result = await inventoryService.deleteInventory(id);
        if (result.ok) {
          queryClient.setQueryData<InventoryItem[]>(['inventory'], (prev) =>
            prev ? prev.filter((i) => i.id !== id) : []
          );
        }
        return result;
      } catch (error) {
        console.error('Delete inventory error:', error);
        return { ok: false, reason: 'error' };
      }
    },
    [queryClient]
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
    setInventoryImage,
    clearInventoryImage,
    deleteInventoryItem,
  };
}

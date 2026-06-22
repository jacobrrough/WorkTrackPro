import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Delivery, DeliveryLineItem, User } from '@/core/types';
import { deliveryService } from '@/services/api/deliveries';
import { enqueueAction } from '@/lib/offlineActionQueue';
import { isOffline, OFFLINE_WRITE_TIMEOUT_MS } from '@/lib/networkStatus';
import { withTimeout } from '@/lib/withTimeout';
import { isAuthError } from '@/lib/authErrors';

export interface UseDeliveryMutationsParams {
  currentUser: User | null;
  showToast: (
    message: string,
    type: 'info' | 'success' | 'error' | 'warning',
    duration?: number
  ) => void;
}

export function useDeliveryMutations({ currentUser, showToast }: UseDeliveryMutationsParams) {
  const queryClient = useQueryClient();

  const createDelivery = useCallback(
    async (data: {
      jobId: string;
      deliveredAt: string;
      carrier?: string;
      trackingNumber?: string;
      recipientName?: string;
      notes?: string;
      lineItems: DeliveryLineItem[];
    }) => {
      // Stable client PK so an offline-queued create replays idempotently and the
      // optimistic list entry shares the eventual server id.
      const id = crypto.randomUUID();
      // Queue + optimistic pending entry (deliveryNumber unknown until sync). Used for both
      // genuine-offline and lie-fi-timeout paths.
      const queueCreate = (): Delivery | null => {
        if (!currentUser) return null;
        enqueueAction({
          type: 'delivery_create',
          entityId: id,
          userId: currentUser.id,
          createdAt: new Date().toISOString(),
          jobId: data.jobId,
          data: {
            deliveredAt: data.deliveredAt,
            carrier: data.carrier,
            trackingNumber: data.trackingNumber,
            recipientName: data.recipientName,
            notes: data.notes,
            lineItems: data.lineItems,
          },
        });
        const optimistic = {
          id,
          jobId: data.jobId,
          deliveryNumber: 0,
          deliveredAt: data.deliveredAt,
          carrier: data.carrier,
          trackingNumber: data.trackingNumber,
          recipientName: data.recipientName,
          notes: data.notes,
          lineItems: data.lineItems,
          createdBy: currentUser.id,
        } as unknown as Delivery;
        queryClient.setQueryData<Delivery[]>(['deliveries', data.jobId], (prev) =>
          prev ? [...prev, optimistic] : [optimistic]
        );
        showToast('Delivery saved offline — will sync when reconnected', 'info');
        return optimistic;
      };
      try {
        const delivery = await withTimeout(
          deliveryService.create({ id, ...data, createdBy: currentUser?.id }),
          OFFLINE_WRITE_TIMEOUT_MS
        );
        if (delivery) {
          queryClient.setQueryData<Delivery[]>(['deliveries', data.jobId], (prev) =>
            prev ? [...prev, delivery] : [delivery]
          );
          showToast(`Delivery #${delivery.deliveryNumber} recorded`, 'success');
          return delivery;
        }
        if (isOffline() && currentUser) return queueCreate();
        showToast('Failed to record delivery', 'error');
        return null;
      } catch (error) {
        // Lie-fi timeout / network throw → queue + keep optimistic (unless auth expired).
        if (!isAuthError(error) && currentUser) return queueCreate();
        showToast('Failed to record delivery', 'error');
        return null;
      }
    },
    [queryClient, currentUser, showToast]
  );

  const updateDelivery = useCallback(
    async (
      jobId: string,
      id: string,
      data: Partial<{
        deliveredAt: string;
        carrier: string | null;
        trackingNumber: string | null;
        recipientName: string | null;
        notes: string | null;
        lineItems: DeliveryLineItem[];
      }>
    ) => {
      const queueUpdate = (): null => {
        if (!currentUser) return null;
        enqueueAction({
          type: 'delivery_update',
          entityId: id,
          userId: currentUser.id,
          createdAt: new Date().toISOString(),
          jobId,
          data,
        });
        // Optimistically patch the cached delivery so the edit isn't dropped.
        queryClient.setQueryData<Delivery[]>(['deliveries', jobId], (prev) =>
          prev ? prev.map((d) => (d.id === id ? ({ ...d, ...data } as Delivery) : d)) : prev
        );
        showToast('Delivery edit saved offline — will sync when reconnected', 'info');
        return null;
      };
      try {
        const delivery = await withTimeout(
          deliveryService.update(id, data),
          OFFLINE_WRITE_TIMEOUT_MS
        );
        if (delivery) {
          queryClient.invalidateQueries({ queryKey: ['deliveries', jobId] });
          showToast('Delivery updated', 'success');
          return delivery;
        }
        if (isOffline() && currentUser) return queueUpdate();
        showToast('Failed to update delivery', 'error');
        return delivery;
      } catch (error) {
        if (!isAuthError(error) && currentUser) return queueUpdate();
        showToast('Failed to update delivery', 'error');
        return null;
      }
    },
    [queryClient, currentUser, showToast]
  );

  const deleteDelivery = useCallback(
    async (jobId: string, id: string) => {
      const queueDelete = (): boolean => {
        if (!currentUser) return false;
        enqueueAction({
          type: 'delivery_delete',
          entityId: id,
          userId: currentUser.id,
          createdAt: new Date().toISOString(),
          jobId,
        });
        queryClient.setQueryData<Delivery[]>(['deliveries', jobId], (prev) =>
          prev ? prev.filter((d) => d.id !== id) : []
        );
        showToast('Delivery deletion saved offline — will sync when reconnected', 'info');
        return true;
      };
      try {
        const ok = await withTimeout(deliveryService.delete(id), OFFLINE_WRITE_TIMEOUT_MS);
        if (ok) {
          queryClient.setQueryData<Delivery[]>(['deliveries', jobId], (prev) =>
            prev ? prev.filter((d) => d.id !== id) : []
          );
          showToast('Delivery deleted', 'success');
          return true;
        }
        if (isOffline() && currentUser) return queueDelete();
        showToast('Failed to delete delivery', 'error');
        return ok;
      } catch (error) {
        if (!isAuthError(error) && currentUser) return queueDelete();
        showToast('Failed to delete delivery', 'error');
        return false;
      }
    },
    [queryClient, currentUser, showToast]
  );

  return { createDelivery, updateDelivery, deleteDelivery };
}

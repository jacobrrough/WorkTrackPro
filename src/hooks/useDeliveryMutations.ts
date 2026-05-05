import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Delivery, DeliveryLineItem, User } from '@/core/types';
import { deliveryService } from '@/services/api/deliveries';

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
      const delivery = await deliveryService.create({
        ...data,
        createdBy: currentUser?.id,
      });
      if (delivery) {
        queryClient.setQueryData<Delivery[]>(['deliveries', data.jobId], (prev) =>
          prev ? [...prev, delivery] : [delivery]
        );
        showToast(`Delivery #${delivery.deliveryNumber} recorded`, 'success');
      } else {
        showToast('Failed to record delivery', 'error');
      }
      return delivery;
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
      const delivery = await deliveryService.update(id, data);
      if (delivery) {
        queryClient.invalidateQueries({ queryKey: ['deliveries', jobId] });
        showToast('Delivery updated', 'success');
      } else {
        showToast('Failed to update delivery', 'error');
      }
      return delivery;
    },
    [queryClient, showToast]
  );

  const deleteDelivery = useCallback(
    async (jobId: string, id: string) => {
      const ok = await deliveryService.delete(id);
      if (ok) {
        queryClient.setQueryData<Delivery[]>(['deliveries', jobId], (prev) =>
          prev ? prev.filter((d) => d.id !== id) : []
        );
        showToast('Delivery deleted', 'success');
      } else {
        showToast('Failed to delete delivery', 'error');
      }
      return ok;
    },
    [queryClient, showToast]
  );

  return { createDelivery, updateDelivery, deleteDelivery };
}

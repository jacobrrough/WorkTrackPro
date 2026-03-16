import { useCallback } from 'react';
import { jobService } from '@/services/api/jobs';
import { inventoryService } from '@/services/api/inventory';

export interface UseAttachmentMutationsParams {
  refreshJobs: () => Promise<void>;
  refreshInventory: () => Promise<void>;
}

export function useAttachmentMutations({
  refreshJobs,
  refreshInventory,
}: UseAttachmentMutationsParams) {
  const addAttachment = useCallback(
    async (jobId: string, file: File, isAdminOnly = false): Promise<boolean> => {
      try {
        const success = await jobService.addAttachment(jobId, file, isAdminOnly);
        if (success) await refreshJobs();
        return success;
      } catch (error) {
        console.error('Add attachment error:', error);
        return false;
      }
    },
    [refreshJobs]
  );

  const deleteAttachment = useCallback(
    async (attachmentId: string): Promise<boolean> => {
      try {
        const success = await jobService.deleteAttachment(attachmentId);
        if (success) await refreshJobs();
        return success;
      } catch (error) {
        console.error('Delete attachment error:', error);
        return false;
      }
    },
    [refreshJobs]
  );

  const updateAttachmentAdminOnly = useCallback(
    async (attachmentId: string, isAdminOnly: boolean): Promise<boolean> => {
      try {
        const success = await jobService.updateAttachmentAdminOnly(attachmentId, isAdminOnly);
        if (success) await refreshJobs();
        return success;
      } catch (error) {
        console.error('Update attachment admin-only error:', error);
        return false;
      }
    },
    [refreshJobs]
  );

  const addInventoryAttachment = useCallback(
    async (inventoryId: string, file: File, isAdminOnly = false): Promise<boolean> => {
      try {
        const success = await inventoryService.addAttachment(inventoryId, file, isAdminOnly);
        if (success) await refreshInventory();
        return success;
      } catch (error) {
        console.error('Add inventory attachment error:', error);
        return false;
      }
    },
    [refreshInventory]
  );

  const deleteInventoryAttachment = useCallback(
    async (attachmentId: string, inventoryId: string): Promise<boolean> => {
      try {
        const success = await inventoryService.deleteAttachment(attachmentId, inventoryId);
        if (success) await refreshInventory();
        return success;
      } catch (error) {
        console.error('Delete inventory attachment error:', error);
        return false;
      }
    },
    [refreshInventory]
  );

  return {
    addAttachment,
    deleteAttachment,
    updateAttachmentAdminOnly,
    addInventoryAttachment,
    deleteInventoryAttachment,
  };
}

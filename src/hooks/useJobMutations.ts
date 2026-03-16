import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Comment, Job, JobStatus, User, InventoryItem } from '@/core/types';
import { buildJobNameFromConvention } from '@/lib/formatJob';
import { getNextWorkflowStatus, isAutoFlowStatus } from '@/lib/jobWorkflow';
import { buildReconciliationMutations } from '@/lib/inventoryReconciliation';
import { dedupeJobsById } from '@/lib/jobUtils';
import { jobService } from '@/services/api/jobs';
import { checklistService } from '@/services/api/checklists';
import { inventoryService } from '@/services/api/inventory';
import { inventoryHistoryService } from '@/services/api/inventoryHistory';

export interface UseJobMutationsParams {
  jobs: Job[];
  inventory: InventoryItem[];
  currentUser: User | null;
  refreshJobs: () => Promise<void>;
  refreshInventory: () => Promise<void>;
  refreshShifts: () => Promise<void>;
  showToast: (message: string, type?: 'info' | 'success' | 'error') => void;
}

export function useJobMutations({
  jobs,
  inventory,
  currentUser,
  refreshJobs,
  refreshInventory,
  refreshShifts,
  showToast,
}: UseJobMutationsParams) {
  const queryClient = useQueryClient();

  const createJob = useCallback(
    async (data: Partial<Job>): Promise<Job | null> => {
      try {
        const job = await jobService.createJob(data);
        if (!job) {
          console.error('Job creation returned null');
          return null;
        }
        queryClient.setQueryData<Job[]>(['jobs'], (prev) =>
          prev ? dedupeJobsById([job, ...prev]) : [job]
        );
        return job;
      } catch (error) {
        console.error('Create job error:', error);
        return null;
      }
    },
    [queryClient]
  );

  const updateJob = useCallback(
    async (jobId: string, data: Partial<Job>): Promise<Job | null> => {
      try {
        if (data.active === false) {
          data.binLocation = undefined;
        }
        const updatedJob = await jobService.updateJob(jobId, data);
        if (updatedJob) {
          let jobForCache = { ...updatedJob, ...data };
          if (
            data.parts === undefined &&
            (updatedJob.parts == null || updatedJob.parts.length === 0)
          ) {
            const existing = queryClient.getQueryData<Job>(['job', jobId]);
            if (existing?.parts != null && existing.parts.length > 0) {
              jobForCache = { ...jobForCache, parts: existing.parts };
            }
          }
          queryClient.setQueryData<Job[]>(['jobs'], (prev) =>
            prev ? prev.map((j) => (j.id === jobId ? jobForCache : j)) : []
          );
          queryClient.setQueryData(['job', jobId], jobForCache);
        }
        return updatedJob;
      } catch (error) {
        console.error('Update job error:', error);
        return null;
      }
    },
    [queryClient]
  );

  const deleteJob = useCallback(
    async (jobId: string): Promise<boolean> => {
      try {
        const deleted = await jobService.deleteJob(jobId);
        if (!deleted) return false;
        queryClient.setQueryData<Job[]>(['jobs'], (prev) =>
          prev ? prev.filter((j) => j.id !== jobId) : []
        );
        await refreshJobs();
        await refreshInventory();
        await refreshShifts();
        return true;
      } catch (error) {
        console.error('Delete job error:', error);
        return false;
      }
    },
    [queryClient, refreshInventory, refreshJobs, refreshShifts]
  );

  const updateJobStatus = useCallback(
    async (jobId: string, status: JobStatus): Promise<boolean> => {
      try {
        const job = jobs.find((j) => j.id === jobId);
        const wasDelivered = job?.status === 'delivered';
        const isDelivered = status === 'delivered';
        const nextJobs = jobs.map((j) => (j.id === jobId ? { ...j, status } : j));

        if (status === 'paid' && job) {
          const name = buildJobNameFromConvention({ ...job, status: 'paid' });
          const updated = await jobService.updateJob(jobId, { status: 'paid', name });
          if (!updated) {
            await refreshJobs();
            return false;
          }
          queryClient.setQueryData<Job[]>(['jobs'], (prev) =>
            prev ? prev.map((j) => (j.id === jobId ? { ...j, status: 'paid', name } : j)) : []
          );
        } else {
          queryClient.setQueryData<Job[]>(['jobs'], (prev) =>
            prev
              ? prev.map((j) =>
                  j.id === jobId
                    ? {
                        ...j,
                        status,
                        ...(status === 'delivered' ? { binLocation: undefined } : {}),
                      }
                    : j
                )
              : []
          );
          const ok = await jobService.updateJobStatus(jobId, status);
          if (!ok) {
            await refreshJobs();
            return false;
          }
        }

        if (status !== 'paid' && status !== 'projectCompleted') {
          await checklistService.ensureJobChecklistForStatus(jobId, status);
        }

        if (job && isDelivered !== wasDelivered) {
          const direction = isDelivered ? 'consume' : 'restore';
          const action = isDelivered ? 'reconcile_job' : 'reconcile_job_reversal';
          const reason = isDelivered
            ? `Materials used for Job #${job.jobCode} (Delivered)`
            : `Delivered status reversed for Job #${job.jobCode}; stock restored`;

          const updates = buildReconciliationMutations({
            job,
            inventory,
            jobsAfterStatusUpdate: nextJobs,
            direction,
          });

          let reconciliationFailed = false;
          for (const entry of updates) {
            try {
              await inventoryService.updateStock(entry.inventoryId, entry.newInStock);
              if (currentUser) {
                await inventoryHistoryService.createHistory({
                  inventory: entry.inventoryId,
                  user: currentUser.id,
                  action,
                  reason,
                  previousInStock: entry.previousInStock,
                  newInStock: entry.newInStock,
                  previousAvailable: entry.previousAvailable,
                  newAvailable: entry.newAvailable,
                  changeAmount: entry.changeAmount,
                  relatedJob: jobId,
                });
              }
            } catch (err) {
              console.error('Reconciliation updateStock failed:', err);
              reconciliationFailed = true;
            }
          }
          if (reconciliationFailed) {
            showToast(
              'Failed to update inventory stock for one or more items. Check permissions and try again.',
              'error'
            );
          }
        }

        await refreshJobs();
        await refreshInventory();
        return true;
      } catch (error) {
        console.error('Update job status error:', error);
        await refreshJobs();
        await refreshInventory();
        return false;
      }
    },
    [jobs, inventory, currentUser, queryClient, refreshJobs, refreshInventory, showToast]
  );

  const advanceJobToNextStatus = useCallback(
    async (jobId: string, currentStatus: JobStatus): Promise<boolean> => {
      if (currentStatus === 'onHold' || !isAutoFlowStatus(currentStatus)) return false;
      const next = getNextWorkflowStatus(currentStatus);
      if (!next) return false;
      return updateJobStatus(jobId, next);
    },
    [updateJobStatus]
  );

  const addJobComment = useCallback(
    async (jobId: string, text: string): Promise<Comment | null> => {
      if (!currentUser) return null;
      try {
        const comment = await jobService.addComment(jobId, text, currentUser.id);
        await refreshJobs();
        return comment;
      } catch (error) {
        console.error('Add comment error:', error);
        return null;
      }
    },
    [currentUser, refreshJobs]
  );

  const getJobByCode = useCallback(
    async (code: number): Promise<Job | null> => {
      const fromMemory = jobs.find((j) => j.jobCode === code);
      if (fromMemory) return fromMemory;
      const fromApi = await jobService.getJobByCode(code);
      if (fromApi) {
        queryClient.setQueryData<Job[]>(['jobs'], (prev) => {
          if (!prev) return [fromApi];
          const exists = prev.some((j) => j.id === fromApi.id);
          return exists ? prev.map((j) => (j.id === fromApi.id ? fromApi : j)) : [fromApi, ...prev];
        });
        return fromApi;
      }
      return null;
    },
    [jobs, queryClient]
  );

  return {
    createJob,
    updateJob,
    deleteJob,
    updateJobStatus,
    advanceJobToNextStatus,
    addJobComment,
    getJobByCode,
  };
}

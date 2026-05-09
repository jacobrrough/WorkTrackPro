import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Comment, Job, JobStatus, User } from '@/core/types';
import { buildJobNameFromConvention } from '@/lib/formatJob';
import { getNextWorkflowStatus, isAutoFlowStatus } from '@/lib/jobWorkflow';
import { dedupeJobsById } from '@/lib/jobUtils';
import { jobService } from '@/services/api/jobs';
import { checklistService } from '@/services/api/checklists';
import { jobStatusHistoryService } from '@/services/api/jobStatusHistory';
import { systemNotificationService } from '@/services/api/systemNotifications';

export interface UseJobMutationsParams {
  jobs: Job[];
  currentUser: User | null;
  refreshJobs: () => Promise<void>;
  refreshInventory: () => Promise<void>;
  refreshShifts: () => Promise<void>;
  showToast?: (
    message: string,
    type: 'info' | 'success' | 'error' | 'warning',
    duration?: number
  ) => void;
}

export function useJobMutations({
  jobs,
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
        const previousJob = jobs.find((j) => j.id === jobId);
        const updatedJob = await jobService.updateJob(jobId, data);
        if (updatedJob) {
          if (currentUser && data.status && previousJob && previousJob.status !== data.status) {
            jobStatusHistoryService
              .createHistory({
                jobId,
                userId: currentUser.id,
                previousStatus: previousJob.status,
                newStatus: data.status,
              })
              .catch((err) => console.error('Job status history insert failed:', err));
          }
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

          if (currentUser && previousJob) {
            const changerName = currentUser.name ?? currentUser.email;
            const jobLabel = `Job #${previousJob.jobCode}`;

            if (data.assignedUsers) {
              const prevSet = new Set(previousJob.assignedUsers ?? []);
              const newSet = new Set(data.assignedUsers);
              for (const uid of data.assignedUsers) {
                if (!prevSet.has(uid) && uid !== currentUser.id) {
                  systemNotificationService
                    .createNotification({
                      userId: uid,
                      type: 'assignment',
                      title: 'Assigned to Job',
                      message: `${changerName} assigned you to ${jobLabel}`,
                      link: `job-detail:${jobId}`,
                      metadata: { job_id: jobId, job_code: previousJob.jobCode },
                    })
                    .catch((err) => console.error('Assignment notification failed:', err));
                }
              }
              for (const uid of previousJob.assignedUsers ?? []) {
                if (!newSet.has(uid) && uid !== currentUser.id) {
                  systemNotificationService
                    .createNotification({
                      userId: uid,
                      type: 'unassignment',
                      title: 'Removed from Job',
                      message: `${changerName} removed you from ${jobLabel}`,
                      link: `job-detail:${jobId}`,
                      metadata: { job_id: jobId, job_code: previousJob.jobCode },
                    })
                    .catch((err) => console.error('Unassignment notification failed:', err));
                }
              }
            }

            if (data.isRush === true && !previousJob.isRush) {
              for (const uid of previousJob.assignedUsers ?? []) {
                if (uid !== currentUser.id) {
                  systemNotificationService
                    .createNotification({
                      userId: uid,
                      type: 'rush',
                      title: 'Rush Job',
                      message: `${jobLabel} has been marked as RUSH by ${changerName}`,
                      link: `job-detail:${jobId}`,
                      metadata: { job_id: jobId, job_code: previousJob.jobCode },
                    })
                    .catch((err) => console.error('Rush notification failed:', err));
                }
              }
            }
          }
        }
        return updatedJob;
      } catch (error) {
        console.error('Update job error:', error);
        return null;
      }
    },
    [queryClient, jobs, currentUser]
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
      // Captured before the try so the catch block can revert the optimistic write.
      const job = jobs.find((j) => j.id === jobId);
      try {
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
          // Only write optimistically when the previous job state is known so
          // the catch block can revert to the correct previous status.
          // If job is undefined (not yet in cache), skip the optimistic write
          // and let refreshJobs() sync the UI after the DB call resolves.
          if (job) {
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
          }
          const ok = await jobService.updateJobStatus(jobId, status);
          if (!ok) {
            await refreshJobs();
            return false;
          }
        }

        if (currentUser && job && job.status !== status) {
          jobStatusHistoryService
            .createHistory({
              jobId,
              userId: currentUser.id,
              previousStatus: job.status,
              newStatus: status,
            })
            .catch((err) => console.error('Job status history insert failed:', err));
        }

        if (status !== 'paid' && status !== 'projectCompleted') {
          await checklistService.ensureJobChecklistForStatus(jobId, status);
        }

        // Inventory reconciliation is handled by the DB trigger
        // jobs_reconcile_inventory_on_status_trg (migration 20260509000002).
        // No app-layer reconciliation needed here.

        await refreshJobs();
        await refreshInventory();
        return true;
      } catch (error) {
        // Revert the optimistic status write so the UI doesn't flash the wrong
        // status while refreshJobs is in flight (~500ms–2s).
        // Only revert when job was known pre-call (optimistic write only happens
        // in that case). 'paid' is pessimistic above and never hits this branch.
        // Also restore binLocation — the 'delivered' optimistic write clears it.
        if (status !== 'paid' && job) {
          queryClient.setQueryData<Job[]>(['jobs'], (prev) =>
            prev
              ? prev.map((j) =>
                  j.id === jobId
                    ? {
                        ...j,
                        status: job.status,
                        ...(status === 'delivered' ? { binLocation: job.binLocation } : {}),
                      }
                    : j
                )
              : []
          );
        }
        console.error('Update job status error:', error);
        const err = error as { message?: string; code?: string };
        const msg = err?.message ?? '';
        if (msg.includes('insufficient_stock') || err?.code === '23514') {
          showToast?.(
            'Not enough stock to complete this status change. Check inventory levels.',
            'error'
          );
        } else if (msg.includes('consumed_at_race_reversal')) {
          // Two sessions tried to restore the same finished job simultaneously (e.g., admin
          // double-click on rework). The second restore was correctly blocked by the DB.
          showToast?.(
            'This job was already restored — refresh to see the current status.',
            'warning'
          );
        } else if (msg.includes('consumed_at_race')) {
          // Two sessions tried to finish the same job simultaneously (e.g., double-tap).
          // The second write was correctly blocked; the job is already marked finished.
          showToast?.('Job status was just updated — refreshing.', 'warning');
        } else if (msg.includes('job_is_consumed')) {
          // Status transition attempted on an already-consumed job (race or stale UI).
          showToast?.('This job is already finished — status cannot be changed.', 'warning');
        } else if (msg.includes('inventory_missing')) {
          showToast?.(
            'An inventory item linked to this job no longer exists. Contact an admin.',
            'error'
          );
        } else if (err?.code === '40P01') {
          // Deadlock between concurrent job-finish and inventory-allocation transactions.
          // Postgres aborts one automatically — ask the user to retry.
          showToast?.('A conflict occurred — please try again.', 'warning');
        } else {
          showToast?.('Failed to update status. Please try again.', 'error');
        }
        await refreshJobs();
        await refreshInventory();
        return false;
      }
    },
    [jobs, currentUser, queryClient, refreshJobs, refreshInventory, showToast]
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

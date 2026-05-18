import { useCallback } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Comment, Job, JobStatus, User } from '@/core/types';
import { buildJobNameFromConvention } from '@/lib/formatJob';
import { getNextWorkflowStatus, isTerminalStatus } from '@/lib/jobWorkflow';
import { dedupeJobsById } from '@/lib/jobUtils';
import { jobService } from '@/services/api/jobs';
import { checklistService } from '@/services/api/checklists';
import { jobStatusHistoryService } from '@/services/api/jobStatusHistory';
import { systemNotificationService } from '@/services/api/systemNotifications';

// ─── Module-level helpers ─────────────────────────────────────────────────────
// Defined outside the hook so they are stable references and never need to
// appear in useCallback dependency arrays.

/** Patch a single job in the ['jobs'] query cache by spreading partial fields. */
function patchJobInCache(queryClient: QueryClient, jobId: string, patch: Partial<Job>): void {
  queryClient.setQueryData<Job[]>(
    ['jobs'],
    (prev) =>
      // Return prev unchanged when the cache is cold (undefined) so we don't
      // overwrite it with [] and blank the job list until refreshJobs resolves.
      prev?.map((j) => (j.id === jobId ? { ...j, ...patch } : j)) ?? prev
  );
}

/**
 * Fire-and-forget status-history insert + cache invalidation.
 * Invalidation is chained on .then() so it fires after the row commits,
 * avoiding a refetch race where the new entry hasn't landed yet.
 *
 * Deduplication: a module-level Map stores in-flight promises keyed by transition.
 * The key is deleted in .finally() once the insert settles (success or failure).
 *
 * Map<key, Promise> over Set+TTL for two reasons:
 *   1. No stuck keys: .finally() always removes the entry — there is no separate
 *      timer that could expire before the promise settles and leave the key in place
 *      permanently, nor a window where the TTL fires mid-flight and lets a duplicate
 *      through on a slow network.
 *   2. Single-threaded safety: JS does not interleave microtasks between .has() and
 *      .set(), so the check-then-add is effectively atomic.
 */
const _inFlightHistoryPromises = new Map<string, Promise<void>>();

function recordStatusChange(
  queryClient: QueryClient,
  jobId: string,
  userId: string,
  previousStatus: JobStatus,
  newStatus: JobStatus
): void {
  // No-op: identical from/to statuses don't represent a real transition.
  if (previousStatus === newStatus) return;
  // Include userId so two different admins triggering the same transition
  // concurrently both get their history rows recorded rather than one being dropped.
  const dedupKey = `${userId}|${jobId}|${previousStatus}|${newStatus}`;
  if (_inFlightHistoryPromises.has(dedupKey)) return;
  const p = jobStatusHistoryService
    .createHistory({ jobId, userId, previousStatus, newStatus })
    .then(() => queryClient.invalidateQueries({ queryKey: ['job-status-history', jobId] }))
    .catch((err) => {
      console.error('Job status history insert failed:', err);
      // Invalidate even on failure so the panel re-fetches and reflects reality
      // rather than showing stale cached entries.
      queryClient.invalidateQueries({ queryKey: ['job-status-history', jobId] });
    })
    .finally(() => _inFlightHistoryPromises.delete(dedupKey));
  _inFlightHistoryPromises.set(dedupKey, p);
}

/**
 * Handle the special-case paid transition: rebuilds the job name via naming
 * convention before persisting. Uses updateJob (full row write) rather than
 * updateJobStatus because the name field also needs to change.
 *
 * Does NOT call refreshJobs — the caller owns post-transition cleanup so that
 * refreshJobs is never called twice in the cold-cache path (once before this
 * function to hydrate, once here on failure would be a double-fetch race).
 */
async function finalizePaidJob(
  queryClient: QueryClient,
  jobId: string,
  job: Job
): Promise<boolean> {
  // Spread job then override status so buildJobNameFromConvention sees 'paid'
  // even though job.status in the cache may still be 'projectCompleted'.
  const name = buildJobNameFromConvention({ ...job, status: 'paid' });
  const updated = await jobService.updateJob(jobId, { status: 'paid', name });
  if (!updated) return false;
  patchJobInCache(queryClient, jobId, { status: 'paid', name });
  return true;
}

/**
 * Read the freshest copy of a job at call time.
 * Prefers the live React Query cache; falls back to the `jobs` prop array
 * when the cache is cold (undefined) OR empty ([]) — nullish coalescing alone
 * is not sufficient because an initialized-but-empty cache is truthy and would
 * suppress the fallback.
 */
function findJobLive(queryClient: QueryClient, jobs: Job[], jobId: string): Job | undefined {
  const cached = queryClient.getQueryData<Job[]>(['jobs']);
  return (cached?.length ? cached : jobs).find((j) => j.id === jobId);
}

/**
 * Build the cache patch that reverts an optimistic status write.
 * Restores `status` and, for 'delivered' transitions, restores `binLocation`
 * (the optimistic write clears it, so the revert must put it back).
 */
function buildRevertPatch(job: Job, status: JobStatus): Partial<Job> {
  return {
    status: job.status,
    ...(status === 'delivered' ? { binLocation: job.binLocation } : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────────

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

  // Extracted helper — `await refreshJobs(); await refreshInventory()` appears on
  // every exit path of updateJobStatus (success, checklist failure, catch). Centralising
  // it means a future change to refresh strategy only needs to touch one place.
  const refreshAll = useCallback(async () => {
    await refreshJobs();
    await refreshInventory();
  }, [refreshJobs, refreshInventory]);

  const createJob = useCallback(
    async (data: Partial<Job>): Promise<Job | null> => {
      try {
        const job = await jobService.createJob(data);
        if (!job) {
          console.error('Job creation returned null');
          return null;
        }
        // Intentionally seeds the cache with [job] on cold-cache (prev undefined).
        // Create is the only mutation where seeding on cold-cache is correct — the
        // new job must appear immediately. Update/delete use prev ?? prev instead
        // to avoid overwriting a warming cache with a partial list.
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
      // Symmetric guard with updateJobStatus — blocks paid writes even when updateJob
      // is called directly (bypassing the updateJobStatus code path).
      if (data.status === 'paid' && !currentUser?.isAdmin) return null;
      // progressEstimatePercent directly controls calendar scheduling (sets remainingLaborHours
      // to 0 at 100%, dropping the job from the calendar). Admin-only at the app layer;
      // RLS is the authoritative backstop.
      if ('progressEstimatePercent' in data && !currentUser?.isAdmin) return null;
      try {
        // Clone before mutating so we don't alter the caller's object.
        // `data` is Partial<Job> and may be reused by the caller after this call.
        const payload = data.active === false ? { ...data, binLocation: undefined } : data;
        // Use findJobLive so the history snapshot reads the freshest cache state
        // rather than a potentially stale jobs prop from a previous render cycle.
        const previousJob = findJobLive(queryClient, jobs, jobId);
        const updatedJob = await jobService.updateJob(jobId, payload);
        if (updatedJob) {
          if (currentUser && data.status && previousJob && previousJob.status !== data.status) {
            recordStatusChange(queryClient, jobId, currentUser.id, previousJob.status, data.status);
          }
          let jobForCache = { ...updatedJob, ...payload };
          if (
            data.parts === undefined &&
            (updatedJob.parts == null || updatedJob.parts.length === 0)
          ) {
            const existing = queryClient.getQueryData<Job>(['job', jobId]);
            if (existing?.parts != null && existing.parts.length > 0) {
              jobForCache = { ...jobForCache, parts: existing.parts };
            }
          }
          queryClient.setQueryData<Job[]>(
            ['jobs'],
            (prev) =>
              // Match patchJobInCache: return prev unchanged on cold cache rather than
              // overwriting with [] and blanking the job list until the next fetch.
              prev?.map((j) => (j.id === jobId ? jobForCache : j)) ?? prev
          );
          queryClient.setQueryData(['job', jobId], jobForCache);

          if (currentUser && previousJob) {
            const changerName = currentUser.name ?? currentUser.email;
            const jobLabel = `Job #${previousJob.jobCode}`;

            if (data.assignedUsers) {
              const prevSet = new Set(previousJob.assignedUsers ?? []);
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
                if (!data.assignedUsers.includes(uid) && uid !== currentUser.id) {
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
        queryClient.setQueryData<Job[]>(
          ['jobs'],
          (prev) =>
            // Match patchJobInCache: return prev unchanged on cold cache.
            prev?.filter((j) => j.id !== jobId) ?? prev
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
    async (
      jobId: string,
      status: JobStatus,
      // Optional compare-and-swap token supplied by advanceJobToNextStatus.
      // When set, the call is aborted if the live cache status no longer matches
      // (another concurrent call already moved the job). This narrows the TOCTOU
      // window between advanceJobToNextStatus's status read and this write.
      // The DB/RLS is the authoritative backstop for races that slip through.
      expectedCurrentStatus?: JobStatus
    ): Promise<boolean> => {
      // 'paid' finalizes a job financially — only admins may trigger it, regardless of
      // call path. advanceJobToNextStatus has the same guard, but callers can invoke
      // updateJobStatus directly, so this is the authoritative application-layer check.
      // The DB/RLS is the ultimate backstop.
      if (status === 'paid' && !currentUser?.isAdmin) return false;
      const job = findJobLive(queryClient, jobs, jobId);
      // TOCTOU guard: if the caller supplied an expected status and the live cache
      // disagrees, a concurrent transition already happened — bail rather than
      // applying a stale advance.
      if (expectedCurrentStatus !== undefined && job?.status !== expectedCurrentStatus)
        return false;
      // effectiveJob is updated to paidJob when the paid cold-cache path resolves a
      // previously-missing job so that recordStatusChange sees the real snapshot.
      let effectiveJob = job;
      // Snapshot the previous status before any refreshJobs() call — a concurrent
      // realtime push may update the cache to 'paid' while we're hydrating, which
      // would make effectiveJob.status === 'paid' === status and silently drop the
      // history row. We preserve the known pre-transition status here and use it
      // for the history guard below regardless of what the cache reads after refresh.
      let previousStatusSnapshot: JobStatus | undefined = job?.status;
      try {
        if (status === 'paid') {
          // paid requires a name rebuild — delegate to finalizePaidJob.
          // If the job isn't in cache yet, refresh to hydrate and re-read in-place
          // rather than returning false (which would silently drop the transition
          // if the caller doesn't retry, e.g. a checklist auto-advance handler).
          let paidJob = job;
          if (!paidJob) {
            await refreshJobs();
            paidJob = (queryClient.getQueryData<Job[]>(['jobs']) ?? []).find((j) => j.id === jobId);
            if (!paidJob) return false; // genuinely not found even after refresh
            // Re-check CAS after refresh: a concurrent mutation may have moved the job
            // to an unexpected status during the refresh window. 'paid' is the one
            // allowed mismatch — realtime beat us; finalizePaidJob is idempotent so
            // we continue. Any other status mismatch means a different race won; bail.
            if (
              expectedCurrentStatus !== undefined &&
              paidJob.status !== expectedCurrentStatus &&
              paidJob.status !== 'paid'
            ) {
              return false;
            }
            // If realtime already pushed 'paid' before we refreshed, fall back to the
            // CAS token (expectedCurrentStatus) as the known previous status so the
            // history row is still recorded. Without this, previousStatusSnapshot would
            // be undefined (job was null pre-refresh) and history would be silently dropped.
            previousStatusSnapshot =
              paidJob.status !== 'paid' ? paidJob.status : expectedCurrentStatus;
          }
          effectiveJob = paidJob; // ensure history guard below sees the resolved snapshot
          const ok = await finalizePaidJob(queryClient, jobId, paidJob);
          if (!ok) {
            await refreshJobs();
            return false;
          }
        } else {
          // Only write optimistically when the previous job state is known so
          // the catch block can revert to the correct previous status.
          // If job is undefined (not yet in cache), skip the optimistic write
          // and let refreshJobs() sync the UI after the DB call resolves.
          if (job) {
            patchJobInCache(queryClient, jobId, {
              status,
              ...(status === 'delivered' ? { binLocation: undefined } : {}),
            });
          }
          const ok = await jobService.updateJobStatus(jobId, status);
          if (!ok) {
            // Revert the optimistic write — !ok is a normal falsy return, not a thrown
            // error, so the catch block never fires for this path.
            if (job) patchJobInCache(queryClient, jobId, buildRevertPatch(job, status));
            await refreshJobs();
            return false;
          }
        }

        // Use previousStatusSnapshot rather than effectiveJob.status — the snapshot
        // is captured before any refreshJobs() call and is immune to a concurrent
        // realtime push that may have already set the cache to the new status.
        if (
          currentUser &&
          effectiveJob &&
          previousStatusSnapshot &&
          previousStatusSnapshot !== status
        ) {
          recordStatusChange(queryClient, jobId, currentUser.id, previousStatusSnapshot, status);
        }

        // Fallback: when a history row was attempted (currentUser present) but
        // effectiveJob was unknown, invalidate so the panel re-fetches and shows the
        // change. Skipped when currentUser is absent — no row was written, nothing to fetch.
        if (currentUser && !effectiveJob) {
          queryClient.invalidateQueries({ queryKey: ['job-status-history', jobId] });
        }

        if (!isTerminalStatus(status)) {
          // Run checklist seeding after the status is committed. A failure here
          // must NOT revert the cache — the DB status is already correct. Surface
          // the error as a non-blocking warning and resync via refreshJobs so the
          // UI reflects the committed state rather than the rolled-back optimistic write.
          //
          // Note: 'projectCompleted' intentionally seeds a checklist here.
          // Its checklist drives the final checklist-auto-advance to 'paid'.
          // Only 'paid' itself is excluded (isTerminalStatus = true) because
          // no checklist is needed once the job lifecycle is fully closed.
          try {
            await checklistService.ensureJobChecklistForStatus(jobId, status);
          } catch (checklistErr) {
            console.error('Checklist seeding failed after status commit:', checklistErr);
            showToast?.(
              'Status updated, but checklist setup failed. Refresh if the checklist looks wrong.',
              'warning'
            );
            await refreshAll();
            return true; // status commit succeeded — report success despite checklist failure
          }
        }

        // Inventory reconciliation is handled by the DB trigger
        // jobs_reconcile_inventory_on_status_trg (migration 20260509000002).
        // No app-layer reconciliation needed here.

        await refreshAll();
        return true;
      } catch (error) {
        // Revert the optimistic status write so the UI doesn't flash the wrong
        // status while refreshJobs is in flight (~500ms–2s).
        // Only revert when job was known pre-call (optimistic write only happens
        // in that case). 'paid' uses finalizePaidJob (pessimistic) and never
        // hits this branch. Also restore binLocation — the 'delivered' optimistic
        // write clears it.
        if (status !== 'paid' && job) {
          patchJobInCache(queryClient, jobId, buildRevertPatch(job, status));
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
        await refreshAll();
        return false;
      }
    },
    [jobs, currentUser, queryClient, refreshAll, refreshJobs, showToast]
  );

  // Always read the live job from the cache/prop — refuses to advance when the
  // job isn't found or its status is absent, rather than risk a wrong transition.
  const advanceJobToNextStatus = useCallback(
    async (jobId: string): Promise<boolean> => {
      const liveJob = findJobLive(queryClient, jobs, jobId);
      // Require a known status — if liveJob exists but status is missing (corrupt
      // cache entry), refuse to advance.
      const liveStatus = liveJob?.status;
      if (!liveJob || !liveStatus) return false;
      // Explicit guard: onHold and rush are not linear production steps and must
      // never be auto-advanced by a checklist event. getNextWorkflowStatus also
      // returns null for them (not in AUTO_WORKFLOW_STATUSES), but the explicit
      // check makes the invariant load-bearing and visible to future editors.
      if (liveStatus === 'onHold' || liveStatus === 'rush') return false;
      // getNextWorkflowStatus returns null for non-flow statuses and for 'paid' (last entry).
      const next = getNextWorkflowStatus(liveStatus);
      if (!next) return false;
      // 'paid' finalizes a job financially and triggers a name rebuild — only admins
      // may advance to it. The DB/RLS is the authoritative backstop, but this guard
      // prevents non-admin workers from even attempting the transition via a checklist.
      if (next === 'paid' && !currentUser?.isAdmin) return false;
      // Pass liveStatus as the compare-and-swap token so updateJobStatus can detect
      // if a concurrent call already moved the job before this write lands.
      return updateJobStatus(jobId, next, liveStatus);
    },
    [queryClient, jobs, currentUser, updateJobStatus]
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
        showToast?.('Failed to post comment. Please try again.', 'error');
        return null;
      }
    },
    [currentUser, refreshJobs, showToast]
  );

  const getJobByCode = useCallback(
    async (code: number): Promise<Job | null> => {
      const fromMemory = jobs.find((j) => j.jobCode === code);
      if (fromMemory) return fromMemory;
      const fromApi = await jobService.getJobByCode(code);
      if (fromApi) {
        // Only patch the cache when it's already warm. A setQueryData updater that
        // returns undefined (which `return prev` does on cold cache) is interpreted
        // by TanStack Query as "delete this entry" — actively worse than the
        // previous [fromApi] seed. Guard at the call site so we never enter the
        // updater when cache is cold.
        const cachedJobs = queryClient.getQueryData<Job[]>(['jobs']);
        if (cachedJobs) {
          queryClient.setQueryData<Job[]>(['jobs'], (prev) => {
            if (!prev) return prev;
            const exists = prev.some((j) => j.id === fromApi.id);
            return exists
              ? prev.map((j) => (j.id === fromApi.id ? fromApi : j))
              : [...prev, fromApi];
          });
        }
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

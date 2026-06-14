import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ClockPunchResult } from '@/core/clockPunch';
import type { Shift } from '@/core/types';
import { getRemainingBreakMs, getTotalBreakMs, toBreakMinutes } from '@/lib/lunchUtils';
import { isAuthError } from '@/lib/authErrors';
import { enqueueClockPunch } from '@/lib/offlineQueue';
import { withTimeout } from '@/lib/withTimeout';
import { shiftService } from '@/services/api/shifts';
import { jobService } from '@/services/api/jobs';
import { isConsumedStatus } from '@/lib/inventoryCalculations';

export interface UseClockMutationsParams {
  currentUser: { id: string } | null;
  shifts: Shift[];
  jobs: { id: string; status?: string }[];
  activeShift: Shift | null;
  refreshShifts: () => Promise<void>;
  refreshJobs: () => Promise<void>;
  onOfflinePunchEnqueued: () => void;
  showToast?: (
    message: string,
    type: 'info' | 'success' | 'error' | 'warning',
    duration?: number
  ) => void;
}

const success = (): ClockPunchResult => ({ ok: true, queued: false });
const failure = (queued: boolean): ClockPunchResult => ({ ok: false, queued });

// On degraded/captive Wi-Fi ("lie-fi") navigator.onLine stays true but the Supabase
// write neither resolves nor rejects, so the punch hangs forever and never falls back
// to the offline queue. Cap each clock-in write so a hang rejects and routes into the
// existing catch -> enqueueClockPunch path instead of spinning indefinitely.
//
// Trade-off: a write that actually succeeds server-side but answers slower than this
// timeout will be treated as failed and re-enqueued, so the replay could attempt a
// second punch. That stays safe because shiftService.clockIn no-ops when an open shift
// already exists (partial unique index on open shifts) and syncOfflineClockQueue clears
// such a punch as already-synced. Kept generous to avoid re-queueing merely-slow writes.
const CLOCK_IN_TIMEOUT_MS = 8000;

export function useClockMutations({
  currentUser,
  shifts,
  jobs,
  activeShift,
  refreshShifts,
  refreshJobs,
  onOfflinePunchEnqueued,
  showToast,
}: UseClockMutationsParams) {
  const queryClient = useQueryClient();

  const clockIn = useCallback(
    async (jobId: string): Promise<ClockPunchResult> => {
      if (!currentUser) return failure(false);

      const existingActiveShift = shifts.find((s) => s.user === currentUser.id && !s.clockOutTime);
      if (existingActiveShift) {
        if (existingActiveShift.job === jobId) return success();
        try {
          if (existingActiveShift.lunchStartTime && !existingActiveShift.lunchEndTime) {
            const totalBreakMinutes = toBreakMinutes(getTotalBreakMs(existingActiveShift));
            await shiftService.endLunch(existingActiveShift.id, totalBreakMinutes);
          }
          await shiftService.clockOut(existingActiveShift.id);
          await refreshShifts();
        } catch (error) {
          console.error('Clock in (switch job) error:', error);
          if (isAuthError(error)) return { ok: false, queued: false, authExpired: true };
          enqueueClockPunch({
            type: 'clock_out',
            userId: currentUser.id,
            timestamp: new Date().toISOString(),
            shiftId: existingActiveShift.id,
          });
          onOfflinePunchEnqueued();
          return failure(true);
        }
      }

      const applyJobProgressAfterClockIn = async () => {
        await refreshShifts();
        const job = jobs.find((j) => j.id === jobId);
        const cachedStatus = job?.status;
        // Enter the live-check path when the cached status is pending/rush OR when the job
        // isn't in the local cache yet (e.g. just created by another session). For every
        // other cached status (inProgress, onHold, qualityControl…) we skip the transition.
        const shouldCheckLive =
          cachedStatus === 'pending' || cachedStatus === 'rush' || job === undefined;
        if (shouldCheckLive) {
          // Guard against offline-replay phantom restore: re-fetch current status from DB
          // before issuing the transition. A stale punch replayed after reconnect could
          // otherwise call updateJobStatus('inProgress') on an already-finished job,
          // which would trigger the DB trigger to restore (undo the deduction of) inStock.
          let liveStatus: string | null;
          try {
            liveStatus = await jobService.getJobStatus(jobId);
          } catch {
            // Network/DB error — be conservative: skip the transition rather than
            // risk a phantom restore on a job that may have already been finished.
            console.warn(
              'Clock in: getJobStatus failed; skipping inProgress transition for job',
              jobId
            );
            showToast?.(
              'Clocked in. Could not verify job status — please check the job manually.',
              'warning'
            );
            await refreshJobs();
            return;
          }
          if (liveStatus !== null && isConsumedStatus(liveStatus)) {
            // Job is already finished/delivered — inform the worker and skip.
            showToast?.('Clocked in. Job is already finished — status unchanged.', 'info');
            await refreshJobs();
            return;
          }
          // liveStatus === null means the job row is gone — unusual; skip conservatively.
          if (liveStatus === null) {
            showToast?.(
              'Clocked in. Job not found in database — please check with an admin.',
              'warning'
            );
            await refreshJobs();
            return;
          }

          // Already in progress (moved by another session between cache read and now).
          // updateJobStatusConditional would succeed as a no-op (WHEN clause suppresses
          // trigger) but would show a misleading "Job is now In Progress" toast.
          if (liveStatus === 'inProgress') {
            showToast?.('Clocked in. Job is already In Progress.', 'info');
            await refreshJobs();
            return;
          }

          // Live status is not pending or rush — don't force a transition. This guards
          // the job-not-in-cache path: if the job was in qualityControl, onHold, or any
          // other non-pending status, we should not move it to inProgress on clock-in.
          if (liveStatus !== 'pending' && liveStatus !== 'rush') {
            await refreshJobs();
            return;
          }

          // Use a conditional UPDATE (WHERE status = liveStatus) to close the TOCTOU
          // window between getJobStatus and this write. If the status changed in that
          // gap (e.g., admin finished the job), 0 rows match — the trigger never fires,
          // and no phantom stock restore occurs.
          let transitioned = false;
          let updateFailed = false;
          try {
            transitioned = await jobService.updateJobStatusConditional(
              jobId,
              'inProgress',
              liveStatus
            );
          } catch (err) {
            // Network/RLS/DB error — not a benign 0-row race.
            updateFailed = true;
            console.error('Clock in: conditional status update threw', err);
          }
          if (updateFailed) {
            // Real error (network, permissions) — warn the worker, do not imply a benign race.
            showToast?.(
              'Clocked in, but job status could not be updated — please check the job manually.',
              'warning'
            );
          } else if (!transitioned) {
            // 0 rows matched — status changed between our fetch and write.
            // Most likely a benign race (admin finished or reassigned the job).
            showToast?.(
              'Clocked in. Job status was just updated — check the current status.',
              'info'
            );
          } else {
            // Success — job moved to In Progress.
            showToast?.('Clocked in. Job is now In Progress.', 'success');
          }
          // Always refresh — so the worker sees the current status, not the stale cache.
          await refreshJobs();
        } else {
          await refreshJobs();
        }
      };

      try {
        let clockInSucceeded = await withTimeout(
          shiftService.clockIn(jobId, currentUser.id),
          CLOCK_IN_TIMEOUT_MS
        );

        if (!clockInSucceeded) {
          const latestShifts = await shiftService.getAllShifts();
          const latestActiveShift = latestShifts.find(
            (s) => s.user === currentUser.id && !s.clockOutTime
          );
          if (latestActiveShift && latestActiveShift.job === jobId) {
            await applyJobProgressAfterClockIn();
            return success();
          }
          if (latestActiveShift && latestActiveShift.job !== jobId) {
            try {
              if (latestActiveShift.lunchStartTime && !latestActiveShift.lunchEndTime) {
                const totalBreakMinutes = toBreakMinutes(getTotalBreakMs(latestActiveShift));
                await shiftService.endLunch(latestActiveShift.id, totalBreakMinutes);
              }
              await shiftService.clockOut(latestActiveShift.id);
              await refreshShifts();
              clockInSucceeded = await withTimeout(
                shiftService.clockIn(jobId, currentUser.id),
                CLOCK_IN_TIMEOUT_MS
              );
            } catch (retryErr) {
              console.error('Clock in retry path error:', retryErr);
              if (isAuthError(retryErr)) return { ok: false, queued: false, authExpired: true };
              enqueueClockPunch({
                type: 'clock_in',
                userId: currentUser.id,
                jobId,
                timestamp: new Date().toISOString(),
              });
              onOfflinePunchEnqueued();
              return failure(true);
            }
          }
        }

        if (clockInSucceeded) {
          await applyJobProgressAfterClockIn();
          return success();
        }
        return failure(false);
      } catch (error) {
        console.error('Clock in error:', error);
        if (isAuthError(error)) return { ok: false, queued: false, authExpired: true };
        if (currentUser && jobId) {
          enqueueClockPunch({
            type: 'clock_in',
            userId: currentUser.id,
            jobId,
            timestamp: new Date().toISOString(),
          });
          onOfflinePunchEnqueued();
        }
        return failure(true);
      }
    },
    [currentUser, shifts, refreshShifts, refreshJobs, jobs, onOfflinePunchEnqueued, showToast]
  );

  const clockOut = useCallback(async (): Promise<ClockPunchResult> => {
    if (!activeShift || !currentUser) return failure(false);
    try {
      if (activeShift.lunchStartTime && !activeShift.lunchEndTime) {
        // Snapshot the break minutes ONCE so the deduction is the wall-clock value at
        // clock-out time — never recomputed later (a recompute at sync would inflate it).
        const totalBreakMinutes = toBreakMinutes(getTotalBreakMs(activeShift));
        let lunchOk = await shiftService.endLunch(activeShift.id, totalBreakMinutes);
        if (!lunchOk) {
          // endLunch returns false on any Supabase write error (no throw), which is
          // frequently transient. Retry the lunch-end ONCE with the same snapshotted
          // minutes before falling back to the offline queue. This preserves the lunch
          // deduction in the common transient-error case: the offline clock_out punch
          // carries no lunch info and the sync path only calls clockOut(), so a dropped
          // lunch here is otherwise lost from lunch_end_time / lunch_minutes_used (which
          // the accounting view relies on).
          lunchOk = await shiftService.endLunch(activeShift.id, totalBreakMinutes);
        }
        if (!lunchOk) {
          // Residual gap (cross-file): a fully-offline clock-out with an open lunch still
          // drops the snapshotted minutes because the queue cannot carry them through to
          // sync. Fully fixing this requires QueuedPunch.lunchMinutesUsed in offlineQueue.ts
          // and an endLunch() call in the syncOfflineClockQueue.ts clock_out handler.
          enqueueClockPunch({
            type: 'clock_out',
            userId: currentUser.id,
            timestamp: new Date().toISOString(),
            shiftId: activeShift.id,
          });
          onOfflinePunchEnqueued();
          return failure(true);
        }
      }
      await shiftService.clockOut(activeShift.id);
      await refreshShifts();
      await refreshJobs();
      return success();
    } catch (error) {
      console.error('Clock out error:', error);
      if (activeShift && currentUser) {
        enqueueClockPunch({
          type: 'clock_out',
          userId: currentUser.id,
          timestamp: new Date().toISOString(),
          shiftId: activeShift.id,
        });
        onOfflinePunchEnqueued();
      }
      return failure(true);
    }
  }, [activeShift, refreshShifts, refreshJobs, currentUser, onOfflinePunchEnqueued]);

  const startLunch = useCallback(async (): Promise<boolean> => {
    if (!activeShift) return false;
    if (activeShift.lunchStartTime && !activeShift.lunchEndTime) return true;
    if (getRemainingBreakMs(activeShift) <= 0) return false;
    const shiftId = activeShift.id;
    const nowIso = new Date().toISOString();
    queryClient.setQueryData<Shift[]>(['shifts'], (prev) =>
      prev
        ? prev.map((s) =>
            s.id === shiftId ? { ...s, lunchStartTime: nowIso, lunchEndTime: undefined } : s
          )
        : []
    );
    try {
      const lunchSuccess = await shiftService.startLunch(shiftId);
      if (!lunchSuccess) {
        queryClient.setQueryData<Shift[]>(['shifts'], (prev) =>
          prev
            ? prev.map((s) =>
                s.id === shiftId ? { ...s, lunchStartTime: undefined, lunchEndTime: undefined } : s
              )
            : []
        );
        return false;
      }
      await refreshShifts();
      return true;
    } catch (error) {
      console.error('Start lunch error:', error);
      queryClient.setQueryData<Shift[]>(['shifts'], (prev) =>
        prev
          ? prev.map((s) =>
              s.id === shiftId ? { ...s, lunchStartTime: undefined, lunchEndTime: undefined } : s
            )
          : []
      );
      return false;
    }
  }, [activeShift, refreshShifts, queryClient]);

  const endLunch = useCallback(async (): Promise<boolean> => {
    if (!activeShift?.lunchStartTime || activeShift.lunchEndTime) return false;
    const shiftId = activeShift.id;
    const totalBreakMinutes = toBreakMinutes(getTotalBreakMs(activeShift));
    const nowIso = new Date().toISOString();
    queryClient.setQueryData<Shift[]>(['shifts'], (prev) =>
      prev
        ? prev.map((s) =>
            s.id === shiftId
              ? {
                  ...s,
                  lunchStartTime: undefined,
                  lunchEndTime: nowIso,
                  lunchMinutesUsed: totalBreakMinutes,
                }
              : s
          )
        : []
    );
    try {
      const lunchSuccess = await shiftService.endLunch(shiftId, totalBreakMinutes);
      if (!lunchSuccess) {
        queryClient.setQueryData<Shift[]>(['shifts'], (prev) =>
          prev
            ? prev.map((s) =>
                s.id === shiftId
                  ? {
                      ...s,
                      lunchStartTime: activeShift.lunchStartTime,
                      lunchEndTime: undefined,
                      lunchMinutesUsed: activeShift.lunchMinutesUsed,
                    }
                  : s
              )
            : []
        );
        return false;
      }
      await refreshShifts();
      return true;
    } catch (error) {
      console.error('End lunch error:', error);
      queryClient.setQueryData<Shift[]>(['shifts'], (prev) =>
        prev
          ? prev.map((s) =>
              s.id === shiftId
                ? {
                    ...s,
                    lunchStartTime: activeShift.lunchStartTime,
                    lunchEndTime: undefined,
                    lunchMinutesUsed: activeShift.lunchMinutesUsed,
                  }
                : s
            )
          : []
      );
      return false;
    }
  }, [activeShift, refreshShifts, queryClient]);

  return { clockIn, clockOut, startLunch, endLunch };
}

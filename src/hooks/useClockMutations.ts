import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ClockPunchResult } from '@/core/clockPunch';
import type { JobStatus, Shift } from '@/core/types';
import { getRemainingBreakMs, getTotalBreakMs, toBreakMinutes } from '@/lib/lunchUtils';
import { enqueueClockPunch } from '@/lib/offlineQueue';
import { shiftService } from '@/services/api/shifts';

export interface UseClockMutationsParams {
  currentUser: { id: string } | null;
  shifts: Shift[];
  jobs: { id: string; status?: string }[];
  activeShift: Shift | null;
  refreshShifts: () => Promise<void>;
  refreshJobs: () => Promise<void>;
  updateJobStatus: (jobId: string, status: JobStatus) => Promise<boolean>;
  onOfflinePunchEnqueued: () => void;
}

const success = (): ClockPunchResult => ({ ok: true, queued: false });
const failure = (queued: boolean): ClockPunchResult => ({ ok: false, queued });

export function useClockMutations({
  currentUser,
  shifts,
  jobs,
  activeShift,
  refreshShifts,
  refreshJobs,
  updateJobStatus,
  onOfflinePunchEnqueued,
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
        const shouldMoveToInProgress = job?.status === 'pending' || job?.status === 'rush';
        if (shouldMoveToInProgress) {
          await updateJobStatus(jobId, 'inProgress');
        } else {
          await refreshJobs();
        }
      };

      try {
        let clockInSucceeded = await shiftService.clockIn(jobId, currentUser.id);

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
              clockInSucceeded = await shiftService.clockIn(jobId, currentUser.id);
            } catch (retryErr) {
              console.error('Clock in retry path error:', retryErr);
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
    [currentUser, shifts, refreshShifts, refreshJobs, jobs, updateJobStatus, onOfflinePunchEnqueued]
  );

  const clockOut = useCallback(async (): Promise<ClockPunchResult> => {
    if (!activeShift) return failure(false);
    try {
      if (activeShift.lunchStartTime && !activeShift.lunchEndTime) {
        const totalBreakMinutes = toBreakMinutes(getTotalBreakMs(activeShift));
        const lunchOk = await shiftService.endLunch(activeShift.id, totalBreakMinutes);
        if (!lunchOk) {
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

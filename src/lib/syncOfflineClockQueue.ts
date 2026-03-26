import {
  bumpQueueAttempt,
  clearPunchFromQueue,
  getQueue,
  MAX_SYNC_ATTEMPTS_PER_PUNCH,
} from '@/lib/offlineQueue';
import { shiftService } from '@/services/api/shifts';

export interface SyncOfflineClockQueueOptions {
  refreshShifts: () => Promise<void>;
  refreshJobs: () => Promise<void>;
}

/**
 * Process queued clock punches in order. Only removes items on confirmed success.
 * Returns how many punches were successfully applied.
 */
export async function syncOfflineClockQueue(opts: SyncOfflineClockQueueOptions): Promise<number> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return 0;
  }

  let synced = 0;
  const snapshot = [...getQueue()];

  for (const punch of snapshot) {
    if (!getQueue().some((p) => p.id === punch.id)) continue;

    if ((punch.attemptCount ?? 0) >= MAX_SYNC_ATTEMPTS_PER_PUNCH) {
      continue;
    }

    try {
      if (punch.type === 'clock_in' && punch.jobId) {
        const ok = await shiftService.clockIn(punch.jobId, punch.userId);
        if (ok) {
          clearPunchFromQueue(punch.id);
          synced += 1;
          await opts.refreshShifts();
        } else {
          bumpQueueAttempt(punch.id);
        }
      } else if (punch.type === 'clock_out') {
        let shiftId = punch.shiftId;
        if (!shiftId) {
          const allShifts = await shiftService.getAllShifts();
          const active = allShifts.find((s) => s.user === punch.userId && !s.clockOutTime);
          shiftId = active?.id;
        }
        if (!shiftId) {
          clearPunchFromQueue(punch.id);
          synced += 1;
          await opts.refreshShifts();
          await opts.refreshJobs();
          continue;
        }

        const state = await shiftService.getShiftOpenState(shiftId);
        if (!state.exists) {
          clearPunchFromQueue(punch.id);
          synced += 1;
          await opts.refreshShifts();
          await opts.refreshJobs();
          continue;
        }
        if (!state.open) {
          clearPunchFromQueue(punch.id);
          synced += 1;
          await opts.refreshShifts();
          await opts.refreshJobs();
          continue;
        }

        await shiftService.clockOut(shiftId);
        clearPunchFromQueue(punch.id);
        synced += 1;
        await opts.refreshShifts();
        await opts.refreshJobs();
      }
    } catch {
      bumpQueueAttempt(punch.id);
    }
  }

  return synced;
}

import {
  bumpQueueAttempt,
  clearPunchFromQueue,
  getQueue,
  MAX_SYNC_ATTEMPTS_PER_PUNCH,
} from '@/lib/offlineQueue';
import { isAuthError } from '@/lib/authErrors';
import { supabase } from '@/services/api/supabaseClient';
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

  // Guard: don't attempt sync if the session is dead. This prevents burning
  // retry attempt counts on punches that will 100% fail until the worker logs in again.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return 0;

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
    } catch (err) {
      // If the error is auth-related, stop the whole loop — every remaining
      // punch will fail for the same reason. Attempt counts are NOT incremented.
      if (isAuthError(err)) break;
      bumpQueueAttempt(punch.id);
    }
  }

  return synced;
}

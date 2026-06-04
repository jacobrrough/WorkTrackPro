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
          // clockIn returns false only when the user already has an open shift
          // (business rule in shiftService.clockIn). A common cause is a lost ACK:
          // the offline punch actually succeeded server-side but the response never
          // came back, so it stayed queued. Reconcile instead of blindly bumping —
          // otherwise this punch retries 25× and surfaces as a bogus "stale" failure.
          const openShift = (await shiftService.getAllShifts()).find(
            (s) => s.user === punch.userId && !s.clockOutTime
          );
          if (openShift && openShift.job === punch.jobId) {
            // An open shift for this exact job already exists — the original
            // clock-in intent is satisfied. Clear the punch as synced.
            clearPunchFromQueue(punch.id);
            synced += 1;
            await opts.refreshShifts();
          } else {
            // No open shift, or one for a *different* job. We deliberately do NOT
            // auto job-switch (clock out the other shift + re-clock-in) during
            // background replay: a different-job open shift is likely the worker's
            // current live shift, and closing it from a stale queued punch could
            // discard active work. Leave it queued and bump the attempt counter so
            // the existing max-attempts visibility still applies.
            bumpQueueAttempt(punch.id);
          }
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

        // Stamp the shift with the queued (offline) punch time, not the reconnect time,
        // so a worker who clocked out offline isn't credited extra hours up to reconnect.
        await shiftService.clockOut(shiftId, punch.timestamp);
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

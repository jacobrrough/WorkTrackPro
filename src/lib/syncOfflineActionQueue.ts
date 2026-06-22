// Drain loop for the generalized offline queue. Structurally identical to
// syncOfflineClockQueue.ts: process queued actions in FIFO order, only remove an item
// on confirmed success/conflict, cap retries, short-circuit the whole loop on an auth
// error (every remaining action would fail the same way), and never throw out to the
// caller. Returns how many actions were applied.

import {
  bumpActionAttempt,
  clearActionFromQueue,
  getActionQueue,
  MAX_ACTION_SYNC_ATTEMPTS,
} from '@/lib/offlineActionQueue';
import { replayAction } from '@/lib/offlineActionHandlers';
import { isAuthError } from '@/lib/authErrors';
import { supabase } from '@/services/api/supabaseClient';

export async function syncOfflineActionQueue(): Promise<number> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 0;

  // Don't burn retry attempts on actions that will 100% fail until the user logs back in.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return 0;
  const sessionUserId = session.user.id;

  let synced = 0;
  const snapshot = [...getActionQueue()];

  for (const action of snapshot) {
    // Skip if it was cleared mid-loop (e.g. dedupe replaced it) or hit the retry cap.
    if (!getActionQueue().some((a) => a.id === action.id)) continue;
    if ((action.attemptCount ?? 0) >= MAX_ACTION_SYNC_ATTEMPTS) continue;
    // Only replay the current user's own queued actions. On a shared device, another
    // user's queued writes must not be applied under (or attributed across) this session;
    // they stay queued and sync when their author logs back in. Not an attempt-bump —
    // this is an ownership skip, not a failure.
    if (action.userId !== sessionUserId) continue;

    try {
      // 'done' and 'conflict' both mean "stop tracking this action".
      await replayAction(action);
      clearActionFromQueue(action.id);
      synced += 1;
    } catch (err) {
      // Auth failure → stop entirely without bumping attempts; a re-login will retry.
      if (isAuthError(err)) break;
      bumpActionAttempt(action.id);
    }
  }

  return synced;
}

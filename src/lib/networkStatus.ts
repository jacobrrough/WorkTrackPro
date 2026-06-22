// Shared offline detection for the mutation hooks. A write should fall back to the
// offline action queue when EITHER the browser reports it is offline, OR a live write
// hung past the lie-fi timeout (handled separately via withTimeout — a thrown timeout).
// Genuine business rejections (insufficient stock, consumed job, etc.) come back as a
// falsy result while ONLINE and must NOT be queued; this predicate keeps them apart.
export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && !navigator.onLine;
}

// Default lie-fi cap for queued-surface writes, matching the clock-in budget. A write
// that genuinely succeeds but answers slower than this is treated as failed and queued;
// replay is idempotent so that stays safe.
export const OFFLINE_WRITE_TIMEOUT_MS = 8000;

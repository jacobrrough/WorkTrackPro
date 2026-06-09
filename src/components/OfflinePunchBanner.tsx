import { useEffect, useRef, useState } from 'react';
import { useApp } from '../AppContext';
import { getOfflinePunchWarning } from '@/lib/offlineQueue';
import { useToast } from '../Toast';

/**
 * Full-width, dismissible banner that warns a clocked-in worker when offline
 * clock punches are still queued — or, worse, stuck at the retry cap so the
 * shift never closed server-side. Includes a manual "Sync now" button that
 * drains the queue via the same path as the automatic background sync.
 *
 * Placed somewhere always-visible (Dashboard header area, Clock In screen) so a
 * stuck punch can't go unnoticed on the shop floor.
 */
export function OfflinePunchBanner() {
  const { pendingOfflinePunchCount, staleOfflinePunch, syncOfflinePunchesNow } = useApp();
  const { showToast } = useToast();
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [dismissedSeverity, setDismissedSeverity] = useState<'stale' | 'pending' | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    const setOnline = () => setIsOnline(true);
    const setOffline = () => setIsOnline(false);
    window.addEventListener('online', setOnline);
    window.addEventListener('offline', setOffline);
    return () => {
      window.removeEventListener('online', setOnline);
      window.removeEventListener('offline', setOffline);
    };
  }, []);

  const warning = getOfflinePunchWarning({
    pendingCount: pendingOfflinePunchCount,
    staleOfflinePunch,
    isOnline,
  });

  // Re-show the banner whenever the queue fully drains and later refills, or
  // when a soft "pending" warning escalates to "stale" — dismissing the gentle
  // version must never bury a punch that has since hit the retry cap.
  const prevSeverity = useRef<'stale' | 'pending' | null>(null);
  useEffect(() => {
    const severity = warning?.severity ?? null;
    if (severity !== prevSeverity.current) {
      if (severity === null || severity !== dismissedSeverity) {
        setDismissedSeverity(null);
      }
      prevSeverity.current = severity;
    }
  }, [warning?.severity, dismissedSeverity]);

  if (!warning || warning.severity === dismissedSeverity) return null;

  const isStale = warning.severity === 'stale';
  const count = warning.pendingCount;
  const punchWord = `punch${count === 1 ? '' : 'es'}`;

  const message = isStale
    ? `${count} offline clock ${punchWord} could not sync after repeated tries. Your shift may not have closed — sync now or tell an admin to check Time Reports.`
    : warning.isOffline
      ? `${count} clock ${punchWord} saved offline. They will sync automatically once you are back online.`
      : `${count} clock ${punchWord} waiting to sync.`;

  const handleSyncNow = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const synced = await syncOfflinePunchesNow();
      if (synced === 0) {
        showToast(
          warning.isOffline
            ? 'Still offline — punches will sync when you reconnect'
            : 'Could not sync yet — will keep retrying',
          'warning'
        );
      }
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div
      role="alert"
      className={`flex items-start gap-2 border-b px-4 py-2.5 text-sm ${
        isStale
          ? 'border-red-500/40 bg-red-500/15 text-red-200'
          : 'border-amber-500/40 bg-amber-500/15 text-amber-100'
      }`}
    >
      <span
        aria-hidden="true"
        className={`material-symbols-outlined mt-0.5 text-base ${
          isStale ? 'text-red-400' : 'text-amber-400'
        }`}
      >
        {isStale ? 'error' : warning.isOffline ? 'cloud_off' : 'sync'}
      </span>
      <p className="min-w-0 flex-1 leading-snug">{message}</p>
      <div className="flex shrink-0 items-center gap-1">
        {!warning.isOffline && (
          <button
            type="button"
            onClick={handleSyncNow}
            disabled={isSyncing}
            className={`flex min-h-8 touch-manipulation items-center gap-1 rounded-sm px-2.5 py-1 text-xs font-bold transition-colors disabled:opacity-60 ${
              isStale
                ? 'bg-red-500/30 text-red-100 hover:bg-red-500/40'
                : 'bg-amber-500/30 text-amber-50 hover:bg-amber-500/40'
            }`}
          >
            <span aria-hidden="true" className="material-symbols-outlined text-sm">
              {isSyncing ? 'progress_activity' : 'sync'}
            </span>
            {isSyncing ? 'Syncing…' : 'Sync now'}
          </button>
        )}
        <button
          type="button"
          onClick={() => setDismissedSeverity(warning.severity)}
          aria-label="Dismiss"
          className="flex size-8 touch-manipulation items-center justify-center rounded-sm text-current opacity-70 transition-opacity hover:opacity-100"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-base">
            close
          </span>
        </button>
      </div>
    </div>
  );
}

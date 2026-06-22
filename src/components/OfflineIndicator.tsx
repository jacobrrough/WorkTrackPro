import { useApp } from '../AppContext';
import { useState, useEffect } from 'react';

/**
 * Small badge for the header/navbar: shows when offline or when there are pending
 * writes to sync — clock punches OR generalized queued actions (jobs, inventory,
 * board moves, deliveries, comments).
 */
export function OfflineIndicator() {
  const { pendingOfflinePunchCount, staleOfflinePunch, pendingActionCount, staleOfflineAction } =
    useApp();
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

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

  const isOffline = !isOnline;
  const pendingTotal = pendingOfflinePunchCount + pendingActionCount;
  const hasPending = pendingTotal > 0;
  const isStale = staleOfflinePunch || staleOfflineAction;

  if (!isOffline && !hasPending) return null;

  const title = isStale
    ? 'Some changes could not sync after repeated tries. Check your connection or ask an admin.'
    : isOffline
      ? 'You are offline. Changes will sync when connected.'
      : `${pendingTotal} change(s) waiting to sync`;

  return (
    <div
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
        isStale
          ? 'border-red-500/50 bg-red-500/20 text-red-400'
          : 'border-amber-500/50 bg-amber-500/20 text-amber-400'
      }`}
      title={title}
    >
      <span className="material-symbols-outlined text-sm">
        {isOffline ? 'cloud_off' : isStale ? 'error' : 'sync'}
      </span>
      {isOffline ? (
        <span>Offline</span>
      ) : isStale ? (
        <span>Sync issue</span>
      ) : (
        <span>{pendingTotal} pending</span>
      )}
    </div>
  );
}

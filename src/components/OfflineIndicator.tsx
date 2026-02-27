import { useApp } from '../AppContext';
import { useState, useEffect } from 'react';

/**
 * Small badge for the header/navbar: shows when offline or when there are pending clock punches to sync.
 */
export function OfflineIndicator() {
  const { pendingOfflinePunchCount } = useApp();
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
  const hasPending = pendingOfflinePunchCount > 0;

  if (!isOffline && !hasPending) return null;

  return (
    <div
      className="flex items-center gap-1.5 rounded-full border border-amber-500/50 bg-amber-500/20 px-2.5 py-1 text-xs font-medium text-amber-400"
      title={
        isOffline
          ? 'You are offline. Clock punches will sync when connected.'
          : `${pendingOfflinePunchCount} punch(es) waiting to sync`
      }
    >
      <span className="material-symbols-outlined text-sm">
        {isOffline ? 'cloud_off' : 'sync'}
      </span>
      {isOffline ? (
        <span>Offline</span>
      ) : (
        <span>{pendingOfflinePunchCount} pending</span>
      )}
    </div>
  );
}

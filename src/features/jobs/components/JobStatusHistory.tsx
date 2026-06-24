import { useJobStatusHistory } from '@/hooks/useJobStatusHistory';
import { StatusBadge } from '@/components/ui/StatusBadge';
import type { JobStatus } from '@/core/types';

interface JobStatusHistoryProps {
  jobId: string;
  isAdmin: boolean;
}

function formatRelativeTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(diff / 86400000);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

export default function JobStatusHistory({ jobId, isAdmin }: JobStatusHistoryProps) {
  // Pass undefined when not admin so the query stays disabled — avoids a
  // network request for data RLS will block anyway (defense-in-depth).
  const { data: entries = [], isLoading } = useJobStatusHistory(isAdmin ? jobId : undefined);

  if (!isAdmin) return null;

  return (
    <div className="p-3 pt-0">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
        <span className="material-symbols-outlined text-lg text-primary">history</span>
        Status History ({entries.length})
      </h3>

      {isLoading ? (
        <div className="rounded-sm bg-surface-2 p-3 text-center text-sm text-muted">Loading...</div>
      ) : entries.length === 0 ? (
        <div className="rounded-sm bg-surface-2 p-3 text-center text-sm text-muted">
          No status changes recorded yet
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <div key={entry.id} className="rounded-sm bg-surface-2 p-3">
              <div className="flex items-start gap-2">
                <div className="flex size-8 flex-shrink-0 items-center justify-center rounded-sm bg-primary text-xs font-bold text-on-accent">
                  {entry.userInitials || '??'}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1 text-sm">
                    <span className="font-bold text-white">{entry.userName || 'Unknown'}</span>
                    <span className="text-muted">moved from</span>
                    <StatusBadge status={entry.previousStatus as JobStatus} size="sm" />
                    <span className="text-muted">to</span>
                    <StatusBadge status={entry.newStatus as JobStatus} size="sm" />
                  </div>
                  <p className="mt-1 text-xs text-subtle">{formatRelativeTime(entry.createdAt)}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

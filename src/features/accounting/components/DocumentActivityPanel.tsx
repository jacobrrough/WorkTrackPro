import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import type { DocumentTimelineEvent } from '@/services/api/accounting';
import { useDocumentSnapshots, useDocumentTimeline } from '../hooks/useAccountingQueries';
import { useRestoreDocumentSnapshot } from '../hooks/useAccountingMutations';

/** "…T12:34:56+00" → "YYYY-MM-DD HH:MM". */
function formatStamp(iso: string): string {
  return iso.length >= 16 ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso;
}

/** Material icon per event kind. */
const KIND_ICON: Record<string, string> = {
  created: 'add_circle',
  edited: 'edit',
  status: 'flag',
  version: 'history',
  email: 'mail',
  payment: 'payments',
  deleted: 'delete',
};

/** Accent color per event kind (dark theme). */
const KIND_COLOR: Record<string, string> = {
  created: 'text-sky-300',
  edited: 'text-amber-300',
  status: 'text-violet-300',
  version: 'text-muted',
  email: 'text-green-300',
  payment: 'text-green-300',
  deleted: 'text-red-300',
};

/**
 * QuickBooks-style audit history for one invoice/estimate/bill: a single, time-ordered timeline
 * assembled server-side from the audit log + version snapshots + email log + payments (newest
 * first). For a DRAFT invoice/estimate it also exposes the captured restore points (the RPC keeps
 * restore draft-only). Collapsed-aware; renders nothing until there is something to show.
 */
export function DocumentActivityPanel({
  documentType,
  documentId,
  status,
}: {
  documentType: 'invoice' | 'estimate' | 'bill';
  documentId: string;
  status: string;
}) {
  const { data: events = [] } = useDocumentTimeline(documentType, documentId);
  // Restore points only exist for invoices/estimates; pass undefined for a bill to disable the query.
  const snapshotType = documentType === 'bill' ? 'invoice' : documentType;
  const { data: snapshots = [] } = useDocumentSnapshots(
    snapshotType,
    documentType === 'bill' ? undefined : documentId
  );
  const restore = useRestoreDocumentSnapshot();
  const [error, setError] = useState<string | null>(null);
  const isDraft = status === 'draft';
  const canRestore = isDraft && documentType !== 'bill' && snapshots.length > 0;

  if (events.length === 0 && !canRestore) return null;

  const onRestore = async (snapshotId: string) => {
    setError(null);
    if (
      !window.confirm(
        'Restore this version? The current draft will be replaced. (The restore is itself undoable.)'
      )
    ) {
      return;
    }
    const res = await restore.mutateAsync({
      snapshotId,
      documentType: snapshotType,
      documentId,
    });
    if (!res.ok) setError(res.error ?? 'Could not restore this version.');
  };

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-bold uppercase tracking-wide text-muted">Audit history</h2>

      {events.length > 0 && (
        <ol className="flex flex-col gap-0 overflow-hidden rounded-sm border border-white/10">
          {events.map((ev: DocumentTimelineEvent, i) => (
            <li
              key={`${ev.at}-${i}`}
              className="flex items-start gap-3 border-b border-white/5 px-3 py-2 last:border-b-0"
            >
              <span
                className={`material-symbols-outlined mt-0.5 text-lg ${KIND_COLOR[ev.kind] ?? 'text-muted'}`}
              >
                {KIND_ICON[ev.kind] ?? 'circle'}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-white">{ev.title}</p>
                {ev.detail && <p className="truncate text-xs text-muted">{ev.detail}</p>}
              </div>
              <div className="shrink-0 text-right">
                <p className="font-mono text-xs text-muted">{formatStamp(ev.at)}</p>
                {ev.actor && <p className="truncate text-xs text-subtle">{ev.actor}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}

      {error && (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      )}

      {canRestore && (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wide text-subtle">
            Restore a version
          </h3>
          <div className="divide-y divide-white/5 overflow-hidden rounded-sm border border-white/10">
            {snapshots.map((s) => (
              <div key={s.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="w-36 shrink-0 font-mono text-xs text-muted">
                  {formatStamp(s.createdAt)}
                </span>
                <span className="flex-1 truncate text-muted">{s.note ?? 'Saved version'}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  icon="restore"
                  onClick={() => onRestore(s.id)}
                  disabled={restore.isPending}
                >
                  Restore
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

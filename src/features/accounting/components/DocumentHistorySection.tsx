import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useDocumentSnapshots } from '../hooks/useAccountingQueries';
import { useRestoreDocumentSnapshot } from '../hooks/useAccountingMutations';

/** "YYYY-MM-DDTHH:MM:SS…+00" → "YYYY-MM-DD HH:MM". */
function formatStamp(iso: string): string {
  return iso.length >= 16 ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso;
}

/**
 * Version history for an invoice/estimate: the captured restore points (each draft save snapshots
 * the prior state) with a Restore action. Restore is enabled only while the document is a draft —
 * the RPC enforces the same, and a posted document is corrected with void & reissue instead.
 * Collapsed by default and renders nothing until at least one snapshot exists.
 */
export function DocumentHistorySection({
  documentType,
  documentId,
  status,
}: {
  documentType: 'invoice' | 'estimate';
  documentId: string;
  status: string;
}) {
  const { data: snapshots = [] } = useDocumentSnapshots(documentType, documentId);
  const restore = useRestoreDocumentSnapshot();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isDraft = status === 'draft';

  if (snapshots.length === 0) return null;

  const onRestore = async (snapshotId: string) => {
    setError(null);
    if (
      !window.confirm(
        'Restore this version? The current draft will be replaced. (The restore is itself undoable.)'
      )
    ) {
      return;
    }
    const res = await restore.mutateAsync({ snapshotId, documentType, documentId });
    if (!res.ok) setError(res.error ?? 'Could not restore this version.');
  };

  return (
    <section className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 self-start text-sm font-bold uppercase tracking-wide text-slate-400 hover:text-white"
      >
        <span className="material-symbols-outlined text-base">
          {open ? 'expand_more' : 'chevron_right'}
        </span>
        Version history ({snapshots.length})
      </button>
      {open && (
        <>
          {!isDraft && (
            <p className="text-xs text-slate-500">
              Restore is available while the document is a draft. Use void &amp; reissue to correct
              a sent document.
            </p>
          )}
          {error && (
            <p className="text-sm text-red-400" role="alert">
              {error}
            </p>
          )}
          <div className="divide-y divide-white/5 overflow-hidden rounded-sm border border-white/10">
            {snapshots.map((s) => (
              <div key={s.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="w-36 shrink-0 font-mono text-xs text-slate-400">
                  {formatStamp(s.createdAt)}
                </span>
                <span className="flex-1 truncate text-slate-300">{s.note ?? 'Saved version'}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  icon="restore"
                  onClick={() => onRestore(s.id)}
                  disabled={!isDraft || restore.isPending}
                >
                  Restore
                </Button>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

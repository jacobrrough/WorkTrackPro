import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import type { DocumentTimelineEvent } from '@/services/api/accounting';
import { useDocumentTimeline, useDocumentVersions } from '../hooks/useAccountingQueries';
import { useRestoreDocumentSnapshot } from '../hooks/useAccountingMutations';
import { buildVersionChanges, type FieldChange, type VersionChange } from './versionDiff';

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

/** One before→after value, highlighted like a tracked change (old struck red, new green). */
function ChangeBits({ change }: { change: FieldChange }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {change.before != null && <span className="text-red-300 line-through">{change.before}</span>}
      {change.before != null && change.after != null && <span className="text-muted">→</span>}
      {change.after != null && <span className="text-green-300">{change.after}</span>}
      {change.before != null && change.after == null && (
        <span className="text-xs text-muted">(removed)</span>
      )}
    </span>
  );
}

/**
 * One version in the change feed: a collapsed summary row (count + who + when) that expands inline
 * to reveal the highlighted field/line diff vs. the previous version. No navigation — Google-Docs
 * style. A draft's captured versions also offer Restore.
 */
function VersionRow({
  change,
  canRestore,
  restoring,
  onRestore,
}: {
  change: VersionChange;
  canRestore: boolean;
  restoring: boolean;
  onRestore: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  // This row can be restored only on a draft, and only when it has a captured state to return to
  // (the latest row's "after" is the live document — nothing to restore).
  const canRestoreThis = canRestore && change.restoreId != null;
  // A no-tracked-change save still expands so its Restore stays reachable; otherwise only rows with
  // something to show are expandable.
  const expandable = change.totalChanges > 0 || canRestoreThis;
  const title = change.isLatest ? 'Latest version' : 'Saved version';
  const summary =
    change.totalChanges === 0
      ? 'No tracked changes'
      : `${change.totalChanges} change${change.totalChanges === 1 ? '' : 's'}`;

  return (
    <li className="border-b border-line/60 last:border-b-0">
      <button
        type="button"
        onClick={() => expandable && setOpen((v) => !v)}
        className={`flex w-full items-start gap-3 px-3 py-2 text-left ${expandable ? 'hover:bg-overlay/5' : 'cursor-default'}`}
        aria-expanded={expandable ? open : undefined}
      >
        <span className="material-symbols-outlined mt-0.5 text-lg text-muted">
          {expandable ? (open ? 'expand_more' : 'chevron_right') : 'history'}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-white">
            {title}
            {change.note && <span className="text-muted"> · {change.note}</span>}
          </p>
          <p className="truncate text-xs text-muted">{summary}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono text-xs text-muted">{formatStamp(change.at)}</p>
          {change.actor && <p className="truncate text-xs text-subtle">{change.actor}</p>}
        </div>
      </button>

      {open && expandable && (
        <div className="flex flex-col gap-2 border-t border-line/60 bg-black/20 px-3 py-2 pl-10 text-sm">
          {change.totalChanges === 0 && (
            <p className="text-xs text-muted">No tracked field changes in this version.</p>
          )}

          {change.headerChanges.map((c, i) => (
            <div key={`h-${i}`} className="flex flex-wrap items-center gap-1">
              <span className="text-subtle">{c.label}:</span>
              <ChangeBits change={c} />
            </div>
          ))}

          {change.lineChanges.map((lc, i) => {
            if (lc.kind === 'added') {
              return (
                <div key={`l-${i}`} className="text-green-300">
                  + {lc.label}
                </div>
              );
            }
            if (lc.kind === 'removed') {
              return (
                <div key={`l-${i}`} className="text-red-300 line-through">
                  − {lc.label}
                </div>
              );
            }
            return (
              <div key={`l-${i}`} className="flex flex-col gap-0.5">
                <span className="text-white">{lc.label}</span>
                {lc.fields.map((f, j) => (
                  <div key={`lf-${j}`} className="flex flex-wrap items-center gap-1 pl-3">
                    <span className="text-subtle">{f.label}:</span>
                    <ChangeBits change={f} />
                  </div>
                ))}
              </div>
            );
          })}

          {canRestoreThis && change.restoreId && (
            <div className="pt-1">
              <Button
                size="sm"
                variant="secondary"
                icon="restore"
                onClick={() => onRestore(change.restoreId as string)}
                disabled={restoring}
              >
                Restore this version
              </Button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * QuickBooks-style audit history for one invoice/estimate/bill: a single, time-ordered timeline
 * (audit log + version snapshots + email log + payments, newest first) plus a Google-Docs-style
 * Version history — each version expands inline to show its highlighted field/line changes vs. the
 * previous version, with who + when, and Restore on a draft's captured versions. All inline; no
 * navigation. Bills have no snapshots, so they show the timeline only. Renders nothing until there
 * is something to show.
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
  const { data: versions = [] } = useDocumentVersions(documentType, documentId);
  const restore = useRestoreDocumentSnapshot();
  const [error, setError] = useState<string | null>(null);
  const isDraft = status === 'draft';

  const changes = documentType === 'bill' ? [] : buildVersionChanges(versions, documentType);
  // One change row per edit (adjacent snapshot pair); show the section once there's any edit.
  const hasVersionHistory = changes.length > 0;

  if (events.length === 0 && !hasVersionHistory) return null;

  const snapshotType = documentType === 'bill' ? 'invoice' : documentType;
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
        <ol className="flex flex-col gap-0 overflow-hidden rounded-lg border border-line">
          {events.map((ev: DocumentTimelineEvent, i) => (
            <li
              key={`${ev.at}-${i}`}
              className="flex items-start gap-3 border-b border-line/60 px-3 py-2 last:border-b-0"
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

      {hasVersionHistory && (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wide text-subtle">Version history</h3>
          <ol className="flex flex-col gap-0 overflow-hidden rounded-lg border border-line">
            {changes.map((c, i) => (
              <VersionRow
                key={c.id ?? `current-${i}`}
                change={c}
                canRestore={isDraft && documentType !== 'bill'}
                restoring={restore.isPending}
                onRestore={onRestore}
              />
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

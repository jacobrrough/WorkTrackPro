import { useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { attachmentsService } from '@/services/api/accounting';
import { useEntityAttachments } from '../hooks/useAccountingQueries';
import { useDeleteAttachment, useUploadAttachment } from '../hooks/useAccountingMutations';
import type { Attachment, AttachmentEntityType } from '../types';

/** Accepted upload types (PDF + common images) and the per-file size cap. */
const ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp';
const MAX_BYTES = 10 * 1024 * 1024;

/** Human-readable file size for the row label (KB up to 1 MB, then MB). */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

interface AttachmentsSectionProps {
  entityType: AttachmentEntityType;
  /**
   * The host entity's id. When undefined (a draft not yet saved) the section renders the
   * heading + a muted hint — files can only be attached once the entity has an id.
   */
  entityId: string | undefined;
}

/**
 * Additive document-attachments section for one accounting entity (invoice/bill/
 * journal_entry/…). Zero-footprint by design: it owns its OWN data (this entity's
 * attachments) via useEntityAttachments and persists via useUploadAttachment /
 * useDeleteAttachment, so it can be dropped onto an existing detail screen WITHOUT
 * touching that screen's form or save path. Attaching a document is pure file metadata —
 * it moves NO money and posts NO journal entry, so the CPA/EA disclaimer is N/A here.
 *
 * Unlike the custom-fields section, this always renders a visible empty state ("No
 * attachments yet.") so the upload control is reachable even before the first file.
 */
export function AttachmentsSection({ entityType, entityId }: AttachmentsSectionProps) {
  const { data: attachments = [], isPending, isError } = useEntityAttachments(entityType, entityId);
  const upload = useUploadAttachment();
  const del = useDeleteAttachment();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Draft (no entity id yet): files can't be filed until the entity is saved. ──
  if (!entityId) {
    return (
      <section className="flex flex-col gap-2">
        <SectionHeading />
        <p className="text-xs text-subtle">Save first to add attachments.</p>
      </section>
    );
  }

  const onPick = async (file: File) => {
    setError(null);
    if (file.size > MAX_BYTES) {
      setError('This file is larger than 10 MB.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    try {
      const res = await upload.mutateAsync({ entityType, entityId, file });
      if (res.error) setError(res.error);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const onView = async (att: Attachment) => {
    setError(null);
    const url = await attachmentsService.getSignedUrl(att);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
    else setError('Could not open this file.');
  };

  const onDelete = async (att: Attachment) => {
    if (!window.confirm(`Delete ${att.filename}?`)) return;
    setError(null);
    const res = await del.mutateAsync(att.id);
    if (!res.ok) setError(res.error ?? 'Could not delete this file.');
  };

  return (
    <section className="flex flex-col gap-3">
      <SectionHeading />

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onPick(file);
        }}
      />

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-subtle">PDF or image, up to 10 MB.</p>
        <Button
          size="sm"
          variant="secondary"
          icon="upload_file"
          onClick={() => fileInputRef.current?.click()}
          disabled={upload.isPending}
        >
          {upload.isPending ? 'Uploading…' : 'Add file'}
        </Button>
      </div>

      {error && (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      )}

      {isPending ? (
        <p className="text-sm text-subtle">Loading attachments…</p>
      ) : isError ? (
        <p className="text-sm text-red-400">Could not load attachments.</p>
      ) : attachments.length === 0 ? (
        <p className="text-sm text-subtle">No attachments yet.</p>
      ) : (
        <ul className="divide-y divide-white/5 overflow-hidden rounded-lg border border-line">
          {attachments.map((att) => (
            <li key={att.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="material-symbols-outlined text-lg text-muted">description</span>
              <span className="flex-1 truncate text-white">{att.filename}</span>
              <span className="shrink-0 text-xs text-subtle">{formatBytes(att.byteSize)}</span>
              <button
                type="button"
                onClick={() => void onView(att)}
                className="shrink-0 text-sm font-semibold text-primary hover:text-primary-hover"
              >
                View
              </button>
              <button
                type="button"
                onClick={() => void onDelete(att)}
                disabled={del.isPending}
                aria-label={`Delete ${att.filename}`}
                className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-white/10 hover:text-red-400 disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-lg">delete</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Shared section heading matching the custom-fields / payments section style. */
function SectionHeading() {
  return (
    <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted">
      <span className="material-symbols-outlined text-lg text-primary">attach_file</span>
      Attachments
    </h2>
  );
}

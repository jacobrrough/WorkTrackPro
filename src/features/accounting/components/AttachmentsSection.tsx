/**
 * ⚠️  HELD / UNVERIFIED — NOT FOR FILING. Document-management (attachments) control for an
 *     accounting entity. The whole module is FLAG-DARK and requires CPA and/or security
 *     sign-off before it is enabled; this control and its preview BOTH render the
 *     UnverifiedBanner and disclose that files are stored UNENCRYPTED (encryption-at-rest is
 *     DEFERRED to the Phase E security module). NOTHING here moves money or posts a journal
 *     entry — uploading/removing only touches the existing storage bucket + the additive
 *     accounting.attachments metadata table.
 *
 * Self-contained, zero-footprint section (mirrors CustomFieldsSection): it owns its OWN data
 * (this entity's attachment list via useAccountingAttachments) and its OWN mutations
 * (useUploadAttachment / useDeleteAttachment), so it can be dropped onto any entity detail
 * screen WITHOUT changing that screen's form or save path. Mount it with the entity's
 * (entityType, entityId); it renders nothing until the entity has an id (a draft has nothing
 * to attach to).
 *
 * Upload: a hidden <input type="file"> constrained to ATTACHMENT_ACCEPT_ATTR (images + PDF),
 * each chosen file run through the SAME client guard the service uses (validateAttachmentFile —
 * size cap + MIME allow-list) before the upload mutation fires.
 *
 * Preview: images render inline and PDFs embed in an <iframe>, via a SIGNED URL
 * (attachmentsService.getSignedUrl — PREFERRED for confidential docs; works whether or not the
 * bucket is public and expires) with a fallback to the public URL (getPreviewUrl) if signing
 * fails. The preview dialog ALSO carries the UnverifiedBanner.
 */
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { attachmentsService, validateAttachmentFile } from '@/services/api/accounting';
import { UnverifiedBanner } from './UnverifiedBanner';
import {
  fileKindIcon,
  formatBytes,
  isImage,
  isPdf,
  maxSizeLabel,
  previewKindFor,
} from './attachmentFormat';
import { useAccountingAttachments } from '../hooks/useAccountingQueries';
import { useDeleteAttachment, useUploadAttachment } from '../hooks/useAccountingMutations';
import {
  ATTACHMENT_ACCEPT_ATTR,
  type AccountingAttachment,
  type AttachmentEntityType,
} from '../types';

interface AttachmentsSectionProps {
  entityType: AttachmentEntityType;
  /**
   * The host entity's id. When undefined (a draft not yet saved) the section renders nothing —
   * there is nothing to attach a file to until the entity exists.
   */
  entityId: string | undefined;
  /** Heading shown above the list (defaults to "Attachments"). */
  title?: string;
}

/** Shared section heading matching the custom-fields / payments section style. */
function SectionHeading({ title }: { title: string }) {
  return (
    <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-400">
      <span className="material-symbols-outlined text-lg text-primary">attach_file</span>
      {title}
    </h2>
  );
}

/**
 * The inline preview overlay. Resolves a SIGNED url for the attachment (preferred for
 * confidential docs) on open, falling back to the public url if signing fails. Images render
 * in an <img>, PDFs in an <iframe>; anything else offers a download link. The UnverifiedBanner
 * is mounted here too (the held-module override requires it on the preview surface).
 */
function AttachmentPreviewModal({
  attachment,
  onClose,
}: {
  attachment: AccountingAttachment;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const kind = previewKindFor(attachment.contentType);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setUrl(null);
    // Prefer a time-limited signed URL; fall back to the public URL of the same object so the
    // preview still works while the bucket is public. Either way the bytes are UNENCRYPTED
    // (Phase E hardens this).
    attachmentsService
      .getSignedUrl(attachment.id)
      .then((signed) => {
        if (cancelled) return;
        const resolved = signed ?? attachmentsService.getPreviewUrl(attachment.storagePath);
        setUrl(resolved);
        setStatus(resolved ? 'ready' : 'error');
      })
      .catch(() => {
        if (cancelled) return;
        // Last-ditch fallback to the public URL (no row lookup needed — we hold the path).
        const pub = attachmentsService.getPreviewUrl(attachment.storagePath);
        setUrl(pub);
        setStatus(pub ? 'ready' : 'error');
      });
    return () => {
      cancelled = true;
    };
  }, [attachment.id, attachment.storagePath]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${attachment.filename}`}
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-sm border border-white/10 bg-card-dark shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
          <h3
            className="min-w-0 flex-1 truncate text-sm font-bold text-white"
            title={attachment.filename}
          >
            {attachment.filename}
          </h3>
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-sm font-semibold text-primary hover:text-primary-hover"
            >
              <span className="material-symbols-outlined text-lg">open_in_new</span>
              Open
            </a>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="flex size-8 items-center justify-center rounded-sm text-slate-400 hover:bg-white/10 hover:text-white"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Held-module banner on the preview surface (required everywhere this module renders). */}
        <div className="px-4 pt-3">
          <UnverifiedBanner
            variant="compact"
            detail="Stored unencrypted — do not preview filing-sensitive documents."
          />
        </div>

        <div className="flex min-h-[200px] flex-1 items-center justify-center overflow-auto p-4">
          {status === 'loading' && <p className="text-sm text-slate-400">Loading preview…</p>}
          {status === 'error' && (
            <p className="text-sm text-red-400" role="alert">
              Could not load a preview for this file.
            </p>
          )}
          {status === 'ready' && url && kind === 'image' && (
            <img
              src={url}
              alt={attachment.filename}
              className="max-h-[70vh] max-w-full rounded-sm object-contain"
            />
          )}
          {status === 'ready' && url && kind === 'pdf' && (
            <iframe
              src={url}
              title={`Preview of ${attachment.filename}`}
              className="h-[70vh] w-full rounded-sm border border-white/10 bg-white"
            />
          )}
          {status === 'ready' && url && kind === 'other' && (
            <div className="flex flex-col items-center gap-3 text-center">
              <span className="material-symbols-outlined text-5xl text-slate-500">
                {fileKindIcon(attachment.contentType)}
              </span>
              <p className="text-sm text-slate-400">This file type cannot be previewed inline.</p>
              <a href={url} target="_blank" rel="noopener noreferrer">
                <Button size="sm" variant="secondary" icon="download">
                  Download
                </Button>
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** One attachment row: kind icon + filename + meta + preview/delete actions. */
function AttachmentRow({
  attachment,
  onPreview,
  onDelete,
  deleting,
}: {
  attachment: AccountingAttachment;
  onPreview: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const canPreview = isImage(attachment.contentType) || isPdf(attachment.contentType);
  const created = attachment.createdAt ? attachment.createdAt.slice(0, 10) : '';

  return (
    <div className="flex items-center gap-3 px-3 py-2 text-sm">
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-primary/15 text-primary"
        aria-hidden="true"
      >
        <span className="material-symbols-outlined text-lg">
          {fileKindIcon(attachment.contentType)}
        </span>
      </span>

      {canPreview ? (
        <button
          type="button"
          onClick={onPreview}
          className="min-w-0 flex-1 truncate text-left font-semibold text-white hover:text-primary"
          title={attachment.filename}
        >
          {attachment.filename}
        </button>
      ) : (
        <span
          className="min-w-0 flex-1 truncate font-semibold text-white"
          title={attachment.filename}
        >
          {attachment.filename}
        </span>
      )}

      <span className="hidden shrink-0 font-mono tabular-nums text-slate-500 sm:block">
        {formatBytes(attachment.sizeBytes)}
      </span>
      {created && (
        <span className="hidden w-24 shrink-0 text-right text-slate-500 md:block">{created}</span>
      )}

      {canPreview && (
        <button
          type="button"
          onClick={onPreview}
          aria-label={`Preview ${attachment.filename}`}
          className="flex size-8 items-center justify-center rounded-sm text-slate-400 hover:bg-white/10 hover:text-white"
        >
          <span className="material-symbols-outlined text-lg">visibility</span>
        </button>
      )}
      <button
        type="button"
        onClick={onDelete}
        disabled={deleting}
        aria-label={`Delete ${attachment.filename}`}
        className="flex size-8 items-center justify-center rounded-sm text-slate-400 hover:bg-red-500/15 hover:text-red-400 disabled:opacity-50"
      >
        <span className="material-symbols-outlined text-lg">delete</span>
      </button>
    </div>
  );
}

/**
 * Attachments control for one accounting entity (invoice / bill / payment / vendor_payment /
 * journal_entry / fixed_asset). Lists existing files, uploads new ones (images + PDF), previews
 * images/PDFs inline, and deletes. Always renders the UnverifiedBanner (held-module override)
 * and discloses that files are stored unencrypted.
 */
export function AttachmentsSection({
  entityType,
  entityId,
  title = 'Attachments',
}: AttachmentsSectionProps) {
  const {
    data: attachments = [],
    isPending,
    isError,
  } = useAccountingAttachments(entityType, entityId);
  const uploadAttachment = useUploadAttachment();
  const deleteAttachment = useDeleteAttachment();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<AccountingAttachment | null>(null);
  // Track the id currently being deleted so only that row's button shows the disabled state.
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // A draft with no id yet cannot own attachments — render nothing (zero footprint), matching
  // CustomFieldsSection's draft behaviour.
  if (!entityId) return null;

  const onPick = () => {
    setUploadError(null);
    fileInputRef.current?.click();
  };

  const onFilesChosen = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadError(null);

    // Upload each chosen file in sequence (small batches; keeps error attribution simple). The
    // SAME client guard the service applies runs here first so a bad file never starts a write.
    const errors: string[] = [];
    for (const file of Array.from(files)) {
      const valid = validateAttachmentFile(file);
      if (!valid.ok) {
        errors.push(`${file.name}: ${valid.error ?? 'rejected'}`);
        continue;
      }
      const res = await uploadAttachment.mutateAsync({ entityType, entityId, file });
      if (res.error || !res.attachment) {
        errors.push(`${file.name}: ${res.error ?? 'upload failed'}`);
      }
    }
    if (errors.length > 0) setUploadError(errors.join(' · '));

    // Reset the input so re-choosing the same file fires onChange again.
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const onDelete = async (attachment: AccountingAttachment) => {
    if (!window.confirm(`Delete "${attachment.filename}"? This cannot be undone.`)) return;
    setUploadError(null);
    setDeletingId(attachment.id);
    try {
      const res = await deleteAttachment.mutateAsync({ id: attachment.id, entityType, entityId });
      if (!res.ok) setUploadError(res.error ?? 'Could not delete the attachment.');
      // If the deleted file was open in the preview, close it.
      if (previewing?.id === attachment.id) setPreviewing(null);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <SectionHeading title={title} />

      {/* Held-module banner on the control itself (required everywhere this module renders),
          with the encryption-at-rest disclosure. */}
      <UnverifiedBanner
        variant="compact"
        detail="Files are stored unencrypted; encryption-at-rest is deferred to the security phase."
      />

      {/* Hidden picker constrained to the v1 accept-list (images + PDF). */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ATTACHMENT_ACCEPT_ATTR}
        multiple
        className="hidden"
        onChange={(e) => void onFilesChosen(e.target.files)}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          variant="secondary"
          icon="upload_file"
          onClick={onPick}
          disabled={uploadAttachment.isPending}
        >
          {uploadAttachment.isPending ? 'Uploading…' : 'Attach file'}
        </Button>
        <span className="text-xs text-slate-500">Images or PDF, up to {maxSizeLabel()} each.</span>
      </div>

      {uploadError && (
        <p className="text-sm text-red-400" role="alert">
          {uploadError}
        </p>
      )}

      {/* List / loading / empty / error states. */}
      {isPending && <p className="text-sm text-slate-500">Loading attachments…</p>}
      {isError && (
        <p className="text-sm text-red-400" role="alert">
          Could not load attachments. Confirm the accounting schema is exposed and you have a role
          that can read them.
        </p>
      )}

      {!isPending && !isError && attachments.length === 0 && (
        <div className="rounded-sm border border-dashed border-white/15 px-4 py-6 text-center text-sm text-slate-500">
          No files attached yet. Attach receipts, contracts, or supporting documents above.
        </div>
      )}

      {!isPending && !isError && attachments.length > 0 && (
        <div className="divide-y divide-white/5 overflow-hidden rounded-sm border border-white/10">
          {attachments.map((a) => (
            <AttachmentRow
              key={a.id}
              attachment={a}
              onPreview={() => setPreviewing(a)}
              onDelete={() => void onDelete(a)}
              deleting={deletingId === a.id}
            />
          ))}
        </div>
      )}

      {previewing && (
        <AttachmentPreviewModal attachment={previewing} onClose={() => setPreviewing(null)} />
      )}
    </section>
  );
}

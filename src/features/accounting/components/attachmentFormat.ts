/**
 * ⚠️  HELD / UNVERIFIED — NOT FOR FILING. Pure presentation helpers for the FLAG-DARK
 *     document-management (attachments) UI. Every surface that uses these ALSO renders the
 *     UnverifiedBanner. NO money moves and NO journal entry is posted anywhere in this module.
 *
 * Framework-free helpers for the AttachmentsSection control (size formatting + MIME → preview
 * kind + a friendly icon). They are deliberately separated from the JSX so they can be unit
 * tested without rendering. `sizeBytes` is a plain BYTE COUNT (NOT money) — there is no cents
 * rule here; it is only divided for human-readable display.
 */
import { ATTACHMENT_MAX_BYTES } from '../types';

/** How an attachment can be previewed inline, derived from its MIME type. */
export type AttachmentPreviewKind = 'image' | 'pdf' | 'other';

/**
 * Classify a content-type into the inline-preview kind the control supports. Matches the
 * v1 accept-list (images + PDF). A null / unknown type is 'other' (download-only, no inline
 * preview). Case-insensitive on the MIME so 'IMAGE/PNG' still classifies as an image.
 */
export function previewKindFor(contentType: string | null | undefined): AttachmentPreviewKind {
  if (!contentType) return 'other';
  const mime = contentType.toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  return 'other';
}

/** True when the attachment is an image we can render inline. */
export function isImage(contentType: string | null | undefined): boolean {
  return previewKindFor(contentType) === 'image';
}

/** True when the attachment is a PDF we can embed inline. */
export function isPdf(contentType: string | null | undefined): boolean {
  return previewKindFor(contentType) === 'pdf';
}

/**
 * A Material Symbols glyph name for an attachment's kind (used in the file-row icon). Images →
 * `image`, PDFs → `picture_as_pdf`, anything else → a generic `description`.
 */
export function fileKindIcon(contentType: string | null | undefined): string {
  switch (previewKindFor(contentType)) {
    case 'image':
      return 'image';
    case 'pdf':
      return 'picture_as_pdf';
    default:
      return 'description';
  }
}

/**
 * Human-readable size from a BYTE count. Null/negative/non-finite → '—' (size unknown — the
 * metadata row preserves a null size rather than coercing it to 0). Uses binary units (KiB/
 * MiB) to match the client cap (ATTACHMENT_MAX_BYTES is 10 MiB), rounding to one decimal for
 * KB and up. Bytes are shown whole. Pure; exported for tests + the file-row label.
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${roundTo1(kib)} KB`;
  const mib = kib / 1024;
  if (mib < 1024) return `${roundTo1(mib)} MB`;
  const gib = mib / 1024;
  return `${roundTo1(gib)} GB`;
}

/** Round to at most one decimal place, dropping a trailing `.0` (e.g. 2.0 → "2", 2.5 → "2.5"). */
function roundTo1(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/**
 * The human-facing max-upload-size string for the picker hint (e.g. "10 MB"), derived from the
 * single ATTACHMENT_MAX_BYTES constant so the UI copy can never drift from the validator.
 */
export function maxSizeLabel(): string {
  return formatBytes(ATTACHMENT_MAX_BYTES);
}

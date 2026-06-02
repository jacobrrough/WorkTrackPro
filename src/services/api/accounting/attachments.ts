/**
 * ⚠️  HELD / UNVERIFIED — NOT FOR FILING. Document management (attachments) for accounting
 *     entities. The whole module is FLAG-DARK and requires CPA and/or security sign-off
 *     before it is enabled; every UI surface + preview renders the UnverifiedBanner. NOTHING
 *     here moves money or posts a journal entry (G3 is vacuous — there is no posting path).
 *
 * Attach receipts / contracts / supporting files to an accounting entity (invoice, bill,
 * payment, vendor_payment, journal_entry, fixed_asset), list them, preview them, and delete
 * them. Two stores are touched, both EXISTING infrastructure reused per the held-module scope
 * (we invent NO new bucket and NO new table):
 *   1. STORAGE — the object bytes live in the EXISTING `attachments` storage bucket (the same
 *      bucket parts/jobs/inventory use; see src/services/api/storage.ts) under a new
 *      `accounting/<entity_type>/<entity_id>/<uuid>.<ext>` path prefix. Storage lives on the
 *      base supabase client (supabase.storage), NOT the accounting-schema client.
 *   2. METADATA — one row per object in accounting.attachments (migration 20260601000026),
 *      reached via the schema-scoped acct() client. RLS gates the metadata (can_read /
 *      can_write); the audit trigger logs every attach/remove.
 *
 * SECURITY CAVEATS (disclosed; see WHAT A HUMAN MUST VERIFY in the build report):
 *   • ENCRYPTION-AT-REST IS DEFERRED to the Phase E security module — files sit UNENCRYPTED
 *     in the bucket until then.
 *   • The existing `attachments` bucket RLS is PERMISSIVE (any authenticated user, any path)
 *     and the bucket is PUBLIC (parts product images are served via getPublicUrl). So the
 *     OBJECT bytes are only as protected as the bucket; this table's RLS gates only the
 *     METADATA. We expose getPreviewUrl() (public URL, matching the existing attachment
 *     pattern) AND getSignedUrl() (time-limited) so a future private-bucket / signed-URL
 *     posture is a drop-in; the UI should prefer the signed URL for confidential docs.
 *   • MIME/size validation here is CLIENT-SIDE ONLY (bypassable). A server-side allow-list /
 *     file-size cap / virus scan is a Phase E follow-up.
 *
 * ORPHAN CLEANUP: accounting.attachments.entity_id has NO DB foreign key (a single column
 * cannot FK to six parent tables), so when a parent entity is voided/deleted the app must
 * cascade — removeForEntity() deletes both the storage objects and the metadata rows for an
 * entity. A DB-level safety net (trigger / nightly sweep) is a documented follow-up.
 *
 * CONVENTION (matches the rest of the accounting services): reads THROW (React Query surfaces
 * them); writes RETURN a result object carrying the DB/storage error so the UI can show it
 * inline. The pure helpers (buildStoragePath / validateAttachmentFile / extensionFor) are
 * exported for unit tests and to keep the file-picker's client guard identical to the upload
 * guard.
 */
import type {
  AccountingAttachment,
  AttachmentEntityType,
  NewAttachmentInput,
} from '../../../features/accounting/types';
import {
  ATTACHMENT_ACCEPTED_MIME_TYPES,
  ATTACHMENT_MAX_BYTES,
} from '../../../features/accounting/types';
import { supabase } from '../supabaseClient';
import { acct } from './accountingClient';
import { mapAccountingAttachmentRow, type Row } from './mappers';

/**
 * The EXISTING storage bucket the whole app already uses for attachments (parts/jobs/
 * inventory). We REUSE it (held-module scope: storage is in scope via the existing bucket) —
 * no new bucket is created. Kept as a module constant so the bucket name is referenced in
 * exactly one place and is NOT persisted per-row (the metadata row stores only the path
 * within this bucket).
 */
export const ATTACHMENTS_BUCKET = 'attachments';

/** The path prefix that namespaces ALL accounting objects within the shared bucket. */
export const ACCOUNTING_PATH_PREFIX = 'accounting';

/** Default lifetime (seconds) of a signed preview URL: 1 hour. */
export const SIGNED_URL_TTL_SECONDS = 60 * 60;

// ── Pure helpers (exported for tests + the file-picker client guard) ──────────────

/**
 * The file extension for an object, derived from the original filename (lower-cased, no dot).
 * Falls back to 'bin' when the name has no extension — matches src/services/api/storage.ts so
 * accounting objects look like every other object in the bucket.
 */
export function extensionFor(filename: string): string {
  const parts = filename.split('.');
  // No dot, or a trailing dot (e.g. "file.") → no usable extension.
  if (parts.length < 2) return 'bin';
  const ext = parts[parts.length - 1].trim().toLowerCase();
  return ext === '' ? 'bin' : ext;
}

/**
 * Build the object path WITHIN the `attachments` bucket for a new upload:
 *   accounting/<entity_type>/<entity_id>/<uuid>.<ext>
 * A fresh uuid per upload means the same file can be attached twice without collision and the
 * path is unguessable. The bucket name is NOT part of the returned path (it is supplied to
 * supabase.storage.from). `uuid` is injected so the function is pure/deterministic in tests;
 * production callers omit it to get crypto.randomUUID().
 */
export function buildStoragePath(
  entityType: AttachmentEntityType,
  entityId: string,
  filename: string,
  uuid: string = crypto.randomUUID()
): string {
  return `${ACCOUNTING_PATH_PREFIX}/${entityType}/${entityId}/${uuid}.${extensionFor(filename)}`;
}

export interface AttachmentValidation {
  ok: boolean;
  error?: string;
}

/**
 * CLIENT-SIDE validation of a candidate upload against the v1 accept-list + size cap. This is
 * a convenience guard ONLY (the permissive bucket does not enforce it; a server-side control
 * is a Phase E follow-up). An empty file, an over-cap file, or a disallowed MIME type is
 * rejected with a human message. A file whose `type` is '' (browser omitted it) is allowed
 * through on MIME (we cannot reliably sniff it client-side) but still size-checked — the row's
 * content_type will be null. Pure; exported for tests + reuse by the upload control.
 */
export function validateAttachmentFile(
  file: Pick<File, 'size' | 'type' | 'name'>
): AttachmentValidation {
  if (file.size <= 0) {
    return { ok: false, error: 'That file is empty.' };
  }
  if (file.size > ATTACHMENT_MAX_BYTES) {
    const mb = Math.round(ATTACHMENT_MAX_BYTES / (1024 * 1024));
    return { ok: false, error: `That file is larger than the ${mb} MB limit.` };
  }
  // Only enforce the MIME allow-list when the browser actually provided a type.
  if (file.type && !ATTACHMENT_ACCEPTED_MIME_TYPES.includes(file.type)) {
    return { ok: false, error: 'Only images (PNG/JPG/GIF/WebP) and PDF files are allowed.' };
  }
  return { ok: true };
}

// ── Result shapes ─────────────────────────────────────────────────────────────────

export interface UploadAttachmentResult {
  attachment: AccountingAttachment | null;
  error?: string;
}

export interface RemoveAttachmentResult {
  ok: boolean;
  error?: string;
}

export interface RemoveForEntityResult {
  ok: boolean;
  /** How many metadata rows were deleted. */
  removed: number;
  error?: string;
}

export const attachmentsService = {
  /**
   * All attachments for one entity, newest first (matches the
   * idx_acct_attachments_entity(entity_type, entity_id, created_at desc) index). This is the
   * single read the entity's detail screen uses. Throws on a read error (React Query surfaces
   * it); an entity with no attachments returns [].
   */
  async listForEntity(
    entityType: AttachmentEntityType,
    entityId: string
  ): Promise<AccountingAttachment[]> {
    const { data, error } = await acct()
      .from('attachments')
      .select('*')
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapAccountingAttachmentRow);
  },

  /** One attachment row by id (e.g. to resolve its storage path before preview). */
  async getById(id: string): Promise<AccountingAttachment | null> {
    const { data, error } = await acct().from('attachments').select('*').eq('id', id).maybeSingle();
    if (error || !data) return null;
    return mapAccountingAttachmentRow(data as Row);
  },

  /**
   * Attach a file to an entity. Two steps, ordered so a failure never leaves a dangling
   * metadata row:
   *   1. validate (client guard) → upload the object to the existing bucket (upsert:false, so
   *      a uuid-collision is an error rather than a silent overwrite);
   *   2. insert the metadata row in accounting.attachments (stamping uploaded_by from the
   *      session). If the metadata insert fails (e.g. RLS denies a non-role user), we BEST-
   *      EFFORT remove the just-uploaded object so storage does not accrue an orphan whose
   *      row never landed.
   * Returns the created AccountingAttachment, or `{ attachment: null, error }`. NO money moves;
   * NO journal entry is posted.
   */
  async upload(input: NewAttachmentInput): Promise<UploadAttachmentResult> {
    const { entityType, entityId, file } = input;

    const valid = validateAttachmentFile(file);
    if (!valid.ok) return { attachment: null, error: valid.error };

    const path = buildStoragePath(entityType, entityId, file.name);

    const { error: upErr } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .upload(path, file, { upsert: false, contentType: file.type || undefined });
    if (upErr) {
      return { attachment: null, error: upErr.message || 'Could not upload the file.' };
    }

    // Stamp the uploader from the current session (FK → public.profiles; null if unavailable).
    const { data: auth } = await supabase.auth.getUser();
    const uploadedBy = auth?.user?.id ?? null;

    const { data, error } = await acct()
      .from('attachments')
      .insert({
        entity_type: entityType,
        entity_id: entityId,
        storage_path: path,
        filename: file.name,
        content_type: file.type || null,
        size_bytes: file.size,
        uploaded_by: uploadedBy,
      })
      .select('*')
      .single();

    if (error || !data) {
      // Roll back the orphaned object (best-effort; ignore a secondary failure).
      await supabase.storage.from(ATTACHMENTS_BUCKET).remove([path]);
      return { attachment: null, error: error?.message ?? 'Could not save the attachment record.' };
    }
    return { attachment: mapAccountingAttachmentRow(data as Row) };
  },

  /**
   * A time-limited signed URL for previewing/downloading an object. PREFERRED for confidential
   * docs — it works whether or not the bucket is public and can be revoked by expiry. Resolves
   * the row's storage path first (so callers pass an attachment id, never a raw path). Returns
   * null on any failure (unknown id / storage error) so the UI can fall back to a placeholder.
   */
  async getSignedUrl(
    id: string,
    expiresIn: number = SIGNED_URL_TTL_SECONDS
  ): Promise<string | null> {
    const att = await this.getById(id);
    if (!att) return null;
    const { data, error } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .createSignedUrl(att.storagePath, expiresIn);
    if (error || !data) return null;
    return data.signedUrl;
  },

  /**
   * The public URL for an object, derived from its storage path. Matches the EXISTING
   * attachment pattern (getAttachmentPublicUrl in src/services/api/storage.ts) — valid only
   * while the `attachments` bucket is public. SECURITY: this URL is reachable by anyone who
   * knows it; the UI must use getSignedUrl for anything confidential once the bucket is made
   * private (Phase E). Pure-ish (no row lookup) — the caller already holds the path.
   */
  getPreviewUrl(storagePath: string): string {
    const { data } = supabase.storage.from(ATTACHMENTS_BUCKET).getPublicUrl(storagePath);
    return data.publicUrl;
  },

  /**
   * Remove one attachment: delete the storage object first, then the metadata row. Resolves
   * the row to learn its path. If the object delete fails we still attempt the row delete (an
   * already-gone object should not strand the row), and vice-versa the row delete failing is
   * surfaced as the error. Idempotent: removing an unknown id is a no-op success. NO money
   * moves; NO journal entry is posted.
   */
  async remove(id: string): Promise<RemoveAttachmentResult> {
    const att = await this.getById(id);
    if (!att) return { ok: true }; // already gone

    // Best-effort object delete (don't block the row delete on a storage hiccup).
    await supabase.storage.from(ATTACHMENTS_BUCKET).remove([att.storagePath]);

    const { error } = await acct().from('attachments').delete().eq('id', id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  /**
   * Cascade-remove EVERY attachment for an entity (the app-layer orphan cleanup the polymorphic
   * design requires when a parent is voided/deleted — there is no DB FK to cascade for us).
   * Reads the rows, removes all their storage objects in one batch, then deletes all the
   * metadata rows. Returns how many rows were removed. Safe to call when there are none (0).
   */
  async removeForEntity(
    entityType: AttachmentEntityType,
    entityId: string
  ): Promise<RemoveForEntityResult> {
    let rows: AccountingAttachment[];
    try {
      rows = await this.listForEntity(entityType, entityId);
    } catch (e) {
      return { ok: false, removed: 0, error: e instanceof Error ? e.message : 'Read failed.' };
    }
    if (rows.length === 0) return { ok: true, removed: 0 };

    // Batch-remove the objects (best-effort), then the rows.
    const paths = rows.map((r) => r.storagePath);
    await supabase.storage.from(ATTACHMENTS_BUCKET).remove(paths);

    const { error } = await acct()
      .from('attachments')
      .delete()
      .eq('entity_type', entityType)
      .eq('entity_id', entityId);
    if (error) return { ok: false, removed: 0, error: error.message };
    return { ok: true, removed: rows.length };
  },
};

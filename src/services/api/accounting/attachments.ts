import type { Attachment, AttachmentEntityType } from '../../../features/accounting/types';
import { acct } from './accountingClient';
import { supabase } from '../supabaseClient';
import type { Row } from './mappers';

/**
 * Document attachments on accounting entities (accounting.attachments, +
 * the private `accounting-attachments` Storage bucket). Each row is pure FILE
 * METADATA polymorphically linked to its host entity via (entity_type, entity_id);
 * the file bytes live in Storage at storagePath and are served to the client via
 * short-lived signed URLs (the bucket is private — there are no public URLs).
 *
 * Attachments move NO money, so this service has NO posting path: nothing here calls
 * accounting.post_journal_entry, and per invariant G3 that path is vacuous for metadata
 * (exactly like the custom-fields D4 and dimensions B2 services). The rows live in their
 * OWN table keyed by (entity_type, entity_id); uploading/deleting one never touches the
 * host invoice/bill/journal_entry row or its INSERT, so this is purely additive.
 *
 * Reads throw (React Query surfaces them). Writes return a result object whose `error`
 * carries the message so the UI can show it inline.
 *
 * CLEANUP-ON-FAILURE: upload writes the bytes FIRST then the metadata row; if the row
 * insert fails the orphaned object is removed so Storage never accumulates files with no
 * row. Delete removes the row FIRST (the row is the source of truth); the Storage object
 * is then best-effort removed — a storage cleanup miss leaves a harmless orphan but does
 * NOT flip the result to failure, since the row the UI lists is already gone.
 *
 * The row mapper (mapAttachmentRow) is intentionally LOCAL to this file rather than in the
 * shared mappers.ts; the str/num/nstr narrowers mirror the ones there.
 */

const ATTACHMENTS_BUCKET = 'accounting-attachments';

// Local row narrowers, mirrored from mappers.ts (kept local — see the module doc).
const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const str = (v: unknown): string => (v == null ? '' : String(v));
const nstr = (v: unknown): string | null => (v == null ? null : String(v));

/** Map an `accounting.attachments` row to the Attachment domain shape. */
function mapAttachmentRow(row: Row): Attachment {
  return {
    id: str(row.id),
    entityType: str(row.entity_type) as AttachmentEntityType,
    entityId: str(row.entity_id),
    bucket: str(row.bucket) || ATTACHMENTS_BUCKET,
    storagePath: str(row.storage_path),
    filename: str(row.filename),
    mimeType: str(row.mime_type),
    byteSize: num(row.byte_size),
    uploadedBy: nstr(row.uploaded_by),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  };
}

export const attachmentsService = {
  /**
   * Every attachment filed against one entity, oldest-first (the order the UI lists them).
   * Reads throw so React Query can surface the error.
   */
  async listForEntity(entityType: AttachmentEntityType, entityId: string): Promise<Attachment[]> {
    const { data, error } = await acct()
      .from('attachments')
      .select('*')
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapAttachmentRow);
  },

  /**
   * Upload a file and record its metadata row. Writes the bytes FIRST (to a path namespaced
   * by entity so two entities never collide), then the row; if the row insert fails the just-
   * uploaded object is removed (cleanup-on-failure) so Storage never holds an orphan. Returns
   * `{ attachment }` on success or `{ attachment: null, error }` on either failure.
   */
  async upload(
    entityType: AttachmentEntityType,
    entityId: string,
    file: File
  ): Promise<{ attachment: Attachment | null; error?: string }> {
    const ext = file.name.split('.').pop() ?? 'bin';
    const path = `${entityType}/${entityId}/${crypto.randomUUID()}.${ext}`;

    const { error: uploadErr } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .upload(path, file, { upsert: false });
    if (uploadErr) {
      return { attachment: null, error: uploadErr.message || 'Storage upload failed.' };
    }

    const insertPayload: Record<string, unknown> = {
      entity_type: entityType,
      entity_id: entityId,
      bucket: ATTACHMENTS_BUCKET,
      storage_path: path,
      filename: file.name,
      mime_type: file.type || 'application/octet-stream',
      byte_size: file.size,
    };

    const { data, error: insertErr } = await acct()
      .from('attachments')
      .insert(insertPayload)
      .select('*')
      .single();
    if (insertErr || !data) {
      // Cleanup-on-failure: drop the orphaned object so Storage stays consistent.
      await supabase.storage.from(ATTACHMENTS_BUCKET).remove([path]);
      return {
        attachment: null,
        error: insertErr?.message ?? 'Could not save the attachment record.',
      };
    }

    return { attachment: mapAttachmentRow(data as Row) };
  },

  /**
   * Delete an attachment. Removes the metadata row FIRST (the row is the source of truth the
   * UI lists); only if that succeeds does it best-effort remove the Storage object. A storage
   * cleanup miss leaves a harmless orphan but does NOT flip ok=false. A missing row is a no-op
   * success (idempotent).
   */
  async remove(id: string): Promise<{ ok: boolean; error?: string }> {
    const { data: row } = await acct()
      .from('attachments')
      .select('storage_path, bucket')
      .eq('id', id)
      .maybeSingle();

    const { error } = await acct().from('attachments').delete().eq('id', id);
    if (error) return { ok: false, error: error.message };

    const storagePath = row ? nstr((row as Row).storage_path) : null;
    if (storagePath) {
      const bucket = nstr((row as Row).bucket) ?? ATTACHMENTS_BUCKET;
      await supabase.storage.from(bucket).remove([storagePath]);
    }
    return { ok: true };
  },

  /**
   * Mint a short-lived (1h) signed URL for an attachment so the client can view/download it
   * from the private bucket. Returns null on error (the caller shows an inline message).
   */
  async getSignedUrl(att: Attachment): Promise<string | null> {
    const { data, error } = await supabase.storage
      .from(att.bucket || ATTACHMENTS_BUCKET)
      .createSignedUrl(att.storagePath, 3600);
    if (error) return null;
    return data?.signedUrl ?? null;
  },
};

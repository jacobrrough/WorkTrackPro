import { supabase } from './supabaseClient';

const BUCKET_ATTACHMENTS = 'attachments';
const BUCKET_INVENTORY = 'inventory-images';

/**
 * Content types that must never be served inline from our public origin — a stored .svg/.html
 * (or xml/js) is a stored-XSS vector when the browser executes it from the storefront. We can't
 * restrict the shared `attachments` bucket to images (it also holds PDF/CAD drawings and arbitrary
 * job/board files), so the control lives here: anything dangerous is stored as
 * `application/octet-stream` so the browser downloads it instead of running it.
 */
const DANGEROUS_INLINE_CONTENT_TYPES = new Set([
  'image/svg+xml',
  'text/html',
  'application/xhtml+xml',
  'text/xml',
  'application/xml',
  'application/javascript',
  'text/javascript',
  'application/x-javascript',
]);

/**
 * Allowlisted content types for PUBLIC product images. Product images are rendered inline on the
 * public storefront, so they get a stricter allowlist (not just the dangerous-type denylist):
 * uploads through the app for `attachment_type = 'product_image'` must be one of these. (A direct
 * supabase.storage.upload() still bypasses this — full closure of the inline-execution vector needs
 * a serve-layer control; see the file_size_limit migration note.)
 */
const PUBLIC_IMAGE_CONTENT_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
]);

/** Known content types → canonical extension. Used so the stored object key never carries a
 * user-controlled extension for these types (e.g. an `image/png` upload named `evil.html`). */
const CONTENT_TYPE_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
};

/** Pick the content type Storage should serve the object with. Dangerous inline types are
 * downgraded to octet-stream (download, never execute); an empty/unknown type also downgrades. */
function safeUploadContentType(fileType: string | undefined): string {
  const t = (fileType || '').toLowerCase().trim();
  if (!t || DANGEROUS_INLINE_CONTENT_TYPES.has(t)) return 'application/octet-stream';
  return t;
}

/** Derive the stored object extension from a validated MIME→ext map rather than the
 * user-controlled filename. Falls back to a sanitized filename extension for legitimate
 * non-mapped types (CAD, office docs) so those uploads keep a meaningful extension. */
function safeStoredExtension(file: File): string {
  const mapped = CONTENT_TYPE_TO_EXT[(file.type || '').toLowerCase().trim()];
  if (mapped) return mapped;
  const raw = file.name.split('.').pop() ?? '';
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 8);
  return cleaned || 'bin';
}

export function getAttachmentPublicUrl(storagePath: string): string {
  const { data } = supabase.storage.from(BUCKET_ATTACHMENTS).getPublicUrl(storagePath);
  return data.publicUrl;
}

export function getInventoryImagePublicUrl(storagePath: string): string {
  const { data } = supabase.storage.from(BUCKET_INVENTORY).getPublicUrl(storagePath);
  return data.publicUrl;
}

/**
 * Upload an inventory item's photo to the public `inventory-images` bucket and return its storage
 * path (to persist in inventory.image_path). Returns null on failure. One file per item is the
 * convention; the caller deletes any previous path via {@link removeInventoryImage}.
 */
export async function uploadInventoryImage(
  inventoryId: string,
  file: File
): Promise<string | null> {
  const ext = safeStoredExtension(file);
  const path = `inventory/${inventoryId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from(BUCKET_INVENTORY)
    .upload(path, file, { upsert: false, contentType: safeUploadContentType(file.type) });
  if (error) {
    console.error('Upload inventory image failed:', error);
    return null;
  }
  return path;
}

/** Best-effort delete of an inventory image object (e.g. the previous photo after a replace). */
export async function removeInventoryImage(storagePath: string): Promise<void> {
  if (!storagePath) return;
  await supabase.storage.from(BUCKET_INVENTORY).remove([storagePath]);
}

export type UploadAttachmentResult = { id: string } | { id: null; error: string };

export type PartAttachmentType = 'drawing' | 'product_image';

export async function uploadAttachment(
  jobId: string | undefined,
  inventoryId: string | undefined,
  partId: string | undefined,
  file: File,
  isAdminOnly: boolean,
  partAttachmentType?: PartAttachmentType,
  boardCardId?: string
): Promise<UploadAttachmentResult> {
  if (!jobId && !inventoryId && !partId && !boardCardId) {
    const msg = 'One of jobId, inventoryId, partId, or boardCardId must be provided';
    console.error(msg);
    return { id: null, error: msg };
  }
  // Public product images render inline on the storefront — enforce the image allowlist server-side
  // (not just the client validator) so a non-image can't be stored for that public path via the app.
  if (partId && partAttachmentType === 'product_image') {
    const t = (file.type || '').toLowerCase().trim();
    if (!PUBLIC_IMAGE_CONTENT_TYPES.has(t)) {
      return { id: null, error: 'Product images must be PNG, JPG, WEBP, or GIF.' };
    }
  }
  const ext = safeStoredExtension(file);
  const prefix = jobId
    ? `jobs/${jobId}`
    : inventoryId
      ? `inventory/${inventoryId}`
      : partId
        ? `parts/${partId}`
        : `board-cards/${boardCardId}`;
  const path = `${prefix}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from(BUCKET_ATTACHMENTS)
    .upload(path, file, { upsert: false, contentType: safeUploadContentType(file.type) });
  if (error) {
    console.error('Upload attachment failed:', error);
    return { id: null, error: error.message || 'Storage upload failed' };
  }
  const insertData: Record<string, unknown> = {
    filename: file.name,
    storage_path: path,
    is_admin_only: isAdminOnly,
  };
  if (jobId) insertData.job_id = jobId;
  if (inventoryId) insertData.inventory_id = inventoryId;
  if (partId) {
    insertData.part_id = partId;
    insertData.attachment_type = partAttachmentType ?? 'drawing';
  }
  if (boardCardId) insertData.board_card_id = boardCardId;

  const { data: row, error: insertErr } = await supabase
    .from('attachments')
    .insert(insertData)
    .select('id')
    .single();
  if (insertErr) {
    console.error('Insert attachment record failed:', insertErr);
    const msg = insertErr.message || 'Could not save attachment record';
    return { id: null, error: msg };
  }
  return { id: row.id };
}

export async function deleteAttachmentRecord(attachmentId: string): Promise<boolean> {
  const { data: att } = await supabase
    .from('attachments')
    .select('storage_path')
    .eq('id', attachmentId)
    .single();

  // Delete the DB row first: it is the source of truth for listings, so once it is gone the
  // storefront can no longer 404 on a missing object. Only then best-effort remove the object —
  // a failure there leaves at most an orphan (reconcilable via the logged path), never a live row
  // pointing at a file that is already deleted.
  const { error } = await supabase.from('attachments').delete().eq('id', attachmentId);
  if (error) return false;

  if (att?.storage_path) {
    const { error: removeErr } = await supabase.storage
      .from(BUCKET_ATTACHMENTS)
      .remove([att.storage_path]);
    if (removeErr) {
      console.error(
        'Orphaned attachment storage object (row deleted, object remains):',
        att.storage_path,
        removeErr
      );
    }
  }
  return true;
}

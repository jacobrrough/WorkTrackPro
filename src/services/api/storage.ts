import { supabase } from './supabaseClient';

const BUCKET_ATTACHMENTS = 'attachments';
const BUCKET_INVENTORY = 'inventory-images';

export function getAttachmentPublicUrl(storagePath: string): string {
  const { data } = supabase.storage.from(BUCKET_ATTACHMENTS).getPublicUrl(storagePath);
  return data.publicUrl;
}

export function getInventoryImagePublicUrl(storagePath: string): string {
  const { data } = supabase.storage.from(BUCKET_INVENTORY).getPublicUrl(storagePath);
  return data.publicUrl;
}

export type UploadAttachmentResult = { id: string } | { id: null; error: string };

export async function uploadAttachment(
  jobId: string | undefined,
  inventoryId: string | undefined,
  partId: string | undefined,
  file: File,
  isAdminOnly: boolean
): Promise<UploadAttachmentResult> {
  if (!jobId && !inventoryId && !partId) {
    const msg = 'One of jobId, inventoryId, or partId must be provided';
    console.error(msg);
    return { id: null, error: msg };
  }
  const ext = file.name.split('.').pop() ?? 'bin';
  const prefix = jobId ? `jobs/${jobId}` : inventoryId ? `inventory/${inventoryId}` : `parts/${partId}`;
  const path = `${prefix}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from(BUCKET_ATTACHMENTS)
    .upload(path, file, { upsert: false });
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
  if (partId) insertData.part_id = partId;

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
  if (att?.storage_path) {
    await supabase.storage.from(BUCKET_ATTACHMENTS).remove([att.storage_path]);
  }
  const { error } = await supabase.from('attachments').delete().eq('id', attachmentId);
  return !error;
}

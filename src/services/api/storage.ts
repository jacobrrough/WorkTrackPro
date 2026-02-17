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

export async function uploadAttachment(jobId: string, file: File, isAdminOnly: boolean): Promise<string | null> {
  const ext = file.name.split('.').pop() ?? 'bin';
  const path = `${jobId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET_ATTACHMENTS).upload(path, file, { upsert: false });
  if (error) {
    console.error('Upload attachment failed:', error);
    return null;
  }
  const { data: row, error: insertErr } = await supabase
    .from('attachments')
    .insert({ job_id: jobId, filename: file.name, storage_path: path, is_admin_only: isAdminOnly })
    .select('id')
    .single();
  if (insertErr) {
    console.error('Insert attachment record failed:', insertErr);
    return null;
  }
  return row.id;
}

export async function deleteAttachmentRecord(attachmentId: string): Promise<boolean> {
  const { data: att } = await supabase.from('attachments').select('storage_path').eq('id', attachmentId).single();
  if (att?.storage_path) {
    await supabase.storage.from(BUCKET_ATTACHMENTS).remove([att.storage_path]);
  }
  const { error } = await supabase.from('attachments').delete().eq('id', attachmentId);
  return !error;
}

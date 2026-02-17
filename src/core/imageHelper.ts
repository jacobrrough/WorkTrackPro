/**
 * Helper to get proper image URLs through Vite proxy
 */

export const getImageUrl = (collectionName: string, recordId: string, filename: string): string => {
  if (!filename) return '';
  return `/api/files/${collectionName}/${recordId}/${filename}`;
};

export const getInventoryImageUrl = (itemId: string, filename: string): string => {
  return getImageUrl('inventory', itemId, filename);
};

export const getJobImageUrl = (jobId: string, filename: string): string => {
  return getImageUrl('jobs', jobId, filename);
};

export const getAttachmentUrl = (attachmentId: string, filename: string): string => {
  return getImageUrl('attachments', attachmentId, filename);
};

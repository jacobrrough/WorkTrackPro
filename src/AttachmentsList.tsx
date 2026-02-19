import React from 'react';
import { Attachment } from '@/core/types';

interface AttachmentsListProps {
  attachments: Attachment[];
  onViewAttachment: (attachment: Attachment) => void;
  canUpload: boolean;
  showUploadButton?: boolean;
  /** When true, show an "Admin only" toggle per attachment (admin review) */
  showAdminOnlyToggle?: boolean;
  onToggleAdminOnly?: (attachmentId: string, isAdminOnly: boolean) => Promise<void>;
}

const AttachmentsList: React.FC<AttachmentsListProps> = ({
  attachments,
  onViewAttachment,
  canUpload,
  showUploadButton = true,
  showAdminOnlyToggle = false,
  onToggleAdminOnly,
}) => {
  const getFileIcon = (filename: string): string => {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext || '')) return 'image';
    if (ext === 'pdf') return 'picture_as_pdf';
    if (['doc', 'docx'].includes(ext || '')) return 'description';
    if (['xls', 'xlsx'].includes(ext || '')) return 'table_chart';
    return 'attachment';
  };

  const formatFileSize = (url: string): string => {
    // Since we don't have file size, we'll just show the file type
    const ext = url.split('.').pop()?.toLowerCase() || '';
    return ext.toUpperCase();
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  };

  if (attachments.length === 0 && !showUploadButton) {
    return null;
  }

  return (
    <div className="space-y-2">
      {attachments.length === 0 ? (
        <div className="py-8 text-center text-slate-400">
          <span className="material-symbols-outlined mb-2 text-5xl opacity-50">cloud_upload</span>
          <p>No files attached yet</p>
          {canUpload && <p className="mt-1 text-sm">Upload files to share with the team</p>}
        </div>
      ) : (
        attachments.map((attachment) => (
          <div
            key={attachment.id}
            className="flex w-full items-center gap-3 rounded-sm border border-white/10 bg-white/5 p-3 transition-colors hover:bg-white/10"
          >
            <button
              type="button"
              onClick={() => onViewAttachment(attachment)}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
            >
              {/* Icon */}
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-sm bg-primary/20">
                <span className="material-symbols-outlined text-primary">
                  {getFileIcon(attachment.filename)}
                </span>
              </div>

              {/* File Info */}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-white">{attachment.filename}</p>
                <p className="text-sm text-slate-400">
                  {formatFileSize(attachment.url ?? '')} • {formatDate(attachment.created ?? '')}
                </p>
              </div>

              {/* Arrow */}
              <span className="material-symbols-outlined flex-shrink-0 text-slate-400">
                chevron_right
              </span>
            </button>

            {showAdminOnlyToggle && onToggleAdminOnly && (
              <label className="flex flex-shrink-0 items-center gap-2 text-sm text-slate-400">
                <span className="whitespace-nowrap">Admin only</span>
                <input
                  type="checkbox"
                  checked={attachment.isAdminOnly}
                  onChange={(e) => {
                    e.stopPropagation();
                    onToggleAdminOnly(attachment.id, e.target.checked);
                  }}
                  className="h-4 w-4 rounded border-white/20 bg-white/10 text-primary focus:ring-primary"
                />
              </label>
            )}
          </div>
        ))
      )}
    </div>
  );
};

export default AttachmentsList;

import React from 'react';
import type { Attachment } from '@/core/types';
import AttachmentsList from '@/AttachmentsList';
import FileUploadButton from '@/FileUploadButton';

interface InventoryDetailAttachmentsProps {
  adminAttachments: Attachment[];
  regularAttachments: Attachment[];
  isAdmin: boolean;
  onFileUpload: (file: File, isAdminOnly: boolean) => Promise<boolean>;
  onViewAttachment: (attachment: Attachment) => void;
  onDeleteAttachment: (attachmentId: string) => Promise<boolean>;
}

export function InventoryDetailAttachments({
  adminAttachments,
  regularAttachments,
  isAdmin,
  onFileUpload,
  onViewAttachment,
  onDeleteAttachment,
}: InventoryDetailAttachmentsProps) {
  return (
    <div className="space-y-3">
      {isAdmin && (
        <div className="rounded-sm bg-card-dark p-3">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-bold text-white">
              <span className="material-symbols-outlined text-lg text-red-400">
                admin_panel_settings
              </span>
              Admin Files ({adminAttachments.length})
            </h3>
            <FileUploadButton
              onUpload={(file) => onFileUpload(file, true)}
              label="Upload Admin File"
            />
          </div>
          <AttachmentsList
            attachments={adminAttachments}
            onViewAttachment={onViewAttachment}
            canUpload={true}
            showUploadButton={false}
            canDelete={isAdmin}
            onDeleteAttachment={isAdmin ? onDeleteAttachment : undefined}
          />
        </div>
      )}
      <div className="rounded-sm bg-card-dark p-3">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-bold text-white">
            <span className="material-symbols-outlined text-lg text-primary">attach_file</span>
            Attachments ({regularAttachments.length})
          </h3>
          {isAdmin && (
            <FileUploadButton onUpload={(file) => onFileUpload(file, false)} label="Upload File" />
          )}
        </div>
        <AttachmentsList
          attachments={regularAttachments}
          onViewAttachment={onViewAttachment}
          canUpload={isAdmin}
          showUploadButton={false}
          canDelete={isAdmin}
          onDeleteAttachment={isAdmin ? onDeleteAttachment : undefined}
        />
      </div>
    </div>
  );
}

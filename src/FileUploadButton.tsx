import React, { useRef, useState } from 'react';
import { useToast } from './Toast';

interface FileUploadButtonProps {
  onUpload: (file: File, isAdminOnly?: boolean) => Promise<boolean>;
  disabled?: boolean;
  accept?: string;
  isAdminOnly?: boolean;
  multiple?: boolean;
  label?: string;
}

const FileUploadButton: React.FC<FileUploadButtonProps> = ({
  onUpload,
  disabled = false,
  accept = 'image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt,.csv',
  isAdminOnly = false,
  multiple = false,
  label = 'Upload File',
}) => {
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length === 0) return;
    const files = multiple ? selectedFiles : [selectedFiles[0]];

    setUploading(true);
    try {
      for (const file of files) {
        // Check file size (max 10MB)
        if (file.size > 10 * 1024 * 1024) {
          showToast(`"${file.name}" is too large (max 10MB).`, 'error');
          continue;
        }

        try {
          const success = await onUpload(file, isAdminOnly);
          if (!success) {
            console.error('❌ Upload failed (returned false):', file.name);
            showToast(`Upload failed for "${file.name}".`, 'error');
          }
        } catch (error) {
          console.error('❌ Upload error (exception):', error);
          showToast(
            error instanceof Error ? error.message : `Upload failed for "${file.name}"`,
            'error'
          );
        }
      }
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      setUploading(false);
    }
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={handleFileChange}
        className="hidden"
        disabled={disabled || uploading}
      />
      <button
        onClick={handleClick}
        disabled={disabled || uploading}
        className="flex items-center gap-2 rounded-sm bg-primary px-4 py-2 text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="material-symbols-outlined text-xl">
          {uploading ? 'hourglass_empty' : 'upload_file'}
        </span>
        <span className="font-medium">{uploading ? 'Uploading...' : label}</span>
      </button>
    </>
  );
};

export default FileUploadButton;

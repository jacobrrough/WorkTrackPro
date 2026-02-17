import React, { useState, useEffect } from 'react';
import { Attachment } from '@/core/types';

interface FileViewerProps {
  attachment: Attachment;
  onClose: () => void;
  onDelete?: () => void;
  canDelete: boolean;
}

const FileViewer: React.FC<FileViewerProps> = ({ attachment, onClose, onDelete, canDelete }) => {
  const [imageError, setImageError] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [imageScale, setImageScale] = useState(1);
  const [imagePosition, setImagePosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  useEffect(() => {
    // Prevent body scroll when modal is open
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  const getFileExtension = (filename: string): string => {
    return filename.split('.').pop()?.toLowerCase() || '';
  };

  const getFileType = (filename: string): 'image' | 'pdf' | 'document' | 'unknown' => {
    const ext = getFileExtension(filename);
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext)) return 'image';
    if (ext === 'pdf') return 'pdf';
    if (['doc', 'docx', 'xls', 'xlsx', 'txt', 'csv'].includes(ext)) return 'document';
    return 'unknown';
  };

  const handleDownload = () => {
    window.open(attachment.url, '_blank');
  };

  const handleDelete = () => {
    if (onDelete) {
      onDelete();
      onClose();
    }
  };

  // Touch event handlers for image pan and zoom
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      setIsDragging(true);
      setDragStart({
        x: e.touches[0].clientX - imagePosition.x,
        y: e.touches[0].clientY - imagePosition.y,
      });
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (isDragging && e.touches.length === 1 && imageScale > 1) {
      setImagePosition({
        x: e.touches[0].clientX - dragStart.x,
        y: e.touches[0].clientY - dragStart.y,
      });
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
  };

  const handleDoubleClick = () => {
    if (imageScale === 1) {
      setImageScale(2);
    } else {
      setImageScale(1);
      setImagePosition({ x: 0, y: 0 });
    }
  };

  const resetZoom = () => {
    setImageScale(1);
    setImagePosition({ x: 0, y: 0 });
  };

  const fileType = getFileType(attachment.filename);
  const ext = getFileExtension(attachment.filename);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95">
      {/* Header - Mobile Optimized */}
      <div className="safe-area-top flex flex-shrink-0 items-center justify-between border-b border-white/10 bg-background-dark p-3 sm:p-4">
        <div className="mr-2 min-w-0 flex-1">
          <h3 className="truncate text-sm font-bold text-white sm:text-base">
            {attachment.filename}
          </h3>
          <p className="text-xs text-slate-400 sm:text-sm">
            {new Date(attachment.created).toLocaleDateString()}
          </p>
        </div>
        <div className="flex items-center gap-1 sm:gap-2">
          {fileType === 'image' && imageScale > 1 && (
            <button
              onClick={resetZoom}
              className="p-2 text-white transition-transform hover:text-primary active:scale-95 sm:p-2"
              title="Reset Zoom"
            >
              <span className="material-symbols-outlined text-xl sm:text-2xl">zoom_out_map</span>
            </button>
          )}
          <button
            onClick={handleDownload}
            className="p-2 text-white transition-transform hover:text-primary active:scale-95 sm:p-2"
            title="Download"
          >
            <span className="material-symbols-outlined text-xl sm:text-2xl">download</span>
          </button>
          {canDelete && (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="p-2 text-white transition-transform hover:text-red-400 active:scale-95 sm:p-2"
              title="Delete"
            >
              <span className="material-symbols-outlined text-xl sm:text-2xl">delete</span>
            </button>
          )}
          <button
            onClick={onClose}
            className="p-2 text-white transition-transform hover:text-primary active:scale-95 sm:p-2"
            title="Close"
          >
            <span className="material-symbols-outlined text-xl sm:text-2xl">close</span>
          </button>
        </div>
      </div>

      {/* Content - Mobile Optimized */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        {fileType === 'image' && !imageError ? (
          <div
            className="flex h-full w-full items-center justify-center overflow-hidden"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onDoubleClick={handleDoubleClick}
          >
            <img
              src={attachment.url}
              alt={attachment.filename}
              className="max-h-full max-w-full select-none object-contain"
              onError={() => setImageError(true)}
              style={{
                transform: `scale(${imageScale}) translate(${imagePosition.x / imageScale}px, ${imagePosition.y / imageScale}px)`,
                transition: isDragging ? 'none' : 'transform 0.2s ease-out',
                cursor: imageScale > 1 ? 'grab' : 'default',
                touchAction: 'none',
              }}
              draggable={false}
            />
            {imageScale === 1 && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 transform rounded-full bg-black/60 px-3 py-2 text-xs text-white">
                Double tap to zoom
              </div>
            )}
          </div>
        ) : fileType === 'pdf' ? (
          <div className="flex h-full w-full flex-col">
            <div className="flex-1 overflow-hidden p-2 sm:p-4">
              <iframe
                src={attachment.url}
                className="h-full w-full rounded bg-white"
                title={attachment.filename}
              />
            </div>
            <div className="flex flex-shrink-0 gap-2 border-t border-white/10 bg-background-dark p-3 sm:gap-3 sm:p-4">
              <button
                onClick={handleDownload}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary/20 px-4 py-2.5 text-sm font-medium text-primary transition-all hover:bg-primary/30 active:scale-95 sm:py-3 sm:text-base"
              >
                <span className="material-symbols-outlined text-base sm:text-lg">open_in_new</span>
                <span>Open in Browser</span>
              </button>
              <button
                onClick={onClose}
                className="rounded-lg bg-white/10 px-4 py-2.5 text-sm font-medium text-white transition-all hover:bg-white/20 active:scale-95 sm:py-3 sm:text-base"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <div className="p-4 text-center">
            <div className="mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-full bg-white/5 sm:h-32 sm:w-32">
              <span className="material-symbols-outlined text-5xl text-white sm:text-6xl">
                {fileType === 'document' ? 'description' : 'attachment'}
              </span>
            </div>
            <p className="mb-2 break-words px-4 text-base text-white sm:text-lg">
              {attachment.filename}
            </p>
            <p className="mb-4 text-sm text-slate-400 sm:text-base">
              {ext.toUpperCase()} file • Preview not available
            </p>
            <button
              onClick={handleDownload}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm text-white transition-all hover:bg-primary/90 active:scale-95 sm:text-base"
            >
              <span className="material-symbols-outlined">download</span>
              <span>Download File</span>
            </button>
          </div>
        )}
      </div>

      {/* Delete Confirmation - Mobile Optimized */}
      {showDeleteConfirm && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-sm rounded-xl bg-card-dark p-4 sm:p-6">
            <h3 className="mb-2 text-base font-bold text-white sm:text-lg">Delete File?</h3>
            <p className="mb-4 text-sm text-slate-400 sm:mb-6 sm:text-base">
              Are you sure you want to delete "{attachment.filename}"? This cannot be undone.
            </p>
            <div className="flex gap-2 sm:gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 rounded-lg bg-white/10 px-4 py-2.5 text-sm font-medium text-white transition-all hover:bg-white/20 active:scale-95 sm:py-3 sm:text-base"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 rounded-lg bg-red-500 px-4 py-2.5 text-sm font-medium text-white transition-all hover:bg-red-600 active:scale-95 sm:py-3 sm:text-base"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FileViewer;

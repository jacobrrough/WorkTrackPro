import React from 'react';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="w-full max-w-md animate-fade-in overflow-hidden rounded-md border border-white/10 bg-card-dark">
        <div className="p-4">
          <h2 className="mb-2 text-xl font-bold text-white">{title}</h2>
          <p className="text-slate-400">{message}</p>
        </div>
        <div className="flex gap-3 border-t border-white/10 bg-white/5 px-4 py-3">
          <button
            onClick={onCancel}
            className="flex-1 rounded-sm bg-white/10 py-3 font-bold text-white transition-colors hover:bg-white/15"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 rounded-sm py-3 font-bold transition-colors ${
              destructive
                ? 'bg-red-500 text-white hover:bg-red-600'
                : 'bg-primary text-white hover:bg-primary/90'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;

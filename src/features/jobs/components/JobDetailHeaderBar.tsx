import type { JobStatus } from '@/core/types';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { formatJobCode } from '@/lib/formatJob';

interface JobDetailHeaderBarProps {
  isEditing: boolean;
  jobCode: number;
  status: JobStatus;
  isAdmin: boolean;
  minimalView: boolean;
  isSubmitting: boolean;
  pendingAttachmentToggleCount: number;
  onBackOrClose: () => void;
  onToggleMinimalView: () => void;
  onEditOrSave: () => void;
}

export default function JobDetailHeaderBar({
  isEditing,
  jobCode,
  status,
  isAdmin,
  minimalView,
  isSubmitting,
  pendingAttachmentToggleCount,
  onBackOrClose,
  onToggleMinimalView,
  onEditOrSave,
}: JobDetailHeaderBarProps) {
  return (
    <header className="safe-area-top sticky top-0 z-header border-b border-line bg-background-dark/95 px-3 py-2 backdrop-blur-sm">
      <div className="flex items-center justify-between">
        <button
          onClick={onBackOrClose}
          disabled={pendingAttachmentToggleCount > 0}
          className="flex size-12 touch-manipulation items-center justify-center rounded-lg text-muted hover:bg-overlay/5 hover:text-white disabled:opacity-50"
          aria-label={isEditing ? 'Cancel editing and close' : 'Close job detail'}
        >
          <span className="material-symbols-outlined">close</span>
        </button>

        <div className="flex-1 text-center">
          <h1 className="app-section-title text-white">
            {isEditing ? 'Edit Job' : formatJobCode(jobCode)}
          </h1>
          {!isEditing && <StatusBadge status={status} size="sm" />}
          {isEditing && <p className="text-[11px] text-muted">Edit below</p>}
        </div>

        <div className="flex items-center gap-2">
          {isAdmin && !isEditing && (
            <button
              onClick={onToggleMinimalView}
              className="flex size-12 touch-manipulation items-center justify-center rounded-lg text-muted hover:bg-overlay/5 hover:text-white"
              title="Toggle minimal view"
              aria-label="Toggle minimal view"
            >
              <span className="material-symbols-outlined">
                {minimalView ? 'view_agenda' : 'view_compact'}
              </span>
            </button>
          )}

          {isAdmin && (
            <button
              onClick={onEditOrSave}
              disabled={isSubmitting}
              className={`flex size-12 touch-manipulation items-center justify-center rounded-lg ${
                isEditing
                  ? 'text-green-400 hover:text-green-300'
                  : 'text-primary hover:text-primary/80'
              } ${isSubmitting ? 'opacity-50' : 'hover:bg-overlay/5'}`}
              aria-label={isEditing ? 'Save job changes' : 'Edit job'}
            >
              <span className="material-symbols-outlined">{isEditing ? 'check' : 'edit'}</span>
            </button>
          )}

          {!isAdmin && (
            <div className="rounded-lg border border-line bg-overlay/5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
              View Only
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

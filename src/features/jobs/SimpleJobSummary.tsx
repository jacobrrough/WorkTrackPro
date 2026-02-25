import React, { useState, useEffect } from 'react';
import { Job, ViewState, Shift, User } from '@/core/types';
import { formatDateOnly } from '@/core/date';
import { formatJobCode, formatDashSummary, totalFromDashQuantities } from '@/lib/formatJob';
import { formatDurationHMS } from '@/lib/timeUtils';
import { getWorkedShiftMs } from '@/lib/lunchUtils';
import ChecklistDisplay from '@/ChecklistDisplay';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useApp } from '@/AppContext';

interface SimpleJobSummaryProps {
  job: Job;
  onNavigate: (view: ViewState, id?: string) => void;
  onBack?: () => void;
  isClockedIn: boolean;
  onClockIn: () => void;
  onClockOut: () => void;
  activeShift: Shift | null;
  currentUser: User;
  onReloadJob?: () => Promise<void>;
  /** Part drawing URL — the only file standard users can access; admins fall back to job attachments if missing */
  partDrawingUrl?: string | null;
}

/** Get first viewable drawing: non-admin attachment, or first URL in description */
function getViewDrawingUrl(job: Job): string | null {
  const regular = (job.attachments || []).filter((a) => !a.isAdminOnly);
  if (regular.length > 0 && regular[0].url) return regular[0].url;
  if (!job.description) return null;
  const line = job.description.split(/\r?\n/).find((l) => l.trim().startsWith('http'));
  return line ? line.trim() : null;
}

const SimpleJobSummary: React.FC<SimpleJobSummaryProps> = ({
  job,
  onNavigate,
  onBack,
  isClockedIn,
  onClockIn,
  onClockOut,
  activeShift,
  currentUser,
  onReloadJob,
  partDrawingUrl,
}) => {
  const [timer, setTimer] = useState('00:00:00');
  const { advanceJobToNextStatus } = useApp();

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (isClockedIn && activeShift) {
      interval = setInterval(() => {
        setTimer(formatDurationHMS(getWorkedShiftMs(activeShift)));
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isClockedIn, activeShift]);

  // Standard users: only part drawing. Admins: part drawing or first non-admin job attachment.
  const drawingUrl = partDrawingUrl ?? (currentUser.isAdmin ? getViewDrawingUrl(job) : null);
  const totalQty = totalFromDashQuantities(job.dashQuantities);

  const handleBack = () => {
    if (onBack) onBack();
    else onNavigate('board-shop');
  };

  const handleChecklistComplete = async () => {
    await advanceJobToNextStatus(job.id, job.status);
    await onReloadJob?.();
  };

  return (
    <div className="flex min-h-0 flex-col bg-gradient-to-br from-[#1a1122] to-[#2d1f3d] pb-24">
      {/* Header with back */}
      <header className="sticky top-0 z-30 flex-shrink-0 border-b border-white/10 bg-background-dark/95 px-4 py-3 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <button
            onClick={handleBack}
            className="flex size-11 min-w-[44px] touch-manipulation items-center justify-center rounded-sm text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Back"
          >
            <span className="material-symbols-outlined text-2xl">arrow_back</span>
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold text-white">
              {formatJobCode(job.jobCode)}
              {job.partNumber ? ` – ${job.partNumber}` : ''}
            </h1>
            <p className="text-xs text-slate-400">Job summary</p>
          </div>
        </div>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        {/* Dash quantities - prominent */}
        {job.dashQuantities && Object.keys(job.dashQuantities).length > 0 && (
          <div className="rounded-sm border border-primary/30 bg-primary/10 p-3">
            <p className="mb-1 text-xs font-bold uppercase text-slate-400">Quantities</p>
            <p className="text-xl font-bold text-white">
              {formatDashSummary(job.dashQuantities)}
              {totalQty > 0 && (
                <span className="ml-2 text-base font-medium text-slate-300">
                  ({totalQty} total)
                </span>
              )}
            </p>
          </div>
        )}

        {/* ECD / Due date */}
        <div className="rounded-sm border border-white/10 bg-white/5 p-3">
          <p className="mb-1 text-xs font-bold uppercase text-slate-400">ECD / Due</p>
          <p className="text-lg font-bold text-white">
            {job.ecd ? formatDateOnly(job.ecd) : job.dueDate ? formatDateOnly(job.dueDate) : '—'}
          </p>
        </div>

        {/* View Drawing */}
        <div className="rounded-sm border border-white/10 bg-white/5 p-3">
          {drawingUrl ? (
            <a
              href={drawingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-[48px] w-full touch-manipulation items-center justify-center gap-2 rounded-sm bg-primary px-4 py-3 font-bold text-white transition-colors hover:bg-primary/90 active:scale-[0.98]"
            >
              <span className="material-symbols-outlined text-xl">picture_as_pdf</span>
              View Drawing
            </a>
          ) : (
            <p className="py-2 text-center text-sm text-slate-500">No drawing available</p>
          )}
        </div>

        {/* Checklist */}
        <div className="rounded-sm border border-white/10 bg-white/5 p-3">
          <p className="mb-3 text-xs font-bold uppercase text-slate-400">Checklist</p>
          <ChecklistDisplay
            jobId={job.id}
            jobStatus={job.status}
            currentUser={currentUser}
            compact={false}
            onChecklistComplete={handleChecklistComplete}
          />
        </div>

        {/* Clock In / Out + timer */}
        <div className="rounded-sm border border-white/10 bg-white/5 p-3">
          {isClockedIn ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-sm border border-green-500/30 bg-green-500/20 p-3">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 animate-pulse rounded-sm bg-green-500" />
                  <span className="text-sm font-medium text-green-400">Clocked in</span>
                </div>
                <span className="font-mono text-xl font-bold text-green-400">{timer}</span>
              </div>
              <button
                onClick={onClockOut}
                className="flex min-h-[48px] w-full touch-manipulation items-center justify-center gap-2 rounded-sm bg-red-500 py-3 font-bold text-white transition-colors hover:bg-red-600 active:scale-[0.98]"
              >
                <span className="material-symbols-outlined">logout</span>
                Clock Out
              </button>
            </div>
          ) : (
            <button
              onClick={onClockIn}
              className="flex min-h-[48px] w-full touch-manipulation items-center justify-center gap-2 rounded-sm bg-green-500 py-3 font-bold text-white transition-colors hover:bg-green-600 active:scale-[0.98]"
            >
              <span className="material-symbols-outlined">login</span>
              Clock In
            </button>
          )}
        </div>

        {/* Current status */}
        <div className="rounded-sm border border-white/10 bg-white/5 p-3">
          <p className="mb-2 text-xs font-bold uppercase text-slate-400">Status</p>
          <StatusBadge status={job.status} size="md" />
        </div>

        {/* More / Full Details */}
        <button
          onClick={() => onNavigate('job-detail', job.id)}
          className="flex min-h-[48px] w-full touch-manipulation items-center justify-center gap-2 rounded-sm border-2 border-primary bg-primary/20 py-3 font-bold text-primary transition-colors hover:bg-primary/30 active:scale-[0.98]"
        >
          <span className="material-symbols-outlined">open_in_new</span>
          More / Full Details
        </button>
      </div>
    </div>
  );
};

export default SimpleJobSummary;

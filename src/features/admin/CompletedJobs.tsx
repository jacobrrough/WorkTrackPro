import React, { useMemo } from 'react';
import { Job, ViewState, User, getStatusDisplayName } from '@/core/types';
import { formatDateOnly } from '@/core/date';
import { getJobDisplayName } from '@/lib/formatJob';

interface CompletedJobsProps {
  jobs: Job[];
  currentUser: User;
  onNavigate: (view: ViewState, id?: string) => void;
  onBack?: () => void;
}

/**
 * Completed Jobs - Archive of paid/completed jobs (read-only).
 * Shows jobs with status 'paid' or 'projectCompleted'.
 */
const CompletedJobs: React.FC<CompletedJobsProps> = ({
  jobs,
  currentUser: _currentUser,
  onNavigate,
  onBack: _onBack,
}) => {
  const completedJobs = useMemo(() => {
    return jobs
      .filter((job) => job.status === 'paid' || job.status === 'projectCompleted')
      .sort((a, b) => {
        // Sort by due date descending (most recent first)
        const dateA = a.dueDate ? new Date(a.dueDate).getTime() : 0;
        const dateB = b.dueDate ? new Date(b.dueDate).getTime() : 0;
        return dateB - dateA;
      });
  }, [jobs]);

  return (
    <div className="flex h-full flex-col">
      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {completedJobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <span className="material-symbols-outlined mb-4 text-6xl text-slate-600">archive</span>
            <p className="text-lg font-medium text-slate-400">No completed jobs</p>
            <p className="mt-2 text-sm text-slate-500">
              Jobs marked as Paid or Project Completed will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {completedJobs.map((job) => (
              <button
                key={job.id}
                onClick={() => onNavigate('job-detail', job.id)}
                className="w-full rounded-sm border border-white/10 bg-white/5 p-3 text-left transition-colors hover:bg-white/10 active:scale-[0.98]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="font-bold text-white">#{job.jobCode}</span>
                      <span className="text-sm font-medium text-slate-300">
                        {getJobDisplayName(job)}
                      </span>
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${
                          job.status === 'paid'
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-blue-500/20 text-blue-400'
                        }`}
                      >
                        {getStatusDisplayName(job.status)}
                      </span>
                    </div>
                    {job.description && (
                      <p className="mb-2 line-clamp-2 text-sm text-slate-400">{job.description}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                      {job.po && (
                        <span className="flex items-center gap-1">
                          <span className="material-symbols-outlined text-sm">receipt</span>
                          PO: {job.po}
                        </span>
                      )}
                      {job.dueDate && (
                        <span className="flex items-center gap-1">
                          <span className="material-symbols-outlined text-sm">event</span>
                          {formatDateOnly(job.dueDate)}
                        </span>
                      )}
                      {job.binLocation && (
                        <span className="flex items-center gap-1">
                          <span className="material-symbols-outlined text-sm">location_on</span>
                          {job.binLocation}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="material-symbols-outlined text-slate-400">chevron_right</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default CompletedJobs;

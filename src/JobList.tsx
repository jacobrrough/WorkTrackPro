import React, { useState } from 'react';
import { Job, ViewState, User, Shift, getStatusDisplayName } from '@/core/types';
import { formatDateOnly } from '@/core/date';
import {
  formatJobCode,
  formatDashSummary,
  getJobDisplayName,
  formatJobIdentityLine,
} from '@/lib/formatJob';

interface JobListProps {
  jobs: Job[];
  onNavigate: (view: ViewState, jobId?: string) => void;
  onClockIn: (jobId: string) => void;
  activeJobId?: string;
  shifts: Shift[];
  users: User[];
}

const JobList: React.FC<JobListProps> = ({
  jobs: allJobs,
  onNavigate,
  onClockIn,
  activeJobId,
  shifts,
  users,
}) => {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'rush' | 'pending' | 'inProgress'>('all');
  const jobs = allJobs.filter((j) => j.status !== 'paid');

  const filteredJobs = jobs.filter((j) => {
    const displayName = getJobDisplayName(j);
    const matchesSearch =
      (j.name?.toLowerCase() ?? '').includes(search.toLowerCase()) ||
      (displayName?.toLowerCase() ?? '').includes(search.toLowerCase()) ||
      (j.jobCode?.toString() ?? '').includes(search) ||
      j.po?.toLowerCase().includes(search.toLowerCase());

    let matchesFilter = true;
    if (filter === 'rush') matchesFilter = j.isRush || j.status === 'rush';
    else if (filter === 'pending') matchesFilter = j.status === 'pending';
    else if (filter === 'inProgress') matchesFilter = j.status === 'inProgress';

    return matchesSearch && matchesFilter;
  });

  const getActiveUsersForJob = (jobId: string) => {
    const activeShifts = shifts.filter((s) => s.job === jobId && !s.clockOutTime);
    return activeShifts.map((s) => {
      const user = users.find((u) => u.id === s.user);
      return user?.initials || s.userInitials || 'WK';
    });
  };

  const getStatusColor = (status: string, isRush: boolean) => {
    if (isRush || status === 'rush') return 'border-red-500';
    if (status === 'inProgress') return 'border-blue-500';
    if (status === 'qualityControl') return 'border-green-500';
    if (status === 'finished' || status === 'delivered') return 'border-emerald-500';
    return 'border-primary/20';
  };

  return (
    <div className="flex min-h-screen flex-col bg-background-dark">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-background-dark/80 backdrop-blur-lg">
        <div className="flex items-center justify-between px-3 py-2.5">
          <button
            onClick={() => onNavigate('dashboard')}
            className="flex size-10 items-center justify-center text-slate-400"
          >
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <h2 className="flex-1 text-center text-lg font-bold">Job Selection</h2>
          <div className="flex size-10 items-center justify-center">
            <span className="material-symbols-outlined text-primary">filter_list</span>
          </div>
        </div>
      </header>

      <main
        className="flex-1 overflow-y-auto pb-24"
        style={{ WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}
      >
        <div className="space-y-3 px-3 py-3">
          <div className="relative">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
              search
            </span>
            <input
              className="block w-full rounded-sm border-none bg-[#261a32] py-2.5 pl-10 pr-3 text-white placeholder:text-slate-500 focus:ring-2 focus:ring-primary"
              placeholder="Search PO, Job Code, Name..."
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="no-scrollbar flex gap-2 overflow-x-auto">
            {(['all', 'rush', 'pending', 'inProgress'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`flex h-9 shrink-0 items-center justify-center gap-x-2 rounded-sm px-3 text-sm font-semibold transition-colors ${
                  filter === f
                    ? f === 'rush'
                      ? 'bg-red-500 text-white'
                      : f === 'pending'
                        ? 'bg-orange-500 text-white'
                        : f === 'inProgress'
                          ? 'bg-blue-500 text-white'
                          : 'bg-primary text-white'
                    : 'border border-white/5 bg-[#261a32] text-slate-300'
                }`}
              >
                {f === 'all' ? (
                  'All Jobs'
                ) : f === 'rush' ? (
                  <>
                    <span className="material-symbols-outlined align-middle text-sm">
                      local_fire_department
                    </span>{' '}
                    Rush
                  </>
                ) : f === 'inProgress' ? (
                  'In Progress'
                ) : (
                  'Pending'
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-2 px-3 pb-3">
          <div className="flex-1 rounded-sm border border-white/5 bg-[#261a32] p-2.5">
            <p className="text-xs font-bold uppercase text-slate-400">Total</p>
            <p className="text-xl font-bold text-white">{jobs.length}</p>
          </div>
          <div className="flex-1 rounded-sm border border-white/5 bg-[#261a32] p-2.5">
            <p className="text-xs font-bold uppercase text-slate-400">Active</p>
            <p className="text-xl font-bold text-blue-400">
              {jobs.filter((j) => j.status === 'inProgress').length}
            </p>
          </div>
          <div className="flex-1 rounded-sm border border-white/5 bg-[#261a32] p-2.5">
            <p className="text-xs font-bold uppercase text-slate-400">Rush</p>
            <p className="text-xl font-bold text-red-400">
              {jobs.filter((j) => j.isRush || j.status === 'rush').length}
            </p>
          </div>
        </div>

        <div className="space-y-2 px-3">
          {filteredJobs.length === 0 ? (
            <div className="py-12 text-center">
              <span className="material-symbols-outlined mb-3 block text-5xl text-slate-600">
                search_off
              </span>
              <p className="text-slate-400">No jobs found</p>
            </div>
          ) : (
            filteredJobs.map((job) => {
              const activeWorkers = getActiveUsersForJob(job.id);
              const isActive = job.id === activeJobId;

              return (
                <div
                  key={job.id}
                  className={`relative overflow-hidden rounded-sm border-l-4 bg-[#261a32] p-3 shadow-sm ${getStatusColor(job.status, job.isRush)}`}
                >
                  <div
                    className="mb-2 flex cursor-pointer items-start justify-between"
                    onClick={() => onNavigate('job-detail', job.id)}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        {(job.isRush || job.status === 'rush') && (
                          <span className="rounded-sm border border-red-500/20 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-extrabold uppercase text-red-500">
                            RUSH
                          </span>
                        )}
                        <span className="text-xs font-medium text-slate-400">
                          {formatJobCode(job.jobCode)}
                        </span>
                      </div>
                      <h4 className="truncate text-lg font-bold text-white">
                        {formatJobIdentityLine(job) || getJobDisplayName(job) || '—'}
                      </h4>
                      <div className="mt-1 flex items-center gap-2">
                        <span
                          className={`rounded-sm px-2 py-0.5 text-[10px] font-bold uppercase ${
                            job.status === 'inProgress'
                              ? 'bg-blue-500/20 text-blue-400'
                              : job.status === 'pending'
                                ? 'bg-orange-500/20 text-orange-400'
                                : job.status === 'finished'
                                  ? 'bg-emerald-500/20 text-emerald-400'
                                  : 'bg-slate-500/20 text-slate-400'
                          }`}
                        >
                          {getStatusDisplayName(job.status)}
                        </span>
                        {job.dashQuantities && Object.keys(job.dashQuantities).length > 0 ? (
                          <span className="text-xs text-slate-500">
                            Qty: {formatDashSummary(job.dashQuantities)}
                          </span>
                        ) : (
                          job.qty && <span className="text-xs text-slate-500">Qty: {job.qty}</span>
                        )}
                      </div>
                    </div>

                    {activeWorkers.length > 0 && (
                      <div className="ml-2 flex -space-x-2">
                        {activeWorkers.slice(0, 3).map((initials, idx) => (
                          <div
                            key={idx}
                            className="flex h-8 w-8 items-center justify-center rounded-sm border-2 border-[#261a32] bg-primary text-[10px] font-bold uppercase text-white shadow-sm"
                          >
                            {initials}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2 border-t border-white/5 pt-2">
                    <div className="flex items-center gap-2">
                      {job.dueDate && (
                        <div className="flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-sm text-slate-400">
                            schedule
                          </span>
                          <span className="text-xs font-medium text-slate-400">
                            Due {formatDateOnly(job.dueDate)}
                          </span>
                        </div>
                      )}
                    </div>
                    {isActive ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onNavigate('job-detail', job.id);
                        }}
                        className="animate-pulse rounded-sm bg-green-500/20 px-4 py-1.5 text-sm font-bold text-green-500"
                      >
                        Active
                      </button>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onClockIn(job.id);
                        }}
                        className="rounded-sm bg-primary px-4 py-1.5 text-sm font-bold text-white shadow-md shadow-primary/20 transition-all hover:bg-primary/90 active:scale-95"
                      >
                        Clock In
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </main>

      <nav className="fixed bottom-0 left-0 right-0 border-t border-white/10 bg-[#1a1122]/80 pb-8 pt-2 backdrop-blur-lg">
        <div className="mx-auto flex max-w-md items-center justify-around px-3">
          <button
            onClick={() => onNavigate('dashboard')}
            className="flex flex-col items-center gap-1 text-slate-400"
          >
            <span className="material-symbols-outlined">grid_view</span>
            <span className="text-[10px] font-bold uppercase">Home</span>
          </button>
          <button className="flex flex-col items-center gap-1 text-primary">
            <span className="material-symbols-outlined fill-1">assignment</span>
            <span className="text-[10px] font-bold uppercase">Jobs</span>
          </button>
          <button
            onClick={() => onNavigate('clock-in')}
            className="flex flex-col items-center gap-1 text-slate-400"
          >
            <span className="material-symbols-outlined">schedule</span>
            <span className="text-[10px] font-bold uppercase">Clock In</span>
          </button>
          <button
            onClick={() => onNavigate('inventory')}
            className="flex flex-col items-center gap-1 text-slate-400"
          >
            <span className="material-symbols-outlined">inventory_2</span>
            <span className="text-[10px] font-bold uppercase">Stock</span>
          </button>
        </div>
      </nav>
    </div>
  );
};

export default JobList;

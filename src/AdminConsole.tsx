import React, { useMemo, useState } from 'react';
import {
  Job,
  User,
  ViewState,
  JobStatus,
  Shift,
  getStatusDisplayName,
  SHOP_FLOOR_COLUMNS,
} from '@/core/types';
import TrelloImport from './TrelloImport';

interface AdminConsoleProps {
  jobs: Job[];
  shifts: Shift[];
  users: User[];
  onNavigate: (view: ViewState, jobId?: string) => void;
  onUpdateJobStatus: (jobId: string, status: JobStatus) => Promise<void>;
}

const AdminConsole: React.FC<AdminConsoleProps> = ({
  jobs,
  shifts,
  users: _users,
  onNavigate,
  onUpdateJobStatus,
}) => {
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [showTrelloImport, setShowTrelloImport] = useState(false);

  const stats = useMemo(
    () => ({
      total: jobs.length,
      active: jobs.filter((j) => j.status === 'inProgress').length,
      pending: jobs.filter((j) => j.status === 'pending').length,
      rush: jobs.filter((j) => j.isRush || j.status === 'rush').length,
      finished: jobs.filter((j) => j.status === 'finished' || j.status === 'delivered').length,
    }),
    [jobs]
  );

  const activeWorkers = useMemo(() => {
    const activeShifts = shifts.filter((s) => !s.clockOutTime);
    return activeShifts.length;
  }, [shifts]);

  const totalHoursToday = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return shifts
      .filter((s) => new Date(s.clockInTime) >= today)
      .reduce((total, s) => {
        if (s.clockOutTime) {
          return (
            total +
            (new Date(s.clockOutTime).getTime() - new Date(s.clockInTime).getTime()) / 3600000
          );
        }
        return total + (Date.now() - new Date(s.clockInTime).getTime()) / 3600000;
      }, 0);
  }, [shifts]);

  const handleStatusChange = async (status: JobStatus) => {
    if (selectedJob) {
      await onUpdateJobStatus(selectedJob.id, status);
      setShowStatusModal(false);
      setSelectedJob(null);
    }
  };

  return (
    <div className="flex h-screen flex-col bg-background-dark">
      <header className="sticky top-0 z-50 flex-shrink-0 border-b border-primary/10 bg-background-dark/95 px-4 py-3 backdrop-blur-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => onNavigate('dashboard')}
              className="rounded-full border border-primary/30 bg-primary/20 p-1"
            >
              <span className="material-symbols-outlined text-primary">arrow_back</span>
            </button>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-primary">
                Administrator
              </p>
              <h1 className="text-lg font-bold leading-tight text-white">Admin Console</h1>
            </div>
          </div>
          <button className="bg-surface-dark relative flex size-10 items-center justify-center rounded-full border border-white/5 text-white">
            <span className="material-symbols-outlined">notifications</span>
          </button>
        </div>
      </header>

      <main
        className="flex-1 overflow-y-auto pb-24"
        style={{ WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}
      >
        <div className="px-4 pt-6">
          <h3 className="mb-4 text-lg font-bold tracking-tight text-white">Overview</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center justify-between rounded-xl border border-white/5 bg-[#362447] p-4">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-primary/20 text-primary">
                  <span className="material-symbols-outlined">work</span>
                </div>
                <div>
                  <p className="text-xs text-white/60">Active Jobs</p>
                  <p className="text-xl font-bold text-white">{stats.active}</p>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-white/5 bg-[#362447] p-4">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-orange-500/20 text-orange-500">
                  <span className="material-symbols-outlined">pending</span>
                </div>
                <div>
                  <p className="text-xs text-white/60">Pending</p>
                  <p className="text-xl font-bold text-white">{stats.pending}</p>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-white/5 bg-[#362447] p-4">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-green-500/20 text-green-500">
                  <span className="material-symbols-outlined">group</span>
                </div>
                <div>
                  <p className="text-xs text-white/60">Workers Active</p>
                  <p className="text-xl font-bold text-white">{activeWorkers}</p>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-white/5 bg-[#362447] p-4">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-cyan-500/20 text-cyan-500">
                  <span className="material-symbols-outlined">schedule</span>
                </div>
                <div>
                  <p className="text-xs text-white/60">Hours Today</p>
                  <p className="text-xl font-bold text-white">{totalHoursToday.toFixed(1)}h</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="px-4 py-6">
          <button
            onClick={() => onNavigate('admin-create-job')}
            className="flex h-14 w-full items-center justify-center gap-3 rounded-xl bg-primary px-6 text-white shadow-lg shadow-primary/25 transition-transform active:scale-95"
          >
            <span className="material-symbols-outlined">add_circle</span>
            <span className="text-base font-bold tracking-wide">Create New Job</span>
          </button>
        </div>

        <div className="px-4 py-2">
          <h3 className="mb-4 text-lg font-bold tracking-tight text-white">Quick Actions</h3>
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => onNavigate('board-admin')}
              className="active:bg-surface-dark/60 flex flex-col items-start gap-3 rounded-xl border border-orange-500/30 bg-gradient-to-br from-orange-600/20 to-red-600/20 p-4"
            >
              <span className="material-symbols-outlined text-3xl text-orange-500">
                view_kanban
              </span>
              <p className="font-bold text-white">Admin Board</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">
                Kanban View
              </p>
            </button>
            <button
              onClick={() => onNavigate('board-shop')}
              className="active:bg-surface-dark/60 flex flex-col items-start gap-3 rounded-xl border border-blue-500/30 bg-gradient-to-br from-blue-600/20 to-cyan-600/20 p-4"
            >
              <span className="material-symbols-outlined text-3xl text-blue-500">view_kanban</span>
              <p className="font-bold text-white">Shop Floor</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">
                Kanban View
              </p>
            </button>
            <button
              onClick={() => onNavigate('time-reports')}
              className="active:bg-surface-dark/60 flex flex-col items-start gap-3 rounded-xl border border-green-500/30 bg-gradient-to-br from-green-600/20 to-emerald-600/20 p-4"
            >
              <span className="material-symbols-outlined text-3xl text-green-500">analytics</span>
              <p className="font-bold text-white">Time Reports</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">
                View Hours
              </p>
            </button>
            <button
              onClick={() => onNavigate('inventory')}
              className="bg-surface-dark active:bg-surface-dark/60 flex flex-col items-start gap-3 rounded-xl border border-white/5 p-4"
            >
              <span className="material-symbols-outlined text-3xl text-primary">inventory_2</span>
              <p className="font-bold text-white">Inventory</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">
                Manage Stock
              </p>
            </button>
            <button
              onClick={() => setShowTrelloImport(true)}
              className="active:bg-surface-dark/60 flex flex-col items-start gap-3 rounded-xl border border-purple-500/30 bg-gradient-to-br from-purple-600/20 to-pink-600/20 p-4"
            >
              <span className="material-symbols-outlined text-3xl text-purple-500">
                upload_file
              </span>
              <p className="font-bold text-white">Import Trello</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">
                From JSON
              </p>
            </button>
            <button
              onClick={() => onNavigate('calendar')}
              className="active:bg-surface-dark/60 flex flex-col items-start gap-3 rounded-xl border border-cyan-500/30 bg-gradient-to-br from-cyan-600/20 to-blue-600/20 p-4"
            >
              <span className="material-symbols-outlined text-3xl text-cyan-500">calendar_month</span>
              <p className="font-bold text-white">Calendar</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">
                Job Timeline
              </p>
            </button>
            <button
              onClick={() => onNavigate('completed-jobs')}
              className="active:bg-surface-dark/60 flex flex-col items-start gap-3 rounded-xl border border-green-500/30 bg-gradient-to-br from-green-600/20 to-emerald-600/20 p-4"
            >
              <span className="material-symbols-outlined text-3xl text-green-500">archive</span>
              <p className="font-bold text-white">Completed Jobs</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">
                Archive
              </p>
            </button>
          </div>
        </div>

        <div className="mt-6 px-4">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-bold tracking-tight text-white">Recent Jobs</h3>
            <button
              onClick={() => onNavigate('board-shop')}
              className="text-xs font-bold uppercase text-primary"
            >
              View All
            </button>
          </div>
          <div className="space-y-3">
            {jobs.slice(0, 5).map((job) => (
              <div key={job.id} className="rounded-xl border border-white/5 bg-[#23182d] p-4">
                <div className="mb-2 flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      {(job.isRush || job.status === 'rush') && (
                        <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[8px] font-bold uppercase text-red-500">
                          RUSH
                        </span>
                      )}
                      <span className="text-xs text-slate-500">#{job.jobCode}</span>
                    </div>
                    <h4 className="truncate font-bold text-white">{job.name}</h4>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedJob(job);
                      setShowStatusModal(true);
                    }}
                    className={`cursor-pointer rounded px-2 py-1 text-[10px] font-bold uppercase ${
                      job.status === 'inProgress'
                        ? 'bg-blue-500/20 text-blue-500'
                        : job.status === 'pending'
                          ? 'bg-orange-500/20 text-orange-400'
                          : job.status === 'finished'
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-slate-500/20 text-slate-400'
                    }`}
                  >
                    {getStatusDisplayName(job.status)}
                  </button>
                </div>
                <div className="flex gap-2 border-t border-white/5 pt-2">
                  <button
                    onClick={() => onNavigate('job-detail', job.id)}
                    className="text-[10px] font-bold uppercase text-primary"
                  >
                    View Details
                  </button>
                  <span className="text-white/20">|</span>
                  <button
                    onClick={() => {
                      setSelectedJob(job);
                      setShowStatusModal(true);
                    }}
                    className="text-[10px] font-bold uppercase text-slate-500"
                  >
                    Change Status
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>

      {showStatusModal && selectedJob && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-t-3xl border-t border-white/10 bg-background-dark p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">Change Status</h3>
              <button onClick={() => setShowStatusModal(false)} className="text-slate-400">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <p className="mb-4 text-sm text-slate-400">
              Job #{selectedJob.jobCode} - {selectedJob.name}
            </p>
            <div className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto">
              {SHOP_FLOOR_COLUMNS.map((col) => (
                <button
                  key={col.id}
                  onClick={() => handleStatusChange(col.id as JobStatus)}
                  className={`rounded-lg p-3 text-left transition-colors ${
                    selectedJob.status === col.id
                      ? 'bg-primary text-white'
                      : 'bg-white/5 text-slate-300 hover:bg-white/10'
                  }`}
                >
                  <span className="text-sm font-bold">{col.title}</span>
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowStatusModal(false)}
              className="mt-4 w-full rounded-xl bg-white/10 py-3 font-bold text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {showTrelloImport && (
        <TrelloImport
          onClose={() => setShowTrelloImport(false)}
          onImportComplete={() => {
            // Refresh the page to show new jobs
            window.location.reload();
          }}
        />
      )}
    </div>
  );
};

export default AdminConsole;

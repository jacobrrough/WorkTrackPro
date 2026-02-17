import React, { useState, useMemo } from 'react';
import { User, ViewState, Job, Shift, InventoryItem, getStatusDisplayName } from '@/core/types';
import QuickScanButton from './QuickScanButton';
import { useToast } from './Toast';
import { durationMs, formatDurationShort, formatDurationHours } from './lib/timeUtils';
import { Card } from './components/ui/Card';
import { Button } from './components/ui/Button';

interface DashboardProps {
  user: User;
  onNavigate: (view: ViewState, id?: string) => void;
  onLogout: () => void;
  activeJob: Job | null;
  activeShift: Shift | null;
  recentShifts: Shift[];
  jobs: Job[];
  inventory: InventoryItem[];
  onClockOut: () => void;
}

/** Returns true if the job or its contents match the search query (case-insensitive). */
function jobMatchesSearch(job: Job, query: string): boolean {
  if (!query.trim()) return true;
  const q = query.trim().toLowerCase();
  const code = String(job.jobCode ?? '');
  const name = (job.name ?? '').toLowerCase();
  const po = (job.po ?? '').toLowerCase();
  const desc = (job.description ?? '').toLowerCase();
  const bin = (job.binLocation ?? '').toLowerCase();
  const statusLabel = getStatusDisplayName(job.status).toLowerCase();
  const qty = (job.qty ?? '').toLowerCase();
  if (code.toLowerCase().includes(q)) return true;
  if (name.includes(q)) return true;
  if (po.includes(q)) return true;
  if (desc.includes(q)) return true;
  if (bin.includes(q)) return true;
  if (statusLabel.includes(q)) return true;
  if (qty.includes(q)) return true;
  if (job.comments?.some((c) => (c.text ?? '').toLowerCase().includes(q))) return true;
  if (job.inventoryItems?.some((i) => (i.inventoryName ?? '').toLowerCase().includes(q)))
    return true;
  return false;
}

const Dashboard: React.FC<DashboardProps> = ({
  user,
  onNavigate,
  onLogout,
  activeJob,
  activeShift,
  recentShifts,
  jobs,
  inventory,
  onClockOut,
}) => {
  const { showToast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    return jobs.filter((j) => jobMatchesSearch(j, searchQuery));
  }, [jobs, searchQuery]);

  const handleQuickScan = (barcode: string) => {
    // Extract bin location if it has BIN: prefix
    let binLocation = barcode;
    if (barcode.startsWith('BIN:')) {
      binLocation = barcode.substring(4);
    }

    // Search for active job with this bin location
    const job = jobs.find((j) => j.binLocation === binLocation && j.active);
    if (job) {
      onNavigate('job-detail', job.id);
      showToast(`Found Job #${job.jobCode} at ${binLocation}`, 'success');
      return;
    }

    // Search for inventory item with this bin location
    const item = inventory.find((i) => i.binLocation === binLocation);
    if (item) {
      onNavigate('inventory-detail', item.id);
      showToast(`Found ${item.name} at ${binLocation}`, 'success');
      return;
    }

    // Try legacy barcode field for inventory (backward compatibility)
    const itemByBarcode = inventory.find((i) => i.barcode === barcode);
    if (itemByBarcode) {
      onNavigate('inventory-detail', itemByBarcode.id);
      showToast(`Found ${itemByBarcode.name}`, 'success');
      return;
    }

    // Nothing found at this location
    showToast(`No active job or inventory item found at location: ${binLocation}`, 'error');
  };

  const getJobCode = (id: string) => jobs.find((j) => j.id === id)?.jobCode?.toString() || 'N/A';

  const formatActiveDuration = (startTime: string) =>
    formatDurationShort(durationMs(startTime, null));

  const formatShiftHours = (shift: Shift): string => {
    if (!shift.clockOutTime) return '--';
    return formatDurationHours(durationMs(shift.clockInTime, shift.clockOutTime));
  };

  return (
    <div className="flex min-h-screen flex-col pb-20 dark:bg-background-dark">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-primary/10 bg-background-light dark:bg-background-dark">
        <div className="flex items-center justify-between p-4">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary">
              <span className="material-symbols-outlined">person</span>
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-primary">
                {user.isAdmin ? 'Administrator' : 'Employee'}
              </p>
              <h1 className="truncate text-lg font-bold leading-tight tracking-tight text-white">
                {user.name || user.email.split('@')[0]}
              </h1>
              <p className="sr-only">WorkTrack Pro — Home</p>
            </div>
          </div>
          <button
            onClick={onLogout}
            className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/10 text-red-400 transition-colors hover:bg-red-500/20"
            title="Logout"
          >
            <span className="material-symbols-outlined">logout</span>
          </button>
        </div>
        {/* Search all jobs */}
        <div className="px-4 pb-4">
          <div className="relative">
            <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xl text-slate-400">
              search
            </span>
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search jobs, PO, description, bin, status..."
              className="w-full rounded-xl border border-white/10 bg-white/5 py-3 pl-10 pr-4 text-white placeholder:text-slate-500 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
              aria-label="Search all jobs and their contents"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                aria-label="Clear search"
              >
                <span className="material-symbols-outlined text-xl">close</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <main
        className="flex-1 overflow-y-auto"
        style={{ WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}
      >
        {/* Search results */}
        {searchQuery.trim() && (
          <div className="px-4 pb-4 pt-2">
            <h3 className="mb-2 text-sm font-bold text-white">
              {searchResults.length === 0
                ? 'No jobs match your search'
                : `${searchResults.length} job${searchResults.length === 1 ? '' : 's'} found`}
            </h3>
            <div className="max-h-[50vh] space-y-2 overflow-y-auto">
              {searchResults.map((job) => (
                <button
                  key={job.id}
                  onClick={() => onNavigate('job-detail', job.id)}
                  className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-card-dark/60 p-3 text-left transition-all hover:border-primary/30 hover:bg-card-dark active:scale-[0.99]"
                >
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/20 text-primary">
                    <span className="material-symbols-outlined text-xl">work</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold text-white">Job #{job.jobCode}</p>
                    <p className="truncate text-sm text-slate-400">{job.name}</p>
                    {(job.po || job.binLocation) && (
                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        {[job.po, job.binLocation].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 text-xs font-medium text-slate-400">
                    {getStatusDisplayName(job.status)}
                  </span>
                  <span className="material-symbols-outlined text-xl text-slate-400">
                    chevron_right
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Active Job Card - Streamlined */}
        <div className="p-4">
          {activeJob && activeShift ? (
            <Card
              onClick={() => onNavigate('job-detail', activeJob.id)}
              className="border-2 border-green-500/30 bg-gradient-to-br from-green-500/20 to-emerald-500/10 hover:border-green-500/50"
            >
              <div className="flex w-full flex-col items-stretch justify-center gap-2 px-5 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="size-3 animate-pulse rounded-full bg-green-500"></div>
                    <span className="text-xs font-bold uppercase tracking-widest text-green-400">
                      Active
                    </span>
                  </div>
                  <span className="text-sm font-bold text-green-400">
                    {formatActiveDuration(activeShift.clockInTime)}
                  </span>
                </div>
                <p className="text-xl font-extrabold leading-tight tracking-tight text-white">
                  Job #{activeJob.jobCode}
                </p>
                <p className="truncate text-sm font-medium text-slate-300">{activeJob.name}</p>
                <Button
                  variant="danger"
                  fullWidth
                  icon="schedule"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClockOut();
                  }}
                  className="mt-3"
                >
                  Clock Out
                </Button>
              </div>
            </Card>
          ) : (
            <div className="rounded-xl border border-white/5 bg-card-dark p-6">
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1">
                  <h3 className="text-base font-bold text-white">Start Working</h3>
                  <p className="mt-1 text-xs text-slate-400">Select a job to begin</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => onNavigate('board-shop')}
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white shadow-lg shadow-primary/20 transition-colors hover:bg-primary/90"
                  >
                    <span className="material-symbols-outlined text-lg">view_kanban</span>
                  </button>
                  <button
                    onClick={() => onNavigate('clock-in')}
                    className="rounded-lg border border-primary bg-card-dark px-4 py-2 text-sm font-bold text-primary transition-colors hover:bg-primary/10"
                  >
                    <span className="material-symbols-outlined text-lg">pin</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Quick Actions - Streamlined Grid */}
        <div className="px-4 pt-2">
          <h3 className="mb-3 text-base font-bold text-white">Quick Actions</h3>

          {/* Primary Actions Row */}
          <div className="mb-3 grid grid-cols-2 gap-3">
            <button
              onClick={() => onNavigate('board-shop')}
              className="flex h-24 flex-col items-center justify-center gap-2 rounded-xl border border-blue-500/30 bg-gradient-to-br from-blue-500/20 to-blue-600/10 text-white transition-all hover:border-blue-500/50 active:scale-[0.98]"
            >
              <span className="material-symbols-outlined text-3xl text-blue-400">view_kanban</span>
              <span className="text-sm font-bold">Shop Floor</span>
            </button>

            <button
              onClick={() => onNavigate('inventory')}
              className="flex h-24 flex-col items-center justify-center gap-2 rounded-xl border border-purple-500/30 bg-gradient-to-br from-purple-500/20 to-purple-600/10 text-white transition-all hover:border-purple-500/50 active:scale-[0.98]"
            >
              <span className="material-symbols-outlined text-3xl text-purple-400">
                inventory_2
              </span>
              <span className="text-sm font-bold">Inventory</span>
            </button>
          </div>

          {/* Needs ordering - quick link */}
          <div className="mt-2">
            <button
              onClick={() => onNavigate('needs-ordering')}
              className="flex w-full items-center gap-2 rounded-lg border border-white/5 bg-card-dark/40 px-4 py-2.5 text-left text-sm font-medium text-slate-300 transition-colors hover:border-primary/20 hover:bg-card-dark/60 hover:text-white"
            >
              <span className="material-symbols-outlined text-lg text-amber-400">shopping_cart</span>
              <span>Needs ordering</span>
              <span className="material-symbols-outlined ml-auto text-lg text-slate-500">
                chevron_right
              </span>
            </button>
          </div>

          {/* Secondary Actions Row */}
          <div className="grid grid-cols-2 gap-3">
            {user.isAdmin && (
              <button
                onClick={() => onNavigate('admin-create-job')}
                className="flex h-24 flex-col items-center justify-center gap-2 rounded-xl border border-primary/30 bg-gradient-to-br from-primary/20 to-primary/10 text-white transition-all hover:border-primary/50 active:scale-[0.98]"
              >
                <span className="material-symbols-outlined text-3xl text-primary">add_circle</span>
                <span className="text-sm font-bold">New Job</span>
              </button>
            )}

            <button
              onClick={() => onNavigate('time-reports')}
              className="flex h-24 flex-col items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 text-white transition-all hover:border-emerald-500/50 active:scale-[0.98]"
            >
              <span className="material-symbols-outlined text-3xl text-emerald-400">schedule</span>
              <span className="text-sm font-bold">Time</span>
            </button>

            {user.isAdmin && (
              <button
                onClick={() => onNavigate('board-admin')}
                className="flex h-24 flex-col items-center justify-center gap-2 rounded-xl border border-orange-500/30 bg-gradient-to-br from-orange-500/20 to-orange-600/10 text-white transition-all hover:border-orange-500/50 active:scale-[0.98]"
              >
                <span className="material-symbols-outlined text-3xl text-orange-400">
                  admin_panel_settings
                </span>
                <span className="text-sm font-bold">Admin</span>
              </button>
            )}

            {user.isAdmin && (
              <button
                onClick={() => onNavigate('quotes')}
                className="flex h-24 flex-col items-center justify-center gap-2 rounded-xl border border-yellow-500/30 bg-gradient-to-br from-yellow-500/20 to-amber-600/10 text-white transition-all hover:border-yellow-500/50 active:scale-[0.98]"
              >
                <span className="material-symbols-outlined text-3xl text-yellow-400">
                  receipt_long
                </span>
                <span className="text-sm font-bold">Quotes</span>
              </button>
            )}
          </div>
        </div>

        {/* Recent Activity - Streamlined */}
        {recentShifts.length > 0 && (
          <>
            <div className="px-4 pb-2 pt-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-white">Recent</h3>
                <button
                  onClick={() => onNavigate('time-reports')}
                  className="text-xs font-bold uppercase tracking-wider text-primary hover:text-primary/80"
                >
                  See All
                </button>
              </div>
            </div>
            <div className="space-y-2 px-4 pb-4">
              {recentShifts.slice(0, 3).map((s) => {
                const job = jobs.find((j) => j.id === s.job);
                return (
                  <button
                    key={s.id}
                    onClick={() => job && onNavigate('job-detail', job.id)}
                    className="flex w-full items-center gap-3 rounded-lg border border-white/5 bg-card-dark/40 p-3 text-left transition-all hover:border-primary/20 hover:bg-card-dark/60 active:scale-[0.98]"
                  >
                    <div
                      className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${s.clockOutTime ? 'bg-slate-500/10 text-slate-500' : 'bg-green-500/10 text-green-500'}`}
                    >
                      <span className="material-symbols-outlined text-lg">
                        {s.clockOutTime ? 'check_circle' : 'play_circle'}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-white">
                        Job #{job?.jobCode || s.jobCode || getJobCode(s.job)}
                      </p>
                      <p className="truncate text-xs text-slate-400">
                        {s.jobName || job?.name || 'Unknown Job'}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-bold text-white">{formatShiftHours(s)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </main>

      {/* Quick Scan FAB - Only show when no active job */}
      {!activeJob && (
        <QuickScanButton
          onScanComplete={handleQuickScan}
          onError={(msg) => showToast(msg, 'error')}
        />
      )}
    </div>
  );
};

export default Dashboard;

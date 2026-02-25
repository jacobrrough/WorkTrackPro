import React, { Suspense, useEffect, useState } from 'react';
import { useApp } from './AppContext';
import { useNavigation } from '@/contexts/NavigationContext';
import { ViewState } from '@/core/types';
import { useToast } from './Toast';
import { SkipLink } from './components/SkipLink';
import { durationMs, formatDurationHMS } from './lib/timeUtils';
import { lazyWithRetry } from './lib/lazyWithRetry';

const QRScanner = lazyWithRetry(() => import('./components/QRScanner'), 'QRScanner');

interface DashboardQuickAction {
  key: string;
  title: string;
  subtitle: string;
  icon: string;
  iconClassName: string;
  cardClassName: string;
  ariaLabel: string;
  onClick: () => void;
  adminOnly?: boolean;
}

interface DashboardProps {
  onNavigate: (view: ViewState, id?: string) => void;
}

const Dashboard: React.FC<DashboardProps> = ({ onNavigate }) => {
  const {
    currentUser,
    jobs,
    inventory,
    activeShift,
    activeJob,
    logout,
    clockOut,
    startLunch,
    endLunch,
  } = useApp();
  const { showToast } = useToast();
  const isAdmin = currentUser?.isAdmin ?? false;
  const { state: navState, updateState } = useNavigation();
  const [searchInput, setSearchInput] = useState(navState.searchTerm);
  const [showScanner, setShowScanner] = useState(false);
  const [isTrackerOpen, setIsTrackerOpen] = useState(false);
  const [isClockOutLoading, setIsClockOutLoading] = useState(false);
  const [isLunchLoading, setIsLunchLoading] = useState(false);
  const [shiftTimer, setShiftTimer] = useState('00:00:00');
  const [lunchTimer, setLunchTimer] = useState('00:00:00');
  const shiftClockInTime = activeShift?.clockInTime ?? null;
  const shiftClockOutTime = activeShift?.clockOutTime ?? null;

  const activeCount = jobs.filter((j) => j.status === 'inProgress').length;
  const pendingCount = jobs.filter((j) => j.status === 'pending').length;
  const isOnLunch = Boolean(activeShift?.lunchStartTime && !activeShift?.lunchEndTime);
  const hasCompletedLunch = Boolean(activeShift?.lunchStartTime && activeShift?.lunchEndTime);
  const resumeJobId =
    navState.lastViewedJobId && jobs.some((job) => job.id === navState.lastViewedJobId)
      ? navState.lastViewedJobId
      : null;

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateState({ searchTerm: searchInput.trim() });
    onNavigate('board-shop');
  };

  useEffect(() => {
    setSearchInput(navState.searchTerm);
  }, [navState.searchTerm]);

  const handleScanComplete = (scannedData: string) => {
    setShowScanner(false);

    // Try to match scanned code to inventory or job
    const inventoryItem = inventory.find(
      (item) => item.id === scannedData || item.barcode === scannedData
    );
    const job = jobs.find((j) => j.id === scannedData || j.jobCode.toString() === scannedData);

    if (inventoryItem) {
      showToast(`Found inventory: ${inventoryItem.name}`, 'success');
      onNavigate('inventory-detail', inventoryItem.id);
    } else if (job) {
      showToast(`Found job: ${job.jobCode}`, 'success');
      onNavigate('job-detail', job.id);
    } else {
      // Check if it's a bin location format
      const binMatch = /^[A-Z]\d+[a-z]$/.test(scannedData);
      if (binMatch) {
        showToast(`Scanned bin location: ${scannedData}`, 'info');
        // Could navigate to a bin location search view or show items at that bin
        // For now, just show toast
      } else {
        showToast(`Scanned: ${scannedData} (not found)`, 'warning');
      }
    }
  };

  useEffect(() => {
    if (!activeShift?.id) {
      setIsTrackerOpen(false);
      setIsClockOutLoading(false);
      setIsLunchLoading(false);
      setShiftTimer('00:00:00');
      setLunchTimer('00:00:00');
    }
  }, [activeShift?.id]);

  useEffect(() => {
    if (!shiftClockInTime) {
      setShiftTimer('00:00:00');
      return undefined;
    }

    const updateShiftTimer = () => {
      setShiftTimer(formatDurationHMS(durationMs(shiftClockInTime, shiftClockOutTime)));
    };

    updateShiftTimer();
    const interval = setInterval(updateShiftTimer, 1000);
    return () => clearInterval(interval);
  }, [shiftClockInTime, shiftClockOutTime]);

  useEffect(() => {
    const lunchStart = activeShift?.lunchStartTime;
    if (!lunchStart) {
      setLunchTimer('00:00:00');
      return undefined;
    }

    const updateLunchTimer = () => {
      setLunchTimer(
        formatDurationHMS(
          durationMs(lunchStart, activeShift.lunchEndTime ?? activeShift.clockOutTime ?? null)
        )
      );
    };

    updateLunchTimer();

    if (activeShift.lunchEndTime) {
      return undefined;
    }

    const interval = setInterval(updateLunchTimer, 1000);
    return () => clearInterval(interval);
  }, [
    activeShift?.id,
    activeShift?.lunchStartTime,
    activeShift?.lunchEndTime,
    activeShift?.clockOutTime,
  ]);

  const handleClockOutFromPopup = async () => {
    setIsClockOutLoading(true);
    const success = await clockOut();
    if (success) {
      showToast('Clocked out successfully', 'success');
      setIsTrackerOpen(false);
    } else {
      showToast('Failed to clock out', 'error');
    }
    setIsClockOutLoading(false);
  };

  const handleLunchToggle = async () => {
    if (!activeShift) return;
    if (hasCompletedLunch) {
      showToast('Lunch has already been completed for this shift', 'info');
      return;
    }

    setIsLunchLoading(true);
    const success = isOnLunch ? await endLunch() : await startLunch();
    if (success) {
      showToast(isOnLunch ? 'Clocked out of lunch' : 'Clocked into lunch', 'success');
    } else {
      showToast(isOnLunch ? 'Unable to clock out of lunch' : 'Unable to clock into lunch', 'error');
    }
    setIsLunchLoading(false);
  };

  const quickActionButtonBaseClassName =
    'flex min-h-[7.25rem] w-full touch-manipulation flex-col items-start gap-3 rounded-sm border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 active:opacity-90';

  const quickActions: DashboardQuickAction[] = [
    {
      key: 'board-shop',
      title: 'Shop Floor',
      subtitle: `${activeCount} active · ${pendingCount} pending`,
      icon: 'view_kanban',
      iconClassName: 'text-blue-500',
      cardClassName: 'border-blue-500/30 bg-gradient-to-br from-blue-600/20 to-cyan-600/20',
      ariaLabel: 'Open shop floor board',
      onClick: () => onNavigate('board-shop'),
    },
    ...(resumeJobId
      ? [
          {
            key: 'resume-job',
            title: 'Resume Job',
            subtitle: 'Open last viewed',
            icon: 'history',
            iconClassName: 'text-violet-400',
            cardClassName:
              'border-violet-500/30 bg-gradient-to-br from-violet-600/20 to-purple-700/20',
            ariaLabel: 'Open last viewed job',
            onClick: () => onNavigate('job-detail', resumeJobId),
          } satisfies DashboardQuickAction,
        ]
      : []),
    {
      key: 'inventory',
      title: 'Inventory',
      subtitle: 'Stock & ordering',
      icon: 'inventory_2',
      iconClassName: 'text-primary',
      cardClassName: 'border-primary/30 bg-gradient-to-br from-primary/20 to-purple-600/20',
      ariaLabel: 'Open inventory',
      onClick: () => onNavigate('inventory'),
    },
    {
      key: 'scan',
      title: 'Scan',
      subtitle: 'QR Code',
      icon: 'qr_code_scanner',
      iconClassName: 'text-amber-500',
      cardClassName: 'border-amber-500/30 bg-gradient-to-br from-amber-600/20 to-orange-600/20',
      ariaLabel: 'Open QR scanner',
      onClick: () => setShowScanner(true),
    },
    {
      key: 'create-job',
      title: 'New Job',
      subtitle: 'Create job',
      icon: 'add_circle',
      iconClassName: 'text-green-500',
      cardClassName: 'border-green-500/30 bg-gradient-to-br from-green-600/20 to-emerald-600/20',
      ariaLabel: 'Create a new job',
      onClick: () => onNavigate('create-job'),
      adminOnly: true,
    },
    {
      key: 'calendar',
      title: 'Calendar',
      subtitle: 'Job timeline',
      icon: 'calendar_month',
      iconClassName: 'text-cyan-500',
      cardClassName: 'border-cyan-500/30 bg-gradient-to-br from-cyan-600/20 to-blue-600/20',
      ariaLabel: 'Open calendar',
      onClick: () => onNavigate('calendar'),
    },
    {
      key: 'parts',
      title: 'Parts',
      subtitle: 'Parts repository',
      icon: 'precision_manufacturing',
      iconClassName: 'text-emerald-500',
      cardClassName: 'border-emerald-500/30 bg-gradient-to-br from-emerald-600/20 to-teal-600/20',
      ariaLabel: 'Open parts repository',
      onClick: () => onNavigate('parts'),
      adminOnly: true,
    },
    {
      key: 'quotes',
      title: 'Quotes',
      subtitle: 'Pricing & estimates',
      icon: 'request_quote',
      iconClassName: 'text-fuchsia-400',
      cardClassName: 'border-fuchsia-500/30 bg-gradient-to-br from-fuchsia-600/20 to-purple-700/20',
      ariaLabel: 'Open quotes',
      onClick: () => onNavigate('quotes'),
      adminOnly: true,
    },
    {
      key: 'board-admin',
      title: 'Admin Board',
      subtitle: 'Kanban view',
      icon: 'view_kanban',
      iconClassName: 'text-orange-500',
      cardClassName: 'border-orange-500/30 bg-gradient-to-br from-orange-600/20 to-red-600/20',
      ariaLabel: 'Open admin board',
      onClick: () => onNavigate('board-admin'),
      adminOnly: true,
    },
    {
      key: 'time-reports',
      title: 'Time Reports',
      subtitle: 'View hours',
      icon: 'analytics',
      iconClassName: 'text-green-500',
      cardClassName: 'border-green-500/30 bg-gradient-to-br from-green-600/20 to-emerald-600/20',
      ariaLabel: 'Open time reports',
      onClick: () => onNavigate('time-reports'),
      adminOnly: true,
    },
    {
      key: 'admin-settings',
      title: 'Settings',
      subtitle: 'Labor rate & upcharge',
      icon: 'settings',
      iconClassName: 'text-slate-400',
      cardClassName: 'border-slate-500/30 bg-gradient-to-br from-slate-600/20 to-slate-700/20',
      ariaLabel: 'Open admin settings',
      onClick: () => onNavigate('admin-settings'),
      adminOnly: true,
    },
    {
      key: 'trello-import',
      title: 'Import Trello',
      subtitle: 'From JSON',
      icon: 'upload_file',
      iconClassName: 'text-purple-500',
      cardClassName: 'border-purple-500/30 bg-gradient-to-br from-purple-600/20 to-pink-600/20',
      ariaLabel: 'Open Trello import',
      onClick: () => onNavigate('trello-import'),
      adminOnly: true,
    },
  ];

  const visibleQuickActions = quickActions.filter((action) => isAdmin || !action.adminOnly);

  return (
    <div className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-background-dark">
      <SkipLink />
      <header className="sticky top-0 z-50 flex items-center justify-between border-b border-white/10 bg-background-dark/95 px-4 py-3 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-primary/20">
            <span aria-hidden="true" className="material-symbols-outlined text-primary">
              person
            </span>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-primary">
              {isAdmin ? 'Administrator' : 'User'}
            </p>
            <p className="text-sm font-semibold text-white">
              {currentUser?.name || currentUser?.email || '—'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={logout}
          className="flex size-11 touch-manipulation items-center justify-center rounded-sm text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
          aria-label="Log out"
        >
          <span aria-hidden="true" className="material-symbols-outlined">
            logout
          </span>
        </button>
      </header>

      <main
        id="main-content"
        tabIndex={-1}
        aria-labelledby="dashboard-heading"
        className="min-h-0 flex-1 overflow-y-auto p-4"
        style={{
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
          paddingBottom: 'max(6rem, env(safe-area-inset-bottom, 0px))',
        }}
      >
        <h1 id="dashboard-heading" className="sr-only">
          Dashboard
        </h1>

        <form onSubmit={handleSearchSubmit} className="mb-4" role="search" aria-label="Search jobs">
          <label htmlFor="dashboard-search" className="sr-only">
            Search jobs, PO, description, bin location, or status
          </label>
          <div className="relative">
            <span
              aria-hidden="true"
              className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
            >
              search
            </span>
            <input
              id="dashboard-search"
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search jobs, PO, description, bin, status..."
              className="w-full rounded-sm border border-white/10 bg-[#261a32] py-2.5 pl-10 pr-3 text-white placeholder:text-slate-500 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
              aria-label="Search"
            />
          </div>
        </form>

        <section aria-labelledby="quick-actions-heading">
          <h2
            id="quick-actions-heading"
            className="mb-4 text-lg font-bold tracking-tight text-white"
          >
            Quick Actions
          </h2>
          <ul className="grid grid-cols-2 gap-3" role="list">
            {visibleQuickActions.map((action) => (
              <li key={action.key} className="min-w-0">
                <button
                  type="button"
                  onClick={action.onClick}
                  className={`${quickActionButtonBaseClassName} ${action.cardClassName}`}
                  aria-label={action.ariaLabel}
                >
                  <span
                    aria-hidden="true"
                    className={`material-symbols-outlined text-3xl ${action.iconClassName}`}
                  >
                    {action.icon}
                  </span>
                  <div>
                    <p className="font-bold text-white">{action.title}</p>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-white/50">
                      {action.subtitle}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </main>

      {activeShift && !isTrackerOpen && (
        <button
          type="button"
          onClick={() => setIsTrackerOpen(true)}
          className="fixed bottom-4 right-4 z-40 flex min-h-12 items-center gap-2 rounded-sm border border-primary/30 bg-primary/90 px-4 py-2 text-sm font-bold text-white shadow-lg"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-base">
            schedule
          </span>
          Open Time Tracker
        </button>
      )}

      {activeShift && isTrackerOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 p-3"
          role="dialog"
          aria-modal="true"
          aria-label="Active time tracker"
          onClick={() => setIsTrackerOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-sm border border-primary/30 bg-[#1b1324] p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-primary">
                  Active Shift
                </p>
                <p className="text-base font-bold text-white">
                  {activeJob ? `#${activeJob.jobCode} • ${activeJob.name}` : 'Clocked into job'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsTrackerOpen(false)}
                className="flex size-10 items-center justify-center rounded-sm text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
                aria-label="Close time tracker popup"
              >
                <span aria-hidden="true" className="material-symbols-outlined">
                  close
                </span>
              </button>
            </div>

            <div className="rounded-sm border border-white/10 bg-black/20 p-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Shift Timer
              </p>
              <p className="font-mono text-3xl font-bold text-green-400">{shiftTimer}</p>
              <p className="mt-2 text-xs text-slate-300">
                {isOnLunch
                  ? `On lunch • ${lunchTimer}`
                  : hasCompletedLunch
                    ? `Lunch completed • ${lunchTimer}`
                    : 'Currently working'}
              </p>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={handleClockOutFromPopup}
                disabled={isClockOutLoading}
                className="flex min-h-12 touch-manipulation items-center justify-center gap-2 rounded-sm bg-red-500 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-base">
                  logout
                </span>
                {isClockOutLoading ? 'Clocking out...' : 'Clock Out'}
              </button>
              <button
                type="button"
                onClick={handleLunchToggle}
                disabled={isLunchLoading || hasCompletedLunch}
                className={`flex min-h-12 touch-manipulation items-center justify-center gap-2 rounded-sm px-4 py-3 text-sm font-bold text-white transition-colors disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400 ${
                  isOnLunch
                    ? 'bg-amber-500 hover:bg-amber-600'
                    : hasCompletedLunch
                      ? 'bg-slate-700'
                      : 'bg-primary hover:bg-primary/90'
                }`}
              >
                <span aria-hidden="true" className="material-symbols-outlined text-base">
                  restaurant
                </span>
                {isLunchLoading
                  ? isOnLunch
                    ? 'Clocking out lunch...'
                    : 'Clocking in lunch...'
                  : isOnLunch
                    ? 'Clock Out Lunch'
                    : hasCompletedLunch
                      ? 'Lunch Complete'
                      : 'Clock In Lunch'}
              </button>
            </div>

            {activeJob && (
              <button
                type="button"
                onClick={() => {
                  onNavigate('job-detail', activeJob.id);
                  setIsTrackerOpen(false);
                }}
                className="mt-3 flex min-h-11 w-full touch-manipulation items-center justify-center gap-2 rounded-sm border border-white/15 bg-white/5 px-4 py-2 text-xs font-bold uppercase tracking-wider text-slate-200 transition-colors hover:bg-white/10"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-sm">
                  work
                </span>
                Open Active Job
              </button>
            )}
          </div>
        </div>
      )}

      {/* QR Scanner Modal */}
      {showScanner && (
        <Suspense
          fallback={
            <div
              role="status"
              aria-live="polite"
              className="fixed inset-0 z-50 flex items-center justify-center bg-black"
            >
              <p className="text-sm text-slate-200">Opening scanner...</p>
            </div>
          }
        >
          <QRScanner
            scanType="any"
            onScanComplete={handleScanComplete}
            onClose={() => setShowScanner(false)}
            title="Scan QR Code"
            description="Scan inventory, job, or bin location QR code"
          />
        </Suspense>
      )}
    </div>
  );
};

export default Dashboard;

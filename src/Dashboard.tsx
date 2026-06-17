import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from './AppContext';
import { useNavigation } from '@/contexts/NavigationContext';
import { ViewState } from '@/core/types';
import { useToast } from './Toast';
import { SkipLink } from './components/SkipLink';
import { OfflineIndicator } from './components/OfflineIndicator';
import { OfflinePunchBanner } from './components/OfflinePunchBanner';
import { NotificationBell } from './components/NotificationBell';
import { formatDurationHMS } from './lib/timeUtils';
import { getWorkedShiftMs } from './lib/lunchUtils';
import { lazyWithRetry } from './lib/lazyWithRetry';
import type { Shift } from './core/types';
import BinResultsView from './components/BinResultsView';
import SearchAutocomplete from './components/SearchAutocomplete';
import { EmptyState } from './components/EmptyState';
import { LoadingSpinner } from './Loading';
import { useDashboardPreferencesSync } from '@/hooks/useDashboardPreferencesSync';
import { useScrollRestore } from './hooks/useScrollRestore';
import { useNavigate } from 'react-router-dom';
import { ACCOUNTING_BUILD_ENABLED } from './lib/featureFlags';
import MFAEnrollScreen from './MFAEnrollScreen';
import { mfaService } from '@/services/api/mfa';
import { useAuth } from '@/contexts/AuthContext';

const AIAssistantPanel = lazyWithRetry(
  () => import('./components/AIAssistantPanel'),
  'AIAssistantPanel'
);

/**
 * Isolated timer component — owns its own 1-second interval so that ticking
 * only re-renders this small subtree, not the entire Dashboard.
 */
const ShiftTimerDisplay: React.FC<{ activeShift: Shift }> = React.memo(function ShiftTimerDisplay({
  activeShift,
}) {
  const [display, setDisplay] = useState(() => formatDurationHMS(getWorkedShiftMs(activeShift)));

  useEffect(() => {
    const tick = () => setDisplay(formatDurationHMS(getWorkedShiftMs(activeShift)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [
    activeShift,
    activeShift.lunchStartTime,
    activeShift.lunchEndTime,
    activeShift.lunchMinutesUsed,
    activeShift.clockInTime,
    activeShift.clockOutTime,
  ]);

  return <p className="font-mono text-3xl font-bold text-green-400">{display}</p>;
});

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

/**
 * SecuritySettingsModal — lightweight self-service 2FA manager any signed-in
 * user can reach from the Dashboard header. Shows current status, lets the user
 * set up TOTP (reusing MFAEnrollScreen in 'settings' mode), and — for optional
 * (non-required) users — remove it.
 *
 * AUTH SAFETY: removing the only verified factor for a REQUIRED user (admin)
 * just drops them to aal1, which the gate catches as forced re-enrollment on the
 * next refresh — never a permanent lockout. We still warn before removing, and
 * for required users we steer them to re-enroll rather than leave 2FA off.
 */
const SecuritySettingsModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { currentUser, refreshMfaGate } = useAuth();
  // requireMfa defaults to true and enforcement is admin-scoped (see AuthContext),
  // so an admin is the "required" case here. Non-admins may freely turn 2FA off.
  const isRequired = currentUser?.isAdmin === true;

  const [view, setView] = useState<'status' | 'enroll'>('status');
  const [loading, setLoading] = useState(true);
  const [hasFactor, setHasFactor] = useState(false);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  const loadState = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const state = await mfaService.getState();
      setHasFactor(state.hasVerifiedFactor);
      setFactorId(state.factorId);
    } catch {
      setError('Could not load your two-factor status. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  const handleRemove = useCallback(async () => {
    if (!factorId) return;
    setRemoving(true);
    setError(null);
    const result = await mfaService.unenroll(factorId);
    if (!result.ok) {
      setError(result.error ?? 'Could not remove two-factor authentication.');
      setRemoving(false);
      return;
    }
    // Re-evaluate the gate: for a required user this flips to 'enroll' (forced
    // re-setup, not a lockout); for an optional user it stays 'ok'.
    await refreshMfaGate();
    setRemoving(false);
    setConfirmRemove(false);
    onClose();
  }, [factorId, refreshMfaGate, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-md border border-[#4d3465] bg-background-dark p-4 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-xl font-bold text-white">Security</h3>
          <button
            type="button"
            onClick={onClose}
            className="flex size-11 touch-manipulation items-center justify-center rounded-sm text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            <span aria-hidden="true" className="material-symbols-outlined">
              close
            </span>
          </button>
        </div>

        {view === 'enroll' ? (
          <MFAEnrollScreen
            mode="settings"
            onCancel={() => {
              setView('status');
              void loadState();
            }}
            onDone={() => {
              setView('status');
              void loadState();
            }}
          />
        ) : (
          <div>
            <div className="mb-4 flex items-start gap-3 rounded-sm border border-[#4d3465] bg-[#261a32] p-3">
              <span
                aria-hidden="true"
                className={`material-symbols-outlined text-2xl ${hasFactor ? 'text-green-400' : 'text-amber-400'}`}
              >
                {hasFactor ? 'verified_user' : 'gpp_maybe'}
              </span>
              <div className="flex-1">
                <p className="text-sm font-semibold text-white">Two-factor authentication</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {loading
                    ? 'Checking status…'
                    : hasFactor
                      ? 'Enabled — your account asks for a code at sign-in.'
                      : isRequired
                        ? 'Required for your account, but not set up yet.'
                        : 'Add a code from an authenticator app for extra security.'}
                </p>
              </div>
            </div>

            {error && (
              <div className="mb-4 rounded-sm border border-red-500/30 bg-red-500/20 p-3">
                <p className="text-center text-sm text-red-400">{error}</p>
              </div>
            )}

            {!loading && !hasFactor && (
              <button
                type="button"
                onClick={() => setView('enroll')}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-sm bg-primary font-bold text-white transition-colors hover:bg-primary/90"
              >
                <span className="material-symbols-outlined text-xl" aria-hidden>
                  add_moderator
                </span>
                Set up two-factor
              </button>
            )}

            {!loading && hasFactor && !confirmRemove && (
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => setView('enroll')}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-sm bg-white/10 font-medium text-white transition-colors hover:bg-white/20"
                >
                  <span className="material-symbols-outlined text-xl" aria-hidden>
                    autorenew
                  </span>
                  Replace authenticator
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmRemove(true)}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-sm border border-red-500/30 font-medium text-red-400 transition-colors hover:bg-red-500/10"
                >
                  <span className="material-symbols-outlined text-xl" aria-hidden>
                    remove_moderator
                  </span>
                  Remove two-factor
                </button>
              </div>
            )}

            {!loading && hasFactor && confirmRemove && (
              <div className="rounded-sm border border-red-500/30 bg-red-500/10 p-3">
                <p className="text-sm font-semibold text-white">
                  Remove two-factor authentication?
                </p>
                <p className="mt-1 text-xs text-slate-300">
                  {isRequired
                    ? 'Two-factor is required for your account. If you remove it you will be asked to set it up again the next time the app checks your access.'
                    : "You'll no longer be asked for a code at sign-in. You can re-enable it any time."}
                </p>
                <div className="mt-3 flex gap-3">
                  <button
                    type="button"
                    onClick={() => setConfirmRemove(false)}
                    disabled={removing}
                    className="h-11 flex-1 rounded-sm bg-white/10 font-medium text-white transition-colors hover:bg-white/20 disabled:opacity-50"
                  >
                    Keep
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRemove()}
                    disabled={removing}
                    className="flex h-11 flex-1 items-center justify-center gap-2 rounded-sm bg-red-500/80 font-bold text-white transition-colors hover:bg-red-500 disabled:opacity-50"
                  >
                    {removing ? (
                      <>
                        <div className="h-4 w-4 animate-spin rounded-sm border-2 border-white border-t-transparent" />
                        <span>Removing…</span>
                      </>
                    ) : (
                      <span>Remove</span>
                    )}
                  </button>
                </div>
              </div>
            )}

            {loading && (
              <div className="flex justify-center py-4">
                <div className="h-6 w-6 animate-spin rounded-sm border-2 border-primary border-t-transparent" />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

interface DashboardProps {
  onNavigate: (view: ViewState, id?: string) => void;
}

const Dashboard: React.FC<DashboardProps> = ({ onNavigate }) => {
  const { ref: scrollRef, onScroll: handleScroll } = useScrollRestore<HTMLElement>('dashboard');
  const {
    currentUser,
    jobs,
    inventory,
    dataPending,
    activeShift,
    activeJob,
    logout,
    clockOut,
    updateJob,
    updateInventoryItem,
    refreshJobs,
    refreshInventory,
  } = useApp();
  const { showToast } = useToast();
  const isAdmin = currentUser?.isAdmin ?? false;
  const navigate = useNavigate();
  const { state: navState, updateState } = useNavigation();
  const [searchInput, setSearchInput] = useState(navState.searchTerm);
  const [showScanner, setShowScanner] = useState(false);
  const [scannedBinLocation, setScannedBinLocation] = useState<string | null>(null);
  const [addingJobToBin, setAddingJobToBin] = useState(false);
  const [isTrackerOpen, setIsTrackerOpen] = useState(false);
  const [isClockOutLoading, setIsClockOutLoading] = useState(false);
  const [isEditingActions, setIsEditingActions] = useState(false);
  const [showAIAssistant, setShowAIAssistant] = useState(false);
  const [showSecurity, setShowSecurity] = useState(false);
  const { syncToServer } = useDashboardPreferencesSync(!!currentUser);

  const activeCount = jobs.filter((j) => j.status === 'inProgress').length;
  const pendingCount = jobs.filter((j) => j.status === 'pending').length;
  const resumeJobId =
    navState.lastViewedJobId && jobs.some((job) => job.id === navState.lastViewedJobId)
      ? navState.lastViewedJobId
      : null;

  const handleSearchSubmit = (term: string) => {
    updateState({ searchTerm: term });
    onNavigate(isAdmin ? 'board-admin' : 'board-shop');
  };

  useEffect(() => {
    setSearchInput(navState.searchTerm);
  }, [navState.searchTerm]);

  const handleScanComplete = (scannedData: string) => {
    const trimmed = scannedData.trim();

    if (addingJobToBin && scannedBinLocation) {
      setShowScanner(false);
      setAddingJobToBin(false);
      const job = jobs.find((j) => j.id === trimmed || j.jobCode.toString() === trimmed);
      if (job) {
        updateJob(job.id, { binLocation: scannedBinLocation })
          .then(() => {
            showToast(`Job #${job.jobCode} added to bin ${scannedBinLocation}`, 'success');
            return refreshJobs();
          })
          .catch(() => showToast('Failed to add job to bin', 'error'));
      } else {
        showToast('Scan a job code to add to this bin', 'warning');
      }
      return;
    }

    setShowScanner(false);

    const inventoryItem = inventory.find((item) => item.id === trimmed || item.barcode === trimmed);
    const job = jobs.find((j) => j.id === trimmed || j.jobCode.toString() === trimmed);

    if (inventoryItem) {
      showToast(`Found inventory: ${inventoryItem.name}`, 'success');
      onNavigate('inventory-detail', inventoryItem.id);
    } else if (job) {
      showToast(`Found job: ${job.jobCode}`, 'success');
      onNavigate('job-detail', job.id);
    } else {
      const binMatch = /^[A-Z]\d+[a-z]$/.test(trimmed);
      if (binMatch) {
        setScannedBinLocation(trimmed);
      } else {
        showToast(`Scanned: ${trimmed} (not found)`, 'warning');
      }
    }
  };

  useEffect(() => {
    if (!activeShift?.id) {
      setIsTrackerOpen(false);
      setIsClockOutLoading(false);
    }
  }, [activeShift?.id]);

  // Intercept browser back while the bin-assignment scanner overlay is open so
  // back closes the overlay rather than navigating away from Dashboard.
  useEffect(() => {
    if (!showScanner && !scannedBinLocation) return;
    const handlePopState = () => {
      setShowScanner(false);
      setAddingJobToBin(false);
      setScannedBinLocation(null);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [showScanner, scannedBinLocation]);

  const handleClockOutFromPopup = async () => {
    setIsClockOutLoading(true);
    const result = await clockOut();
    if (result.ok) {
      showToast('Clocked out successfully', 'success');
      setIsTrackerOpen(false);
    } else if (result.queued) {
      showToast('Saved offline — will sync when connected', 'warning');
      setIsTrackerOpen(false);
    } else {
      showToast('Failed to clock out', 'error');
    }
    setIsClockOutLoading(false);
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
      onClick: () => onNavigate('scanner'),
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
      key: 'chat',
      title: 'Chat',
      subtitle: 'Team messenger',
      icon: 'chat_bubble',
      iconClassName: 'text-indigo-400',
      cardClassName: 'border-indigo-500/30 bg-gradient-to-br from-indigo-600/20 to-blue-700/20',
      ariaLabel: 'Open team chat',
      onClick: () => onNavigate('chat'),
    },
    {
      key: 'boards',
      title: 'Boards',
      subtitle: 'Custom Kanban',
      icon: 'dashboard_customize',
      iconClassName: 'text-teal-500',
      cardClassName: 'border-teal-500/30 bg-gradient-to-br from-teal-600/20 to-cyan-600/20',
      ariaLabel: 'Open custom boards',
      onClick: () => onNavigate('boards'),
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
      subtitle: isAdmin ? 'View hours' : 'Your shifts',
      icon: 'analytics',
      iconClassName: 'text-green-500',
      cardClassName: 'border-green-500/30 bg-gradient-to-br from-green-600/20 to-emerald-600/20',
      ariaLabel: 'Open time reports',
      onClick: () => onNavigate('time-reports'),
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
    {
      key: 'ai-assistant',
      title: 'AI Assistant',
      subtitle: 'Ask anything',
      icon: 'smart_toy',
      iconClassName: 'text-sky-400',
      cardClassName: 'border-sky-500/30 bg-gradient-to-br from-sky-600/20 to-indigo-600/20',
      ariaLabel: 'Open AI assistant',
      onClick: () => setShowAIAssistant(true),
      adminOnly: true,
    },
    // Accounting lives at a real route (/app/accounting), gated by the build flag AND
    // admin-only. Hidden entirely when accounting is off so it's never a dead link.
    ...(ACCOUNTING_BUILD_ENABLED
      ? [
          {
            key: 'accounting',
            title: 'Accounting',
            subtitle: 'Invoices, bills & ledger',
            icon: 'account_balance',
            iconClassName: 'text-amber-400',
            cardClassName:
              'border-amber-500/30 bg-gradient-to-br from-amber-600/20 to-yellow-700/20',
            ariaLabel: 'Open accounting',
            onClick: () => navigate('/app/accounting'),
            adminOnly: true,
          } satisfies DashboardQuickAction,
        ]
      : []),
  ];

  const roleFilteredActions = quickActions.filter((action) => isAdmin || !action.adminOnly);

  const orderedActions = useMemo(() => {
    const order = navState.quickActionOrder;
    if (order.length === 0) return roleFilteredActions;
    const indexed = new Map(roleFilteredActions.map((a) => [a.key, a]));
    const sorted: DashboardQuickAction[] = [];
    for (const key of order) {
      const action = indexed.get(key);
      if (action) {
        sorted.push(action);
        indexed.delete(key);
      }
    }
    for (const action of indexed.values()) sorted.push(action);
    return sorted;
  }, [roleFilteredActions, navState.quickActionOrder]);

  const visibleQuickActions = isEditingActions
    ? orderedActions
    : orderedActions.filter((a) => !navState.hiddenQuickActions.includes(a.key));

  const moveAction = useCallback(
    (key: string, direction: -1 | 1) => {
      const keys = orderedActions.map((a) => a.key);
      const idx = keys.indexOf(key);
      const target = idx + direction;
      if (target < 0 || target >= keys.length) return;
      [keys[idx], keys[target]] = [keys[target], keys[idx]];
      updateState({ quickActionOrder: keys });
      syncToServer({ quickActionOrder: keys, hiddenQuickActions: navState.hiddenQuickActions });
    },
    [orderedActions, updateState, syncToServer, navState.hiddenQuickActions]
  );

  const toggleHidden = useCallback(
    (key: string) => {
      const hidden = navState.hiddenQuickActions;
      const next = hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key];
      updateState({ hiddenQuickActions: next });
      syncToServer({ quickActionOrder: navState.quickActionOrder, hiddenQuickActions: next });
    },
    [navState.hiddenQuickActions, navState.quickActionOrder, updateState, syncToServer]
  );

  const resetCustomization = useCallback(() => {
    updateState({ quickActionOrder: [], hiddenQuickActions: [] });
    syncToServer({ quickActionOrder: [], hiddenQuickActions: [] });
  }, [updateState, syncToServer]);

  return (
    <div className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-background-dark">
      <SkipLink />
      <header className="safe-area-top sticky top-0 z-50 flex items-center justify-between border-b border-white/10 bg-background-dark/95 px-4 py-3 backdrop-blur-md">
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
        <div className="flex items-center gap-2">
          <OfflineIndicator />
          <NotificationBell onNavigate={onNavigate} />
          <button
            type="button"
            onClick={() => setShowSecurity(true)}
            className="flex size-11 touch-manipulation items-center justify-center rounded-sm text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Security and two-factor authentication"
            title="Security / Two-factor"
          >
            <span aria-hidden="true" className="material-symbols-outlined">
              shield_person
            </span>
          </button>
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
        </div>
      </header>

      {showSecurity && <SecuritySettingsModal onClose={() => setShowSecurity(false)} />}

      <OfflinePunchBanner />

      <main
        ref={scrollRef}
        onScroll={handleScroll}
        id="main-content"
        tabIndex={-1}
        aria-labelledby="dashboard-heading"
        className="content-above-nav min-h-0 flex-1 overflow-y-auto p-4"
        style={{
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
        }}
      >
        <h1 id="dashboard-heading" className="sr-only">
          Dashboard
        </h1>

        <SearchAutocomplete
          jobs={jobs}
          inventory={inventory}
          isAdmin={isAdmin}
          searchInput={searchInput}
          onSearchInputChange={setSearchInput}
          onSubmit={handleSearchSubmit}
          onNavigateDirect={onNavigate}
        />

        <section aria-labelledby="quick-actions-heading">
          <div className="mb-4 flex items-center justify-between">
            <h2 id="quick-actions-heading" className="text-lg font-bold tracking-tight text-white">
              Quick Actions
            </h2>
            <div className="flex items-center gap-2">
              {isEditingActions && (
                <button
                  type="button"
                  onClick={resetCustomization}
                  className="flex items-center gap-1 rounded-sm px-2 py-1 text-xs font-medium text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-sm">
                    restart_alt
                  </span>
                  Reset
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsEditingActions(!isEditingActions)}
                className={`flex items-center gap-1 rounded-sm px-2 py-1 text-xs font-medium transition-colors hover:bg-white/10 ${isEditingActions ? 'text-primary' : 'text-slate-400 hover:text-white'}`}
              >
                <span aria-hidden="true" className="material-symbols-outlined text-sm">
                  {isEditingActions ? 'check' : 'edit'}
                </span>
                {isEditingActions ? 'Done' : 'Edit'}
              </button>
            </div>
          </div>
          <ul
            className={isEditingActions ? 'flex flex-col gap-2' : 'grid grid-cols-2 gap-3'}
            role="list"
          >
            {visibleQuickActions.map((action, idx) => {
              const isHidden = navState.hiddenQuickActions.includes(action.key);

              if (isEditingActions) {
                return (
                  <li
                    key={action.key}
                    className={`flex items-center gap-2 rounded-sm border p-2 transition-colors ${isHidden ? 'border-white/5 bg-white/[0.02] opacity-50' : `${action.cardClassName}`}`}
                  >
                    <span
                      aria-hidden="true"
                      className={`material-symbols-outlined text-xl ${isHidden ? 'text-slate-500' : action.iconClassName}`}
                    >
                      {action.icon}
                    </span>
                    <span
                      className={`flex-1 text-sm font-bold ${isHidden ? 'text-slate-500 line-through' : 'text-white'}`}
                    >
                      {action.title}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleHidden(action.key)}
                      className="flex size-8 items-center justify-center rounded-sm text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
                      aria-label={isHidden ? `Show ${action.title}` : `Hide ${action.title}`}
                    >
                      <span aria-hidden="true" className="material-symbols-outlined text-lg">
                        {isHidden ? 'visibility_off' : 'visibility'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => moveAction(action.key, -1)}
                      disabled={idx === 0}
                      className="flex size-8 items-center justify-center rounded-sm text-slate-400 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-25"
                      aria-label={`Move ${action.title} up`}
                    >
                      <span aria-hidden="true" className="material-symbols-outlined text-lg">
                        arrow_upward
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => moveAction(action.key, 1)}
                      disabled={idx === visibleQuickActions.length - 1}
                      className="flex size-8 items-center justify-center rounded-sm text-slate-400 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-25"
                      aria-label={`Move ${action.title} down`}
                    >
                      <span aria-hidden="true" className="material-symbols-outlined text-lg">
                        arrow_downward
                      </span>
                    </button>
                  </li>
                );
              }

              return (
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
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="active-jobs-heading" className="mt-6">
          <h2 id="active-jobs-heading" className="mb-3 text-lg font-bold tracking-tight text-white">
            Active Jobs
          </h2>
          {dataPending ? (
            <div className="flex justify-center py-12" role="status" aria-live="polite">
              <LoadingSpinner size="small" text="Loading jobs…" />
            </div>
          ) : activeCount + pendingCount === 0 ? (
            <EmptyState
              icon="work_off"
              title="No active jobs"
              hint="Jobs that are pending or in progress will show up here. Use the Shop Floor board to get started."
            />
          ) : (
            <button
              type="button"
              onClick={() => onNavigate('board-shop')}
              className="flex w-full touch-manipulation items-center justify-between gap-3 rounded-sm border border-white/10 bg-white/5 p-4 text-left transition-colors hover:bg-white/10"
            >
              <div>
                <p className="font-bold text-white">
                  {activeCount} in progress · {pendingCount} pending
                </p>
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/50">
                  Tap to open the shop floor board
                </p>
              </div>
              <span aria-hidden="true" className="material-symbols-outlined text-primary">
                arrow_forward
              </span>
            </button>
          )}
        </section>
      </main>

      {activeShift && !isTrackerOpen && (
        <button
          type="button"
          onClick={() => setIsTrackerOpen(true)}
          className="fixed bottom-20 right-4 z-[45] flex min-h-[44px] touch-manipulation items-center gap-2 rounded-sm border border-primary/30 bg-primary/90 px-4 py-2 text-sm font-bold text-white shadow-lg"
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
              {activeShift && <ShiftTimerDisplay activeShift={activeShift} />}
              <p className="mt-2 text-xs text-slate-300">Tracking active job time.</p>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3">
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

      {/* Bin results modal (dashboard scanner only: after scanning a bin) */}
      {scannedBinLocation && (
        <BinResultsView
          binLocation={scannedBinLocation}
          jobs={jobs}
          inventory={inventory}
          onUpdateJob={updateJob}
          onUpdateInventoryItem={updateInventoryItem}
          onRefreshJobs={refreshJobs}
          onRefreshInventory={refreshInventory}
          onNavigate={onNavigate}
          onClose={() => setScannedBinLocation(null)}
          onAddJobToBin={() => {
            setAddingJobToBin(true);
            setShowScanner(true);
          }}
        />
      )}

      {/* AI Assistant Panel */}
      {showAIAssistant && (
        <Suspense fallback={null}>
          <AIAssistantPanel onClose={() => setShowAIAssistant(false)} />
        </Suspense>
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
            onClose={() => {
              setShowScanner(false);
              setAddingJobToBin(false);
            }}
            title={addingJobToBin ? 'Scan job to add to bin' : 'Scan QR Code'}
            description={
              addingJobToBin
                ? 'Scan a job code to assign this bin'
                : 'Scan inventory, job, or bin location QR code'
            }
          />
        </Suspense>
      )}
    </div>
  );
};

export default Dashboard;

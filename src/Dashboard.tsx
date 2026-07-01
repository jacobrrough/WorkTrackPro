import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useDashboardPreferencesSync } from '@/hooks/useDashboardPreferencesSync';
import { useScrollRestore } from './hooks/useScrollRestore';
import { useNavigate } from 'react-router-dom';
import { ACCOUNTING_BUILD_ENABLED } from './lib/featureFlags';
import MFAEnrollScreen from './MFAEnrollScreen';
import { mfaService } from '@/services/api/mfa';
import { useAuth } from '@/contexts/AuthContext';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { reorderQuickActionKeys } from './lib/quickActions';

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
  ariaLabel: string;
  onClick: () => void;
  adminOnly?: boolean;
  /** Hidden for admins by default (e.g. Shop Floor, since admins use the Admin Board). */
  hideForAdmin?: boolean;
}

/** Droppable id for the "drop here to hide" zone shown while dragging a quick action. */
const QUICK_ACTION_HIDE_ZONE_ID = '__quick-action-hide-zone__';

/**
 * Shared activation gate for both the pointer and touch drag sensors: a card only
 * lifts after a deliberate ~1s press-and-hold that stays within 5px. Any earlier
 * movement is treated as a click/scroll, so a reorder never triggers by accident.
 */
const QUICK_ACTION_DRAG_ACTIVATION = { delay: 1000, tolerance: 5 } as const;

const quickActionCardBaseClassName =
  'app-quick-card touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-app';

/** The visual contents of a quick-action card — shared by the live card and the drag clone. */
const QuickActionCardInner: React.FC<{ action: DashboardQuickAction }> = ({ action }) => (
  <>
    <span aria-hidden="true" className="app-icon-badge">
      <span className="material-symbols-outlined text-2xl">{action.icon}</span>
    </span>
    <span className="app-qa-text min-w-0 flex-1">
      <span className="block truncate text-sm font-semibold text-white">{action.title}</span>
      {action.subtitle && (
        <span className="app-qa-sub mt-0.5 block truncate text-xs text-muted">
          {action.subtitle}
        </span>
      )}
    </span>
  </>
);

/**
 * A single quick-action card that is sortable via drag. Both mouse and touch
 * require a deliberate ~1s press-and-hold before the card lifts (see the sensor
 * activation constraints). A plain tap/click still fires onClick because a drag
 * only begins once the hold completes without the pointer drifting.
 *
 * Touch behaviour is iOS-like: a *moving* swipe scrolls the page (we leave
 * vertical panning to the browser via `touch-action: pan-y`), while a *stationary*
 * press-and-hold lifts the card — at which point handleDragStart fires a haptic
 * "click" so it feels picked up, exactly like rearranging apps on a home screen.
 *
 * While this card is the one being dragged, its slot renders a dashed skeleton
 * placeholder that tracks the projected drop position — the lifted card itself
 * floats in the DragOverlay — so it's clear where it will land.
 */
const SortableQuickActionCard: React.FC<{ action: DashboardQuickAction }> = ({ action }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: action.key,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    // Let the browser handle vertical scrolling so a swipe that starts on a card
    // still scrolls the page; the TouchSensor's hold-delay is what distinguishes
    // a deliberate pick-up from a scroll. (Blocking all touch-action here was the
    // bug that made scrolling feel like it was being eaten / mistaken for a drag.)
    touchAction: 'pan-y',
  };

  return (
    <li ref={setNodeRef} style={style} className="min-w-0">
      {isDragging ? (
        <div
          aria-hidden="true"
          className="h-full min-h-[4.25rem] rounded-2xl border-2 border-dashed border-primary/60 bg-primary/10"
        />
      ) : (
        <button
          type="button"
          {...attributes}
          {...listeners}
          onClick={action.onClick}
          className={quickActionCardBaseClassName}
          aria-label={action.ariaLabel}
        >
          <QuickActionCardInner action={action} />
        </button>
      )}
    </li>
  );
};

/** The "drop here to hide" target that only appears while a card is being dragged. */
const QuickActionHideZone: React.FC = () => {
  const { setNodeRef, isOver } = useDroppable({ id: QUICK_ACTION_HIDE_ZONE_ID });
  return (
    <div
      ref={setNodeRef}
      className={`mt-3 flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-4 text-sm font-semibold transition-colors ${
        isOver
          ? 'border-danger bg-danger/20 text-danger'
          : 'border-line-strong bg-white/[0.02] text-muted'
      }`}
    >
      <span aria-hidden="true" className="material-symbols-outlined">
        delete
      </span>
      Drop here to hide
    </div>
  );
};

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
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl border border-line bg-background-dark p-4 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-xl font-bold text-white">Security</h3>
          <button
            type="button"
            onClick={onClose}
            className="flex size-11 touch-manipulation items-center justify-center rounded-lg text-muted transition-colors hover:bg-white/10 hover:text-white"
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
            <div className="mb-4 flex items-start gap-3 rounded-2xl border border-line bg-surface-2 p-3">
              <span
                aria-hidden="true"
                className={`material-symbols-outlined text-2xl ${hasFactor ? 'text-green-400' : 'text-amber-400'}`}
              >
                {hasFactor ? 'verified_user' : 'gpp_maybe'}
              </span>
              <div className="flex-1">
                <p className="text-sm font-semibold text-white">Two-factor authentication</p>
                <p className="mt-0.5 text-xs text-muted">
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
              <div className="mb-4 rounded-2xl border border-danger/30 bg-danger/20 p-3">
                <p className="text-center text-sm text-danger">{error}</p>
              </div>
            )}

            {!loading && !hasFactor && (
              <button
                type="button"
                onClick={() => setView('enroll')}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary font-bold text-on-accent transition-colors hover:bg-primary/90"
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
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-white/10 font-medium text-white transition-colors hover:bg-white/20"
                >
                  <span className="material-symbols-outlined text-xl" aria-hidden>
                    autorenew
                  </span>
                  Replace authenticator
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmRemove(true)}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-lg border border-danger/30 font-medium text-danger transition-colors hover:bg-danger/10"
                >
                  <span className="material-symbols-outlined text-xl" aria-hidden>
                    remove_moderator
                  </span>
                  Remove two-factor
                </button>
              </div>
            )}

            {!loading && hasFactor && confirmRemove && (
              <div className="rounded-2xl border border-danger/30 bg-danger/10 p-3">
                <p className="text-sm font-semibold text-white">
                  Remove two-factor authentication?
                </p>
                <p className="mt-1 text-xs text-muted">
                  {isRequired
                    ? 'Two-factor is required for your account. If you remove it you will be asked to set it up again the next time the app checks your access.'
                    : "You'll no longer be asked for a code at sign-in. You can re-enable it any time."}
                </p>
                <div className="mt-3 flex gap-3">
                  <button
                    type="button"
                    onClick={() => setConfirmRemove(false)}
                    disabled={removing}
                    className="h-11 flex-1 rounded-lg bg-white/10 font-medium text-white transition-colors hover:bg-white/20 disabled:opacity-50"
                  >
                    Keep
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRemove()}
                    disabled={removing}
                    className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-danger/80 font-bold text-on-danger transition-colors hover:bg-danger disabled:opacity-50"
                  >
                    {removing ? (
                      <>
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
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
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
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
    createInventory,
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
  const [activeDragKey, setActiveDragKey] = useState<string | null>(null);
  const [showAIAssistant, setShowAIAssistant] = useState(false);
  const [showSecurity, setShowSecurity] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { syncToServer } = useDashboardPreferencesSync(!!currentUser);

  // Close the header dropdown menu on outside click or Escape.
  useEffect(() => {
    if (!showMenu) return;
    const handlePointer = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowMenu(false);
    };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [showMenu]);

  const activeCount = jobs.filter((j) => j.status === 'inProgress').length;
  const pendingCount = jobs.filter((j) => j.status === 'pending').length;
  const resumeJob =
    (navState.lastViewedJobId && jobs.find((job) => job.id === navState.lastViewedJobId)) || null;

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
      const invItem = inventory.find((i) => i.id === trimmed || i.barcode === trimmed);
      const job = jobs.find((j) => j.id === trimmed || j.jobCode.toString() === trimmed);
      if (invItem && invItem.category === 'tool') {
        showToast('Use tool check-in to place a tool in a bin', 'warning');
      } else if (invItem) {
        updateInventoryItem(invItem.id, { binLocation: scannedBinLocation })
          .then(() => {
            showToast(`${invItem.name} added to bin ${scannedBinLocation}`, 'success');
            return refreshInventory();
          })
          .catch(() => showToast('Failed to add to bin', 'error'));
      } else if (job) {
        updateJob(job.id, { binLocation: scannedBinLocation })
          .then(() => {
            showToast(`Job #${job.jobCode} added to bin ${scannedBinLocation}`, 'success');
            return refreshJobs();
          })
          .catch(() => showToast('Failed to add to bin', 'error'));
      } else {
        showToast('Scan a job or inventory code to add to this bin', 'warning');
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

  const quickActions: DashboardQuickAction[] = [
    {
      key: 'board-shop',
      title: 'Shop Floor',
      subtitle: `${activeCount} active · ${pendingCount} pending`,
      icon: 'view_kanban',
      ariaLabel: 'Open shop floor board',
      onClick: () => onNavigate('board-shop'),
      hideForAdmin: true,
    },
    {
      key: 'inventory',
      title: 'Inventory',
      subtitle: 'Stock & ordering',
      icon: 'inventory_2',
      ariaLabel: 'Open inventory',
      onClick: () => onNavigate('inventory'),
    },
    {
      key: 'tools',
      title: 'Tools',
      subtitle: 'Tag in / tag out',
      icon: 'handyman',
      ariaLabel: 'Open tools',
      onClick: () => onNavigate('tools'),
    },
    {
      key: 'scan',
      title: 'Scan',
      subtitle: 'QR Code',
      icon: 'qr_code_scanner',
      ariaLabel: 'Open QR scanner',
      onClick: () => onNavigate('scanner'),
    },
    {
      key: 'calendar',
      title: 'Calendar',
      subtitle: 'Job timeline',
      icon: 'calendar_month',
      ariaLabel: 'Open calendar',
      onClick: () => onNavigate('calendar'),
      adminOnly: true,
    },
    {
      key: 'parts',
      title: 'Parts',
      subtitle: 'Parts repository',
      icon: 'precision_manufacturing',
      ariaLabel: 'Open parts repository',
      onClick: () => onNavigate('parts'),
      adminOnly: true,
    },
    {
      key: 'quotes',
      title: 'Quotes',
      subtitle: 'Pricing & estimates',
      icon: 'request_quote',
      ariaLabel: 'Open quotes',
      onClick: () => onNavigate('quotes'),
      adminOnly: true,
    },
    {
      key: 'chat',
      title: 'Chat',
      subtitle: 'Team messenger',
      icon: 'chat_bubble',
      ariaLabel: 'Open team chat',
      onClick: () => onNavigate('chat'),
    },
    {
      key: 'boards',
      title: 'Boards',
      subtitle: 'Custom Kanban',
      icon: 'dashboard_customize',
      ariaLabel: 'Open custom boards',
      onClick: () => onNavigate('boards'),
    },
    {
      key: 'board-admin',
      title: 'Admin Board',
      subtitle: 'Kanban view',
      icon: 'view_kanban',
      ariaLabel: 'Open admin board',
      onClick: () => onNavigate('board-admin'),
      adminOnly: true,
    },
    {
      key: 'time-reports',
      title: 'Time Reports',
      subtitle: isAdmin ? 'View hours' : 'Your shifts',
      icon: 'analytics',
      ariaLabel: 'Open time reports',
      onClick: () => onNavigate('time-reports'),
    },
    {
      key: 'project-hours',
      title: 'Project Hours',
      subtitle: 'Log dev hours',
      icon: 'payments',
      ariaLabel: 'Open project hours',
      onClick: () => onNavigate('project-hours'),
      adminOnly: true,
    },
    {
      key: 'trello-import',
      title: 'Import Trello',
      subtitle: 'From JSON',
      icon: 'upload_file',
      ariaLabel: 'Open Trello import',
      onClick: () => onNavigate('trello-import'),
      adminOnly: true,
    },
    {
      key: 'ai-assistant',
      title: 'AI Assistant',
      subtitle: 'Ask anything',
      icon: 'smart_toy',
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
            ariaLabel: 'Open accounting',
            onClick: () => navigate('/app/accounting'),
            adminOnly: true,
          } satisfies DashboardQuickAction,
        ]
      : []),
  ];

  const roleFilteredActions = quickActions.filter((action) =>
    isAdmin ? !action.hideForAdmin : !action.adminOnly
  );

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

  const visibleQuickActions = orderedActions.filter(
    (a) => !navState.hiddenQuickActions.includes(a.key)
  );

  const hiddenActions = orderedActions.filter((a) => navState.hiddenQuickActions.includes(a.key));

  // Both pointer (mouse) and touch gate on the same deliberate press-and-hold
  // (QUICK_ACTION_DRAG_ACTIVATION) so a reorder only starts when intended — never
  // on the slightest drag/scroll. handleDragStart fires the haptic on activation.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: QUICK_ACTION_DRAG_ACTIVATION }),
    useSensor(TouchSensor, { activationConstraint: QUICK_ACTION_DRAG_ACTIVATION })
  );

  const setHidden = useCallback(
    (key: string, hidden: boolean) => {
      const current = navState.hiddenQuickActions;
      const next = hidden
        ? current.includes(key)
          ? current
          : [...current, key]
        : current.includes(key)
          ? current.filter((k) => k !== key)
          : current;
      if (next === current) return;
      updateState({ hiddenQuickActions: next });
      syncToServer({ quickActionOrder: navState.quickActionOrder, hiddenQuickActions: next });
    },
    [navState.hiddenQuickActions, navState.quickActionOrder, updateState, syncToServer]
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    // Haptic "click" the instant a card is picked up, so a touch drag feels like
    // lifting an app icon on an iOS home screen. No-op where unsupported (iOS
    // Safari ignores it; Android/Chrome buzzes).
    navigator.vibrate?.(10);
    setActiveDragKey(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveDragKey(null);
      if (!over) return;

      // Dropped on the hide zone → hide the card.
      if (over.id === QUICK_ACTION_HIDE_ZONE_ID) {
        setHidden(String(active.id), true);
        return;
      }

      // Reordered onto another card → persist the new full order. Both ids are
      // visible cards, so we move within the full ordered-key list, which keeps
      // any hidden cards in their existing slots.
      const fullKeys = orderedActions.map((a) => a.key);
      const nextOrder = reorderQuickActionKeys(fullKeys, String(active.id), String(over.id));
      if (nextOrder === fullKeys) return;
      updateState({ quickActionOrder: nextOrder });
      syncToServer({
        quickActionOrder: nextOrder,
        hiddenQuickActions: navState.hiddenQuickActions,
      });
    },
    [orderedActions, setHidden, updateState, syncToServer, navState.hiddenQuickActions]
  );

  const resetCustomization = useCallback(() => {
    updateState({ quickActionOrder: [], hiddenQuickActions: [] });
    syncToServer({ quickActionOrder: [], hiddenQuickActions: [] });
  }, [updateState, syncToServer]);

  // Header dropdown entries. `dividerBefore` separates the settings group from
  // the account actions; `adminOnly` items are filtered out for non-admins.
  const menuItems: ReadonlyArray<{
    label: string;
    icon: string;
    onSelect: () => void;
    adminOnly?: boolean;
    danger?: boolean;
    dividerBefore?: boolean;
  }> = [
    { label: 'Appearance', icon: 'palette', onSelect: () => onNavigate('appearance') },
    {
      label: 'Notification settings',
      icon: 'notifications',
      onSelect: () => onNavigate('notification-settings'),
    },
    {
      label: 'See more settings',
      icon: 'tune',
      onSelect: () => onNavigate('admin-settings'),
      adminOnly: true,
    },
    {
      label: 'Two-factor (MFA)',
      icon: 'shield_person',
      onSelect: () => setShowSecurity(true),
      dividerBefore: true,
    },
    { label: 'Log out', icon: 'logout', onSelect: logout, danger: true },
  ];

  // The card currently being dragged, rendered as the floating DragOverlay clone.
  const activeDragAction = activeDragKey
    ? visibleQuickActions.find((a) => a.key === activeDragKey)
    : null;

  return (
    <div className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-background-dark">
      <SkipLink />
      <header className="safe-area-top sticky top-0 z-50 flex items-center justify-between border-b border-line bg-background-dark/95 px-4 py-3 backdrop-blur-md">
        <div className="flex min-w-0 items-center gap-3">
          <span className="app-brand-mark" aria-hidden="true" />
          <div className="min-w-0">
            <p className="app-eyebrow">{isAdmin ? 'Administrator' : 'User'}</p>
            <p className="app-display truncate text-base leading-tight text-white">
              {currentUser?.name || currentUser?.email || '—'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <OfflineIndicator />
          <NotificationBell onNavigate={onNavigate} />
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setShowMenu((open) => !open)}
              className={`flex size-11 touch-manipulation items-center justify-center rounded-lg transition-colors hover:bg-white/10 hover:text-white ${showMenu ? 'bg-white/10 text-white' : 'text-muted'}`}
              aria-label="Menu"
              title="Menu"
              aria-haspopup="menu"
              aria-expanded={showMenu}
            >
              <span aria-hidden="true" className="material-symbols-outlined">
                menu
              </span>
            </button>
            {showMenu && (
              <div
                role="menu"
                className="absolute right-0 top-full z-50 mt-1 w-52 overflow-hidden rounded-2xl border border-line bg-background-dark/95 py-1 shadow-lg shadow-black/40 backdrop-blur-md"
              >
                <p className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-widest text-subtle">
                  Settings
                </p>
                {menuItems
                  .filter((item) => !item.adminOnly || isAdmin)
                  .map((item) => (
                    <React.Fragment key={item.label}>
                      {item.dividerBefore && <div className="my-1 border-t border-line" />}
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setShowMenu(false);
                          item.onSelect();
                        }}
                        className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm font-medium transition-colors ${item.danger ? 'text-danger hover:bg-danger/10' : 'text-on-danger/90 hover:bg-white/10'}`}
                      >
                        <span
                          aria-hidden="true"
                          className={`material-symbols-outlined text-lg ${item.danger ? '' : 'text-muted'}`}
                        >
                          {item.icon}
                        </span>
                        {item.label}
                      </button>
                    </React.Fragment>
                  ))}
              </div>
            )}
          </div>
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
        className="content-above-nav mx-auto min-h-0 w-full max-w-4xl flex-1 overflow-y-auto p-4"
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

        {resumeJob && (
          <button
            type="button"
            onClick={() => onNavigate('job-detail', resumeJob.id)}
            aria-label={`Resume job #${resumeJob.jobCode} ${resumeJob.name}`}
            className="app-primary-card mb-4 flex w-full touch-manipulation items-center gap-3 p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-app"
          >
            <span aria-hidden="true" className="app-icon-badge app-icon-badge--accent">
              <span className="material-symbols-outlined">history</span>
            </span>
            <div className="min-w-0 flex-1">
              <p className="app-eyebrow">Resume Job</p>
              <p className="truncate font-bold text-white">
                #{resumeJob.jobCode} • {resumeJob.name}
              </p>
            </div>
            <span aria-hidden="true" className="material-symbols-outlined text-primary">
              chevron_right
            </span>
          </button>
        )}

        <section aria-labelledby="quick-actions-heading">
          <h2 id="quick-actions-heading" className="app-section-title mb-4">
            Quick Actions
          </h2>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setActiveDragKey(null)}
          >
            <SortableContext
              items={visibleQuickActions.map((a) => a.key)}
              strategy={rectSortingStrategy}
            >
              <ul
                className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5"
                role="list"
              >
                {visibleQuickActions.map((action) => (
                  <SortableQuickActionCard key={action.key} action={action} />
                ))}
              </ul>
            </SortableContext>

            {activeDragKey && <QuickActionHideZone />}

            {/* The lifted card that floats under the cursor while dragging. */}
            <DragOverlay>
              {activeDragAction ? (
                <div
                  className={`${quickActionCardBaseClassName} border-primary/60 shadow-lg shadow-black/40`}
                >
                  <QuickActionCardInner action={activeDragAction} />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>

          {(navState.quickActionOrder.length > 0 || navState.hiddenQuickActions.length > 0) && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {hiddenActions.length > 0 && (
                <span className="text-[10px] font-bold uppercase tracking-widest text-subtle">
                  Hidden
                </span>
              )}
              {hiddenActions.map((action) => (
                <button
                  key={action.key}
                  type="button"
                  onClick={() => setHidden(action.key, false)}
                  className="flex items-center gap-0.5 rounded-full border border-line bg-white/[0.03] px-2 py-0.5 text-[11px] font-medium text-muted transition-colors hover:border-line-strong hover:text-white"
                  aria-label={`Restore ${action.title}`}
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-xs">
                    add
                  </span>
                  {action.title}
                </button>
              ))}
              <button
                type="button"
                onClick={resetCustomization}
                className="ml-auto flex items-center gap-0.5 rounded-lg px-1.5 py-0.5 text-[11px] font-medium text-subtle transition-colors hover:bg-white/10 hover:text-white"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-xs">
                  restart_alt
                </span>
                Reset
              </button>
            </div>
          )}
        </section>

        <section aria-labelledby="active-jobs-heading" className="mt-6">
          <h2 id="active-jobs-heading" className="app-section-title mb-3">
            Active Jobs
          </h2>
          {dataPending ? (
            <div
              className="app-card flex items-center gap-3 p-4"
              role="status"
              aria-live="polite"
              aria-busy="true"
            >
              <span className="app-icon-badge animate-pulse" aria-hidden="true" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-4 w-40 max-w-[70%] animate-pulse rounded-lg bg-surface-3" />
                <div className="h-3 w-56 max-w-[85%] animate-pulse rounded-lg bg-surface-2" />
              </div>
              <span className="sr-only">Loading jobs…</span>
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
              className="app-card app-card-interactive flex w-full touch-manipulation items-center justify-between gap-3 p-4 text-left"
            >
              <span className="flex min-w-0 items-center gap-3">
                <span aria-hidden="true" className="app-icon-badge">
                  <span className="material-symbols-outlined">work</span>
                </span>
                <span className="min-w-0">
                  <span className="block font-bold text-white">
                    {activeCount} in progress · {pendingCount} pending
                  </span>
                  <span className="block text-[10px] font-bold uppercase tracking-widest text-white/50">
                    Tap to open the shop floor board
                  </span>
                </span>
              </span>
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
          className="fixed bottom-20 right-4 z-[45] flex min-h-[44px] touch-manipulation items-center gap-2 rounded-lg border border-primary/30 bg-primary/90 px-4 py-2 text-sm font-bold text-white shadow-lg"
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
            className="w-full max-w-md rounded-3xl border border-primary/30 bg-surface-2 p-4 shadow-2xl"
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
                className="flex size-10 items-center justify-center rounded-lg text-muted transition-colors hover:bg-white/10 hover:text-white"
                aria-label="Close time tracker popup"
              >
                <span aria-hidden="true" className="material-symbols-outlined">
                  close
                </span>
              </button>
            </div>

            <div className="rounded-2xl border border-line bg-black/20 p-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted">
                Shift Timer
              </p>
              {activeShift && <ShiftTimerDisplay activeShift={activeShift} />}
              <p className="mt-2 text-xs text-muted">Tracking active job time.</p>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3">
              <button
                type="button"
                onClick={handleClockOutFromPopup}
                disabled={isClockOutLoading}
                className="flex min-h-12 touch-manipulation items-center justify-center gap-2 rounded-lg bg-danger px-4 py-3 text-sm font-bold text-on-danger transition-colors hover:bg-danger-hover disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-muted"
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
                className="mt-3 flex min-h-11 w-full touch-manipulation items-center justify-center gap-2 rounded-lg border border-line bg-white/5 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white transition-colors hover:bg-white/10"
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
          onCreateInventory={createInventory}
          onRefreshJobs={refreshJobs}
          onRefreshInventory={refreshInventory}
          onNavigate={onNavigate}
          onClose={() => setScannedBinLocation(null)}
          onAddByScan={() => {
            setAddingJobToBin(true);
            setShowScanner(true);
          }}
          isAdmin={isAdmin}
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
              <p className="text-sm text-white">Opening scanner...</p>
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

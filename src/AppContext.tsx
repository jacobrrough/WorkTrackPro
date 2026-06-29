/* eslint-disable react-refresh/only-export-components -- useApp is the public API for this context */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ClockPunchResult } from '@/core/clockPunch';
import type { Comment, Job, JobStatus, InventoryItem, Shift, User } from '@/core/types';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { useActiveShift } from '@/hooks/useActiveShift';
import { useAppQueries } from '@/hooks/useAppQueries';
import { useJobMutations } from '@/hooks/useJobMutations';
import { getNextWorkflowStatus } from '@/lib/jobWorkflow';
import { useClockMutations } from '@/hooks/useClockMutations';
import { useInventoryMutations } from '@/hooks/useInventoryMutations';
import { useAttachmentMutations } from '@/hooks/useAttachmentMutations';
import { useInventoryAllocation } from '@/hooks/useInventoryAllocation';
import { withComputedInventory } from '@/lib/inventoryState';
import { stripInventoryFinancials } from '@/lib/priceVisibility';
import { CLOCK_QUEUE_KEY, getQueue, hasQueuedPunchAtMaxAttempts } from '@/lib/offlineQueue';
import { syncOfflineClockQueue } from '@/lib/syncOfflineClockQueue';
import {
  ACTION_QUEUE_EVENT,
  ACTION_QUEUE_KEY,
  getActionQueue,
  getPendingActionCount,
  getPendingEntityIds,
  hasActionAtMaxAttempts,
} from '@/lib/offlineActionQueue';
import { syncOfflineActionQueue } from '@/lib/syncOfflineActionQueue';
import { subscriptions } from '@/services/api/subscriptions';
import type { DeleteInventoryResult } from '@/services/api/inventory';
import {
  removeBoardCard,
  removeBoardColumn,
  upsertBoardCard,
  upsertBoardColumn,
} from '@/lib/boardCache';
import { mapCardRow, mapColumnRow } from '@/services/api/boards';
import { createRealtimeDebouncer } from '@/lib/realtimeDebounce';
import { useToast } from '@/Toast';

export interface AppContextType {
  currentUser: User | null;
  isLoading: boolean;
  /** True while the initial jobs/inventory fetch is in flight (first load, nothing cached). */
  dataPending: boolean;
  authError: string | null;
  jobs: Job[];
  shifts: Shift[];
  users: User[];
  inventory: InventoryItem[];
  /** Inventory items in the 'tool' category (derived). Drives the tag-in/out hub. */
  tools: InventoryItem[];
  activeShift: Shift | null;
  activeJob: Job | null;
  login: (email: string, password: string) => Promise<boolean>;
  signUp: (
    email: string,
    password: string,
    options?: { name?: string }
  ) => Promise<boolean | 'needs_email_confirmation'>;
  resetPasswordForEmail: (email: string) => Promise<void>;
  logout: () => void;
  createJob: (data: Partial<Job>) => Promise<Job | null>;
  updateJob: (jobId: string, data: Partial<Job>) => Promise<Job | null>;
  deleteJob: (jobId: string) => Promise<boolean>;
  updateJobStatus: (
    jobId: string,
    status: JobStatus,
    expectedCurrentStatus?: JobStatus
  ) => Promise<boolean>;
  advanceJobToNextStatus: (jobId: string) => Promise<boolean>;
  addJobComment: (jobId: string, text: string) => Promise<Comment | null>;
  getJobByCode: (code: number) => Promise<Job | null>;
  clockIn: (jobId: string) => Promise<ClockPunchResult>;
  clockOut: () => Promise<ClockPunchResult>;
  /** Job whose clock-out completion popup is pending (null when none). Hosted in AppShell. */
  clockOutPromptJob: Job | null;
  /** Resolve the pending clock-out prompt so the deferred punch can proceed. */
  completeClockOutPrompt: () => void;
  /** Job whose In Progress -> QC "used more than estimate?" popup is pending. Hosted in AppShell. */
  qcMaterialPromptJob: Job | null;
  /** Resolve the pending QC material prompt so the deferred status change can proceed. */
  completeQcMaterialPrompt: () => void;
  startLunch: () => Promise<boolean>;
  endLunch: () => Promise<boolean>;
  createInventory: (data: Partial<InventoryItem>) => Promise<InventoryItem | null>;
  updateInventoryItem: (id: string, data: Partial<InventoryItem>) => Promise<InventoryItem | null>;
  updateInventoryStock: (id: string, inStock: number, reason?: string) => Promise<void>;
  setInventoryImage: (id: string, file: File) => Promise<InventoryItem | null>;
  clearInventoryImage: (id: string) => Promise<InventoryItem | null>;
  /** Permanently delete an inventory item (admin-only; refused server-side if used by a job/part). */
  deleteInventoryItem: (id: string) => Promise<DeleteInventoryResult>;
  addJobInventory: (
    jobId: string,
    inventoryId: string,
    quantity: number,
    unit: string
  ) => Promise<void>;
  allocateInventoryToJob: (
    jobId: string,
    inventoryId: string,
    quantity: number,
    notes?: string
  ) => Promise<boolean>;
  removeJobInventory: (jobId: string, jobInventoryId: string) => Promise<void>;
  markInventoryOrdered: (id: string, quantity: number) => Promise<boolean>;
  receiveInventoryOrder: (id: string, receivedQuantity: number) => Promise<boolean>;
  addAttachment: (jobId: string, file: File, isAdminOnly?: boolean) => Promise<boolean>;
  deleteAttachment: (attachmentId: string) => Promise<boolean>;
  updateAttachmentAdminOnly: (attachmentId: string, isAdminOnly: boolean) => Promise<boolean>;
  addInventoryAttachment: (
    inventoryId: string,
    file: File,
    isAdminOnly?: boolean
  ) => Promise<boolean>;
  deleteInventoryAttachment: (attachmentId: string, inventoryId: string) => Promise<boolean>;
  refreshJobs: () => Promise<void>;
  refreshJob: (jobId: string) => Promise<void>;
  refreshShifts: () => Promise<void>;
  refreshUsers: () => Promise<void>;
  refreshInventory: () => Promise<void>;
  refreshTools: () => Promise<void>;
  calculateAvailable: (item: InventoryItem) => number;
  calculateAllocated: (inventoryId: string) => number;
  pendingOfflinePunchCount: number;
  /** True when some queued punches exceeded sync retries (needs admin attention). */
  staleOfflinePunch: boolean;
  /**
   * Manually drain the offline clock-punch queue (same path as the automatic
   * reconnect/focus/timer sync). Resolves with how many punches were applied.
   */
  syncOfflinePunchesNow: () => Promise<number>;
  /** Number of queued non-clock writes (jobs/inventory/board/delivery/comments). */
  pendingActionCount: number;
  /** True when some queued actions exceeded sync retries (needs attention). */
  staleOfflineAction: boolean;
  /** Ids of entities with a pending queued write — drives the per-row "pending" badge. */
  pendingEntityIds: Set<string>;
  /** Manually drain the offline action queue. Resolves with how many were applied. */
  syncOfflineActionsNow: () => Promise<number>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

function AppProviderInner({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const auth = useAuth();
  const { currentUser, login, signUp, resetPasswordForEmail, logout } = auth;

  const enabled = !!currentUser && currentUser.isApproved !== false;
  const queries = useAppQueries(enabled);
  const { activeShift, activeJob } = useActiveShift(currentUser, queries.shifts, queries.jobs);
  const { calculateAvailable, calculateAllocated } = useInventoryAllocation(queries.jobs);

  const [offlineQueueVersion, setOfflineQueueVersion] = useState(0);
  // Single-flight guard so overlapping punch-drain triggers don't run concurrently.
  const punchSyncInFlightRef = useRef(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pendingOfflinePunchCount = useMemo(() => getQueue().length, [offlineQueueVersion]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const staleOfflinePunch = useMemo(() => hasQueuedPunchAtMaxAttempts(), [offlineQueueVersion]);

  // Generalized offline action queue (jobs/inventory/board/delivery/comments). Mirrors
  // the punch-queue bookkeeping above; version state forces the memos to re-read the
  // localStorage-backed queue whenever an action is enqueued, cleared, or retried.
  const [offlineActionVersion, setOfflineActionVersion] = useState(0);
  // Single-flight guard so overlapping drain triggers don't run concurrently.
  const actionSyncInFlightRef = useRef(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pendingActionCount = useMemo(() => getPendingActionCount(), [offlineActionVersion]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const staleOfflineAction = useMemo(() => hasActionAtMaxAttempts(), [offlineActionVersion]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pendingEntityIds = useMemo(() => getPendingEntityIds(), [offlineActionVersion]);

  // Shared queue-drain path used by both the automatic sync (reconnect / tab
  // focus / ~90s timer) below and the manual "Sync now" banner button.
  const syncOfflinePunchesNow = useCallback(async (): Promise<number> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return 0;
    if (getQueue().length === 0) return 0;
    // Single-flight: the same four triggers (online/visibility/timer/mount) can fire at
    // once; skip if a drain is already running.
    if (punchSyncInFlightRef.current) return 0;
    punchSyncInFlightRef.current = true;
    let synced: number;
    try {
      synced = await syncOfflineClockQueue({
        refreshShifts: queries.refreshShifts,
        refreshJobs: queries.refreshJobs,
      });
    } finally {
      punchSyncInFlightRef.current = false;
    }
    if (synced > 0) {
      setOfflineQueueVersion((v) => v + 1);
      showToast(`Synced ${synced} clock punch${synced === 1 ? '' : 'es'}`, 'success');
    }
    return synced;
  }, [queries.refreshShifts, queries.refreshJobs, showToast]);

  // Drain the generalized action queue. Used by the same triggers as the punch sync
  // (reconnect / focus / timer / mount) and the manual "Sync now" path. Refreshes the
  // affected caches once after the drain rather than per-action.
  const syncOfflineActionsNow = useCallback(async (): Promise<number> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return 0;
    if (getActionQueue().length === 0) return 0;
    // Single-flight guard: four triggers (online/visibility/timer/mount) can fire at once.
    // Replays are idempotent, but overlapping drains waste round-trips and re-attempt the
    // same items — skip if one is already running.
    if (actionSyncInFlightRef.current) return 0;
    actionSyncInFlightRef.current = true;
    let synced: number;
    try {
      synced = await syncOfflineActionQueue();
    } finally {
      actionSyncInFlightRef.current = false;
    }
    // Always refresh the indicator/badge state — attempt counts may have advanced toward
    // the stale threshold even when nothing was fully applied.
    setOfflineActionVersion((v) => v + 1);
    if (synced > 0) {
      await queries.refreshJobs();
      await queries.refreshInventory();
      queryClient.invalidateQueries({ queryKey: ['boards'] });
      queryClient.invalidateQueries({ queryKey: ['board'] });
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      showToast(`Synced ${synced} change${synced === 1 ? '' : 's'}`, 'success');
    }
    return synced;
    // refreshJobs/refreshInventory are stable useCallbacks from useAppQueries; the rule
    // wants the whole `queries` object, which would re-create this callback every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queries.refreshJobs, queries.refreshInventory, queryClient, showToast]);

  const jobMutations = useJobMutations({
    jobs: queries.jobs,
    currentUser,
    refreshJobs: queries.refreshJobs,
    refreshInventory: queries.refreshInventory,
    refreshShifts: queries.refreshShifts,
    showToast,
  });

  const clockMutations = useClockMutations({
    currentUser,
    shifts: queries.shifts,
    jobs: queries.jobs,
    activeShift,
    refreshShifts: queries.refreshShifts,
    refreshJobs: queries.refreshJobs,
    onOfflinePunchEnqueued: () => setOfflineQueueVersion((v) => v + 1),
    showToast,
  });

  // Clock-out completion prompt: when leaving a production job that has units to log, ask
  // "how many did you finish?" before the punch completes (deducts material, bumps progress).
  // Skipped offline — offline-queue support for the progress log is a separate workstream
  // (see docs/cnc-unit-progress-deduction.md hand-off).
  const [clockOutPrompt, setClockOutPrompt] = useState<{ job: Job; resolve: () => void } | null>(
    null
  );
  // Mirror of the pending resolver so we can release a hung promise on unmount and detect
  // re-entrancy without racing React state.
  const clockOutResolverRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    // On unmount (e.g. logout tears down the tree) resolve any pending prompt so a deferred
    // clockOut()/clockIn() promise can't hang forever.
    return () => {
      clockOutResolverRef.current?.();
      clockOutResolverRef.current = null;
    };
  }, []);

  const jobNeedsCompletionPrompt = useCallback((job: Job | undefined): job is Job => {
    if (!job) return false;
    if (job.status !== 'inProgress' && job.status !== 'rush') return false;
    const hasVariants = Object.keys(job.dashQuantities ?? {}).length > 0;
    const hasBom = (job.inventoryItems?.length ?? 0) > 0;
    return hasVariants || hasBom;
  }, []);

  const promptForJob = useCallback(async (job: Job) => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    // Re-entrancy guard: if a prompt is already open, don't overwrite its resolver (which would
    // strand the first caller's promise). The second caller proceeds straight to its punch.
    if (clockOutResolverRef.current) return;
    await new Promise<void>((resolve) => {
      clockOutResolverRef.current = resolve;
      setClockOutPrompt({ job, resolve });
    });
  }, []);

  const clockOut = useCallback(async () => {
    const job = queries.jobs.find((j) => j.id === activeShift?.job);
    if (jobNeedsCompletionPrompt(job)) await promptForJob(job);
    return clockMutations.clockOut();
  }, [clockMutations, queries.jobs, activeShift, jobNeedsCompletionPrompt, promptForJob]);

  const clockIn = useCallback(
    async (jobId: string) => {
      const leaving = queries.jobs.find((j) => j.id === activeShift?.job);
      if (activeShift && activeShift.job !== jobId && jobNeedsCompletionPrompt(leaving)) {
        await promptForJob(leaving);
      }
      return clockMutations.clockIn(jobId);
    },
    [clockMutations, queries.jobs, activeShift, jobNeedsCompletionPrompt, promptForJob]
  );

  // In Progress -> Quality Control material-usage gate: before the move, ask "used more than the
  // estimate?" per BOM material so scrap/mistakes don't leave hidden inventory drift. Online-only
  // (the extra-usage RPC has no offline queue, mirroring the per-unit progress log); offline the
  // status change just proceeds via its normal path.
  const [qcMaterialPrompt, setQcMaterialPrompt] = useState<{
    job: Job;
    resolve: () => void;
  } | null>(null);
  const qcMaterialResolverRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    return () => {
      qcMaterialResolverRef.current?.();
      qcMaterialResolverRef.current = null;
    };
  }, []);

  const promptForQcMaterials = useCallback(async (job: Job) => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    // Re-entrancy guard: don't overwrite an open prompt's resolver.
    if (qcMaterialResolverRef.current) return;
    await new Promise<void>((resolve) => {
      qcMaterialResolverRef.current = resolve;
      setQcMaterialPrompt({ job, resolve });
    });
  }, []);

  const updateJobStatus = useCallback(
    async (jobId: string, status: JobStatus, expectedCurrentStatus?: JobStatus) => {
      const job = queries.jobs.find((j) => j.id === jobId);
      if (job?.status === 'inProgress' && status === 'qualityControl') {
        await promptForQcMaterials(job);
      }
      return jobMutations.updateJobStatus(jobId, status, expectedCurrentStatus);
    },
    [jobMutations, queries.jobs, promptForQcMaterials]
  );

  const advanceJobToNextStatus = useCallback(
    async (jobId: string) => {
      const job = queries.jobs.find((j) => j.id === jobId);
      if (job?.status === 'inProgress' && getNextWorkflowStatus(job.status) === 'qualityControl') {
        await promptForQcMaterials(job);
      }
      return jobMutations.advanceJobToNextStatus(jobId);
    },
    [jobMutations, queries.jobs, promptForQcMaterials]
  );

  const inventoryMutations = useInventoryMutations({
    inventory: queries.inventory,
    jobs: queries.jobs,
    currentUser,
    refreshJobs: queries.refreshJobs,
    refreshInventory: queries.refreshInventory,
    calculateAvailable,
    calculateAllocated,
    showToast,
  });

  const attachmentMutations = useAttachmentMutations({
    refreshJobs: queries.refreshJobs,
    refreshInventory: queries.refreshInventory,
  });

  // Offline queues: drain both the clock-punch queue and the generalized action queue
  // on reconnect, tab focus, periodically while pending, and on mount.
  useEffect(() => {
    const syncAll = () => {
      void syncOfflinePunchesNow();
      void syncOfflineActionsNow();
    };
    const onOnline = () => syncAll();
    const onVisible = () => {
      if (document.visibilityState === 'visible') syncAll();
    };
    // Same-tab: an action was enqueued/cleared/retried — re-read the queue (indicator,
    // badges) and try to drain it.
    const onActionChanged = () => {
      setOfflineActionVersion((v) => v + 1);
      void syncOfflineActionsNow();
    };
    // Cross-tab: another tab mutated a queue in localStorage. Reflect it here and drain.
    const onStorage = (e: StorageEvent) => {
      if (e.key === ACTION_QUEUE_KEY) {
        setOfflineActionVersion((v) => v + 1);
        void syncOfflineActionsNow();
      } else if (e.key === CLOCK_QUEUE_KEY) {
        setOfflineQueueVersion((v) => v + 1);
        void syncOfflinePunchesNow();
      }
    };

    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener(ACTION_QUEUE_EVENT, onActionChanged);
    window.addEventListener('storage', onStorage);
    const intervalId = window.setInterval(() => {
      if (typeof navigator === 'undefined' || !navigator.onLine) return;
      if (getQueue().length > 0) void syncOfflinePunchesNow();
      if (getActionQueue().length > 0) void syncOfflineActionsNow();
    }, 90_000);

    syncAll();

    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener(ACTION_QUEUE_EVENT, onActionChanged);
      window.removeEventListener('storage', onStorage);
      window.clearInterval(intervalId);
    };
  }, [syncOfflinePunchesNow, syncOfflineActionsNow, offlineQueueVersion, offlineActionVersion]);

  // Realtime subscriptions — single consolidated channel for all core tables.
  const debouncerRef = useRef(createRealtimeDebouncer(300));
  useEffect(() => () => debouncerRef.current.cleanup(), []);

  useEffect(() => {
    if (!currentUser) return;
    const debounce = debouncerRef.current.debounce;

    const unsub = subscriptions.subscribeToCoreChanges({
      // ── Jobs (merge scalars, preserve relation arrays) ────────────
      onJob: (action, scalars) => {
        if (typeof scalars.id !== 'string') return;
        if (action === 'create') {
          void queries.refreshJob(scalars.id);
        } else if (action === 'update') {
          queryClient.setQueryData<Job[]>(['jobs'], (prev) => {
            if (!prev) return prev;
            const exists = prev.some((j) => j.id === scalars.id);
            if (!exists) return prev;
            return prev.map((j) => (j.id === scalars.id ? { ...j, ...scalars } : j));
          });
          const existing = queryClient.getQueryData<Job>(['job', scalars.id]);
          if (existing) {
            queryClient.setQueryData<Job>(['job', scalars.id], { ...existing, ...scalars });
          }
        } else if (action === 'delete') {
          queryClient.setQueryData<Job[]>(['jobs'], (prev) =>
            prev ? prev.filter((j) => j.id !== scalars.id) : prev
          );
          queryClient.removeQueries({ queryKey: ['job', scalars.id] });
        }
      },

      // ── Shifts ────────────────────────────────────────────────────
      onShift: (action, record) => {
        if (typeof record.id !== 'string') return;
        if (action === 'create') {
          queryClient.setQueryData<Shift[]>(['shifts'], (prev) =>
            !prev
              ? [record as Shift]
              : prev.some((s) => s.id === record.id)
                ? prev
                : [record as Shift, ...prev]
          );
        } else if (action === 'update') {
          queryClient.setQueryData<Shift[]>(['shifts'], (prev) =>
            prev ? prev.map((s) => (s.id === record.id ? record : s)) : prev
          );
        } else if (action === 'delete') {
          queryClient.setQueryData<Shift[]>(['shifts'], (prev) =>
            prev ? prev.filter((s) => s.id !== record.id) : prev
          );
        }
      },

      // ── Inventory ─────────────────────────────────────────────────
      onInventory: (action, record) => {
        if (typeof record.id !== 'string') return;
        if (action === 'create') {
          queryClient.setQueryData<InventoryItem[]>(['inventory'], (prev) =>
            !prev
              ? [record as InventoryItem]
              : prev.some((i) => i.id === record.id)
                ? prev
                : [record as InventoryItem, ...prev]
          );
        } else if (action === 'update') {
          queryClient.setQueryData<InventoryItem[]>(['inventory'], (prev) =>
            prev ? prev.map((i) => (i.id === record.id ? record : i)) : prev
          );
        } else if (action === 'delete') {
          queryClient.setQueryData<InventoryItem[]>(['inventory'], (prev) =>
            prev ? prev.filter((i) => i.id !== record.id) : prev
          );
        }
      },

      // ── Users/profiles ────────────────────────────────────────────
      // DELETE payloads only carry the PK (id) from payload.old — other
      // fields on `record` are defaults and must not be read in the delete branch.
      onUser: (action, record) => {
        if (typeof record.id !== 'string') return;
        if (action === 'create') {
          queryClient.setQueryData<User[]>(['users'], (prev) => {
            if (!prev) return [record];
            return prev.some((u) => u.id === record.id) ? prev : [record, ...prev];
          });
        } else if (action === 'update') {
          queryClient.setQueryData<User[]>(['users'], (prev) =>
            prev ? prev.map((u) => (u.id === record.id ? record : u)) : prev
          );
        } else if (action === 'delete') {
          queryClient.setQueryData<User[]>(['users'], (prev) =>
            prev ? prev.filter((u) => u.id !== record.id) : prev
          );
        }
      },

      // ── Job-related tables (comments, attachments, job_parts, etc.)
      onJobRelated: (table, _action, record) => {
        const jobId = record.job_id as string | undefined;
        if (!jobId) return;
        debounce(`job-${jobId}`, () => void queries.refreshJob(jobId));
        if (table === 'job_inventory') {
          debounce('inventory-refresh', () => void queries.refreshInventory());
        }
      },

      // ── Board-related tables — patch the board cache directly (no refetch). ──
      // Refetching the whole board (getBoardById ≈ 5 round-trips) on every card move was
      // the source of the boards "slow + flash"; patch the cached arrays instead.
      onBoardRelated: (table, action, record) => {
        if (table === 'boards') {
          // The board row itself (rename / visibility) changed — rare; refresh the lists.
          void queryClient.invalidateQueries({ queryKey: ['boards'] });
          const boardId = record.id as string | undefined;
          if (boardId) void queryClient.invalidateQueries({ queryKey: ['board', boardId] });
          return;
        }
        if (table === 'board_columns') {
          if (action === 'delete') {
            removeBoardColumn(queryClient, record.id as string);
          } else {
            upsertBoardColumn(queryClient, record.board_id as string, mapColumnRow(record));
          }
          return;
        }
        // board_cards. DELETE payloads carry only the PK under default replica identity,
        // so remove by id across board caches; INSERT/UPDATE carry the full row.
        if (action === 'delete') {
          removeBoardCard(queryClient, record.id as string);
        } else {
          const boardId = record.board_id as string | undefined;
          if (boardId) upsertBoardCard(queryClient, boardId, mapCardRow(record));
        }
      },

      // ── Parts table ───────────────────────────────────────────────
      onParts: () => {
        debounce('parts-jobs', () => void queries.refreshJobs());
      },
    });

    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, queryClient, queries.refreshJob, queries.refreshJobs, queries.refreshInventory]);

  const inventoryWithComputed = useMemo(
    () => withComputedInventory(queries.inventory, queries.jobs),
    [queries.inventory, queries.jobs]
  );
  const inventoryForRole = useMemo(
    () => stripInventoryFinancials(inventoryWithComputed, currentUser?.isAdmin === true),
    [inventoryWithComputed, currentUser?.isAdmin]
  );
  // Tools are inventory items in the 'tool' category; the tag-in/out hub reads this derived list.
  const toolItems = useMemo(
    () => inventoryForRole.filter((i) => i.category === 'tool'),
    [inventoryForRole]
  );

  const contextValue = useMemo<AppContextType>(
    () => ({
      currentUser: auth.currentUser,
      isLoading: auth.isLoading,
      dataPending: queries.isPending,
      authError: auth.authError,
      jobs: queries.jobs,
      shifts: queries.shifts,
      users: queries.users,
      inventory: inventoryForRole,
      tools: toolItems,
      activeShift,
      activeJob,
      login,
      signUp,
      resetPasswordForEmail,
      logout,
      createJob: jobMutations.createJob,
      updateJob: jobMutations.updateJob,
      deleteJob: jobMutations.deleteJob,
      updateJobStatus,
      advanceJobToNextStatus,
      addJobComment: jobMutations.addJobComment,
      getJobByCode: jobMutations.getJobByCode,
      clockIn,
      clockOut,
      clockOutPromptJob: clockOutPrompt?.job ?? null,
      completeClockOutPrompt: () => {
        clockOutPrompt?.resolve();
        clockOutResolverRef.current = null;
        setClockOutPrompt(null);
      },
      qcMaterialPromptJob: qcMaterialPrompt?.job ?? null,
      completeQcMaterialPrompt: () => {
        qcMaterialPrompt?.resolve();
        qcMaterialResolverRef.current = null;
        setQcMaterialPrompt(null);
      },
      startLunch: clockMutations.startLunch,
      endLunch: clockMutations.endLunch,
      createInventory: inventoryMutations.createInventory,
      updateInventoryItem: inventoryMutations.updateInventoryItem,
      updateInventoryStock: inventoryMutations.updateInventoryStock,
      addJobInventory: inventoryMutations.addJobInventory,
      allocateInventoryToJob: inventoryMutations.allocateInventoryToJob,
      removeJobInventory: inventoryMutations.removeJobInventory,
      markInventoryOrdered: inventoryMutations.markInventoryOrdered,
      receiveInventoryOrder: inventoryMutations.receiveInventoryOrder,
      setInventoryImage: inventoryMutations.setInventoryImage,
      clearInventoryImage: inventoryMutations.clearInventoryImage,
      deleteInventoryItem: inventoryMutations.deleteInventoryItem,
      addAttachment: attachmentMutations.addAttachment,
      deleteAttachment: attachmentMutations.deleteAttachment,
      updateAttachmentAdminOnly: attachmentMutations.updateAttachmentAdminOnly,
      addInventoryAttachment: attachmentMutations.addInventoryAttachment,
      deleteInventoryAttachment: attachmentMutations.deleteInventoryAttachment,
      refreshJobs: queries.refreshJobs,
      refreshJob: queries.refreshJob,
      refreshShifts: queries.refreshShifts,
      refreshUsers: queries.refreshUsers,
      refreshInventory: queries.refreshInventory,
      refreshTools: queries.refreshInventory,
      calculateAvailable,
      calculateAllocated,
      pendingOfflinePunchCount,
      staleOfflinePunch,
      syncOfflinePunchesNow,
      pendingActionCount,
      staleOfflineAction,
      pendingEntityIds,
      syncOfflineActionsNow,
    }),
    [
      auth.currentUser,
      auth.isLoading,
      queries.isPending,
      auth.authError,
      queries.jobs,
      queries.shifts,
      queries.users,
      inventoryForRole,
      toolItems,
      activeShift,
      activeJob,
      login,
      signUp,
      resetPasswordForEmail,
      logout,
      jobMutations,
      clockMutations,
      clockIn,
      clockOut,
      clockOutPrompt,
      updateJobStatus,
      advanceJobToNextStatus,
      qcMaterialPrompt,
      inventoryMutations,
      attachmentMutations,
      queries.refreshJobs,
      queries.refreshJob,
      queries.refreshShifts,
      queries.refreshUsers,
      queries.refreshInventory,
      calculateAvailable,
      calculateAllocated,
      pendingOfflinePunchCount,
      staleOfflinePunch,
      syncOfflinePunchesNow,
      pendingActionCount,
      staleOfflineAction,
      pendingEntityIds,
      syncOfflineActionsNow,
    ]
  );

  return <AppContext.Provider value={contextValue}>{children}</AppContext.Provider>;
}

export function AppProvider({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <AppProviderInner>{children}</AppProviderInner>
    </AuthProvider>
  );
}

export function useApp(): AppContextType {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }
  return context;
}

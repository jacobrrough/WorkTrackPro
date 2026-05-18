/* eslint-disable react-refresh/only-export-components -- useApp is the public API for this context */
import {
  createContext,
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
import { useClockMutations } from '@/hooks/useClockMutations';
import { useInventoryMutations } from '@/hooks/useInventoryMutations';
import { useAttachmentMutations } from '@/hooks/useAttachmentMutations';
import { useInventoryAllocation } from '@/hooks/useInventoryAllocation';
import { withComputedInventory } from '@/lib/inventoryState';
import { stripInventoryFinancials } from '@/lib/priceVisibility';
import { getQueue, hasQueuedPunchAtMaxAttempts } from '@/lib/offlineQueue';
import { syncOfflineClockQueue } from '@/lib/syncOfflineClockQueue';
import { subscriptions } from '@/services/api/subscriptions';
import { createRealtimeDebouncer } from '@/lib/realtimeDebounce';
import { useToast } from '@/Toast';

export interface AppContextType {
  currentUser: User | null;
  isLoading: boolean;
  authError: string | null;
  jobs: Job[];
  shifts: Shift[];
  users: User[];
  inventory: InventoryItem[];
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
  startLunch: () => Promise<boolean>;
  endLunch: () => Promise<boolean>;
  createInventory: (data: Partial<InventoryItem>) => Promise<InventoryItem | null>;
  updateInventoryItem: (id: string, data: Partial<InventoryItem>) => Promise<InventoryItem | null>;
  updateInventoryStock: (id: string, inStock: number, reason?: string) => Promise<void>;
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
  calculateAvailable: (item: InventoryItem) => number;
  calculateAllocated: (inventoryId: string) => number;
  pendingOfflinePunchCount: number;
  /** True when some queued punches exceeded sync retries (needs admin attention). */
  staleOfflinePunch: boolean;
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pendingOfflinePunchCount = useMemo(() => getQueue().length, [offlineQueueVersion]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const staleOfflinePunch = useMemo(() => hasQueuedPunchAtMaxAttempts(), [offlineQueueVersion]);

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

  // Offline clock queue: sync on reconnect, tab focus, and periodic while pending
  useEffect(() => {
    const runSync = async () => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      if (getQueue().length === 0) return;
      const synced = await syncOfflineClockQueue({
        refreshShifts: queries.refreshShifts,
        refreshJobs: queries.refreshJobs,
      });
      if (synced > 0) {
        setOfflineQueueVersion((v) => v + 1);
        showToast(`Synced ${synced} clock punch${synced === 1 ? '' : 'es'}`, 'success');
      }
    };

    const onOnline = () => {
      void runSync();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void runSync();
    };

    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    const intervalId = window.setInterval(() => {
      if (typeof navigator !== 'undefined' && navigator.onLine && getQueue().length > 0) {
        void runSync();
      }
    }, 90_000);

    void runSync();

    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(intervalId);
    };
  }, [queries.refreshShifts, queries.refreshJobs, showToast, offlineQueueVersion]);

  // Realtime subscriptions
  const debouncerRef = useRef(createRealtimeDebouncer(300));
  useEffect(() => () => debouncerRef.current.cleanup(), []);

  useEffect(() => {
    if (!currentUser) return;
    const debounce = debouncerRef.current.debounce;

    // ── Jobs channel (merge scalars, preserve relation arrays) ──────
    // refreshInventory() is NOT called here — the subscribeToJobRelated
    // channel handles job_inventory changes with debouncing.
    const unsubJobs = subscriptions.subscribeToJobs((action, scalars) => {
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
    });

    // ── Shifts channel ─────────────────────────────────────────────
    const unsubShifts = subscriptions.subscribeToShifts((action, record) => {
      if (typeof record.id !== 'string') return;
      if (action === 'create') {
        queryClient.setQueryData<Shift[]>(['shifts'], (prev) =>
          prev ? [record as Shift, ...prev] : [record as Shift]
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
    });

    // ── Inventory channel ──────────────────────────────────────────
    const unsubInventory = subscriptions.subscribeToInventory((action, record) => {
      if (typeof record.id !== 'string') return;
      if (action === 'create') {
        queryClient.setQueryData<InventoryItem[]>(['inventory'], (prev) =>
          prev ? [record as InventoryItem, ...prev] : [record as InventoryItem]
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
    });

    // ── Job-related tables (comments, attachments, job_parts, etc.) ─
    const unsubJobRelated = subscriptions.subscribeToJobRelated((table, _action, record) => {
      const jobId = record.job_id as string | undefined;
      if (!jobId) return;
      debounce(`job-${jobId}`, () => void queries.refreshJob(jobId));
      if (table === 'job_inventory') {
        debounce('inventory-refresh', () => void queries.refreshInventory());
      }
    });

    // ── Board-related tables ───────────────────────────────────────
    const unsubBoards = subscriptions.subscribeToBoardRelated((table, _action, record) => {
      if (table === 'boards') {
        void queryClient.invalidateQueries({ queryKey: ['boards'] });
        const boardId = record.id as string | undefined;
        if (boardId) void queryClient.invalidateQueries({ queryKey: ['board', boardId] });
      } else {
        const boardId = record.board_id as string | undefined;
        if (boardId) {
          debounce(
            `board-${boardId}`,
            () => void queryClient.invalidateQueries({ queryKey: ['board', boardId] })
          );
        }
      }
    });

    // ── Parts table ────────────────────────────────────────────────
    const unsubParts = subscriptions.subscribeToParts(() => {
      debounce('parts-jobs', () => void queries.refreshJobs());
    });

    // ── Users/profiles table ───────────────────────────────────────
    // Note: DELETE payloads only carry the PK (id) from payload.old — other
    // fields on `record` are defaults and must not be read in the delete branch.
    const unsubUsers = subscriptions.subscribeToUsers((action, record) => {
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
    });

    return () => {
      unsubJobs();
      unsubShifts();
      unsubInventory();
      unsubJobRelated();
      unsubBoards();
      unsubParts();
      unsubUsers();
    };
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

  const contextValue = useMemo<AppContextType>(
    () => ({
      currentUser: auth.currentUser,
      isLoading: auth.isLoading,
      authError: auth.authError,
      jobs: queries.jobs,
      shifts: queries.shifts,
      users: queries.users,
      inventory: inventoryForRole,
      activeShift,
      activeJob,
      login,
      signUp,
      resetPasswordForEmail,
      logout,
      createJob: jobMutations.createJob,
      updateJob: jobMutations.updateJob,
      deleteJob: jobMutations.deleteJob,
      updateJobStatus: jobMutations.updateJobStatus,
      advanceJobToNextStatus: jobMutations.advanceJobToNextStatus,
      addJobComment: jobMutations.addJobComment,
      getJobByCode: jobMutations.getJobByCode,
      clockIn: clockMutations.clockIn,
      clockOut: clockMutations.clockOut,
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
      calculateAvailable,
      calculateAllocated,
      pendingOfflinePunchCount,
      staleOfflinePunch,
    }),
    [
      auth.currentUser,
      auth.isLoading,
      auth.authError,
      queries.jobs,
      queries.shifts,
      queries.users,
      inventoryForRole,
      activeShift,
      activeJob,
      login,
      signUp,
      resetPasswordForEmail,
      logout,
      jobMutations,
      clockMutations,
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

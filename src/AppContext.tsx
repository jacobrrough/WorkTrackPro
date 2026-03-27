/* eslint-disable react-refresh/only-export-components -- useApp is the public API for this context */
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
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
import { dedupeJobsById } from '@/lib/jobUtils';
import { withComputedInventory } from '@/lib/inventoryState';
import { stripInventoryFinancials } from '@/lib/priceVisibility';
import { getQueue, hasQueuedPunchAtMaxAttempts } from '@/lib/offlineQueue';
import { syncOfflineClockQueue } from '@/lib/syncOfflineClockQueue';
import { subscriptions } from '@/services/api/subscriptions';
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
  updateJobStatus: (jobId: string, status: JobStatus) => Promise<boolean>;
  advanceJobToNextStatus: (jobId: string, currentStatus: JobStatus) => Promise<boolean>;
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
  const pendingOfflinePunchCount = useMemo(() => getQueue().length, [offlineQueueVersion]);
  const staleOfflinePunch = useMemo(() => hasQueuedPunchAtMaxAttempts(), [offlineQueueVersion]);

  const jobMutations = useJobMutations({
    jobs: queries.jobs,
    inventory: queries.inventory,
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
    updateJobStatus: jobMutations.updateJobStatus,
    onOfflinePunchEnqueued: () => setOfflineQueueVersion((v) => v + 1),
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
  useEffect(() => {
    if (!currentUser) return;

    const unsubJobs = subscriptions.subscribeToJobs((action, record) => {
      if (action === 'create') {
        queryClient.setQueryData<Job[]>(['jobs'], (prev) =>
          prev ? dedupeJobsById([record as Job, ...prev]) : [record as Job]
        );
        queries.refreshInventory();
      } else if (action === 'update') {
        queryClient.setQueryData<Job[]>(['jobs'], (prev) => {
          if (!prev) return [record as Job];
          const exists = prev.some((j) => j.id === record.id);
          const next = exists
            ? prev.map((j) => (j.id === record.id ? (record as Job) : j))
            : ([record as Job, ...prev] as Job[]);
          return dedupeJobsById(next);
        });
        queries.refreshInventory();
      } else if (action === 'delete') {
        queryClient.setQueryData<Job[]>(['jobs'], (prev) =>
          prev ? prev.filter((j) => j.id !== record.id) : []
        );
        queries.refreshInventory();
      }
    });

    const unsubShifts = subscriptions.subscribeToShifts((action, record) => {
      if (action === 'create') {
        queryClient.setQueryData<Shift[]>(['shifts'], (prev) =>
          prev ? [record as Shift, ...prev] : [record as Shift]
        );
      } else if (action === 'update') {
        queryClient.setQueryData<Shift[]>(['shifts'], (prev) =>
          prev ? prev.map((s) => (s.id === record.id ? (record as Shift) : s)) : []
        );
      } else if (action === 'delete') {
        queryClient.setQueryData<Shift[]>(['shifts'], (prev) =>
          prev ? prev.filter((s) => s.id !== record.id) : []
        );
      }
    });

    const unsubInventory = subscriptions.subscribeToInventory((action, record) => {
      if (action === 'create') {
        queryClient.setQueryData<InventoryItem[]>(['inventory'], (prev) =>
          prev ? [record as InventoryItem, ...prev] : [record as InventoryItem]
        );
      } else if (action === 'update') {
        queryClient.setQueryData<InventoryItem[]>(['inventory'], (prev) =>
          prev ? prev.map((i) => (i.id === record.id ? (record as InventoryItem) : i)) : []
        );
      } else if (action === 'delete') {
        queryClient.setQueryData<InventoryItem[]>(['inventory'], (prev) =>
          prev ? prev.filter((i) => i.id !== record.id) : []
        );
      }
    });

    return () => {
      unsubJobs();
      unsubShifts();
      unsubInventory();
    };
  }, [currentUser, queryClient]);

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

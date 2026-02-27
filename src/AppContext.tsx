/* eslint-disable react-refresh/only-export-components -- useApp is the public API for this context */
// AppContext.tsx - FIXED VERSION
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { User, Job, Shift, InventoryItem, JobStatus, Comment } from '@/core/types';
import {
  authService,
  userService,
  jobService,
  shiftService,
  inventoryService,
  inventoryHistoryService,
  checklistService,
  subscriptions,
} from './pocketbase';
import { supabase } from './services/api/supabaseClient';
import {
  calculateAllocated as calcAllocated,
  calculateAvailable as calcAvailable,
} from './lib/inventoryCalculations';
import { buildJobNameFromConvention } from './lib/formatJob';
import { getNextWorkflowStatus, isAutoFlowStatus } from '@/lib/jobWorkflow';
import { stripInventoryFinancials } from '@/lib/priceVisibility';
import { getRemainingBreakMs, getTotalBreakMs, toBreakMinutes } from '@/lib/lunchUtils';
import { withComputedInventory } from '@/lib/inventoryState';
import { buildReconciliationMutations } from '@/lib/inventoryReconciliation';
import { enqueueClockPunch, getQueue, clearPunchFromQueue } from '@/lib/offlineQueue';

interface AppContextType {
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
  updateJobStatus: (jobId: string, status: JobStatus) => Promise<boolean>; // FIXED: Return boolean
  advanceJobToNextStatus: (jobId: string, currentStatus: JobStatus) => Promise<boolean>;
  addJobComment: (jobId: string, text: string) => Promise<Comment | null>; // FIXED: Renamed and return Comment
  getJobByCode: (code: number) => Promise<Job | null>; // ADDED: Missing function
  clockIn: (jobId: string) => Promise<boolean>;
  clockOut: () => Promise<boolean>; // FIXED: Return boolean
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
  /** Refetch a single job and update it in the list (avoids full refresh overwriting unsaved or just-saved data). */
  refreshJob: (jobId: string) => Promise<void>;
  refreshShifts: () => Promise<void>;
  refreshUsers: () => Promise<void>;
  refreshInventory: () => Promise<void>;
  calculateAvailable: (item: InventoryItem) => number;
  calculateAllocated: (inventoryId: string) => number;
  /** Number of clock punches waiting to sync (offline queue). */
  pendingOfflinePunchCount: number;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

function dedupeJobsById(items: Job[]): Job[] {
  const seen = new Set<string>();
  const unique: Job[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    unique.push(item);
  }
  return unique;
}

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const queryClient = useQueryClient();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [offlineQueueVersion, setOfflineQueueVersion] = useState(0);

  const enabled = !!currentUser && currentUser.isApproved !== false;

  const { data: jobsData = [] } = useQuery({
    queryKey: ['jobs'],
    queryFn: async () => {
      const list = await jobService.getAllJobs();
      list.sort((a, b) => {
        const dateA = a.dueDate || a.ecd || '9999-12-31';
        const dateB = b.dueDate || b.ecd || '9999-12-31';
        return dateA.localeCompare(dateB);
      });
      return dedupeJobsById(list);
    },
    enabled,
  });

  const { data: shiftsData = [] } = useQuery({
    queryKey: ['shifts'],
    queryFn: () => shiftService.getAllShifts(),
    enabled,
  });

  const { data: usersData = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => userService.getAllUsers(),
    enabled,
  });

  const { data: inventoryData = [] } = useQuery({
    queryKey: ['inventory'],
    queryFn: () => inventoryService.getAllInventory(),
    enabled,
  });

  const jobs = jobsData;
  const shifts = shiftsData;
  const users = usersData;
  const inventory = inventoryData;

  const pendingOfflinePunchCount = useMemo(() => getQueue().length, [offlineQueueVersion]);

  const activeShift = useMemo(() => {
    if (!currentUser) return null;
    return shifts.find((s) => s.user === currentUser.id && !s.clockOutTime) || null;
  }, [shifts, currentUser]);

  const activeJob = useMemo(() => {
    if (!activeShift) return null;
    return jobs.find((j) => j.id === activeShift.job) || null;
  }, [activeShift, jobs]);

  const refreshJobs = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['jobs'] });
  }, [queryClient]);

  /** Refetch a single job and replace it in the list. Use after save + material sync so we don't overwrite with stale data from refreshJobs(). */
  const refreshJob = useCallback(
    async (jobId: string) => {
      try {
        const job = await jobService.getJobById(jobId);
        if (job) {
          queryClient.setQueryData<Job[]>(['jobs'], (prev) =>
            prev ? prev.map((j) => (j.id === jobId ? job : j)) : [job]
          );
        }
      } catch (error) {
        console.error('Failed to refresh job:', error);
        await queryClient.invalidateQueries({ queryKey: ['jobs'] });
      }
    },
    [queryClient]
  );

  const refreshShifts = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['shifts'] });
  }, [queryClient]);

  const refreshInventory = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['inventory'] });
  }, [queryClient]);

  const refreshUsers = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['users'] });
  }, [queryClient]);

  const login = useCallback(async (email: string, password: string): Promise<boolean> => {
    setAuthError(null);
    setIsLoading(true);
    try {
      const user = await authService.login(email, password);
      setCurrentUser(user);
      // Queries will refetch automatically when enabled (currentUser is set)
      return true;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Login failed';
      setAuthError(errorMessage);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const signUp = useCallback(
    async (
      email: string,
      password: string,
      options?: { name?: string }
    ): Promise<boolean | 'needs_email_confirmation'> => {
      setAuthError(null);
      setIsLoading(true);
      try {
        const { user, needsEmailConfirmation } = await authService.signUp(email, password, options);
        if (user) {
          setCurrentUser(user);
          return true;
        }
        return needsEmailConfirmation ? 'needs_email_confirmation' : false;
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Sign up failed';
        setAuthError(errorMessage);
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const resetPasswordForEmail = useCallback(async (email: string): Promise<void> => {
    setAuthError(null);
    await authService.resetPasswordForEmail(email);
  }, []);

  const logout = useCallback(() => {
    authService.logout();
    setCurrentUser(null);
    // Query cache is left as-is; queries are disabled when !currentUser
  }, []);

  const calculateAllocated = useCallback(
    (inventoryId: string): number => calcAllocated(inventoryId, jobs),
    [jobs]
  );

  const calculateAvailable = useCallback(
    (item: InventoryItem): number => calcAvailable(item, calcAllocated(item.id, jobs)),
    [jobs]
  );

  const createJob = useCallback(
    async (data: Partial<Job>): Promise<Job | null> => {
      try {
        const job = await jobService.createJob(data);
        if (!job) {
          console.error('Job creation returned null');
          return null;
        }
        if (job) {
          queryClient.setQueryData<Job[]>(['jobs'], (prev) =>
            prev ? dedupeJobsById([job, ...prev]) : [job]
          );
        }
        return job;
      } catch (error) {
        console.error('Create job error:', error);
        return null;
      }
    },
    [queryClient]
  );

  const updateJob = useCallback(
    async (jobId: string, data: Partial<Job>): Promise<Job | null> => {
      try {
        // If marking job as inactive, clear the bin location to free up the space
        if (data.active === false) {
          data.binLocation = undefined;
        }

        const updatedJob = await jobService.updateJob(jobId, data);
        if (updatedJob) {
          queryClient.setQueryData<Job[]>(['jobs'], (prev) =>
            prev ? prev.map((j) => (j.id === jobId ? updatedJob : j)) : []
          );
        }
        return updatedJob;
      } catch (error) {
        console.error('Update job error:', error);
        return null;
      }
    },
    [queryClient]
  );

  const deleteJob = useCallback(
    async (jobId: string): Promise<boolean> => {
      try {
        const deleted = await jobService.deleteJob(jobId);
        if (!deleted) return false;
        queryClient.setQueryData<Job[]>(['jobs'], (prev) =>
          prev ? prev.filter((j) => j.id !== jobId) : []
        );
        await refreshJobs();
        await refreshInventory();
        await refreshShifts();
        return true;
      } catch (error) {
        console.error('Delete job error:', error);
        return false;
      }
    },
    [queryClient, refreshInventory, refreshJobs, refreshShifts]
  );

  // FIXED: Now returns boolean for success/failure
  const updateJobStatus = useCallback(
    async (jobId: string, status: JobStatus): Promise<boolean> => {
      try {
        const job = jobs.find((j) => j.id === jobId);
        const wasDelivered = job?.status === 'delivered';
        const isDelivered = status === 'delivered';
        const nextJobs = jobs.map((j) => (j.id === jobId ? { ...j, status } : j));

        // When marking as paid, rename job to Part REV per convention
        if (status === 'paid' && job) {
          const name = buildJobNameFromConvention({ ...job, status: 'paid' });
          const updated = await jobService.updateJob(jobId, { status: 'paid', name });
          if (!updated) {
            await refreshJobs();
            return false;
          }
          queryClient.setQueryData<Job[]>(['jobs'], (prev) =>
            prev ? prev.map((j) => (j.id === jobId ? { ...j, status: 'paid', name } : j)) : []
          );
        } else {
          queryClient.setQueryData<Job[]>(['jobs'], (prev) =>
            prev
              ? prev.map((j) =>
                  j.id === jobId
                    ? {
                        ...j,
                        status,
                        ...(status === 'delivered' ? { binLocation: undefined } : {}),
                      }
                    : j
                )
              : []
          );
          const ok = await jobService.updateJobStatus(jobId, status);
          if (!ok) {
            await refreshJobs();
            return false;
          }
        }

        // Ensure checklist is ready for the destination status.
        // This keeps checklist provisioning aligned with card column entry.
        if (status !== 'paid' && status !== 'projectCompleted') {
          await checklistService.ensureJobChecklistForStatus(jobId, status);
        }

        // Reconcile stock when entering delivered, and restore when leaving delivered.
        if (job && isDelivered !== wasDelivered) {
          const direction = isDelivered ? 'consume' : 'restore';
          const action = isDelivered ? 'reconcile_job' : 'reconcile_job_reversal';
          const reason = isDelivered
            ? `Materials used for Job #${job.jobCode} (Delivered)`
            : `Delivered status reversed for Job #${job.jobCode}; stock restored`;

          const updates = buildReconciliationMutations({
            job,
            inventory,
            jobsAfterStatusUpdate: nextJobs,
            direction,
          });

          for (const entry of updates) {
            await inventoryService.updateStock(entry.inventoryId, entry.newInStock);
            if (currentUser) {
              await inventoryHistoryService.createHistory({
                inventory: entry.inventoryId,
                user: currentUser.id,
                action,
                reason,
                previousInStock: entry.previousInStock,
                newInStock: entry.newInStock,
                previousAvailable: entry.previousAvailable,
                newAvailable: entry.newAvailable,
                changeAmount: entry.changeAmount,
                relatedJob: jobId,
              });
            }
          }
        }

        await refreshJobs();
        await refreshInventory(); // Refresh to update available calculations
        return true;
      } catch (error) {
        console.error('Update job status error:', error);
        await refreshJobs();
        await refreshInventory();
        return false;
      }
    },
    [refreshJobs, refreshInventory, jobs, inventory, currentUser, queryClient]
  );

  const advanceJobToNextStatus = useCallback(
    async (jobId: string, currentStatus: JobStatus): Promise<boolean> => {
      // On Hold is intentionally excluded from auto-flow.
      if (currentStatus === 'onHold' || !isAutoFlowStatus(currentStatus)) return false;
      const next = getNextWorkflowStatus(currentStatus);
      if (!next) return false;
      return updateJobStatus(jobId, next);
    },
    [updateJobStatus]
  );

  // FIXED: Renamed to addJobComment and returns Comment
  const addJobComment = useCallback(
    async (jobId: string, text: string): Promise<Comment | null> => {
      if (!currentUser) return null;
      try {
        const comment = await jobService.addComment(jobId, text, currentUser.id);
        await refreshJobs();
        return comment;
      } catch (error) {
        console.error('Add comment error:', error);
        return null;
      }
    },
    [currentUser, refreshJobs]
  );

  const getJobByCode = useCallback(
    async (code: number): Promise<Job | null> => {
      const fromMemory = jobs.find((j) => j.jobCode === code);
      if (fromMemory) return fromMemory;
      const fromApi = await jobService.getJobByCode(code);
      if (fromApi) {
        queryClient.setQueryData<Job[]>(['jobs'], (prev) => {
          if (!prev) return [fromApi];
          const exists = prev.some((j) => j.id === fromApi.id);
          return exists ? prev.map((j) => (j.id === fromApi.id ? fromApi : j)) : [fromApi, ...prev];
        });
        return fromApi;
      }
      return null;
    },
    [jobs, queryClient]
  );

  const clockIn = useCallback(
    async (jobId: string): Promise<boolean> => {
      if (!currentUser) return false;

      // Auto-switch behavior: if user is already clocked into another job, clock out first.
      const existingActiveShift = shifts.find((s) => s.user === currentUser.id && !s.clockOutTime);
      if (existingActiveShift) {
        if (existingActiveShift.job === jobId) return true;
        if (existingActiveShift.lunchStartTime && !existingActiveShift.lunchEndTime) {
          const totalBreakMinutes = toBreakMinutes(getTotalBreakMs(existingActiveShift));
          await shiftService.endLunch(existingActiveShift.id, totalBreakMinutes);
        }
        await shiftService.clockOut(existingActiveShift.id);
        await refreshShifts();
      }
      try {
        let success = await shiftService.clockIn(jobId, currentUser.id);
        if (!success) {
          // Recovery path for stale client state (e.g. active shift created elsewhere).
          const latestShifts = await shiftService.getAllShifts();
          const latestActiveShift = latestShifts.find(
            (s) => s.user === currentUser.id && !s.clockOutTime
          );
          if (latestActiveShift && latestActiveShift.job !== jobId) {
            if (latestActiveShift.lunchStartTime && !latestActiveShift.lunchEndTime) {
              const totalBreakMinutes = toBreakMinutes(getTotalBreakMs(latestActiveShift));
              await shiftService.endLunch(latestActiveShift.id, totalBreakMinutes);
            }
            await shiftService.clockOut(latestActiveShift.id);
            await refreshShifts();
            success = await shiftService.clockIn(jobId, currentUser.id);
          }
        }
        if (success) {
          await refreshShifts();
          const job = jobs.find((j) => j.id === jobId);
          const shouldMoveToInProgress = job?.status === 'pending' || job?.status === 'rush';

          if (shouldMoveToInProgress) {
            await updateJobStatus(jobId, 'inProgress');
          } else {
            await refreshJobs();
          }
        }
        return success;
      } catch (error) {
        console.error('Clock in error:', error);
        if (currentUser && jobId) {
          enqueueClockPunch({
            type: 'clock_in',
            userId: currentUser.id,
            jobId,
            timestamp: new Date().toISOString(),
          });
          setOfflineQueueVersion((v) => v + 1);
        }
        return false;
      }
    },
    [currentUser, shifts, refreshShifts, refreshJobs, jobs, updateJobStatus]
  );

  // FIXED: Now returns boolean for success/failure
  const clockOut = useCallback(async (): Promise<boolean> => {
    if (!activeShift) return false;
    try {
      if (activeShift.lunchStartTime && !activeShift.lunchEndTime) {
        const totalBreakMinutes = toBreakMinutes(getTotalBreakMs(activeShift));
        await shiftService.endLunch(activeShift.id, totalBreakMinutes);
      }
      await shiftService.clockOut(activeShift.id);
      await refreshShifts();
      await refreshJobs();
      return true;
    } catch (error) {
      console.error('Clock out error:', error);
      if (activeShift && currentUser) {
        enqueueClockPunch({
          type: 'clock_out',
          userId: currentUser.id,
          timestamp: new Date().toISOString(),
          shiftId: activeShift.id,
        });
        setOfflineQueueVersion((v) => v + 1);
      }
      return false;
    }
  }, [activeShift, refreshShifts, refreshJobs, currentUser]);

  const startLunch = useCallback(async (): Promise<boolean> => {
    if (!activeShift) return false;
    if (activeShift.lunchStartTime && !activeShift.lunchEndTime) return true;
    if (getRemainingBreakMs(activeShift) <= 0) return false;
    const shiftId = activeShift.id;
    const nowIso = new Date().toISOString();
    queryClient.setQueryData<Shift[]>(['shifts'], (prev) =>
      prev
        ? prev.map((s) =>
            s.id === shiftId ? { ...s, lunchStartTime: nowIso, lunchEndTime: undefined } : s
          )
        : []
    );
    try {
      const success = await shiftService.startLunch(shiftId);
      if (!success) {
        queryClient.setQueryData<Shift[]>(['shifts'], (prev) =>
          prev
            ? prev.map((s) =>
                s.id === shiftId ? { ...s, lunchStartTime: undefined, lunchEndTime: undefined } : s
              )
            : []
        );
        return false;
      }
      await refreshShifts();
      return true;
    } catch (error) {
      console.error('Start lunch error:', error);
      queryClient.setQueryData<Shift[]>(['shifts'], (prev) =>
        prev
          ? prev.map((s) =>
              s.id === shiftId ? { ...s, lunchStartTime: undefined, lunchEndTime: undefined } : s
            )
          : []
      );
      return false;
    }
  }, [activeShift, refreshShifts, queryClient]);

  const endLunch = useCallback(async (): Promise<boolean> => {
    if (!activeShift?.lunchStartTime || activeShift.lunchEndTime) return false;
    const shiftId = activeShift.id;
    const totalBreakMinutes = toBreakMinutes(getTotalBreakMs(activeShift));
    const nowIso = new Date().toISOString();
    queryClient.setQueryData<Shift[]>(['shifts'], (prev) =>
      prev
        ? prev.map((s) =>
            s.id === shiftId
              ? {
                  ...s,
                  lunchStartTime: undefined,
                  lunchEndTime: nowIso,
                  lunchMinutesUsed: totalBreakMinutes,
                }
              : s
          )
        : []
    );
    try {
      const success = await shiftService.endLunch(shiftId, totalBreakMinutes);
      if (!success) {
        queryClient.setQueryData<Shift[]>(['shifts'], (prev) =>
          prev
            ? prev.map((s) =>
                s.id === shiftId
                  ? {
                      ...s,
                      lunchStartTime: activeShift.lunchStartTime,
                      lunchEndTime: undefined,
                      lunchMinutesUsed: activeShift.lunchMinutesUsed,
                    }
                  : s
              )
            : []
        );
        return false;
      }
      await refreshShifts();
      return true;
    } catch (error) {
      console.error('End lunch error:', error);
      queryClient.setQueryData<Shift[]>(['shifts'], (prev) =>
        prev
          ? prev.map((s) =>
              s.id === shiftId
                ? {
                    ...s,
                    lunchStartTime: activeShift.lunchStartTime,
                    lunchEndTime: undefined,
                    lunchMinutesUsed: activeShift.lunchMinutesUsed,
                  }
                : s
            )
          : []
      );
      return false;
    }
  }, [activeShift, refreshShifts, queryClient]);

  const createInventory = useCallback(
    async (data: Partial<InventoryItem>): Promise<InventoryItem | null> => {
      try {
        const inStock = data.inStock ?? 0;
        const item = await inventoryService.createInventory({
          ...data,
          inStock,
          available: inStock,
          onOrder: data.onOrder ?? 0,
        });
        if (item) {
          queryClient.setQueryData<InventoryItem[]>(['inventory'], (prev) =>
            prev ? [item, ...prev] : [item]
          );
        }
        return item;
      } catch (error) {
        console.error('Create inventory error:', error);
        return null;
      }
    },
    [queryClient]
  );

  const updateInventoryItem = useCallback(
    async (id: string, data: Partial<InventoryItem>): Promise<InventoryItem | null> => {
      try {
        const updatedItem = await inventoryService.updateInventory(id, data);
        if (updatedItem) {
          queryClient.setQueryData<InventoryItem[]>(['inventory'], (prev) =>
            prev ? prev.map((i) => (i.id === id ? updatedItem : i)) : []
          );
        }
        return updatedItem;
      } catch (error) {
        console.error('Update inventory error:', error);
        return null;
      }
    },
    [queryClient]
  );

  const updateInventoryStock = useCallback(
    async (id: string, inStock: number, reason?: string): Promise<void> => {
      try {
        // Get current item to calculate previous values
        const currentItem = inventory.find((i) => i.id === id);
        if (!currentItem) {
          console.error('Inventory item not found');
          return;
        }

        const previousInStock = currentItem.inStock;
        const previousAvailable = calculateAvailable(currentItem);
        const changeAmount = inStock - previousInStock;

        queryClient.setQueryData<InventoryItem[]>(['inventory'], (prev) =>
          prev ? prev.map((i) => (i.id === id ? { ...i, inStock } : i)) : []
        );

        // Update in database (only inStock)
        await inventoryService.updateStock(id, inStock);

        // Create history entry if user is logged in
        if (currentUser && changeAmount !== 0) {
          await inventoryHistoryService.createHistory({
            inventory: id,
            user: currentUser.id,
            action: 'manual_adjust',
            reason: reason || 'Stock adjusted manually',
            previousInStock,
            newInStock: inStock,
            previousAvailable,
            newAvailable: Math.max(0, inStock - calculateAllocated(id)),
            changeAmount,
          });
        }

        await refreshInventory();
      } catch (error) {
        console.error('Update inventory stock error:', error);
        await refreshInventory();
      }
    },
    [refreshInventory, inventory, calculateAvailable, calculateAllocated, currentUser, queryClient]
  );

  const addJobInventory = useCallback(
    async (jobId: string, inventoryId: string, quantity: number, unit: string): Promise<void> => {
      try {
        const item = inventory.find((i) => i.id === inventoryId);
        if (item) {
          const available = calculateAvailable(item);
          if (quantity > available) {
            return;
          }
        }
        await jobService.addJobInventory(jobId, inventoryId, quantity, unit);
        await refreshJobs();
        await refreshInventory();
      } catch (error) {
        console.error('Add job inventory error:', error);
      }
    },
    [inventory, calculateAvailable, refreshJobs, refreshInventory]
  );

  const allocateInventoryToJob = useCallback(
    async (
      jobId: string,
      inventoryId: string,
      quantity: number,
      notes?: string
    ): Promise<boolean> => {
      try {
        const item = inventory.find((inv) => inv.id === inventoryId);
        const job = jobs.find((j) => j.id === jobId);
        if (!item || !job || quantity <= 0) return false;

        const previousAvailable = calculateAvailable(item);
        if (quantity > previousAvailable) {
          return false;
        }
        const currentAllocated = calculateAllocated(inventoryId);
        const nextAllocated = currentAllocated + quantity;
        const newAvailable = Math.max(0, item.inStock - nextAllocated);

        const ok = await jobService.addJobInventory(
          jobId,
          inventoryId,
          quantity,
          item.unit || 'units'
        );
        if (!ok) return false;

        if (currentUser) {
          await inventoryHistoryService.createHistory({
            inventory: inventoryId,
            user: currentUser.id,
            action: 'allocated_to_job',
            reason: notes?.trim() || `Allocated ${quantity} ${item.unit} to Job #${job.jobCode}`,
            previousInStock: item.inStock,
            newInStock: item.inStock,
            previousAvailable,
            newAvailable,
            changeAmount: 0,
            relatedJob: jobId,
            relatedPO: job.po,
          });
        }

        await refreshJobs();
        await refreshInventory();
        return true;
      } catch (error) {
        console.error('Allocate inventory to job error:', error);
        return false;
      }
    },
    [
      inventory,
      jobs,
      currentUser,
      calculateAvailable,
      calculateAllocated,
      refreshJobs,
      refreshInventory,
    ]
  );

  const removeJobInventory = useCallback(
    async (jobId: string, jobInventoryId: string): Promise<void> => {
      try {
        await jobService.removeJobInventory(jobId, jobInventoryId);
        await refreshJobs();
        await refreshInventory();
      } catch (error) {
        console.error('Remove job inventory error:', error);
      }
    },
    [refreshJobs, refreshInventory]
  );

  const markInventoryOrdered = useCallback(
    async (id: string, quantity: number): Promise<boolean> => {
      try {
        const item = inventory.find((i) => i.id === id);
        if (!item) {
          console.error('Inventory item not found');
          return false;
        }
        const newOnOrder = (item.onOrder || 0) + quantity;
        await inventoryService.updateInventory(id, { onOrder: newOnOrder });
        if (currentUser) {
          await inventoryHistoryService.createHistory({
            inventory: id,
            user: currentUser.id,
            action: 'order_placed',
            reason: `Ordered ${quantity} ${item.unit}`,
            previousInStock: item.inStock,
            newInStock: item.inStock,
            previousAvailable: calculateAvailable(item),
            newAvailable: calculateAvailable(item),
            changeAmount: 0,
          });
        }
        await refreshInventory();
        return true;
      } catch (error) {
        console.error('Mark inventory ordered error:', error);
        await refreshInventory();
        return false;
      }
    },
    [inventory, currentUser, refreshInventory, calculateAvailable]
  );

  const receiveInventoryOrder = useCallback(
    async (id: string, receivedQuantity: number): Promise<boolean> => {
      try {
        const item = inventory.find((i) => i.id === id);
        if (!item) {
          console.error('Inventory item not found');
          return false;
        }
        const previousAvailable = calculateAvailable(item);
        const newInStock = item.inStock + receivedQuantity;
        const newOnOrder = Math.max(0, (item.onOrder || 0) - receivedQuantity);
        await inventoryService.updateInventory(id, { inStock: newInStock, onOrder: newOnOrder });
        if (currentUser) {
          await inventoryHistoryService.createHistory({
            inventory: id,
            user: currentUser.id,
            action: 'order_received',
            reason: `Received ${receivedQuantity} ${item.unit}`,
            previousInStock: item.inStock,
            newInStock: newInStock,
            previousAvailable: previousAvailable,
            newAvailable: Math.max(0, newInStock - calculateAllocated(id)),
            changeAmount: receivedQuantity,
          });
        }
        await refreshInventory();
        return true;
      } catch (error) {
        console.error('Receive inventory order error:', error);
        await refreshInventory();
        return false;
      }
    },
    [inventory, currentUser, refreshInventory, calculateAvailable, calculateAllocated]
  );

  const addAttachment = useCallback(
    async (jobId: string, file: File, isAdminOnly = false): Promise<boolean> => {
      try {
        const success = await jobService.addAttachment(jobId, file, isAdminOnly);
        if (success) {
          await refreshJobs();
        }
        return success;
      } catch (error) {
        console.error('Add attachment error:', error);
        return false;
      }
    },
    [refreshJobs]
  );

  const deleteAttachment = useCallback(
    async (attachmentId: string): Promise<boolean> => {
      try {
        const success = await jobService.deleteAttachment(attachmentId);
        if (success) {
          await refreshJobs();
        }
        return success;
      } catch (error) {
        console.error('Delete attachment error:', error);
        return false;
      }
    },
    [refreshJobs]
  );

  const updateAttachmentAdminOnly = useCallback(
    async (attachmentId: string, isAdminOnly: boolean): Promise<boolean> => {
      try {
        const success = await jobService.updateAttachmentAdminOnly(attachmentId, isAdminOnly);
        if (success) {
          await refreshJobs();
        }
        return success;
      } catch (error) {
        console.error('Update attachment admin-only error:', error);
        return false;
      }
    },
    [refreshJobs]
  );

  const addInventoryAttachment = useCallback(
    async (inventoryId: string, file: File, isAdminOnly = false): Promise<boolean> => {
      try {
        const success = await inventoryService.addAttachment(inventoryId, file, isAdminOnly);
        if (success) {
          await refreshInventory();
        }
        return success;
      } catch (error) {
        console.error('Add inventory attachment error:', error);
        return false;
      }
    },
    [refreshInventory]
  );

  const deleteInventoryAttachment = useCallback(
    async (attachmentId: string, inventoryId: string): Promise<boolean> => {
      try {
        const success = await inventoryService.deleteAttachment(attachmentId, inventoryId);
        if (success) {
          await refreshInventory();
        }
        return success;
      } catch (error) {
        console.error('Delete inventory attachment error:', error);
        return false;
      }
    },
    [refreshInventory]
  );

  useEffect(() => {
    const initApp = async () => {
      setIsLoading(true);
      try {
        const user = await authService.checkAuth();
        if (user) {
          setCurrentUser(user);
          // Server data (jobs, shifts, inventory, users) is now loaded via useQuery when enabled
        }
      } catch (error) {
        console.error('App initialization error:', error);
      } finally {
        setIsLoading(false);
      }
    };
    initApp();
  }, []);

  // Auto-refresh auth token + idle timeout (resilient to avoid constant logouts)
  useEffect(() => {
    if (!currentUser) return;

    let lastActivity = Date.now();

    const refreshAuthWithRetry = async (retries = 2): Promise<boolean> => {
      for (let i = 0; i <= retries; i++) {
        try {
          const user = await authService.checkAuth();
          if (user) return true;
        } catch (error) {
          if (i === retries) {
            console.error('Auth refresh failed after retries:', error);
            return false;
          }
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      return false;
    };

    // Refresh auth token every 20 minutes; only logout if refresh fails after retries
    const authRefreshInterval = setInterval(
      async () => {
        const ok = await refreshAuthWithRetry();
        if (!ok) logout();
      },
      20 * 60 * 1000
    );

    const updateActivity = () => {
      lastActivity = Date.now();
    };

    window.addEventListener('mousedown', updateActivity);
    window.addEventListener('keydown', updateActivity);
    window.addEventListener('touchstart', updateActivity);
    window.addEventListener('scroll', updateActivity);

    // Idle timeout: 60 minutes (was 30) to reduce unexpected logouts
    const idleCheckInterval = setInterval(() => {
      const idleTime = Date.now() - lastActivity;
      const idleLimit = 60 * 60 * 1000;
      if (idleTime >= idleLimit) logout();
    }, 60 * 1000);

    return () => {
      clearInterval(authRefreshInterval);
      clearInterval(idleCheckInterval);
      window.removeEventListener('mousedown', updateActivity);
      window.removeEventListener('keydown', updateActivity);
      window.removeEventListener('touchstart', updateActivity);
      window.removeEventListener('scroll', updateActivity);
    };
  }, [currentUser, logout]);

  // Offline clock queue: sync when back online
  useEffect(() => {
    const syncQueue = async () => {
      if (!navigator.onLine) return;
      const queue = getQueue();
      for (const punch of queue) {
        try {
          if (punch.type === 'clock_in' && punch.jobId) {
            await shiftService.clockIn(punch.jobId, punch.userId);
            clearPunchFromQueue(punch.id);
            setOfflineQueueVersion((v) => v + 1);
            await refreshShifts();
          } else if (punch.type === 'clock_out') {
            let shiftId = punch.shiftId;
            if (!shiftId) {
              const allShifts = await shiftService.getAllShifts();
              const active = allShifts.find((s) => s.user === punch.userId && !s.clockOutTime);
              shiftId = active?.id;
            }
            if (shiftId) {
              await shiftService.clockOut(shiftId);
              clearPunchFromQueue(punch.id);
              setOfflineQueueVersion((v) => v + 1);
              await refreshShifts();
              await refreshJobs();
            }
          }
        } catch {
          // Leave in queue, try again next cycle
        }
      }
    };
    window.addEventListener('online', syncQueue);
    syncQueue();
    return () => window.removeEventListener('online', syncQueue);
  }, [refreshShifts, refreshJobs]);

  // Auth state listener: handle session expiry and token refresh so UI stays in sync
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        setCurrentUser(null);
      }
      if (event === 'TOKEN_REFRESHED' && session?.user) {
        authService.checkAuth().then((user) => {
          if (user) setCurrentUser(user);
        });
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!currentUser) return;

    const unsubJobs = subscriptions.subscribeToJobs((action, record) => {
      if (action === 'create') {
        queryClient.setQueryData<Job[]>(['jobs'], (prev) =>
          prev ? dedupeJobsById([record as Job, ...prev]) : [record as Job]
        );
        refreshInventory();
      } else if (action === 'update') {
        queryClient.setQueryData<Job[]>(['jobs'], (prev) => {
          if (!prev) return [record as Job];
          const exists = prev.some((j) => j.id === record.id);
          const next = exists
            ? prev.map((j) => (j.id === record.id ? (record as Job) : j))
            : ([record as Job, ...prev] as Job[]);
          return dedupeJobsById(next);
        });
        refreshInventory();
      } else if (action === 'delete') {
        queryClient.setQueryData<Job[]>(['jobs'], (prev) =>
          prev ? prev.filter((j) => j.id !== record.id) : []
        );
        refreshInventory();
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
    // refreshInventory intentionally omitted to avoid re-subscribing on every refresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, queryClient]);

  // Single source of truth: inventory with available/allocated computed from jobs (never use DB .available for display)
  const inventoryWithComputed = useMemo(
    () => withComputedInventory(inventory, jobs),
    [inventory, jobs]
  );

  // Defense in depth: never expose inventory pricing to non-admin UI consumers.
  const inventoryForRole = useMemo(() => {
    return stripInventoryFinancials(inventoryWithComputed, currentUser?.isAdmin === true);
  }, [inventoryWithComputed, currentUser?.isAdmin]);

  const contextValue = useMemo<AppContextType>(
    () => ({
      currentUser,
      isLoading,
      authError,
      jobs,
      shifts,
      users,
      inventory: inventoryForRole,
      activeShift,
      activeJob,
      login,
      signUp,
      resetPasswordForEmail,
      logout,
      createJob,
      updateJob,
      deleteJob,
      updateJobStatus,
      advanceJobToNextStatus,
      addJobComment, // FIXED: Renamed from addComment
      getJobByCode, // ADDED
      clockIn,
      clockOut,
      startLunch,
      endLunch,
      createInventory,
      updateInventoryItem,
      updateInventoryStock,
      addJobInventory,
      allocateInventoryToJob,
      removeJobInventory,
      markInventoryOrdered, // ADDED
      receiveInventoryOrder, // ADDED
      addAttachment,
      deleteAttachment,
      updateAttachmentAdminOnly,
      addInventoryAttachment,
      deleteInventoryAttachment,
      refreshJobs,
      refreshJob,
      refreshShifts,
      refreshUsers,
      refreshInventory,
      calculateAvailable,
      calculateAllocated,
      pendingOfflinePunchCount,
    }),
    [
      currentUser,
      isLoading,
      authError,
      jobs,
      shifts,
      users,
      inventoryForRole,
      activeShift,
      activeJob,
      login,
      signUp,
      resetPasswordForEmail,
      logout,
      createJob,
      updateJob,
      deleteJob,
      updateJobStatus,
      advanceJobToNextStatus,
      addJobComment,
      getJobByCode,
      clockIn,
      clockOut,
      startLunch,
      endLunch,
      createInventory,
      updateInventoryItem,
      updateInventoryStock,
      addJobInventory,
      allocateInventoryToJob,
      removeJobInventory,
      markInventoryOrdered,
      receiveInventoryOrder,
      addAttachment,
      deleteAttachment,
      updateAttachmentAdminOnly,
      addInventoryAttachment,
      deleteInventoryAttachment,
      refreshJobs,
      refreshJob,
      refreshShifts,
      refreshUsers,
      refreshInventory,
      calculateAvailable,
      calculateAllocated,
      pendingOfflinePunchCount,
    ]
  );

  return <AppContext.Provider value={contextValue}>{children}</AppContext.Provider>;
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }
  return context;
};

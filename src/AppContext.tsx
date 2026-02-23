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
import { User, Job, Shift, InventoryItem, JobStatus, Comment } from '@/core/types';
import {
  authService,
  userService,
  jobService,
  shiftService,
  inventoryService,
  inventoryHistoryService,
  subscriptions,
} from './pocketbase';
import {
  calculateAllocated as calcAllocated,
  calculateAvailable as calcAvailable,
} from './lib/inventoryCalculations';
import { buildJobNameFromConvention } from './lib/formatJob';

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
  updateJobStatus: (jobId: string, status: JobStatus) => Promise<boolean>; // FIXED: Return boolean
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
  refreshShifts: () => Promise<void>;
  refreshInventory: () => Promise<void>;
  calculateAvailable: (item: InventoryItem) => number;
  calculateAllocated: (inventoryId: string) => number;
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
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);

  const activeShift = useMemo(() => {
    if (!currentUser) return null;
    return shifts.find((s) => s.user === currentUser.id && !s.clockOutTime) || null;
  }, [shifts, currentUser]);

  const activeJob = useMemo(() => {
    if (!activeShift) return null;
    return jobs.find((j) => j.id === activeShift.job) || null;
  }, [activeShift, jobs]);

  const login = useCallback(async (email: string, password: string): Promise<boolean> => {
    setAuthError(null);
    setIsLoading(true);
    try {
      const user = await authService.login(email, password);
      setCurrentUser(user);

      // Load all data after successful login
      await Promise.all([refreshJobs(), refreshShifts(), refreshUsers(), refreshInventory()]);

      return true;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Login failed';
      setAuthError(errorMessage);
      return false;
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          await Promise.all([refreshJobs(), refreshShifts(), refreshUsers(), refreshInventory()]);
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
      // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setJobs([]);
    setShifts([]);
    setUsers([]);
    setInventory([]);
  }, []);

  const calculateAllocated = useCallback(
    (inventoryId: string): number => calcAllocated(inventoryId, jobs),
    [jobs]
  );

  const calculateAvailable = useCallback(
    (item: InventoryItem): number => calcAvailable(item, calcAllocated(item.id, jobs)),
    [jobs]
  );

  const refreshJobs = useCallback(async () => {
    try {
      const jobsData = await jobService.getAllJobs();
      // Sort jobs by date (soonest first)
      jobsData.sort((a, b) => {
        const dateA = a.dueDate || a.ecd || '9999-12-31';
        const dateB = b.dueDate || b.ecd || '9999-12-31';
        return dateA.localeCompare(dateB);
      });
      setJobs(dedupeJobsById(jobsData));
    } catch (error) {
      console.error('Failed to refresh jobs:', error);
    }
  }, []);

  const refreshShifts = useCallback(async () => {
    try {
      const shiftsData = await shiftService.getAllShifts();
      setShifts(shiftsData);
    } catch (error) {
      console.error('Failed to refresh shifts:', error);
    }
  }, []);

  const refreshInventory = useCallback(async () => {
    try {
      const inventoryData = await inventoryService.getAllInventory();
      setInventory(inventoryData);
    } catch (error) {
      console.error('Failed to refresh inventory:', error);
    }
  }, []);

  const refreshUsers = useCallback(async () => {
    try {
      const usersData = await userService.getAllUsers();
      setUsers(usersData);
    } catch (error) {
      console.error('Failed to refresh users:', error);
    }
  }, []);

  const createJob = useCallback(async (data: Partial<Job>): Promise<Job | null> => {
    try {
      const job = await jobService.createJob(data);
      if (!job) {
        console.error('Job creation returned null');
        return null;
      }
      if (job) {
        setJobs((prev) => dedupeJobsById([job, ...prev]));
      }
      return job;
    } catch (error) {
      console.error('Create job error:', error);
      return null;
    }
  }, []);

  const updateJob = useCallback(async (jobId: string, data: Partial<Job>): Promise<Job | null> => {
    try {
      // If marking job as inactive, clear the bin location to free up the space
      if (data.active === false) {
        data.binLocation = undefined;
      }

      const updatedJob = await jobService.updateJob(jobId, data);
      if (updatedJob) {
        setJobs((prev) => prev.map((j) => (j.id === jobId ? updatedJob : j)));
      }
      return updatedJob;
    } catch (error) {
      console.error('Update job error:', error);
      return null;
    }
  }, []);

  // FIXED: Now returns boolean for success/failure
  const updateJobStatus = useCallback(
    async (jobId: string, status: JobStatus): Promise<boolean> => {
      try {
        const job = jobs.find((j) => j.id === jobId);

        // When marking as paid, rename job to Part REV per convention
        if (status === 'paid' && job) {
          const name = buildJobNameFromConvention({ ...job, status: 'paid' });
          const updated = await jobService.updateJob(jobId, { status: 'paid', name });
          if (!updated) {
            await refreshJobs();
            return false;
          }
          setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, status: 'paid', name } : j)));
        } else {
          setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, status } : j)));
          await jobService.updateJobStatus(jobId, status);
        }

        // CRITICAL: Material reconciliation on delivery
        if (status === 'delivered' && job && job.expand?.job_inventory) {
          for (const ji of job.expand.job_inventory) {
            const inventoryId = ji.inventory;
            const quantity = ji.quantity || 0;

            if (quantity > 0) {
              // Get current inventory item
              const invItem = inventory.find((i) => i.id === inventoryId);
              if (invItem) {
                const newInStock = Math.max(0, invItem.inStock - quantity);
                const previousAvailable = calculateAvailable(invItem);

                // Update stock
                await inventoryService.updateStock(inventoryId, newInStock);

                // Create history entry
                if (currentUser) {
                  await inventoryHistoryService.createHistory({
                    inventory: inventoryId,
                    user: currentUser.id,
                    action: 'reconcile_job',
                    reason: `Materials used for Job #${job.jobCode} (Delivered)`,
                    previousInStock: invItem.inStock,
                    newInStock: newInStock,
                    previousAvailable: previousAvailable,
                    newAvailable: Math.max(0, newInStock - calculateAllocated(inventoryId)),
                    changeAmount: -quantity,
                    relatedJob: jobId,
                  });
                }
              }
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
    [
      refreshJobs,
      refreshInventory,
      jobs,
      inventory,
      currentUser,
      calculateAvailable,
      calculateAllocated,
    ]
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
        setJobs((prev) => {
          const exists = prev.some((j) => j.id === fromApi.id);
          return exists ? prev.map((j) => (j.id === fromApi.id ? fromApi : j)) : [fromApi, ...prev];
        });
        return fromApi;
      }
      return null;
    },
    [jobs]
  );

  const clockIn = useCallback(
    async (jobId: string): Promise<boolean> => {
      if (!currentUser) return false;
      try {
        const success = await shiftService.clockIn(jobId, currentUser.id);
        if (success) {
          await refreshShifts();
          await refreshJobs();
        }
        return success;
      } catch (error) {
        console.error('Clock in error:', error);
        return false;
      }
    },
    [currentUser, refreshShifts, refreshJobs]
  );

  // FIXED: Now returns boolean for success/failure
  const clockOut = useCallback(async (): Promise<boolean> => {
    if (!activeShift) return false;
    try {
      if (activeShift.lunchStartTime && !activeShift.lunchEndTime) {
        await shiftService.endLunch(activeShift.id);
      }
      await shiftService.clockOut(activeShift.id);
      await refreshShifts();
      await refreshJobs();
      return true;
    } catch (error) {
      console.error('Clock out error:', error);
      return false;
    }
  }, [activeShift, refreshShifts, refreshJobs]);

  const startLunch = useCallback(async (): Promise<boolean> => {
    if (!activeShift) return false;
    if (activeShift.lunchStartTime && activeShift.lunchEndTime) return false;
    if (activeShift.lunchStartTime && !activeShift.lunchEndTime) return true;
    try {
      const success = await shiftService.startLunch(activeShift.id);
      if (success) {
        await refreshShifts();
      }
      return success;
    } catch (error) {
      console.error('Start lunch error:', error);
      return false;
    }
  }, [activeShift, refreshShifts]);

  const endLunch = useCallback(async (): Promise<boolean> => {
    if (!activeShift?.lunchStartTime || activeShift.lunchEndTime) return false;
    try {
      const success = await shiftService.endLunch(activeShift.id);
      if (success) {
        await refreshShifts();
      }
      return success;
    } catch (error) {
      console.error('End lunch error:', error);
      return false;
    }
  }, [activeShift, refreshShifts]);

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
          setInventory((prev) => [item, ...prev]);
        }
        return item;
      } catch (error) {
        console.error('Create inventory error:', error);
        return null;
      }
    },
    []
  );

  const updateInventoryItem = useCallback(
    async (id: string, data: Partial<InventoryItem>): Promise<InventoryItem | null> => {
      try {
        const updatedItem = await inventoryService.updateInventory(id, data);
        if (updatedItem) {
          setInventory((prev) => prev.map((i) => (i.id === id ? updatedItem : i)));
        }
        return updatedItem;
      } catch (error) {
        console.error('Update inventory error:', error);
        return null;
      }
    },
    []
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

        setInventory((prev) => prev.map((i) => (i.id === id ? { ...i, inStock } : i)));

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
    [refreshInventory, inventory, calculateAvailable, calculateAllocated, currentUser]
  );

  const addJobInventory = useCallback(
    async (jobId: string, inventoryId: string, quantity: number, unit: string): Promise<void> => {
      try {
        const item = inventory.find((i) => i.id === inventoryId);
        if (item) {
          const available = calculateAvailable(item);
          if (quantity > available) {
            console.warn(
              `Add job inventory: only ${available} available for ${item.name}, requested ${quantity}`
            );
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
          await Promise.all([refreshJobs(), refreshShifts(), refreshUsers(), refreshInventory()]);
        }
      } catch (error) {
        console.error('App initialization error:', error);
      } finally {
        setIsLoading(false);
      }
    };
    initApp();
  }, [refreshJobs, refreshShifts, refreshUsers, refreshInventory]);

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

  useEffect(() => {
    if (!currentUser) return;

    const unsubJobs = subscriptions.subscribeToJobs((action, record) => {
      if (action === 'create') {
        setJobs((prev) => dedupeJobsById([record as Job, ...prev]));
        // Refresh inventory to recalculate allocated when new job created
        refreshInventory();
      } else if (action === 'update') {
        setJobs((prev) => {
          const exists = prev.some((j) => j.id === record.id);
          const next = exists
            ? prev.map((j) => (j.id === record.id ? (record as Job) : j))
            : ([record as Job, ...prev] as Job[]);
          return dedupeJobsById(next);
        });
        // Refresh inventory when job status changes (affects allocated)
        refreshInventory();
      } else if (action === 'delete') {
        setJobs((prev) => prev.filter((j) => j.id !== record.id));
        refreshInventory();
      }
    });

    const unsubShifts = subscriptions.subscribeToShifts((action, record) => {
      if (action === 'create') {
        setShifts((prev) => [record as Shift, ...prev]);
      } else if (action === 'update') {
        setShifts((prev) => prev.map((s) => (s.id === record.id ? (record as Shift) : s)));
      } else if (action === 'delete') {
        setShifts((prev) => prev.filter((s) => s.id !== record.id));
      }
    });

    const unsubInventory = subscriptions.subscribeToInventory((action, record) => {
      if (action === 'create') {
        setInventory((prev) => [record as InventoryItem, ...prev]);
      } else if (action === 'update') {
        setInventory((prev) =>
          prev.map((i) => (i.id === record.id ? (record as InventoryItem) : i))
        );
      } else if (action === 'delete') {
        setInventory((prev) => prev.filter((i) => i.id !== record.id));
      }
    });

    return () => {
      unsubJobs();
      unsubShifts();
      unsubInventory();
    };
    // refreshInventory intentionally omitted to avoid re-subscribing on every refresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  // Single source of truth: inventory with available/allocated computed from jobs (never use DB .available for display)
  const inventoryWithComputed = useMemo(() => {
    // Precompute allocations in one pass to avoid O(inventory * jobs) scans.
    const allocatedByInventoryId = new Map<string, number>();
    for (const job of jobs) {
      for (const ji of job.inventoryItems ?? []) {
        allocatedByInventoryId.set(
          ji.inventoryId,
          (allocatedByInventoryId.get(ji.inventoryId) ?? 0) + ji.quantity
        );
      }
    }

    return inventory.map((item) => ({
      ...item,
      allocated: allocatedByInventoryId.get(item.id) ?? 0,
      available: Math.max(0, item.inStock - (allocatedByInventoryId.get(item.id) ?? 0)),
    }));
  }, [inventory, jobs]);

  const contextValue = useMemo<AppContextType>(
    () => ({
      currentUser,
      isLoading,
      authError,
      jobs,
      shifts,
      users,
      inventory: inventoryWithComputed,
      activeShift,
      activeJob,
      login,
      signUp,
      resetPasswordForEmail,
      logout,
      createJob,
      updateJob,
      updateJobStatus,
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
      removeJobInventory,
      markInventoryOrdered, // ADDED
      receiveInventoryOrder, // ADDED
      addAttachment,
      deleteAttachment,
      updateAttachmentAdminOnly,
      addInventoryAttachment,
      deleteInventoryAttachment,
      refreshJobs,
      refreshShifts,
      refreshInventory,
      calculateAvailable,
      calculateAllocated,
    }),
    [
      currentUser,
      isLoading,
      authError,
      jobs,
      shifts,
      users,
      inventoryWithComputed,
      activeShift,
      activeJob,
      login,
      signUp,
      resetPasswordForEmail,
      logout,
      createJob,
      updateJob,
      updateJobStatus,
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
      removeJobInventory,
      markInventoryOrdered,
      receiveInventoryOrder,
      addAttachment,
      deleteAttachment,
      updateAttachmentAdminOnly,
      addInventoryAttachment,
      deleteInventoryAttachment,
      refreshJobs,
      refreshShifts,
      refreshInventory,
      calculateAvailable,
      calculateAllocated,
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

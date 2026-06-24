import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { InventoryItem, Job, Shift, User } from '@/core/types';
import { dedupeJobsById } from '@/lib/jobUtils';
import { jobService } from '@/services/api/jobs';
import { shiftService } from '@/services/api/shifts';
import { userService } from '@/services/api/users';
import { inventoryService } from '@/services/api/inventory';

export interface UseAppQueriesResult {
  jobs: Job[];
  shifts: Shift[];
  users: User[];
  inventory: InventoryItem[];
  /**
   * True while the core jobs/inventory queries are loading their first page of
   * data (and have nothing cached yet). Lets list views show a spinner instead
   * of rendering blank during the initial fetch. Stays false when queries are
   * disabled (logged out), so the UI falls through to its empty state rather
   * than spinning forever.
   */
  isPending: boolean;
  refreshJobs: () => Promise<void>;
  refreshJob: (jobId: string) => Promise<void>;
  refreshShifts: () => Promise<void>;
  refreshUsers: () => Promise<void>;
  refreshInventory: () => Promise<void>;
}

export function useAppQueries(enabled: boolean): UseAppQueriesResult {
  const queryClient = useQueryClient();

  const { data: jobsData = [], isLoading: jobsLoading } = useQuery({
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

  const { data: inventoryData = [], isLoading: inventoryLoading } = useQuery({
    queryKey: ['inventory'],
    queryFn: () => inventoryService.getAllInventory(),
    enabled,
  });

  // `isLoading` from react-query is (isPending && isFetching): true only on the
  // first fetch with no cached data, and false when the query is disabled. That
  // makes it the right signal for an initial-load spinner — it won't re-trigger
  // on background refetches or realtime-driven cache updates.
  const isPending = enabled && (jobsLoading || inventoryLoading);

  const refreshJobs = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['jobs'] });
  }, [queryClient]);

  const refreshJob = useCallback(
    async (jobId: string) => {
      try {
        const job = await jobService.getJobById(jobId);
        if (job) {
          let jobToSet = job;
          const existing = queryClient.getQueryData<Job>(['job', jobId]);
          if (
            (job.parts == null || job.parts.length === 0) &&
            existing?.parts != null &&
            existing.parts.length > 0
          ) {
            jobToSet = { ...job, parts: existing.parts };
          }
          queryClient.setQueryData<Job[]>(['jobs'], (prev) =>
            prev ? dedupeJobsById([jobToSet, ...prev]) : [jobToSet]
          );
          queryClient.setQueryData(['job', jobId], jobToSet);
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

  const refreshUsers = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['users'] });
  }, [queryClient]);

  const refreshInventory = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['inventory'] });
  }, [queryClient]);

  return {
    jobs: jobsData,
    shifts: shiftsData,
    users: usersData,
    inventory: inventoryData,
    isPending,
    refreshJobs,
    refreshJob,
    refreshShifts,
    refreshUsers,
    refreshInventory,
  };
}

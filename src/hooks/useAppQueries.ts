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
  refreshJobs: () => Promise<void>;
  refreshJob: (jobId: string) => Promise<void>;
  refreshShifts: () => Promise<void>;
  refreshUsers: () => Promise<void>;
  refreshInventory: () => Promise<void>;
}

export function useAppQueries(enabled: boolean): UseAppQueriesResult {
  const queryClient = useQueryClient();

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
            prev ? prev.map((j) => (j.id === jobId ? jobToSet : j)) : [jobToSet]
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
    refreshJobs,
    refreshJob,
    refreshShifts,
    refreshUsers,
    refreshInventory,
  };
}

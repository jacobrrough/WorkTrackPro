import { useMemo } from 'react';
import type { Job, Shift, User } from '@/core/types';

/**
 * Derives active shift and active job for the current user from shifts and jobs.
 */
export function useActiveShift(
  currentUser: User | null,
  shifts: Shift[],
  jobs: Job[]
): { activeShift: Shift | null; activeJob: Job | null } {
  const activeShift = useMemo(() => {
    if (!currentUser) return null;
    return shifts.find((s) => s.user === currentUser.id && !s.clockOutTime) || null;
  }, [shifts, currentUser]);

  const activeJob = useMemo(() => {
    if (!activeShift) return null;
    return jobs.find((j) => j.id === activeShift.job) || null;
  }, [activeShift, jobs]);

  return { activeShift, activeJob };
}

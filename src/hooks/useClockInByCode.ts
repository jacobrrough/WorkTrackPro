import { useCallback } from 'react';
import { useApp } from '../AppContext';

/**
 * Extracted from App.tsx — handles the full clock-in-by-job-code flow
 * including offline queuing and session-expiry handling.
 */
export function useClockInByCode() {
  const { getJobByCode, clockIn, logout } = useApp();

  return useCallback(
    async (
      code: number
    ): Promise<{ success: boolean; message: string; queued?: boolean; authExpired?: boolean }> => {
      const job = await getJobByCode(code);
      if (!job) return { success: false, message: 'Job not found' };
      const { ok, queued, authExpired } = await clockIn(job.id);
      if (ok) return { success: true, message: 'Clocked in' };
      if (authExpired) {
        logout();
        return {
          success: false,
          message: 'Session expired — please log in again',
          authExpired: true,
        };
      }
      if (queued) {
        return {
          success: false,
          message: 'Saved offline — will sync when connected',
          queued: true,
        };
      }
      return { success: false, message: 'Failed to clock in' };
    },
    [getJobByCode, clockIn, logout]
  );
}

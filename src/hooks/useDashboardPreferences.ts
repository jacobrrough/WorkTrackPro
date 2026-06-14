import { useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { dashboardPreferencesService } from '@/services/api/dashboardPreferences';
import { useToast } from '@/Toast';
import type { DashboardPreferences, UserDashboardPreferences } from '@/core/types';

// Matches the toast's default visible duration — collapse failures that land
// within one toast's lifetime into a single message.
const ERROR_TOAST_THROTTLE_MS = 3000;

export function useDashboardPreferences(enabled: boolean) {
  return useQuery({
    queryKey: ['dashboard-preferences'],
    queryFn: () => dashboardPreferencesService.getPreferences(),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useUpdateDashboardPreferences() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const lastErrorToastAt = useRef(0);

  return useMutation({
    // Serialize saves so only one runs at a time. Each onMutate snapshot then
    // reflects the previously committed state, so a failed save's rollback can
    // never restore a stale value over a newer save that already landed.
    scope: { id: 'dashboard-preferences' },

    mutationFn: ({
      preferences,
      updatedAt,
    }: {
      preferences: DashboardPreferences;
      updatedAt: string;
    }) => dashboardPreferencesService.updatePreferences(preferences, updatedAt),

    onMutate: async ({ preferences, updatedAt }) => {
      await queryClient.cancelQueries({ queryKey: ['dashboard-preferences'] });

      const previous = queryClient.getQueryData<UserDashboardPreferences>([
        'dashboard-preferences',
      ]);

      // Mirror the exact timestamp being persisted so the optimistic cache and
      // the eventual server value agree on the version marker.
      queryClient.setQueryData<UserDashboardPreferences>(['dashboard-preferences'], (old) =>
        old ? { ...old, preferences, updatedAt } : old
      );

      return { previous };
    },

    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['dashboard-preferences'], context.previous);
      }
      // The save failed (Supabase error or expired session). React Query does
      // not auto-retry mutations, so each failed save reports at most once; the
      // throttle additionally collapses a burst of separate failures — rapid
      // reorder clicks while offline, or a user save plus the background
      // reconcile push both failing — into a single toast.
      const now = Date.now();
      if (now - lastErrorToastAt.current > ERROR_TOAST_THROTTLE_MS) {
        lastErrorToastAt.current = now;
        showToast(
          'Could not save your dashboard layout — changes may not sync across devices.',
          'error'
        );
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard-preferences'] });
    },
  });
}

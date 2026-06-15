import { useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { dashboardPreferencesService } from '@/services/api/dashboardPreferences';
import { isAuthError } from '@/lib/authErrors';
import { useToast } from '@/Toast';
import type { DashboardPreferences, UserDashboardPreferences } from '@/core/types';

// Single source of truth for the query key so a rename can't silently desync the
// read, the optimistic write, and the logout cache-clear.
export const DASHBOARD_PREFERENCES_KEY = ['dashboard-preferences'] as const;

// Matches the toast's default visible duration — collapse failures that land
// within one toast's lifetime into a single message.
const ERROR_TOAST_THROTTLE_MS = 3000;

export function useDashboardPreferences(enabled: boolean) {
  return useQuery({
    queryKey: DASHBOARD_PREFERENCES_KEY,
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
      await queryClient.cancelQueries({ queryKey: DASHBOARD_PREFERENCES_KEY });

      const previous =
        queryClient.getQueryData<UserDashboardPreferences>(DASHBOARD_PREFERENCES_KEY);

      // Mirror the exact timestamp being persisted so the optimistic cache and
      // the eventual server value agree on the version marker.
      queryClient.setQueryData<UserDashboardPreferences>(DASHBOARD_PREFERENCES_KEY, (old) =>
        old ? { ...old, preferences, updatedAt } : old
      );

      return { previous };
    },

    onError: (err, _vars, context) => {
      // A save that lost its session — most often because it was in flight when
      // the user logged out — rejects with an auth error. Logout already clears
      // this cache; rolling `context.previous` back in here would re-populate the
      // just-cleared cache with the previous user's layout (the cross-user leak
      // logout fixes), and the toast would wrongly blame a save the user never
      // expected to land. Bail silently — the auth layer owns that UX.
      if (isAuthError(err)) return;

      if (context?.previous) {
        queryClient.setQueryData(DASHBOARD_PREFERENCES_KEY, context.previous);
      }
      // The save failed (Supabase error). React Query does not auto-retry
      // mutations, so each failed save reports at most once; the throttle
      // additionally collapses a burst of separate failures — rapid reorder
      // clicks while offline, or a user save plus the background reconcile push
      // both failing — into a single toast.
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
      queryClient.invalidateQueries({ queryKey: DASHBOARD_PREFERENCES_KEY });
    },
  });
}

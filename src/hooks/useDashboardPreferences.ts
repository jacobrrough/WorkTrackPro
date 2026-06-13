import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { dashboardPreferencesService } from '@/services/api/dashboardPreferences';
import type { DashboardPreferences, UserDashboardPreferences } from '@/core/types';

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

  return useMutation({
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
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard-preferences'] });
    },
  });
}

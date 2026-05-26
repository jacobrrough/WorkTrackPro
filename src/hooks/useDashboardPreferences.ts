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
    mutationFn: (preferences: DashboardPreferences) =>
      dashboardPreferencesService.updatePreferences(preferences),

    onMutate: async (newPrefs) => {
      await queryClient.cancelQueries({ queryKey: ['dashboard-preferences'] });

      const previous = queryClient.getQueryData<UserDashboardPreferences>([
        'dashboard-preferences',
      ]);

      queryClient.setQueryData<UserDashboardPreferences>(['dashboard-preferences'], (old) =>
        old ? { ...old, preferences: newPrefs, updatedAt: new Date().toISOString() } : old
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

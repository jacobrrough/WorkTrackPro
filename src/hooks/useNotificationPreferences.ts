import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationPreferencesService } from '@/services/api/notificationPreferences';
import type { NotificationPreferences, UserNotificationPreferences } from '@/core/types';

export function useNotificationPreferences(enabled: boolean, isAdmin: boolean) {
  return useQuery({
    queryKey: ['notification-preferences'],
    queryFn: () => notificationPreferencesService.getPreferences(isAdmin),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (preferences: NotificationPreferences) =>
      notificationPreferencesService.updatePreferences(preferences),

    onMutate: async (newPrefs) => {
      await queryClient.cancelQueries({ queryKey: ['notification-preferences'] });

      const previous = queryClient.getQueryData<UserNotificationPreferences>([
        'notification-preferences',
      ]);

      queryClient.setQueryData<UserNotificationPreferences>(['notification-preferences'], (old) =>
        old ? { ...old, preferences: newPrefs, updatedAt: new Date().toISOString() } : old
      );

      return { previous };
    },

    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['notification-preferences'], context.previous);
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-preferences'] });
    },
  });
}

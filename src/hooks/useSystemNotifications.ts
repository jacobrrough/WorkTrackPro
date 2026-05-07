import { useEffect } from 'react';
import { useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { systemNotificationService } from '@/services/api/systemNotifications';
import { subscriptions } from '@/services/api/subscriptions';
import type { SystemNotification } from '@/core/types';

export function useSystemNotifications(enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ['system-notifications'],
    queryFn: async ({ pageParam }) => {
      return systemNotificationService.getNotifications(50, pageParam as string | undefined);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => {
      if (!lastPage || lastPage.length < 50) return undefined;
      return lastPage[lastPage.length - 1]?.createdAt;
    },
    enabled,
    staleTime: 30_000,
  });
}

export function useUnreadNotificationCount(enabled: boolean) {
  return useQuery({
    queryKey: ['system-notifications', 'unread-count'],
    queryFn: () => systemNotificationService.getUnreadCount(),
    enabled,
    staleTime: 30_000,
  });
}

export function useSystemNotificationSubscription(userId: string | null, enabled: boolean) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId || !enabled) return;

    const unsub = subscriptions.subscribeToSystemNotifications(userId, (_action, record) => {
      queryClient.setQueryData<{ pages: SystemNotification[][]; pageParams: unknown[] }>(
        ['system-notifications'],
        (old) => {
          if (!old) return old;
          const notification: SystemNotification = {
            id: record.id as string,
            userId: record.user_id as string,
            type: record.type as SystemNotification['type'],
            title: record.title as string,
            message: record.message as string,
            link: (record.link as string) ?? undefined,
            metadata: (record.metadata as Record<string, unknown>) ?? undefined,
            readAt: undefined,
            createdAt: record.created_at as string,
          };
          const firstPage = old.pages[0] ?? [];
          if (firstPage.some((n) => n.id === notification.id)) return old;
          return {
            ...old,
            pages: [[notification, ...firstPage], ...old.pages.slice(1)],
          };
        }
      );

      queryClient.setQueryData<number>(
        ['system-notifications', 'unread-count'],
        (prev) => (prev ?? 0) + 1
      );
    });

    return unsub;
  }, [userId, enabled, queryClient]);
}

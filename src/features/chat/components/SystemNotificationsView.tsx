import { useCallback, useRef, useEffect } from 'react';
import { useSystemNotifications } from '@/hooks/useSystemNotifications';
import { systemNotificationService } from '@/services/api/systemNotifications';
import { useQueryClient } from '@tanstack/react-query';
import type { SystemNotification } from '@/core/types';
import { NotificationItem } from './NotificationItem';

interface SystemNotificationsViewProps {
  onBack: () => void;
  onNavigate?: (link: string) => void;
}

export function SystemNotificationsView({ onBack, onNavigate }: SystemNotificationsViewProps) {
  const queryClient = useQueryClient();
  const {
    data: notificationData,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    isLoading,
  } = useSystemNotifications(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const allNotifications = notificationData?.pages.flat() ?? [];

  const handleMarkAllRead = useCallback(async () => {
    await systemNotificationService.markAllRead();
    queryClient.invalidateQueries({ queryKey: ['system-notifications'] });
    queryClient.setQueryData<number>(['system-notifications', 'unread-count'], 0);
  }, [queryClient]);

  const handleNotificationClick = useCallback(
    async (notification: SystemNotification) => {
      if (!notification.readAt) {
        await systemNotificationService.markRead([notification.id]);
        queryClient.invalidateQueries({ queryKey: ['system-notifications'] });
        queryClient.setQueryData<number>(['system-notifications', 'unread-count'], (prev) =>
          Math.max((prev ?? 1) - 1, 0)
        );
      }
      if (notification.link && onNavigate) {
        onNavigate(notification.link);
      }
    },
    [queryClient, onNavigate]
  );

  const handleScroll = useCallback(() => {
    if (!scrollRef.current || isFetchingNextPage || !hasNextPage) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    if (scrollHeight - scrollTop - clientHeight < 200) {
      fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  const hasUnread = allNotifications.some((n) => !n.readAt);

  return (
    <div className="flex flex-1 flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-white/10 hover:text-white md:hidden"
        >
          <span className="material-symbols-outlined text-xl">arrow_back</span>
        </button>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/20 text-primary">
          <span className="material-symbols-outlined text-xl">notifications</span>
        </div>
        <div className="flex-1">
          <h2 className="text-sm font-bold text-white">Notifications</h2>
          <p className="text-xs text-subtle">System alerts and mentions</p>
        </div>
        {hasUnread && (
          <button
            type="button"
            onClick={handleMarkAllRead}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
          >
            Mark all read
          </button>
        )}
      </div>

      {/* Notification list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-muted">Loading notifications...</p>
          </div>
        )}

        {!isLoading && allNotifications.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center">
            <span className="material-symbols-outlined text-5xl text-subtle">
              notifications_none
            </span>
            <p className="text-sm text-muted">No notifications yet</p>
            <p className="text-xs text-subtle">
              You&apos;ll see alerts for job changes, mentions, and more here.
            </p>
          </div>
        )}

        {allNotifications.map((notification) => (
          <NotificationItem
            key={notification.id}
            notification={notification}
            onClick={() => handleNotificationClick(notification)}
          />
        ))}

        {isFetchingNextPage && (
          <div className="flex items-center justify-center py-4">
            <p className="text-xs text-subtle">Loading more...</p>
          </div>
        )}
      </div>
    </div>
  );
}

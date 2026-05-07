import { useState, useRef, useEffect, useCallback } from 'react';
import { useSystemNotifications, useUnreadNotificationCount } from '@/hooks/useSystemNotifications';
import { systemNotificationService } from '@/services/api/systemNotifications';
import { useQueryClient } from '@tanstack/react-query';
import type { SystemNotification, SystemNotificationType, ViewState } from '@/core/types';

const TYPE_LABELS: Record<SystemNotificationType, string> = {
  mention: 'Mention',
  status_change: 'Status',
  assignment: 'Assigned',
  unassignment: 'Removed',
  low_stock: 'Low stock',
  rush: 'Rush',
  overdue: 'Overdue',
  delivery: 'Delivery',
  po_received: 'PO Received',
};

interface NotificationBellProps {
  onNavigate?: (view: ViewState, id?: string) => void;
}

export function NotificationBell({ onNavigate }: NotificationBellProps) {
  const queryClient = useQueryClient();
  const { data: notificationData } = useSystemNotifications(true);
  const { data: unreadCount } = useUnreadNotificationCount(true);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const notifications = notificationData?.pages.flat() ?? [];
  const displayCount = unreadCount ?? 0;

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('click', handle);
    return () => window.removeEventListener('click', handle);
  }, [open]);

  const handleMarkAllRead = useCallback(async () => {
    await systemNotificationService.markAllRead();
    queryClient.invalidateQueries({ queryKey: ['system-notifications'] });
    queryClient.setQueryData<number>(['system-notifications', 'unread-count'], 0);
  }, [queryClient]);

  const handleSelect = useCallback(
    async (n: SystemNotification) => {
      if (!n.readAt) {
        await systemNotificationService.markRead([n.id]);
        queryClient.invalidateQueries({ queryKey: ['system-notifications'] });
        queryClient.setQueryData<number>(['system-notifications', 'unread-count'], (prev) =>
          Math.max((prev ?? 1) - 1, 0)
        );
      }
      setOpen(false);
      if (n.link && onNavigate) {
        const [view, id] = n.link.split(':');
        if (view && id) onNavigate(view as ViewState, id);
      }
    },
    [queryClient, onNavigate]
  );

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative flex size-11 touch-manipulation items-center justify-center rounded-sm text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
        aria-label={displayCount > 0 ? `${displayCount} notifications` : 'Notifications'}
        aria-expanded={open}
      >
        <span className="material-symbols-outlined">notifications</span>
        {displayCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
            {displayCount > 99 ? '99+' : displayCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-80 max-w-[calc(100vw-2rem)] rounded-sm border border-white/10 bg-[#1a1122] shadow-xl">
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
            <span className="text-sm font-bold text-white">Notifications</span>
            {notifications.some((n) => !n.readAt) && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="text-xs text-primary hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-72 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-slate-500">No notifications</p>
            ) : (
              notifications.slice(0, 20).map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => handleSelect(n)}
                  className={`flex w-full flex-col items-start gap-0.5 border-b border-white/5 px-3 py-2 text-left transition-colors hover:bg-white/10 ${
                    n.readAt ? 'opacity-80' : ''
                  }`}
                >
                  <span className="text-xs font-bold uppercase text-primary">
                    {TYPE_LABELS[n.type]}
                  </span>
                  <span className="text-sm text-white">{n.message}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

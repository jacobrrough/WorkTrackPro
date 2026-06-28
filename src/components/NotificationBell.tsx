import { useState, useRef, useEffect, useCallback } from 'react';
import { useSystemNotifications, useUnreadNotificationCount } from '@/hooks/useSystemNotifications';
import { systemNotificationService } from '@/services/api/systemNotifications';
import { useQueryClient } from '@tanstack/react-query';
import type { SystemNotification, SystemNotificationType, ViewState } from '@/core/types';

const TYPE_LABELS: Partial<Record<SystemNotificationType, string>> = {
  // Jobs & Boards
  status_change: 'Status',
  assignment: 'Assigned',
  unassignment: 'Removed',
  rush: 'Rush',
  overdue: 'Overdue',
  comment_mention: 'Mention',
  checklist_complete: 'Checklist',
  delivery_update: 'Delivery',
  variant_update: 'Variant',
  // Inventory
  low_stock: 'Low Stock',
  critical_stock: 'Critical',
  allocation_complete: 'Allocated',
  allocation_reversal: 'Reversed',
  reorder_point_hit: 'Reorder',
  // Time Clock
  shift_edit_approved: 'Shift Edit',
  shift_edit_requested: 'Shift Request',
  clock_anomaly: 'Clock Alert',
  lunch_break_reminder: 'Lunch',
  // Chat
  chat_mention: 'Chat Mention',
  new_direct_message: 'DM',
  thread_reply: 'Reply',
  // Admin
  new_user_pending_approval: 'New User',
  user_approved: 'Approved',
  user_rejected: 'Rejected',
  proposal_submitted: 'Proposal',
  // Quotes
  new_customer_proposal: 'Proposal',
  quote_assigned: 'Quote',
  quote_updated: 'Quote Update',
  // Deliveries
  delivery_scheduled: 'Scheduled',
  delivery_completed: 'Delivered',
  delivery_delayed: 'Delayed',
  // System
  daily_summary: 'Summary',
  system_alert: 'Alert',
  maintenance_notice: 'Maintenance',
  // Legacy
  mention: 'Mention',
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
        className="relative flex size-11 touch-manipulation items-center justify-center rounded-sm text-muted transition-colors hover:bg-white/10 hover:text-white"
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
        <div className="absolute right-0 top-full z-50 mt-1 w-72 max-w-[calc(100vw-1.5rem)] rounded-sm border border-white/10 bg-app-2 shadow-xl sm:w-80">
          <div className="flex items-center justify-between border-b border-white/10 px-2.5 py-1.5 sm:px-3 sm:py-2">
            <span className="text-xs font-bold text-white sm:text-sm">Notifications</span>
            <div className="flex items-center gap-2">
              {notifications.some((n) => !n.readAt) && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  className="text-[11px] text-primary hover:underline sm:text-xs"
                >
                  Mark all read
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onNavigate?.('notification-settings' as ViewState);
                }}
                className="flex size-6 items-center justify-center rounded-sm text-muted transition-colors hover:bg-white/10 hover:text-white sm:size-7"
                aria-label="Notification settings"
              >
                <span className="material-symbols-outlined text-sm sm:text-base">settings</span>
              </button>
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-subtle sm:text-sm">
                No notifications
              </p>
            ) : (
              notifications.slice(0, 20).map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => handleSelect(n)}
                  className={`flex w-full flex-col items-start gap-0.5 border-b border-white/5 px-2.5 py-1.5 text-left transition-colors hover:bg-white/10 sm:px-3 sm:py-2 ${
                    n.readAt ? 'opacity-80' : ''
                  }`}
                >
                  <span className="text-[10px] font-bold uppercase text-primary sm:text-xs">
                    {TYPE_LABELS[n.type] ?? n.type.replace(/_/g, ' ')}
                  </span>
                  <span className="text-xs text-white sm:text-sm">{n.message}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

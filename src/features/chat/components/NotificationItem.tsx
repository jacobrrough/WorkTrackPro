import type { SystemNotification, SystemNotificationType } from '@/core/types';

interface NotificationItemProps {
  notification: SystemNotification;
  onClick: () => void;
}

const TYPE_CONFIG: Partial<Record<SystemNotificationType, { icon: string; color: string }>> = {
  // Jobs & Boards
  status_change: { icon: 'swap_horiz', color: 'text-amber-400' },
  assignment: { icon: 'person_add', color: 'text-green-400' },
  unassignment: { icon: 'person_remove', color: 'text-orange-400' },
  rush: { icon: 'bolt', color: 'text-yellow-400' },
  overdue: { icon: 'schedule', color: 'text-red-500' },
  comment_mention: { icon: 'alternate_email', color: 'text-blue-400' },
  checklist_complete: { icon: 'checklist', color: 'text-green-500' },
  delivery_update: { icon: 'local_shipping', color: 'text-emerald-400' },
  variant_update: { icon: 'tune', color: 'text-purple-400' },
  // Inventory
  low_stock: { icon: 'inventory_2', color: 'text-red-400' },
  critical_stock: { icon: 'warning', color: 'text-red-500' },
  allocation_complete: { icon: 'check_circle', color: 'text-green-400' },
  allocation_reversal: { icon: 'undo', color: 'text-orange-400' },
  reorder_point_hit: { icon: 'shopping_cart', color: 'text-amber-400' },
  // Time Clock
  shift_edit_approved: { icon: 'thumb_up', color: 'text-green-400' },
  shift_edit_requested: { icon: 'edit_calendar', color: 'text-blue-400' },
  clock_anomaly: { icon: 'error', color: 'text-red-400' },
  lunch_break_reminder: { icon: 'restaurant', color: 'text-amber-300' },
  // Chat
  chat_mention: { icon: 'alternate_email', color: 'text-blue-400' },
  new_direct_message: { icon: 'mail', color: 'text-sky-400' },
  thread_reply: { icon: 'reply', color: 'text-indigo-400' },
  // Admin
  new_user_pending_approval: { icon: 'person_add', color: 'text-amber-400' },
  user_approved: { icon: 'how_to_reg', color: 'text-green-400' },
  user_rejected: { icon: 'person_off', color: 'text-red-400' },
  proposal_submitted: { icon: 'description', color: 'text-blue-400' },
  // Quotes
  new_customer_proposal: { icon: 'storefront', color: 'text-purple-400' },
  quote_assigned: { icon: 'request_quote', color: 'text-teal-400' },
  quote_updated: { icon: 'update', color: 'text-teal-300' },
  // Deliveries
  delivery_scheduled: { icon: 'event', color: 'text-blue-400' },
  delivery_completed: { icon: 'task_alt', color: 'text-green-400' },
  delivery_delayed: { icon: 'report', color: 'text-red-400' },
  // System
  daily_summary: { icon: 'summarize', color: 'text-slate-300' },
  system_alert: { icon: 'campaign', color: 'text-amber-400' },
  maintenance_notice: { icon: 'engineering', color: 'text-slate-400' },
  // Legacy
  mention: { icon: 'alternate_email', color: 'text-blue-400' },
  delivery: { icon: 'local_shipping', color: 'text-emerald-400' },
  po_received: { icon: 'package_2', color: 'text-teal-400' },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function NotificationItem({ notification, onClick }: NotificationItemProps) {
  const config = TYPE_CONFIG[notification.type] ?? {
    icon: 'notifications',
    color: 'text-slate-400',
  };
  const isUnread = !notification.readAt;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-white/5 ${
        isUnread ? 'bg-primary/5' : ''
      }`}
    >
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 ${config.color}`}
      >
        <span className="material-symbols-outlined text-lg">{config.icon}</span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className={`text-sm font-medium ${isUnread ? 'text-white' : 'text-slate-300'}`}>
            {notification.title}
          </span>
          <span className="shrink-0 text-xs text-slate-500">{timeAgo(notification.createdAt)}</span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-xs text-slate-400">{notification.message}</p>
      </div>

      {isUnread && <div className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" />}
    </button>
  );
}

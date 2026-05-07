import type { SystemNotification, SystemNotificationType } from '@/core/types';

interface NotificationItemProps {
  notification: SystemNotification;
  onClick: () => void;
}

const TYPE_CONFIG: Record<SystemNotificationType, { icon: string; color: string }> = {
  mention: { icon: 'alternate_email', color: 'text-blue-400' },
  status_change: { icon: 'swap_horiz', color: 'text-amber-400' },
  assignment: { icon: 'person_add', color: 'text-green-400' },
  unassignment: { icon: 'person_remove', color: 'text-orange-400' },
  low_stock: { icon: 'inventory_2', color: 'text-red-400' },
  rush: { icon: 'bolt', color: 'text-yellow-400' },
  overdue: { icon: 'schedule', color: 'text-red-500' },
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

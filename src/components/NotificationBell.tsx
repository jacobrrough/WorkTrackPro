import React, { useState, useRef, useEffect } from 'react';
import { useNotifications } from '@/contexts/NotificationsContext';
import type { AppNotification, AppNotificationType } from '@/lib/notifications';

const TYPE_LABELS: Record<AppNotificationType, string> = {
  low_stock: 'Low stock',
  overdue_job: 'Overdue',
  rush_job: 'Rush',
  info: 'Info',
};

interface NotificationBellProps {
  onNavigate?: (view: string, id?: string) => void;
}

export function NotificationBell({ onNavigate }: NotificationBellProps) {
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('click', handle);
    return () => window.removeEventListener('click', handle);
  }, [open]);

  const handleSelect = (n: AppNotification) => {
    markRead(n.id);
    setOpen(false);
    if (n.link && onNavigate) {
      const [view, id] = n.link.split(':');
      if (view && id) onNavigate(view as 'job-detail' | 'inventory-detail', id);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative flex size-11 touch-manipulation items-center justify-center rounded-sm text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
        aria-label={unreadCount > 0 ? `${unreadCount} notifications` : 'Notifications'}
        aria-expanded={open}
      >
        <span className="material-symbols-outlined">notifications</span>
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-80 max-w-[calc(100vw-2rem)] rounded-sm border border-white/10 bg-[#1a1122] shadow-xl">
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
            <span className="text-sm font-bold text-white">Notifications</span>
            {notifications.some((n) => !n.read) && (
              <button
                type="button"
                onClick={markAllRead}
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
                    n.read ? 'opacity-80' : ''
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

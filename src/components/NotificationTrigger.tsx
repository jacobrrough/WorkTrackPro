import { useEffect, useRef } from 'react';
import { useApp } from '@/AppContext';
import { useToast } from '@/Toast';
import { useNotifications } from '@/contexts/NotificationsContext';
import type { AppNotification } from '@/lib/notifications';
import { getNewNotificationIds, markNotificationSeen } from '@/lib/notifications';

const COMPLETED_STATUSES = ['finished', 'delivered', 'projectCompleted', 'paid'];

export function NotificationTrigger() {
  const { jobs, inventory, calculateAvailable } = useApp();
  const { showToast } = useToast();
  const { updateNotifications } = useNotifications();
  const prevIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const list: AppNotification[] = [];
    const now = new Date();

    // Overdue jobs (ecd in past, status not complete)
    jobs.forEach((job) => {
      if (!job.ecd || COMPLETED_STATUSES.includes(job.status)) return;
      if (new Date(job.ecd) >= now) return;
      list.push({
        id: `overdue-${job.id}`,
        type: 'overdue_job',
        message: `"${job.name}" (${job.jobCode}) is overdue`,
        link: `job-detail:${job.id}`,
        read: false,
        createdAt: new Date().toISOString(),
      });
    });

    // Rush jobs (in progress)
    jobs.forEach((job) => {
      if (!job.isRush || COMPLETED_STATUSES.includes(job.status)) return;
      list.push({
        id: `rush-${job.id}`,
        type: 'rush_job',
        message: `Rush: "${job.name}" (${job.jobCode})`,
        link: `job-detail:${job.id}`,
        read: false,
        createdAt: new Date().toISOString(),
      });
    });

    // Low stock
    inventory.forEach((item) => {
      const reorderPoint = item.reorderPoint ?? 0;
      if (reorderPoint <= 0) return;
      const available = calculateAvailable(item);
      if (available > reorderPoint) return;
      list.push({
        id: `lowstock-${item.id}`,
        type: 'low_stock',
        message: `Low stock: ${item.name} (${available} ≤ ${reorderPoint})`,
        link: `inventory-detail:${item.id}`,
        read: false,
        createdAt: new Date().toISOString(),
      });
    });

    updateNotifications(list);

    const ids = list.map((n) => n.id);
    const newIds = getNewNotificationIds(ids);
    newIds.forEach((id) => {
      if (prevIdsRef.current.has(id)) return;
      prevIdsRef.current.add(id);
      const n = list.find((x) => x.id === id);
      if (n) {
        showToast(n.message, 'warning');
        markNotificationSeen(id);
      }
    });
  }, [jobs, inventory, calculateAvailable, updateNotifications, showToast]);

  return null;
}

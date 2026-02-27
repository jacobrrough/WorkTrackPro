export type AppNotificationType = 'low_stock' | 'overdue_job' | 'rush_job' | 'info';

export interface AppNotification {
  id: string;
  type: AppNotificationType;
  message: string;
  link?: string;
  read: boolean;
  createdAt: string;
}

const SEEN_KEY = 'wtp_notifications_seen';

function getSeenIds(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

export function getNewNotificationIds(ids: string[]): string[] {
  const seen = getSeenIds();
  return ids.filter((id) => !seen.has(id));
}

export function markNotificationSeen(id: string): void {
  const seen = getSeenIds();
  seen.add(id);
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
  } catch {
    // ignore
  }
}

export function markAllNotificationsSeen(ids: string[]): void {
  const seen = getSeenIds();
  ids.forEach((id) => seen.add(id));
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
  } catch {
    // ignore
  }
}

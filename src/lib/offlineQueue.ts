const QUEUE_KEY = 'wtp_offline_clock_queue';

export interface QueuedPunch {
  id: string;
  type: 'clock_in' | 'clock_out';
  userId: string;
  jobId?: string;
  jobCode?: number;
  timestamp: string; // ISO string captured at time of punch
  location?: { lat: number; lng: number };
  /** Set when syncing clock_out so we know which shift to end */
  shiftId?: string;
}

export function enqueueClockPunch(punch: Omit<QueuedPunch, 'id'>): void {
  const queue = getQueue();
  queue.push({ ...punch, id: crypto.randomUUID() });
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function getQueue(): QueuedPunch[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function clearPunchFromQueue(id: string): void {
  const queue = getQueue().filter((p) => p.id !== id);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function getPendingPunchCount(): number {
  return getQueue().length;
}

const QUEUE_KEY = 'wtp_offline_clock_queue';

/** Stop retrying sync after this many failed attempts per punch (leaves item in queue for visibility). */
export const MAX_SYNC_ATTEMPTS_PER_PUNCH = 25;

export interface QueuedPunch {
  id: string;
  type: 'clock_in' | 'clock_out';
  userId: string;
  jobId?: string;
  jobCode?: number;
  timestamp: string;
  location?: { lat: number; lng: number };
  shiftId?: string;
  attemptCount?: number;
  lastAttemptAt?: string;
}

function persistQueue(queue: QueuedPunch[]): void {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function enqueueClockPunch(punch: Omit<QueuedPunch, 'id'>): void {
  const queue = getQueue();
  if (punch.type === 'clock_in' && punch.jobId) {
    const dupIdx = queue.findIndex(
      (p) => p.type === 'clock_in' && p.userId === punch.userId && p.jobId === punch.jobId
    );
    if (dupIdx !== -1) {
      const prev = queue[dupIdx];
      queue[dupIdx] = {
        ...prev,
        timestamp: punch.timestamp,
        attemptCount: 0,
        lastAttemptAt: undefined,
      };
      persistQueue(queue);
      return;
    }
  }
  if (punch.type === 'clock_out' && punch.shiftId) {
    const dupIdx = queue.findIndex(
      (p) => p.type === 'clock_out' && p.userId === punch.userId && p.shiftId === punch.shiftId
    );
    if (dupIdx !== -1) {
      queue[dupIdx] = {
        ...queue[dupIdx],
        timestamp: punch.timestamp,
        attemptCount: 0,
        lastAttemptAt: undefined,
      };
      persistQueue(queue);
      return;
    }
  }
  queue.push({
    ...punch,
    id: crypto.randomUUID(),
    attemptCount: 0,
  });
  persistQueue(queue);
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
  persistQueue(queue);
}

export function getPendingPunchCount(): number {
  return getQueue().length;
}

export function bumpQueueAttempt(id: string): void {
  const queue = getQueue();
  const idx = queue.findIndex((p) => p.id === id);
  if (idx === -1) return;
  const p = queue[idx];
  const attemptCount = (p.attemptCount ?? 0) + 1;
  queue[idx] = {
    ...p,
    attemptCount,
    lastAttemptAt: new Date().toISOString(),
  };
  persistQueue(queue);
}

export function hasQueuedPunchAtMaxAttempts(): boolean {
  return getQueue().some((p) => (p.attemptCount ?? 0) >= MAX_SYNC_ATTEMPTS_PER_PUNCH);
}

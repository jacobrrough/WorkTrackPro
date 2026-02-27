import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  enqueueClockPunch,
  getQueue,
  clearPunchFromQueue,
  getPendingPunchCount,
} from './offlineQueue';

const QUEUE_KEY = 'wtp_offline_clock_queue';

describe('offlineQueue', () => {
  let storage: Record<string, string>;

  beforeEach(() => {
    storage = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => {
        storage[key] = value;
      },
    });
  });

  it('enqueueClockPunch adds a punch and getQueue returns it', () => {
    enqueueClockPunch({
      type: 'clock_in',
      userId: 'user-1',
      jobId: 'job-1',
      timestamp: new Date().toISOString(),
    });
    const queue = getQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].type).toBe('clock_in');
    expect(queue[0].userId).toBe('user-1');
    expect(queue[0].jobId).toBe('job-1');
    expect(queue[0].id).toBeDefined();
  });

  it('getPendingPunchCount returns queue length', () => {
    expect(getPendingPunchCount()).toBe(0);
    enqueueClockPunch({
      type: 'clock_out',
      userId: 'user-1',
      timestamp: new Date().toISOString(),
    });
    expect(getPendingPunchCount()).toBe(1);
    enqueueClockPunch({
      type: 'clock_in',
      userId: 'user-1',
      jobId: 'job-2',
      timestamp: new Date().toISOString(),
    });
    expect(getPendingPunchCount()).toBe(2);
  });

  it('clearPunchFromQueue removes the punch by id', () => {
    enqueueClockPunch({
      type: 'clock_in',
      userId: 'user-1',
      jobId: 'job-1',
      timestamp: new Date().toISOString(),
    });
    const queue = getQueue();
    const id = queue[0].id;
    clearPunchFromQueue(id);
    expect(getQueue()).toHaveLength(0);
  });

  it('getQueue returns empty array when localStorage is empty or invalid', () => {
    expect(getQueue()).toEqual([]);
    storage[QUEUE_KEY] = 'invalid json';
    expect(getQueue()).toEqual([]);
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockReplay = vi.fn();
vi.mock('./offlineActionHandlers', () => ({
  replayAction: (...args: unknown[]) => mockReplay(...args),
}));

// Prevent Supabase client initialization; the loop calls getSession() as a guard.
vi.mock('@/services/api/supabaseClient', () => ({
  supabase: {
    auth: {
      // Session user matches the actions' userId ('u1') so the ownership check passes.
      getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'u1' } } } }),
    },
  },
}));

// Real auth-error predicate.
vi.mock('@/lib/authErrors', () => ({
  isAuthError: (e: unknown) => (e as { __auth?: boolean })?.__auth === true,
}));

import { syncOfflineActionQueue } from './syncOfflineActionQueue';
import { enqueueAction, getActionQueue } from './offlineActionQueue';

function enqueueUpdate(entityId: string) {
  return enqueueAction({
    type: 'job_update',
    entityId,
    userId: 'u1',
    createdAt: new Date().toISOString(),
    data: { name: entityId },
  });
}

describe('syncOfflineActionQueue', () => {
  let storage: Record<string, string>;

  beforeEach(() => {
    storage = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => {
        storage[key] = value;
      },
    });
    vi.stubGlobal('navigator', { onLine: true });
    mockReplay.mockReset();
  });

  it('does nothing when offline', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    enqueueUpdate('a');
    expect(await syncOfflineActionQueue()).toBe(0);
    expect(getActionQueue()).toHaveLength(1);
    expect(mockReplay).not.toHaveBeenCalled();
  });

  it('replays in FIFO order and clears on done/conflict', async () => {
    enqueueAction({
      type: 'job_create',
      entityId: 'a',
      userId: 'u1',
      createdAt: new Date().toISOString(),
      data: {},
    });
    enqueueUpdate('b');
    mockReplay.mockResolvedValueOnce('done').mockResolvedValueOnce('conflict');
    const synced = await syncOfflineActionQueue();
    expect(synced).toBe(2);
    expect(getActionQueue()).toHaveLength(0);
    const order = mockReplay.mock.calls.map((c) => (c[0] as { entityId: string }).entityId);
    expect(order).toEqual(['a', 'b']);
  });

  it('keeps the item and bumps the attempt on a transient throw (confirm-before-clear)', async () => {
    const a = enqueueUpdate('a');
    mockReplay.mockRejectedValueOnce(new Error('network'));
    const synced = await syncOfflineActionQueue();
    expect(synced).toBe(0);
    const queue = getActionQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].id).toBe(a.id);
    expect(queue[0].attemptCount).toBe(1);
  });

  it('skips actions queued by a different user (shared device) without replaying them', async () => {
    enqueueAction({
      type: 'job_update',
      entityId: 'a',
      userId: 'someone-else', // not the current session user ('u1')
      createdAt: new Date().toISOString(),
      data: { name: 'a' },
    });
    const synced = await syncOfflineActionQueue();
    expect(synced).toBe(0);
    expect(mockReplay).not.toHaveBeenCalled();
    // Left queued (it belongs to the other user), not bumped or cleared.
    const queue = getActionQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].attemptCount).toBe(0);
  });

  it('stops the whole loop on an auth error without bumping attempts', async () => {
    enqueueUpdate('a');
    enqueueUpdate('b'); // different entity so it is NOT deduped
    mockReplay.mockRejectedValueOnce({ __auth: true });
    const synced = await syncOfflineActionQueue();
    expect(synced).toBe(0);
    // Only the first action was attempted; loop broke before the second.
    expect(mockReplay).toHaveBeenCalledTimes(1);
    const queue = getActionQueue();
    expect(queue).toHaveLength(2);
    expect(queue.every((q) => (q.attemptCount ?? 0) === 0)).toBe(true);
  });
});

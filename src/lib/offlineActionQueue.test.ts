import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  enqueueAction,
  getActionQueue,
  clearActionFromQueue,
  bumpActionAttempt,
  getPendingActionCount,
  hasActionAtMaxAttempts,
  getPendingEntityIds,
  MAX_ACTION_SYNC_ATTEMPTS,
} from './offlineActionQueue';

describe('offlineActionQueue', () => {
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

  it('enqueues an action with a generated id and zeroed attempt count', () => {
    const a = enqueueAction({
      type: 'job_update',
      entityId: 'job-1',
      userId: 'u1',
      createdAt: new Date().toISOString(),
      data: { name: 'x' },
    });
    expect(a.id).toBeTruthy();
    expect(a.attemptCount).toBe(0);
    expect(getActionQueue()).toHaveLength(1);
    expect(getPendingActionCount()).toBe(1);
  });

  it('dedupes absolute-target writes to the same entity, keeping the latest payload and position', () => {
    enqueueAction({
      type: 'job_create', // not deduped — sits first
      entityId: 'job-0',
      userId: 'u1',
      createdAt: new Date().toISOString(),
      data: {},
    });
    const first = enqueueAction({
      type: 'job_update',
      entityId: 'job-1',
      userId: 'u1',
      createdAt: new Date().toISOString(),
      data: { name: 'old' },
    });
    const second = enqueueAction({
      type: 'job_update',
      entityId: 'job-1',
      userId: 'u1',
      createdAt: new Date().toISOString(),
      data: { name: 'new' },
    });
    const queue = getActionQueue();
    expect(queue).toHaveLength(2); // create + the single collapsed job_update
    const updates = queue.filter((q) => q.type === 'job_update');
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe(first.id); // position/id preserved
    expect((updates[0] as { data: { name: string } }).data.name).toBe('new'); // latest wins
    expect(second.id).toBe(first.id);
  });

  it('does NOT dedupe delta or create actions (each is a distinct effect)', () => {
    const base = {
      entityId: 'inv-1',
      userId: 'u1',
      createdAt: new Date().toISOString(),
      onOrderDelta: 0,
      history: { action: 'manual_adjust' as const, reason: 'x' },
    };
    enqueueAction({ type: 'inventory_delta', ...base, inStockDelta: 5, clientActionId: 'c1' });
    enqueueAction({ type: 'inventory_delta', ...base, inStockDelta: 3, clientActionId: 'c2' });
    expect(getActionQueue()).toHaveLength(2);
  });

  it('clears a specific action by id', () => {
    const a = enqueueAction({
      type: 'job_delete',
      entityId: 'job-1',
      userId: 'u1',
      createdAt: new Date().toISOString(),
    });
    clearActionFromQueue(a.id);
    expect(getActionQueue()).toHaveLength(0);
  });

  it('bumps attempt count and flags max attempts', () => {
    const a = enqueueAction({
      type: 'job_delete',
      entityId: 'job-1',
      userId: 'u1',
      createdAt: new Date().toISOString(),
    });
    for (let i = 0; i < MAX_ACTION_SYNC_ATTEMPTS; i++) bumpActionAttempt(a.id);
    expect(hasActionAtMaxAttempts()).toBe(true);
    expect(getActionQueue()[0].attemptCount).toBe(MAX_ACTION_SYNC_ATTEMPTS);
  });

  it('derives the set of pending entity ids', () => {
    enqueueAction({
      type: 'job_update',
      entityId: 'job-1',
      userId: 'u1',
      createdAt: new Date().toISOString(),
      data: {},
    });
    enqueueAction({
      type: 'card_move',
      entityId: 'card-9',
      userId: 'u1',
      createdAt: new Date().toISOString(),
      boardId: 'b1',
      columnId: 'col1',
      sortOrder: 2,
    });
    const ids = getPendingEntityIds();
    expect(ids.has('job-1')).toBe(true);
    expect(ids.has('card-9')).toBe(true);
    expect(ids.size).toBe(2);
  });
});

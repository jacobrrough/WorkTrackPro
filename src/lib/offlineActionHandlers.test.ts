import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockGetJobStatus = vi.fn();
const mockUpdateConditional = vi.fn();
const mockAdjustIdem = vi.fn();
const mockCreateHistory = vi.fn();
// rowExists() does supabase.from(t).select('id').eq('id', id).maybeSingle(); default to "found".
const mockMaybeSingle = vi.fn().mockResolvedValue({ data: { id: 'x' }, error: null });

vi.mock('@/services/api/supabaseClient', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: (...a: unknown[]) => mockMaybeSingle(...a) }) }),
    }),
  },
}));
vi.mock('@/services/api/jobs', () => ({
  jobService: {
    getJobStatus: (...a: unknown[]) => mockGetJobStatus(...a),
    updateJobStatusConditional: (...a: unknown[]) => mockUpdateConditional(...a),
  },
}));
vi.mock('@/services/api/inventory', () => ({
  inventoryService: { adjustStockIdempotent: (...a: unknown[]) => mockAdjustIdem(...a) },
}));
vi.mock('@/services/api/inventoryHistory', () => ({
  inventoryHistoryService: { createHistory: (...a: unknown[]) => mockCreateHistory(...a) },
}));
vi.mock('@/services/api/boards', () => ({ boardService: {} }));
vi.mock('@/services/api/deliveries', () => ({ deliveryService: {} }));
vi.mock('@/lib/inventoryCalculations', () => ({
  isConsumedStatus: (s: string) => s === 'paid' || s === 'delivered',
}));

import { replayAction } from './offlineActionHandlers';
import type { JobStatusAction, InventoryDeltaAction } from './offlineActionQueue';

const statusAction = (status: string, fromStatus: string): JobStatusAction => ({
  type: 'job_status',
  id: 'q1',
  entityId: 'job-1',
  userId: 'u1',
  createdAt: '',
  status: status as JobStatusAction['status'],
  fromStatus: fromStatus as JobStatusAction['fromStatus'],
});

const deltaAction = (clientActionId: string): InventoryDeltaAction => ({
  type: 'inventory_delta',
  id: 'q2',
  entityId: 'inv-1',
  userId: 'u1',
  createdAt: '',
  inStockDelta: 5,
  onOrderDelta: 0,
  clientActionId,
  history: { action: 'manual_adjust', reason: 'test' },
});

describe('replayAction — job_status reconcile (phantom-restore guard)', () => {
  beforeEach(() => {
    mockGetJobStatus.mockReset();
    mockUpdateConditional.mockReset();
  });

  it('is a no-op when the job already moved to the target status', async () => {
    mockGetJobStatus.mockResolvedValueOnce('inProgress');
    const res = await replayAction(statusAction('inProgress', 'pending'));
    expect(res).toBe('conflict');
    expect(mockUpdateConditional).not.toHaveBeenCalled();
  });

  it('refuses to move a job that has since been consumed (no double-deduct/restore)', async () => {
    mockGetJobStatus.mockResolvedValueOnce('paid');
    const res = await replayAction(statusAction('inProgress', 'pending'));
    expect(res).toBe('conflict');
    expect(mockUpdateConditional).not.toHaveBeenCalled();
  });

  it('returns conflict when the row is gone', async () => {
    mockGetJobStatus.mockResolvedValueOnce(null);
    expect(await replayAction(statusAction('inProgress', 'pending'))).toBe('conflict');
  });

  it('applies a conditional transition from the live status', async () => {
    mockGetJobStatus.mockResolvedValueOnce('pending');
    mockUpdateConditional.mockResolvedValueOnce(true);
    const res = await replayAction(statusAction('inProgress', 'pending'));
    expect(res).toBe('done');
    expect(mockUpdateConditional).toHaveBeenCalledWith('job-1', 'inProgress', 'pending');
  });

  it('treats a 0-row conditional update as superseded', async () => {
    mockGetJobStatus.mockResolvedValueOnce('pending');
    mockUpdateConditional.mockResolvedValueOnce(false);
    expect(await replayAction(statusAction('inProgress', 'pending'))).toBe('conflict');
  });

  it('CAS uses the captured fromStatus, not the live status, so a moved job is superseded', async () => {
    // Worker captured the change at fromStatus=pending; another session moved it to onHold.
    mockGetJobStatus.mockResolvedValueOnce('onHold');
    mockUpdateConditional.mockResolvedValueOnce(false); // 0 rows: live (onHold) != fromStatus
    const res = await replayAction(statusAction('inProgress', 'pending'));
    expect(res).toBe('conflict');
    // The CAS token must be the captured fromStatus, never the just-read live status.
    expect(mockUpdateConditional).toHaveBeenCalledWith('job-1', 'inProgress', 'pending');
  });
});

describe('replayAction — inventory_delta idempotency', () => {
  beforeEach(() => {
    mockAdjustIdem.mockReset();
    mockCreateHistory.mockReset();
    mockMaybeSingle.mockResolvedValue({ data: { id: 'x' }, error: null }); // item exists
  });

  it('gives up (conflict) if the inventory item was deleted before replay', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null }); // row gone
    const res = await replayAction(deltaAction('c1'));
    expect(res).toBe('conflict');
    expect(mockAdjustIdem).not.toHaveBeenCalled();
  });

  it('applies the delta and records history on first replay', async () => {
    mockAdjustIdem.mockResolvedValueOnce({ inStock: 15, onOrder: 0, applied: true });
    const res = await replayAction(deltaAction('c1'));
    expect(res).toBe('done');
    expect(mockAdjustIdem).toHaveBeenCalledWith('inv-1', 5, 0, 'c1');
    expect(mockCreateHistory).toHaveBeenCalledTimes(1);
    // previous = post - delta
    expect(mockCreateHistory.mock.calls[0][0]).toMatchObject({
      previousInStock: 10,
      newInStock: 15,
    });
  });

  it('does NOT re-apply or re-log on a deduped (lost-ACK) replay', async () => {
    mockAdjustIdem.mockResolvedValueOnce({ inStock: 15, onOrder: 0, applied: false });
    const res = await replayAction(deltaAction('c1'));
    expect(res).toBe('done');
    expect(mockCreateHistory).not.toHaveBeenCalled();
  });

  it('throws to retry when the RPC fails', async () => {
    mockAdjustIdem.mockResolvedValueOnce(null);
    await expect(replayAction(deltaAction('c1'))).rejects.toThrow();
  });
});

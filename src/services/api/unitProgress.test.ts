import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Job, InventoryItem } from '@/core/types';
import { NO_VARIANT_KEY } from '@/lib/cncDeduction';

const mockRpc = vi.fn();

vi.mock('@/services/api/supabaseClient', () => ({
  supabase: { rpc: (...a: unknown[]) => mockRpc(...a) },
}));

import { logUnitProgress } from './unitProgress';

const foam = (id: string): InventoryItem =>
  ({
    id,
    name: id,
    category: 'foam',
    inStock: 0,
    available: 0,
    disposed: 0,
    onOrder: 0,
    unit: 'units',
  }) as InventoryItem;

describe('logUnitProgress — RPC payload', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockRpc.mockResolvedValue({ error: null });
  });

  it('sends inventory deltas keyed by snake_case inventory_id (matches the RPC contract)', async () => {
    // No-variant job with CNC hours + foam: the CNC milestone must pull foam.
    const job = {
      id: 'job-1',
      dashQuantities: {},
      qty: '2',
      machineBreakdownByVariant: {
        '-': {
          qty: 2,
          cncHoursPerUnit: 1,
          cncHoursTotal: 2,
          printer3DHoursPerUnit: 0,
          printer3DHoursTotal: 0,
        },
      },
      inventoryItems: [{ id: 'l1', inventoryId: 'foam1', quantity: 4, unit: 'units' }],
      cncDoneByVariant: {},
      unitsDoneByVariant: {},
    } as unknown as Job;

    const ok = await logUnitProgress({
      job,
      part: null,
      inventory: [foam('foam1')],
      cncAbleCategories: new Set(['foam']),
      edits: [{ variantKey: NO_VARIANT_KEY, cncDelta: 1 }],
    });

    expect(ok).toBe(true);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    const [fn, payload] = mockRpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(fn).toBe('log_unit_progress');
    const deltas = payload.p_inventory_deltas as Array<Record<string, unknown>>;
    expect(deltas).toHaveLength(1);
    // The bug this guards: the RPC reads e->>'inventory_id'; camelCase here makes it parse to NULL.
    expect(deltas[0]).toEqual({ inventory_id: 'foam1', delta: 2 });
    expect(deltas[0]).not.toHaveProperty('inventoryId');
  });
});

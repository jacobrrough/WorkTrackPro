import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Posting-logic + read-shape tests for inventoryRevaluationsService. The gated revaluation
 * batch is a MONEY path: postBatch delegates to accounting.post_inventory_revaluation, which
 * posts ONE balanced JE (Dr/Cr 1300 ↔ 1310 by net) — so these tests assert the RPC is
 * invoked with the right name + ids, and that its scalar/null/error returns are surfaced
 * exactly (a uuid → posted JE; null → net-zero/no-op; an error → carried as `error`).
 *
 * The accounting client is faked: `.rpc()` records the call and resolves a configured
 * `{ data, error }`; the query builder records table + filters for the list/get reads.
 */

type EqFilter = { col: string; val: unknown };
interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}
interface FromCall {
  table: string;
  eqs: EqFilter[];
  order: { col: string; opts?: unknown } | null;
  limit: number | null;
}

let rpcCalls: RpcCall[];
let fromCalls: FromCall[];
// Configurable RPC result.
let rpcData: unknown;
let rpcError: { message: string } | null;
// Rows returned by a list/get select.
let selectRows: Record<string, unknown>[];

function makeBuilder(table: string) {
  const call: FromCall = { table, eqs: [], order: null, limit: null };
  fromCalls.push(call);
  const builder = {
    select() {
      return builder;
    },
    eq(col: string, val: unknown) {
      call.eqs.push({ col, val });
      return builder;
    },
    order(col: string, opts?: unknown) {
      call.order = { col, opts };
      return builder;
    },
    limit(n: number) {
      call.limit = n;
      return builder;
    },
    maybeSingle() {
      return Promise.resolve({ data: selectRows[0] ?? null, error: null });
    },
    then(resolve: (v: { data: unknown; error: null }) => unknown) {
      return Promise.resolve({ data: selectRows, error: null }).then(resolve);
    },
  };
  return builder;
}

vi.mock('./accountingClient', () => ({
  acct: () => ({
    from: (table: string) => makeBuilder(table),
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ data: rpcData, error: rpcError });
    },
  }),
}));

import { inventoryRevaluationsService } from './inventoryRevaluations';

beforeEach(() => {
  rpcCalls = [];
  fromCalls = [];
  rpcData = null;
  rpcError = null;
  selectRows = [];
});

describe('inventoryRevaluationsService.postBatch (the gated money path)', () => {
  it('invokes post_inventory_revaluation with the id array and returns the posted JE', async () => {
    rpcData = 'je-reval-1';
    const res = await inventoryRevaluationsService.postBatch(['rv-1', 'rv-2']);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe('post_inventory_revaluation');
    expect(rpcCalls[0].args).toEqual({ p_revaluation_ids: ['rv-1', 'rv-2'] });
    expect(res).toEqual({ journalEntryId: 'je-reval-1', posted: true });
  });

  it('treats a null scalar (net-zero / no-op batch) as a successful no-JE post', async () => {
    rpcData = null;
    const res = await inventoryRevaluationsService.postBatch(['rv-1']);
    expect(res).toEqual({ journalEntryId: null, posted: true });
  });

  it('short-circuits an empty id list — NO RPC call, not posted', async () => {
    const res = await inventoryRevaluationsService.postBatch([]);
    expect(rpcCalls).toHaveLength(0);
    expect(res).toEqual({ journalEntryId: null, posted: false });
  });

  it('surfaces a DB error (e.g. RLS denial / missing default accounts) as `error`', async () => {
    rpcError = { message: 'insufficient privileges to post inventory revaluations' };
    const res = await inventoryRevaluationsService.postBatch(['rv-1']);
    expect(res.posted).toBe(false);
    expect(res.journalEntryId).toBeNull();
    expect(res.error).toMatch(/insufficient privileges/);
  });

  it('coerces a non-string scalar payload to a string id (defensive)', async () => {
    rpcData = 12345;
    const res = await inventoryRevaluationsService.postBatch(['rv-1']);
    expect(res.journalEntryId).toBe('12345');
  });
});

describe('inventoryRevaluationsService.postAllPending', () => {
  it('reads the pending queue then posts exactly those ids', async () => {
    selectRows = [
      { id: 'rv-1', source_inventory_id: 'inv-1', status: 'pending' },
      { id: 'rv-2', source_inventory_id: 'inv-2', status: 'pending' },
    ];
    rpcData = 'je-reval-all';
    const res = await inventoryRevaluationsService.postAllPending();
    // It listed pending first (filtered status='pending'), then posted those ids.
    const list = fromCalls.find((c) => c.table === 'inventory_revaluations');
    expect(list?.eqs).toContainEqual({ col: 'status', val: 'pending' });
    expect(rpcCalls[0].args).toEqual({ p_revaluation_ids: ['rv-1', 'rv-2'] });
    expect(res.journalEntryId).toBe('je-reval-all');
  });

  it('is a no-op when nothing is pending (no RPC call)', async () => {
    selectRows = [];
    const res = await inventoryRevaluationsService.postAllPending();
    expect(rpcCalls).toHaveLength(0);
    expect(res).toEqual({ journalEntryId: null, posted: false });
  });
});

describe('inventoryRevaluationsService reads', () => {
  it('listPending filters by status=pending and (optionally) source_inventory_id', async () => {
    selectRows = [{ id: 'rv-1', source_inventory_id: 'inv-9', status: 'pending' }];
    const rows = await inventoryRevaluationsService.listPending('inv-9');
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceInventoryId).toBe('inv-9');
    const c = fromCalls.find((f) => f.table === 'inventory_revaluations');
    expect(c?.eqs).toContainEqual({ col: 'status', val: 'pending' });
    expect(c?.eqs).toContainEqual({ col: 'source_inventory_id', val: 'inv-9' });
  });

  it('listByStatus defaults to posted', async () => {
    selectRows = [{ id: 'rv-2', source_inventory_id: 'inv-9', status: 'posted' }];
    const rows = await inventoryRevaluationsService.listByStatus();
    expect(rows[0].status).toBe('posted');
    const c = fromCalls.find((f) => f.table === 'inventory_revaluations');
    expect(c?.eqs).toContainEqual({ col: 'status', val: 'posted' });
  });
});

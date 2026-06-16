import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Tests for inventorySeederService: the seed is a MONEY path (a real run posts ONE balanced
 * opening JE Dr 1300 / Cr 3050). These assert the RPC is called with the right dry-run flag
 * + as-of date, that the jsonb result OBJECT (preview + exceptions arrays, snake_case keys)
 * is mapped to the camelCase domain shape, and that a DB error is surfaced as `error` with
 * the shape still complete (never throws — it is a write path).
 */

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}
let rpcCalls: RpcCall[];
let rpcData: unknown;
let rpcError: { message: string } | null;

vi.mock('./accountingClient', () => ({
  acct: () => ({
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ data: rpcData, error: rpcError });
    },
  }),
}));

import { inventorySeederService } from './inventorySeeder';

beforeEach(() => {
  rpcCalls = [];
  rpcData = null;
  rpcError = null;
});

/** A representative dry-run jsonb payload (the DB smoke-test scenario shape). */
const DRY_RUN_PAYLOAD = {
  as_of: '2026-06-16',
  dry_run: true,
  already_seeded: false,
  posted: false,
  journal_entry_id: null,
  total_qty: 10,
  total_value: 50,
  item_count: 1,
  preview: [
    { source_inventory_id: 'inv-9', name: 'M8 Bolt', in_stock: 10, unit_cost: 5, extended: 50 },
  ],
  exceptions: [
    {
      source_inventory_id: 'inv-3',
      name: 'No-price item',
      in_stock: 4,
      price: null,
      reason: 'null_price',
    },
  ],
};

describe('inventorySeederService.preview (dry-run, no writes)', () => {
  it('calls the RPC with p_dry_run=true and the as-of date', async () => {
    rpcData = DRY_RUN_PAYLOAD;
    await inventorySeederService.preview('2026-06-16');
    expect(rpcCalls[0].fn).toBe('seed_opening_inventory_layers');
    expect(rpcCalls[0].args).toEqual({ p_as_of: '2026-06-16', p_dry_run: true });
  });

  it('omits p_as_of when not provided (lets the DB default to today)', async () => {
    rpcData = DRY_RUN_PAYLOAD;
    await inventorySeederService.preview();
    expect(rpcCalls[0].args).toEqual({ p_dry_run: true });
  });

  it('maps the jsonb object to the domain shape, including preview + exceptions', async () => {
    rpcData = DRY_RUN_PAYLOAD;
    const res = await inventorySeederService.preview('2026-06-16');
    expect(res).toMatchObject({
      asOf: '2026-06-16',
      dryRun: true,
      alreadySeeded: false,
      posted: false,
      journalEntryId: null,
      totalQty: 10,
      totalValue: 50,
      itemCount: 1,
    });
    expect(res.preview).toEqual([
      { sourceInventoryId: 'inv-9', name: 'M8 Bolt', inStock: 10, unitCost: 5, extended: 50 },
    ]);
    expect(res.exceptions).toEqual([
      {
        sourceInventoryId: 'inv-3',
        name: 'No-price item',
        inStock: 4,
        price: null,
        reason: 'null_price',
      },
    ]);
  });

  it('coerces an unknown exception reason to "unknown" and tolerates missing arrays', async () => {
    rpcData = {
      as_of: '2026-06-16',
      dry_run: true,
      total_qty: 0,
      total_value: 0,
      item_count: 0,
      exceptions: [{ source_inventory_id: 'x', name: 'X', in_stock: 0, price: 1, reason: 'weird' }],
      // no `preview` key at all
    };
    const res = await inventorySeederService.preview('2026-06-16');
    expect(res.preview).toEqual([]);
    expect(res.exceptions[0].reason).toBe('unknown');
  });

  it('returns a complete (zeroed) shape with `error` set on a DB error — never throws', async () => {
    rpcError = { message: 'insufficient privileges to seed opening inventory' };
    const res = await inventorySeederService.preview('2026-06-16');
    expect(res.error).toMatch(/insufficient privileges/);
    expect(res.dryRun).toBe(true);
    expect(res.preview).toEqual([]);
    expect(res.exceptions).toEqual([]);
    expect(res.itemCount).toBe(0);
  });
});

describe('inventorySeederService.seed (real run, posts the opening JE)', () => {
  it('calls the RPC with p_dry_run=false', async () => {
    rpcData = {
      ...DRY_RUN_PAYLOAD,
      dry_run: false,
      posted: true,
      journal_entry_id: 'je-open-1',
      exceptions: [],
    };
    const res = await inventorySeederService.seed('2026-06-16');
    expect(rpcCalls[0].args).toEqual({ p_as_of: '2026-06-16', p_dry_run: false });
    expect(res.dryRun).toBe(false);
    expect(res.posted).toBe(true);
    expect(res.journalEntryId).toBe('je-open-1');
  });

  it('reports already_seeded (idempotent re-run) and posts nothing', async () => {
    rpcData = {
      as_of: '2026-06-16',
      dry_run: false,
      already_seeded: true,
      posted: false,
      journal_entry_id: null,
      total_qty: 0,
      total_value: 0,
      item_count: 0,
      preview: [],
      exceptions: [],
    };
    const res = await inventorySeederService.seed('2026-06-16');
    expect(res.alreadySeeded).toBe(true);
    expect(res.posted).toBe(false);
    expect(res.journalEntryId).toBeNull();
  });

  it('surfaces a DB error from a real run with dryRun=false in the fallback shape', async () => {
    rpcError = { message: 'default accounts are not configured' };
    const res = await inventorySeederService.seed('2026-06-16');
    expect(res.error).toMatch(/default accounts/);
    expect(res.dryRun).toBe(false);
    expect(res.posted).toBe(false);
  });
});

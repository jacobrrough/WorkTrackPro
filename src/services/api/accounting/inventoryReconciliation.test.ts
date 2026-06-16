import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Tests for inventoryReconciliationService. These views are READ-ONLY (no posting), so the
 * only logic worth pinning is grid()'s presentation ordering: rows that need attention
 * (any exception flag OR a pending revaluation) sort first, then by the absolute value
 * variance descending (biggest dollar gap), then by name. The header read maps the single
 * tie row. The accounting client is faked to return configured rows.
 */

let gridRows: Record<string, unknown>[];
let headerRow: Record<string, unknown> | null;

function makeBuilder(table: string) {
  const builder = {
    select() {
      return builder;
    },
    eq() {
      return builder;
    },
    maybeSingle() {
      // Only the header view uses maybeSingle in these tests.
      return Promise.resolve({ data: headerRow, error: null });
    },
    then(resolve: (v: { data: unknown; error: null }) => unknown) {
      const data = table === 'v_inventory_reconciliation' ? gridRows : null;
      return Promise.resolve({ data, error: null }).then(resolve);
    },
  };
  return builder;
}

vi.mock('./accountingClient', () => ({
  acct: () => ({ from: (table: string) => makeBuilder(table) }),
}));

import { inventoryReconciliationService } from './inventoryReconciliation';

/** Minimal grid row with sensible defaults (all flags false, zero variances). */
function row(over: Record<string, unknown>): Record<string, unknown> {
  return {
    source_inventory_id: 'x',
    inventory_name: 'X',
    in_stock: 0,
    qty_on_hand: 0,
    asset_value: 0,
    op_value: 0,
    qty_variance: 0,
    value_variance: 0,
    pending_reval_amount: 0,
    pending_reval_count: 0,
    uncosted: false,
    null_price: false,
    negative_stock: false,
    qty_mismatch: false,
    ...over,
  };
}

beforeEach(() => {
  gridRows = [];
  headerRow = null;
});

describe('inventoryReconciliationService.grid ordering', () => {
  it('sorts flagged/pending rows ahead of clean rows', async () => {
    gridRows = [
      row({ source_inventory_id: 'clean', inventory_name: 'Clean' }),
      row({ source_inventory_id: 'flagged', inventory_name: 'Flagged', uncosted: true }),
    ];
    const rows = await inventoryReconciliationService.grid();
    expect(rows.map((r) => r.sourceInventoryId)).toEqual(['flagged', 'clean']);
  });

  it('treats a pending revaluation as needing attention (sorts it first)', async () => {
    gridRows = [
      row({ source_inventory_id: 'clean', inventory_name: 'Clean' }),
      row({
        source_inventory_id: 'pending',
        inventory_name: 'Pending',
        pending_reval_count: 1,
        pending_reval_amount: 30,
      }),
    ];
    const rows = await inventoryReconciliationService.grid();
    expect(rows[0].sourceInventoryId).toBe('pending');
  });

  it('orders by absolute value variance (biggest dollar gap first) within the same flag tier', async () => {
    gridRows = [
      row({
        source_inventory_id: 'small',
        inventory_name: 'Small',
        qty_mismatch: true,
        value_variance: 5,
      }),
      row({
        source_inventory_id: 'big',
        inventory_name: 'Big',
        qty_mismatch: true,
        value_variance: -100,
      }),
    ];
    const rows = await inventoryReconciliationService.grid();
    expect(rows.map((r) => r.sourceInventoryId)).toEqual(['big', 'small']);
  });

  it('falls back to name order for otherwise-equal rows', async () => {
    gridRows = [
      row({ source_inventory_id: 'b', inventory_name: 'Beta' }),
      row({ source_inventory_id: 'a', inventory_name: 'Alpha' }),
    ];
    const rows = await inventoryReconciliationService.grid();
    expect(rows.map((r) => r.inventoryName)).toEqual(['Alpha', 'Beta']);
  });
});

describe('inventoryReconciliationService.header', () => {
  it('maps the single tie row', async () => {
    headerRow = {
      total_asset_value: 300,
      total_op_value: 330,
      total_pending_reval: 30,
      gl_1300_balance: 250,
      asset_value_vs_gl_variance: 50,
    };
    const h = await inventoryReconciliationService.header();
    expect(h).toEqual({
      totalAssetValue: 300,
      totalOpValue: 330,
      totalPendingReval: 30,
      gl1300Balance: 250,
      assetValueVsGlVariance: 50,
    });
  });

  it('returns null when the view yields no row', async () => {
    headerRow = null;
    const h = await inventoryReconciliationService.header();
    expect(h).toBeNull();
  });
});

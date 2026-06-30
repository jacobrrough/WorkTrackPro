import { describe, it, expect } from 'vitest';
import type { InventoryItem } from '@/core/types';
import { computeHubSummary, computeStock, pickFallbackItems } from './inventoryViewModel';

const makeItem = (overrides: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'item',
  name: 'Part',
  category: 'material',
  inStock: 0,
  available: 0,
  disposed: 0,
  onOrder: 0,
  unit: 'ea',
  ...overrides,
});

// Summary math depends only on available (via calculateAvailable), reorderPoint and onOrder.
const availableOf = (item: InventoryItem) => item.available;
const noAllocation = () => 0;

describe('computeHubSummary', () => {
  it('counts total / in-stock / low-stock / needs-reorder with the same rules as the list', () => {
    const items = [
      makeItem({ id: 'a', available: 0, reorderPoint: 5, onOrder: 0 }), // out + below threshold, not on order
      makeItem({ id: 'b', available: 3, reorderPoint: 5, onOrder: 0 }), // below threshold, not on order
      makeItem({ id: 'c', available: 3, reorderPoint: 5, onOrder: 10 }), // below now, but on order covers the gap
      makeItem({ id: 'd', available: 20, reorderPoint: 5 }), // healthy
      makeItem({ id: 'e', available: 8, reorderPoint: 0 }), // no threshold set
    ];

    const summary = computeHubSummary(items, availableOf, noAllocation);

    expect(summary.total).toBe(5);
    expect(summary.needsReorder).toBe(2); // a, b (c excluded: its on-order covers the threshold gap)
    expect(summary.lowStock).toBe(3); // a, b, c
    expect(summary.inStock).toBe(4); // b, c, d, e (a is out)
  });

  it('flags items short for job demand even with no reorder point set', () => {
    // Jobs need 5 but only 2 in stock, no threshold configured: still a shortage to reorder.
    const items = [makeItem({ id: 'a', inStock: 2, available: 0, reorderPoint: 0, onOrder: 0 })];
    const allocatedFive = () => 5;
    const summary = computeHubSummary(items, availableOf, allocatedFive);
    expect(summary.needsReorder).toBe(1);
  });

  it('keeps flagging a demand shortage when the incoming order will not cover it', () => {
    // Need 5, have 2, only 1 on order → still short by 2 even after it arrives.
    const items = [makeItem({ id: 'a', inStock: 2, available: 0, reorderPoint: 0, onOrder: 1 })];
    const allocatedFive = () => 5;
    expect(computeHubSummary(items, availableOf, allocatedFive).needsReorder).toBe(1);
  });

  it('stops flagging once the incoming order covers the demand', () => {
    // Need 5, have 2, 3 on order → fully covered, nothing to reorder.
    const items = [makeItem({ id: 'a', inStock: 2, available: 0, reorderPoint: 0, onOrder: 3 })];
    const allocatedFive = () => 5;
    expect(computeHubSummary(items, availableOf, allocatedFive).needsReorder).toBe(0);
  });

  it('keeps flagging a below-threshold item when the order will not restore the threshold', () => {
    // Reorder point 10, only 2 available, 5 on order → still at 7 after it lands, below 10.
    const items = [makeItem({ id: 'a', inStock: 2, available: 2, reorderPoint: 10, onOrder: 5 })];
    expect(computeHubSummary(items, availableOf, noAllocation).needsReorder).toBe(1);
  });

  it('stops flagging a below-threshold item once the order restores the threshold', () => {
    // Reorder point 10, 2 available, 9 on order → 11 after it lands, above 10.
    const items = [makeItem({ id: 'a', inStock: 2, available: 2, reorderPoint: 10, onOrder: 9 })];
    expect(computeHubSummary(items, availableOf, noAllocation).needsReorder).toBe(0);
  });

  it('flags an out-of-stock item even with no reorder point and no job demand', () => {
    // Zero on the shelf, no threshold, nothing reserved, nothing on order → owner must still see it.
    const items = [makeItem({ id: 'a', inStock: 0, available: 0, reorderPoint: 0, onOrder: 0 })];
    expect(computeHubSummary(items, availableOf, noAllocation).needsReorder).toBe(1);
  });

  it('does not flag an out-of-stock item that already has an order on the way', () => {
    // Out now, but 5 on order and nothing demanding it → already handled, no nag.
    const items = [makeItem({ id: 'a', inStock: 0, available: 0, reorderPoint: 0, onOrder: 5 })];
    expect(computeHubSummary(items, availableOf, noAllocation).needsReorder).toBe(0);
  });

  it('returns all-zero counts for empty inventory', () => {
    expect(computeHubSummary([], availableOf, noAllocation)).toEqual({
      total: 0,
      inStock: 0,
      lowStock: 0,
      needsReorder: 0,
    });
  });
});

describe('computeStock shortfall', () => {
  it('reports the larger of the threshold gap and the demand gap, net of on order', () => {
    // Realistic state: 2 in stock, 5 reserved → available = max(0, 2 - 5) = 0. Both gaps positive:
    // threshold gap 10 - (0 + 0) = 10 beats demand gap 5 - (2 + 0) = 3 → shortfall 10.
    const item = makeItem({ inStock: 2, reorderPoint: 10, onOrder: 0 });
    const stock = computeStock(
      item,
      () => 0,
      () => 5
    );
    expect(stock.shortfall).toBe(10);
  });

  it('is 0 when the item is healthy', () => {
    const item = makeItem({ inStock: 50, reorderPoint: 10, onOrder: 0 });
    const stock = computeStock(
      item,
      () => 50,
      () => 5
    );
    expect(stock.shortfall).toBe(0);
  });

  it('surfaces a demand shortage with no reorder point set', () => {
    // Need 5, have 2, nothing on order → short 3 even though no threshold is configured.
    const item = makeItem({ inStock: 2, reorderPoint: 0, onOrder: 0 });
    const stock = computeStock(
      item,
      () => 0,
      () => 5
    );
    expect(stock.shortfall).toBe(3);
  });

  it('exposes the two needsReorder reasons, and they agree with needsReorder (detail banner uses these)', () => {
    // Below now but the incoming order clears the threshold → banner must NOT alarm (matches list).
    const covered = makeItem({ inStock: 2, reorderPoint: 10, onOrder: 9 });
    const c = computeStock(
      covered,
      () => 2,
      () => 0
    );
    expect(c.belowThresholdAfterOrders).toBe(false);
    expect(c.shortForJobs).toBe(false);
    expect(c.needsReorder).toBe(false);

    // Genuinely short for jobs with no threshold → shortForJobs reason fires.
    const shortItem = makeItem({ inStock: 2, reorderPoint: 0, onOrder: 0 });
    const s = computeStock(
      shortItem,
      () => 0,
      () => 5
    );
    expect(s.shortForJobs).toBe(true);
    expect(s.needsReorder).toBe(true);
    expect(s.needsReorder).toBe(s.belowThresholdAfterOrders || s.shortForJobs);
  });
});

describe('pickFallbackItems', () => {
  it('orders low/out-of-stock items first, then alphabetically', () => {
    const items = [
      makeItem({ id: 'd', name: 'Zeta', available: 20, reorderPoint: 5 }), // healthy
      makeItem({ id: 'a', name: 'Alpha', available: 0, reorderPoint: 5 }), // out
      makeItem({ id: 'b', name: 'Beta', available: 3, reorderPoint: 5 }), // low
    ];
    const picked = pickFallbackItems(items, availableOf, noAllocation);
    expect(picked.map((i) => i.id)).toEqual(['a', 'b', 'd']);
  });
});

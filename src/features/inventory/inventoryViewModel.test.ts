import { describe, it, expect } from 'vitest';
import type { InventoryItem } from '@/core/types';
import { computeHubSummary, pickFallbackItems } from './inventoryViewModel';

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
      makeItem({ id: 'c', available: 3, reorderPoint: 5, onOrder: 10 }), // below threshold but already on order
      makeItem({ id: 'd', available: 20, reorderPoint: 5 }), // healthy
      makeItem({ id: 'e', available: 8, reorderPoint: 0 }), // no threshold set
    ];

    const summary = computeHubSummary(items, availableOf, noAllocation);

    expect(summary.total).toBe(5);
    expect(summary.needsReorder).toBe(2); // a, b (c is excluded because it's on order)
    expect(summary.lowStock).toBe(3); // a, b, c
    expect(summary.inStock).toBe(4); // b, c, d, e (a is out)
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

import { describe, it, expect } from 'vitest';
import type { InventoryItem } from '@/core/types';
import {
  shouldShowInventoryKanbanPrice,
  shouldShowInventoryDetailPrice,
  stripInventoryFinancials,
} from './priceVisibility';

const mockInventory = (overrides: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'inv-1',
  name: 'Foam Sheet',
  category: 'foam',
  inStock: 10,
  available: 8,
  disposed: 0,
  onOrder: 0,
  price: 12.5,
  unit: 'ea',
  ...overrides,
});

describe('price visibility', () => {
  it('hides kanban price for non-admin users', () => {
    expect(shouldShowInventoryKanbanPrice(mockInventory(), false)).toBe(false);
  });

  it('shows kanban price for admins only when reorder point is unset/zero', () => {
    expect(shouldShowInventoryKanbanPrice(mockInventory({ reorderPoint: 0 }), true)).toBe(true);
    expect(shouldShowInventoryKanbanPrice(mockInventory({ reorderPoint: 5 }), true)).toBe(false);
  });

  it('hides detail price for non-admin and shows for admin', () => {
    expect(shouldShowInventoryDetailPrice(mockInventory(), false)).toBe(false);
    expect(shouldShowInventoryDetailPrice(mockInventory(), true)).toBe(true);
  });

  it('strips pricing fields from inventory for non-admin users', () => {
    const items = [mockInventory(), mockInventory({ id: 'inv-2', price: 99 })];
    const stripped = stripInventoryFinancials(items, false);
    expect(stripped.every((item) => item.price === undefined)).toBe(true);
  });

  it('preserves inventory pricing fields for admins', () => {
    const items = [mockInventory()];
    const preserved = stripInventoryFinancials(items, true);
    expect(preserved[0].price).toBe(12.5);
  });
});

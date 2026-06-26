import { describe, it, expect } from 'vitest';
import { lineFromItem } from './lineFromItem';
import type { Item } from '../types';

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: 'item-1',
    name: 'Labor Sales',
    sku: null,
    itemType: 'service',
    incomeAccountId: 'acct-labor',
    expenseAccountId: null,
    inventoryAssetAccountId: null,
    defaultTaxCodeId: null,
    salesPrice: null,
    purchaseCost: null,
    isActive: true,
    sourceInventoryId: null,
    sourcePartId: null,
    externalQboId: null,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  };
}

describe('lineFromItem', () => {
  it('links the item, clears the part, and routes revenue to the item income account', () => {
    const patch = lineFromItem(makeItem());
    expect(patch.itemId).toBe('item-1');
    expect(patch.partId).toBeNull();
    expect(patch.description).toBe('Labor Sales');
    expect(patch.incomeAccountId).toBe('acct-labor');
    // Amount must recompute from qty × rate, so any seeded explicit total is cleared.
    expect(patch.lineTotal).toBeUndefined();
  });

  it('seeds the unit price from a positive item sales price', () => {
    const patch = lineFromItem(makeItem({ name: 'Delivery', salesPrice: 50 }), { unitPrice: 0 });
    expect(patch.unitPrice).toBe(50);
  });

  it('keeps the current line price when the item has no positive price', () => {
    // A 0/null-priced service item (e.g. "Labor Sales") must not stomp a price already typed.
    expect(lineFromItem(makeItem({ salesPrice: 0 }), { unitPrice: 42 }).unitPrice).toBe(42);
    expect(lineFromItem(makeItem({ salesPrice: null }), { unitPrice: 42 }).unitPrice).toBe(42);
    // …and falls back to 0 when there is no current price either.
    expect(lineFromItem(makeItem({ salesPrice: 0 })).unitPrice).toBe(0);
  });

  it('applies the item default tax code only when it has one', () => {
    expect(lineFromItem(makeItem({ defaultTaxCodeId: 'tc-1' })).taxCodeId).toBe('tc-1');
    // No default → leave the field absent so the header/line tax code still governs.
    expect('taxCodeId' in lineFromItem(makeItem({ defaultTaxCodeId: null }))).toBe(false);
  });
});

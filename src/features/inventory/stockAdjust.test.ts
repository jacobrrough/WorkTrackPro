import { describe, it, expect } from 'vitest';
import type { InventoryItem } from '@/core/types';
import { computeStockTarget, resolveScannedItem } from './stockAdjust';

const makeItem = (overrides: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'item-1',
  name: 'Test Part',
  category: 'material',
  inStock: 10,
  available: 10,
  disposed: 0,
  onOrder: 0,
  unit: 'ea',
  ...overrides,
});

describe('computeStockTarget', () => {
  it('adds qty for stock in', () => {
    const r = computeStockTarget('in', 10, 5, 'ea');
    expect(r.target).toBe(15);
    expect(r.appliedQty).toBe(5);
    expect(r.reason).toContain('+5');
    expect(r.reason).toContain('ea');
  });

  it('subtracts qty for stock out', () => {
    const r = computeStockTarget('out', 10, 4);
    expect(r.target).toBe(6);
    expect(r.appliedQty).toBe(4);
    expect(r.reason).toContain('-4');
  });

  it('clamps stock out at zero so stock never goes negative', () => {
    const r = computeStockTarget('out', 3, 10);
    expect(r.target).toBe(0);
    expect(r.appliedQty).toBe(3); // only the available 3 were actually removed
  });

  it('treats invalid or non-positive qty as a no-op', () => {
    expect(computeStockTarget('in', 7, Number.NaN).target).toBe(7);
    expect(computeStockTarget('in', 7, -2).target).toBe(7);
    expect(computeStockTarget('out', 7, 0).target).toBe(7);
  });

  it('supports fractional quantities for materials', () => {
    expect(computeStockTarget('in', 12.5, 2.5, 'ft').target).toBe(15);
    expect(computeStockTarget('out', 12.5, 2.5).target).toBe(10);
  });
});

describe('resolveScannedItem', () => {
  const inventory = [
    makeItem({ id: 'abc', barcode: 'BC-100' }),
    makeItem({ id: 'def', barcode: ' BC-200 ' }),
  ];

  it('matches by id', () => {
    expect(resolveScannedItem(inventory, 'abc')?.id).toBe('abc');
  });

  it('matches by barcode, trimming both the scan and the stored value', () => {
    expect(resolveScannedItem(inventory, 'BC-100')?.id).toBe('abc');
    expect(resolveScannedItem(inventory, '  BC-200 ')?.id).toBe('def');
  });

  it('returns undefined when nothing matches or the code is blank', () => {
    expect(resolveScannedItem(inventory, 'nope')).toBeUndefined();
    expect(resolveScannedItem(inventory, '   ')).toBeUndefined();
  });
});

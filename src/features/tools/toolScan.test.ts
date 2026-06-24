import { describe, it, expect } from 'vitest';
import type { InventoryItem } from '@/core/types';
import { binsMatch, normalizeBin, resolveToolByScan } from './toolScan';

const tool = (over: Partial<InventoryItem>): InventoryItem => ({
  id: 'id-x',
  name: 'Impact Driver',
  category: 'tool',
  inStock: 1,
  available: 1,
  disposed: 0,
  onOrder: 0,
  unit: 'ea',
  barcode: 'T-100',
  binLocation: 'A4c',
  ...over,
});

const tools: InventoryItem[] = [
  tool({ id: 'id-1', barcode: 'T-100' }),
  tool({ id: 'id-2', barcode: 'DRILL-7', name: 'Drill' }),
  tool({ id: 'id-3', barcode: undefined, name: 'No Barcode' }),
];

describe('resolveToolByScan', () => {
  it('matches by barcode, case-insensitively and trimmed', () => {
    expect(resolveToolByScan('T-100', tools)?.id).toBe('id-1');
    expect(resolveToolByScan(' t-100 ', tools)?.id).toBe('id-1');
    expect(resolveToolByScan('drill-7', tools)?.id).toBe('id-2');
  });

  it('falls back to matching by item id', () => {
    expect(resolveToolByScan('id-3', tools)?.id).toBe('id-3');
  });

  it('returns null for empty or unknown payloads', () => {
    expect(resolveToolByScan('', tools)).toBeNull();
    expect(resolveToolByScan('   ', tools)).toBeNull();
    expect(resolveToolByScan('NOPE-999', tools)).toBeNull();
  });

  it('never matches an item that has no barcode by an empty scan', () => {
    expect(resolveToolByScan('', tools)).toBeNull();
  });
});

describe('normalizeBin / binsMatch', () => {
  it('normalizes BIN: prefix, whitespace, and case', () => {
    expect(normalizeBin('BIN:A4c')).toBe('A4C');
    expect(normalizeBin(' a4c ')).toBe('A4C');
  });

  it('matches bins ignoring case and prefix', () => {
    expect(binsMatch('A4c', 'A4c')).toBe(true);
    expect(binsMatch('BIN:a4c', 'A4c')).toBe(true);
    expect(binsMatch('B2a', 'A4c')).toBe(false);
  });

  it('treats an empty scan as no match', () => {
    expect(binsMatch('', 'A4c')).toBe(false);
    expect(binsMatch('BIN:', 'A4c')).toBe(false);
  });
});

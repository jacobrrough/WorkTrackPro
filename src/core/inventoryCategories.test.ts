import { describe, it, expect } from 'vitest';
import {
  BUILTIN_INVENTORY_CATEGORIES,
  getCategoryDisplayName,
  humanizeCategoryKey,
  isBuiltInInventoryCategory,
  makeCategoryKey,
  mergeInventoryCategories,
  type InventoryCategoryOption,
} from './types';

describe('makeCategoryKey', () => {
  it('camelCases a multi-word label, alphanumerics only', () => {
    expect(makeCategoryKey('Raw Steel')).toBe('rawSteel');
    expect(makeCategoryKey('ABS Plastic')).toBe('absPlastic');
    expect(makeCategoryKey('  Spaced   Out  ')).toBe('spacedOut');
    expect(makeCategoryKey('Adhesives & Glue!')).toBe('adhesivesGlue');
  });

  it('keeps a single lowercase word stable', () => {
    expect(makeCategoryKey('Adhesives')).toBe('adhesives');
  });

  it('returns empty string when no usable characters', () => {
    expect(makeCategoryKey('')).toBe('');
    expect(makeCategoryKey('   ')).toBe('');
    expect(makeCategoryKey('!!!')).toBe('');
  });
});

describe('humanizeCategoryKey', () => {
  it('splits camelCase and separators into Title Case', () => {
    expect(humanizeCategoryKey('rawSteel')).toBe('Raw Steel');
    expect(humanizeCategoryKey('raw_steel')).toBe('Raw Steel');
    expect(humanizeCategoryKey('raw-steel')).toBe('Raw Steel');
    expect(humanizeCategoryKey('adhesives')).toBe('Adhesives');
  });
});

describe('getCategoryDisplayName', () => {
  it('uses the curated label for built-ins', () => {
    expect(getCategoryDisplayName('foam')).toBe('Foam');
    expect(getCategoryDisplayName('trimCord')).toBe('Trim & Cord');
    expect(getCategoryDisplayName('miscSupplies')).toBe('Misc Supplies');
  });

  it('humanizes unknown/custom keys', () => {
    expect(getCategoryDisplayName('rawSteel')).toBe('Raw Steel');
  });
});

describe('isBuiltInInventoryCategory', () => {
  it('recognizes built-in keys only', () => {
    expect(isBuiltInInventoryCategory('foam')).toBe(true);
    expect(isBuiltInInventoryCategory('miscSupplies')).toBe(true);
    expect(isBuiltInInventoryCategory('rawSteel')).toBe(false);
    expect(isBuiltInInventoryCategory('')).toBe(false);
  });
});

describe('BUILTIN_INVENTORY_CATEGORIES', () => {
  it('exposes the 7 built-ins in order with labels', () => {
    expect(BUILTIN_INVENTORY_CATEGORIES).toHaveLength(7);
    expect(BUILTIN_INVENTORY_CATEGORIES[0]).toEqual({ key: 'material', label: 'Material' });
  });
});

describe('mergeInventoryCategories', () => {
  it('returns just the built-ins when there are no custom categories', () => {
    expect(mergeInventoryCategories([])).toHaveLength(7);
  });

  it('appends custom categories after the built-ins', () => {
    const merged = mergeInventoryCategories([{ key: 'rawSteel', label: 'Raw Steel' }]);
    expect(merged).toHaveLength(8);
    expect(merged[7]).toEqual({ key: 'rawSteel', label: 'Raw Steel' });
  });

  it('never lets a custom entry shadow a built-in key', () => {
    const merged = mergeInventoryCategories([{ key: 'foam', label: 'Hijacked' }]);
    expect(merged).toHaveLength(7);
    expect(merged.find((c) => c.key === 'foam')?.label).toBe('Foam');
  });

  it('dedupes custom keys (first occurrence wins)', () => {
    const merged = mergeInventoryCategories([
      { key: 'rawSteel', label: 'Raw Steel' },
      { key: 'rawSteel', label: 'Duplicate' },
    ]);
    expect(merged.filter((c) => c.key === 'rawSteel')).toHaveLength(1);
    expect(merged.find((c) => c.key === 'rawSteel')?.label).toBe('Raw Steel');
  });

  it('drops malformed entries', () => {
    const merged = mergeInventoryCategories([
      { key: '', label: 'no key' },
      { key: 'ok' } as InventoryCategoryOption,
      null as unknown as InventoryCategoryOption,
      { key: 'good', label: 'Good' },
    ]);
    expect(merged).toHaveLength(8);
    expect(merged[7]).toEqual({ key: 'good', label: 'Good' });
  });
});

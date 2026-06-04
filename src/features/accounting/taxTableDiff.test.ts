import { describe, it, expect } from 'vitest';
import {
  applicableDiffEntries,
  classifyDiffEntry,
  hasApplicableChanges,
  isApplicableDiffEntry,
  normalizeDiffEntry,
  parseDiff,
  toRate,
} from './taxTableDiff';

/**
 * Pure TAX-SYNC diff helpers. These mirror the apply rules in the DB RPC
 * accounting.apply_tax_table_drift (migration 022): an entry is applied iff it has a
 * non-empty rate_name AND a numeric, non-negative new_rate; otherwise the RPC SKIPS it
 * (the whole apply does not fail). Keeping that gate identical here is what makes the
 * client's "N rate(s) will change" preview match what the DB actually does.
 */

describe('toRate', () => {
  it('passes finite numbers through', () => {
    expect(toRate(0.0725)).toBe(0.0725);
    expect(toRate(0)).toBe(0);
  });

  it('parses numeric strings (external data may not be pre-typed)', () => {
    expect(toRate('0.0775')).toBe(0.0775);
    expect(toRate('  0.05 ')).toBe(0.05);
  });

  it('returns null for non-numeric / empty / nullish / non-finite', () => {
    expect(toRate('')).toBeNull();
    expect(toRate('abc')).toBeNull();
    expect(toRate(null)).toBeNull();
    expect(toRate(undefined)).toBeNull();
    expect(toRate(NaN)).toBeNull();
    expect(toRate(Infinity)).toBeNull();
    expect(toRate({})).toBeNull();
  });
});

describe('normalizeDiffEntry', () => {
  it('reads snake_case keys as the DB/scheduled function writes them', () => {
    const e = normalizeDiffEntry({
      rate_name: 'CA Statewide Base',
      jurisdiction: 'state',
      current_rate: 0.0725,
      new_rate: 0.0775,
      effective_date: '2026-07-01',
      label: 'rate up',
    });
    expect(e).toEqual({
      rateName: 'CA Statewide Base',
      jurisdiction: 'state',
      currentRate: 0.0725,
      newRate: 0.0775,
      effectiveDate: '2026-07-01',
      label: 'rate up',
    });
  });

  it('also accepts camelCase keys (defensive)', () => {
    const e = normalizeDiffEntry({
      rateName: 'X',
      newRate: 0.01,
      currentRate: null,
      effectiveDate: null,
    });
    expect(e.rateName).toBe('X');
    expect(e.newRate).toBe(0.01);
    expect(e.currentRate).toBeNull();
  });

  it('trims the rate name and drops a stray ISO timestamp suffix on the date', () => {
    const e = normalizeDiffEntry({
      rate_name: '  Trimmed  ',
      effective_date: '2026-07-01T00:00:00Z',
    });
    expect(e.rateName).toBe('Trimmed');
    expect(e.effectiveDate).toBe('2026-07-01');
  });

  it('degrades a non-object element to an empty/null entry instead of throwing', () => {
    expect(normalizeDiffEntry(null)).toEqual({
      rateName: '',
      jurisdiction: null,
      currentRate: null,
      newRate: null,
      effectiveDate: null,
      label: null,
    });
    expect(normalizeDiffEntry('garbage').rateName).toBe('');
    expect(normalizeDiffEntry(42).newRate).toBeNull();
  });

  it('nulls an unparseable effective_date and a non-numeric new_rate', () => {
    const e = normalizeDiffEntry({
      rate_name: 'X',
      new_rate: 'not-a-number',
      effective_date: 'soon',
    });
    expect(e.newRate).toBeNull();
    expect(e.effectiveDate).toBeNull();
  });
});

describe('parseDiff', () => {
  it('maps a jsonb array of entries', () => {
    const diff = parseDiff([
      { rate_name: 'A', new_rate: 0.01 },
      { rate_name: 'B', new_rate: 0.02 },
    ]);
    expect(diff).toHaveLength(2);
    expect(diff[0].rateName).toBe('A');
    expect(diff[1].newRate).toBe(0.02);
  });

  it('parses a stringified array (defensive)', () => {
    const diff = parseDiff('[{"rate_name":"A","new_rate":0.03}]');
    expect(diff).toHaveLength(1);
    expect(diff[0].newRate).toBe(0.03);
  });

  it('degrades null / non-array / bad JSON to an empty array', () => {
    expect(parseDiff(null)).toEqual([]);
    expect(parseDiff(undefined)).toEqual([]);
    expect(parseDiff('{not json')).toEqual([]);
    expect(parseDiff({ rate_name: 'A' })).toEqual([]); // object, not array
    expect(parseDiff(123)).toEqual([]);
  });

  it('preserves order', () => {
    const diff = parseDiff([
      { rate_name: 'first', new_rate: 1 },
      { rate_name: 'second', new_rate: 2 },
    ]);
    expect(diff.map((e) => e.rateName)).toEqual(['first', 'second']);
  });
});

describe('isApplicableDiffEntry / applicableDiffEntries (mirrors the RPC skip rules)', () => {
  it('accepts an entry with a usable name and a non-negative numeric rate', () => {
    expect(isApplicableDiffEntry(normalizeDiffEntry({ rate_name: 'A', new_rate: 0.05 }))).toBe(
      true
    );
    expect(isApplicableDiffEntry(normalizeDiffEntry({ rate_name: 'A', new_rate: 0 }))).toBe(true);
  });

  it('rejects an entry missing a rate name (RPC skips it)', () => {
    expect(isApplicableDiffEntry(normalizeDiffEntry({ new_rate: 0.05 }))).toBe(false);
    expect(isApplicableDiffEntry(normalizeDiffEntry({ rate_name: '   ', new_rate: 0.05 }))).toBe(
      false
    );
  });

  it('rejects an entry with a missing or non-numeric new_rate (RPC skips it)', () => {
    expect(isApplicableDiffEntry(normalizeDiffEntry({ rate_name: 'A' }))).toBe(false);
    expect(isApplicableDiffEntry(normalizeDiffEntry({ rate_name: 'A', new_rate: null }))).toBe(
      false
    );
    expect(isApplicableDiffEntry(normalizeDiffEntry({ rate_name: 'A', new_rate: 'x' }))).toBe(
      false
    );
  });

  it('rejects a negative rate (matches the tax_rates CHECK rate >= 0; RPC skips it)', () => {
    expect(isApplicableDiffEntry(normalizeDiffEntry({ rate_name: 'A', new_rate: -0.01 }))).toBe(
      false
    );
  });

  it('filters a mixed diff to exactly the applicable entries', () => {
    const diff = parseDiff([
      { rate_name: 'Keep', new_rate: 0.05 }, // ok
      { rate_name: '', new_rate: 0.05 }, // no name → skip
      { rate_name: 'NoRate' }, // no rate → skip
      { rate_name: 'Neg', new_rate: -1 }, // negative → skip
      { rate_name: 'AlsoKeep', new_rate: 0 }, // zero ok
    ]);
    const applicable = applicableDiffEntries(diff);
    expect(applicable.map((e) => e.rateName)).toEqual(['Keep', 'AlsoKeep']);
    expect(hasApplicableChanges(diff)).toBe(true);
  });

  it('reports no applicable changes when every entry is bad', () => {
    const diff = parseDiff([{ rate_name: '' }, { new_rate: 0.05 }]);
    expect(applicableDiffEntries(diff)).toEqual([]);
    expect(hasApplicableChanges(diff)).toBe(false);
  });
});

describe('classifyDiffEntry (update vs insert — mirrors the RPC UPDATE-then-INSERT branch)', () => {
  const existing = new Set(['CA Statewide Base', 'LA County District']);

  it('classifies an existing active rate name as an UPDATE', () => {
    expect(
      classifyDiffEntry(
        normalizeDiffEntry({ rate_name: 'CA Statewide Base', new_rate: 0.0775 }),
        existing
      )
    ).toBe('update');
  });

  it('classifies a new rate name as an INSERT', () => {
    expect(
      classifyDiffEntry(
        normalizeDiffEntry({ rate_name: 'Brand New District', new_rate: 0.01 }),
        existing
      )
    ).toBe('insert');
  });

  it('matches on EXACT name (the RPC does not lower-case)', () => {
    // Different casing → not the same active rate → would INSERT.
    expect(
      classifyDiffEntry(
        normalizeDiffEntry({ rate_name: 'ca statewide base', new_rate: 0.0775 }),
        existing
      )
    ).toBe('insert');
  });

  it('returns null for a non-applicable entry', () => {
    expect(
      classifyDiffEntry(normalizeDiffEntry({ rate_name: '', new_rate: 0.05 }), existing)
    ).toBeNull();
    expect(classifyDiffEntry(normalizeDiffEntry({ rate_name: 'X' }), existing)).toBeNull();
  });
});

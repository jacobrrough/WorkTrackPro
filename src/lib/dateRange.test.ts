import { describe, it, expect } from 'vitest';
import { dateKey, todayKey, dateRangeKeys, filterByDateRange } from './dateRange';

// A fixed "now": Tuesday, 2026-06-16, late local evening.
const NOW = new Date(2026, 5, 16, 22, 30, 0);

describe('dateKey / todayKey', () => {
  it('uses local calendar components (not UTC)', () => {
    // 22:30 local on the 16th must stay the 16th even where UTC would roll to the 17th.
    expect(dateKey(NOW)).toBe('2026-06-16');
    expect(todayKey(NOW)).toBe('2026-06-16');
  });
});

describe('dateRangeKeys', () => {
  it('today is a single-day half-open window', () => {
    expect(dateRangeKeys('today', NOW)).toMatchObject({
      startKey: '2026-06-16',
      endKeyExclusive: '2026-06-17',
    });
  });

  it('week starts Monday and spans 7 days', () => {
    // 2026-06-16 is a Tuesday -> week starts Mon 2026-06-15.
    expect(dateRangeKeys('week', NOW)).toMatchObject({
      startKey: '2026-06-15',
      endKeyExclusive: '2026-06-22',
    });
  });

  it('month spans the calendar month', () => {
    expect(dateRangeKeys('month', NOW)).toMatchObject({
      startKey: '2026-06-01',
      endKeyExclusive: '2026-07-01',
    });
  });

  it('all has open bounds', () => {
    expect(dateRangeKeys('all', NOW)).toMatchObject({ startKey: null, endKeyExclusive: null });
  });
});

describe('filterByDateRange', () => {
  const items = [
    { entryDate: '2026-06-14' }, // Sunday (prev week)
    { entryDate: '2026-06-15' }, // Monday (week start)
    { entryDate: '2026-06-16' }, // today
    { entryDate: '2026-06-22' }, // next Monday (excluded from week)
  ];
  const get = (i: { entryDate: string }) => i.entryDate;

  it('keeps only today', () => {
    expect(filterByDateRange(items, get, 'today', NOW)).toEqual([{ entryDate: '2026-06-16' }]);
  });

  it('includes the start boundary and excludes the end boundary for week', () => {
    expect(filterByDateRange(items, get, 'week', NOW)).toEqual([
      { entryDate: '2026-06-15' },
      { entryDate: '2026-06-16' },
    ]);
  });

  it('an entry dated today stays in the week window (UTC-vs-local regression)', () => {
    const result = filterByDateRange([{ entryDate: todayKey(NOW) }], get, 'week', NOW);
    expect(result).toHaveLength(1);
  });

  it('all returns everything', () => {
    expect(filterByDateRange(items, get, 'all', NOW)).toEqual(items);
  });
});

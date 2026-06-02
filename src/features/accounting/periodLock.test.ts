import { describe, it, expect } from 'vitest';
import { isDateInClosedPeriod, isDatePostable, toIsoDate } from './periodLock';

/**
 * The DB scenario from migration 20260601000016's smoke test: books closed through
 * 2026-01-31. An entry on or before that date is frozen; a later entry is open.
 */
const CLOSED = '2026-01-31';

describe('isDateInClosedPeriod', () => {
  it('treats a date BEFORE the closed date as in the closed period (pre-lock rejected)', () => {
    // Mirrors the DB proof: entry dated 2025-12-31 with lock 2026-01-31 → rejected.
    expect(isDateInClosedPeriod('2025-12-31', CLOSED)).toBe(true);
    expect(isDateInClosedPeriod('2026-01-01', CLOSED)).toBe(true);
  });

  it('treats a date AFTER the closed date as open (post-lock succeeds)', () => {
    // Mirrors the DB proof: entry dated 2026-06-15 posts cleanly under the same lock.
    expect(isDateInClosedPeriod('2026-02-01', CLOSED)).toBe(false);
    expect(isDateInClosedPeriod('2026-06-15', CLOSED)).toBe(false);
  });

  it('treats a date ON the closed date as in the closed period (rule is "on or before")', () => {
    // The DB gate is `entry_date <= closed`, so the boundary day itself is frozen.
    expect(isDateInClosedPeriod(CLOSED, CLOSED)).toBe(true);
  });

  it('treats null / blank lock as books-open (nothing is closed)', () => {
    expect(isDateInClosedPeriod('2020-01-01', null)).toBe(false);
    expect(isDateInClosedPeriod('2020-01-01', undefined)).toBe(false);
    expect(isDateInClosedPeriod('2020-01-01', '')).toBe(false);
  });

  it('accepts ISO timestamps for either argument, comparing only the date part (no TZ math)', () => {
    // A full timestamp the same calendar day as the lock is still frozen.
    expect(isDateInClosedPeriod('2026-01-31T23:59:59Z', CLOSED)).toBe(true);
    expect(isDateInClosedPeriod('2026-02-01T00:00:00Z', CLOSED)).toBe(false);
    expect(isDateInClosedPeriod('2025-12-31', '2026-01-31T00:00:00.000Z')).toBe(true);
  });

  it('does not block on an unparseable entry date (DB stays the authority)', () => {
    expect(isDateInClosedPeriod('not-a-date', CLOSED)).toBe(false);
    expect(isDateInClosedPeriod(null, CLOSED)).toBe(false);
    expect(isDateInClosedPeriod('Jan 31 2026', CLOSED)).toBe(false); // not YYYY-MM-DD shape
  });

  it('compares lexicographically-correct ISO dates across year boundaries', () => {
    expect(isDateInClosedPeriod('2025-12-31', '2026-01-01')).toBe(true);
    expect(isDateInClosedPeriod('2026-01-02', '2026-01-01')).toBe(false);
  });
});

describe('isDatePostable', () => {
  it('is the inverse of isDateInClosedPeriod', () => {
    expect(isDatePostable('2025-12-31', CLOSED)).toBe(false); // frozen → not postable
    expect(isDatePostable('2026-06-15', CLOSED)).toBe(true); // open → postable
    expect(isDatePostable(CLOSED, CLOSED)).toBe(false); // boundary → not postable
    expect(isDatePostable('2020-01-01', null)).toBe(true); // no lock → postable
  });
});

describe('toIsoDate', () => {
  it('passes through a bare YYYY-MM-DD date', () => {
    expect(toIsoDate('2026-01-31')).toBe('2026-01-31');
  });

  it('takes the date portion of an ISO timestamp verbatim', () => {
    expect(toIsoDate('2026-01-31T12:34:56Z')).toBe('2026-01-31');
    expect(toIsoDate('2026-01-31 12:34:56')).toBe('2026-01-31');
  });

  it('returns null for null, blank, or non-date strings', () => {
    expect(toIsoDate(null)).toBeNull();
    expect(toIsoDate(undefined)).toBeNull();
    expect(toIsoDate('')).toBeNull();
    expect(toIsoDate('   ')).toBeNull();
    expect(toIsoDate('garbage')).toBeNull();
    expect(toIsoDate('2026-01')).toBeNull(); // partial date
  });

  it('trims surrounding whitespace', () => {
    expect(toIsoDate('  2026-01-31  ')).toBe('2026-01-31');
  });
});

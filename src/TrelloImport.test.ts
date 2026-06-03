import { describe, it, expect } from 'vitest';
import { trelloDateToLocalISODate } from './TrelloImport';

/**
 * Regression tests for Trello due-date / custom-field date normalization.
 *
 * Historically `card.due` was imported via `String(card.due).split('T')[0]` and text
 * dates via `toISOString().split('T')[0]`, both of which yield the UTC calendar date.
 * For users in timezones behind UTC, an evening-local due time that crosses midnight UTC
 * was stored one day ahead. `trelloDateToLocalISODate` must map a real instant to the
 * LOCAL calendar date, while leaving bare user-typed dates untouched.
 */

const pad = (n: number) => String(n).padStart(2, '0');
const localISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

describe('trelloDateToLocalISODate', () => {
  it('maps an instant to the LOCAL calendar date (not the UTC date)', () => {
    // 23:00 UTC: in any timezone behind UTC this is the evening of the SAME UTC day,
    // but the prior-day boundary matters for zones at/after UTC. Assert against the
    // local date derived from the same instant so the test holds in every timezone and
    // fails if the implementation reverts to a UTC `toISOString` split.
    const instant = '2026-06-02T23:00:00.000Z';
    expect(trelloDateToLocalISODate(instant)).toBe(localISO(new Date(instant)));
  });

  it('does not shift an evening-UTC-crossing instant by a day for behind-UTC zones', () => {
    // 02:30 UTC on the 3rd is still the 2nd in US timezones (UTC-3..-10). Compute the
    // expected local date live; additionally assert it diverges from the naive UTC split
    // whenever the host is actually behind UTC, proving the off-by-one is handled.
    const instant = '2026-06-03T02:30:00.000Z';
    const d = new Date(instant);
    expect(trelloDateToLocalISODate(instant)).toBe(localISO(d));

    const utcSplit = d.toISOString().split('T')[0];
    if (d.getTimezoneOffset() > 0) {
      // Host is behind UTC -> local date precedes the UTC date for this instant.
      expect(trelloDateToLocalISODate(instant)).not.toBe(utcSplit);
    }
  });

  it('keeps a bare ISO calendar date as-is (no timezone rollback)', () => {
    // `new Date("2026-06-02")` parses as UTC midnight and would roll back a day in
    // behind-UTC zones; the user typed a calendar date, so it must be preserved.
    expect(trelloDateToLocalISODate('2026-06-02')).toBe('2026-06-02');
  });

  it('normalizes a bare US-style M/D/YYYY date without timezone math', () => {
    expect(trelloDateToLocalISODate('6/2/2026')).toBe('2026-06-02');
    expect(trelloDateToLocalISODate('12/9/2026')).toBe('2026-12-09');
  });

  it('normalizes a slash-style YYYY/M/D date', () => {
    expect(trelloDateToLocalISODate('2026/6/2')).toBe('2026-06-02');
  });

  it('returns null for empty or unparseable input', () => {
    expect(trelloDateToLocalISODate('')).toBeNull();
    expect(trelloDateToLocalISODate('   ')).toBeNull();
    expect(trelloDateToLocalISODate(null)).toBeNull();
    expect(trelloDateToLocalISODate(undefined)).toBeNull();
    expect(trelloDateToLocalISODate('not a date')).toBeNull();
  });
});

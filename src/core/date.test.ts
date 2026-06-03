import { describe, it, expect } from 'vitest';
import { dateInputToISO, isoToDateInput, formatDateOnly } from './date';

/**
 * Regression tests for the due/ECD date round-trip.
 *
 * The write path (dateInputToISO) and read path (isoToDateInput) must agree on
 * the calendar day with each other AND with the literal-day parse used by
 * formatDateOnly, regardless of the client's UTC offset. The previous
 * implementation anchored at UTC midnight and read local calendar components,
 * which shifted the stored day by one for clients whose offset crossed midnight
 * relative to the stored instant.
 */
describe('dateInputToISO', () => {
  it('anchors the instant at UTC noon so ±12h client offsets cannot cross a day boundary', () => {
    expect(dateInputToISO('2026-01-15')).toBe('2026-01-15T12:00:00.000Z');
  });

  it('preserves the literal calendar day that formatDateOnly reads', () => {
    // formatDateOnly takes the literal YYYY-MM-DD portion of the stored value,
    // so the date part of the ISO string must match the input exactly.
    const input = '2026-01-15';
    const iso = dateInputToISO(input);
    expect(iso?.split('T')[0]).toBe(input);
  });

  it('returns undefined for empty input', () => {
    expect(dateInputToISO(undefined)).toBeUndefined();
    expect(dateInputToISO('')).toBeUndefined();
  });
});

describe('isoToDateInput', () => {
  it('reads UTC calendar components to mirror the UTC-noon anchor', () => {
    expect(isoToDateInput('2026-01-15T12:00:00.000Z')).toBe('2026-01-15');
  });

  it('returns the same calendar day at the UTC-day edges (no off-by-one)', () => {
    // Just after midnight UTC and just before midnight UTC both belong to the
    // 15th in UTC terms; local getters would have reported the 14th/16th for
    // some clients.
    expect(isoToDateInput('2026-01-15T00:30:00.000Z')).toBe('2026-01-15');
    expect(isoToDateInput('2026-01-15T23:30:00.000Z')).toBe('2026-01-15');
  });

  it('returns empty string for empty input', () => {
    expect(isoToDateInput(undefined)).toBe('');
    expect(isoToDateInput('')).toBe('');
  });
});

describe('due/ECD round-trip (input -> stored ISO -> input)', () => {
  const days = [
    '2026-01-01',
    '2026-01-15',
    '2026-06-03',
    '2026-12-31',
    '2024-02-29', // leap day
  ];

  it('round-trips every calendar day unchanged', () => {
    for (const day of days) {
      const iso = dateInputToISO(day);
      expect(iso).toBeDefined();
      expect(isoToDateInput(iso)).toBe(day);
    }
  });

  it('keeps formatDateOnly agreeing with the round-trip on the calendar day', () => {
    for (const day of days) {
      const iso = dateInputToISO(day)!;
      // formatDateOnly consumes the stored ISO directly (display path).
      const displayed = formatDateOnly(iso);
      // It must render the SAME calendar day that isoToDateInput recovers.
      const recovered = isoToDateInput(iso); // YYYY-MM-DD
      const expected = formatDateOnly(recovered);
      expect(displayed).toBe(expected);
      expect(displayed).not.toBe('Invalid Date');
    }
  });
});

/**
 * Exercise the round-trip under a non-UTC timezone. process.env.TZ is restored
 * afterward so test ordering is unaffected. The assertions hold by construction
 * (UTC-noon anchor + UTC getters), which is exactly the offset-independence the
 * fix guarantees; this block documents the positive-offset case from the report.
 */
describe('round-trip under a non-UTC timezone', () => {
  const cases: Array<[string, string]> = [
    ['Asia/Tokyo', '2026-01-15'], // UTC+9 (positive offset — the reported failure)
    ['Pacific/Kiritimati', '2026-01-15'], // UTC+14 (extreme positive offset)
    ['America/Los_Angeles', '2026-01-15'], // UTC-8 (current app's negative offset)
    ['Pacific/Pago_Pago', '2026-01-15'], // UTC-11 (extreme negative offset)
  ];

  for (const [tz, day] of cases) {
    it(`round-trips ${day} under ${tz}`, () => {
      const original = process.env.TZ;
      try {
        process.env.TZ = tz;
        const iso = dateInputToISO(day);
        expect(iso).toBe(`${day}T12:00:00.000Z`);
        expect(isoToDateInput(iso)).toBe(day);
        expect(iso?.split('T')[0]).toBe(day);
      } finally {
        process.env.TZ = original;
      }
    });
  }
});

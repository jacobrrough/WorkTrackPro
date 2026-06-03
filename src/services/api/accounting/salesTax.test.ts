import { describe, it, expect } from 'vitest';
import { combinedRateFromRates } from './salesTax';
import type { Row } from './mappers';

/**
 * Unit coverage for combinedRateFromRates — the agency combined-rate helper. The defect
 * it guards: summing every rate (regardless of whether it is currently in effect) inflates
 * an agency's displayed combined rate. These tests pin the in-effect window filtering
 * (active AND effective_date<=asOf AND (end_date null or >=asOf)) while preserving the
 * prior behaviour for the common seeded case where the date bounds are unset.
 */
describe('combinedRateFromRates', () => {
  const asOf = '2026-06-02';

  it('returns 0 for null / undefined / empty input', () => {
    expect(combinedRateFromRates(null, asOf)).toBe(0);
    expect(combinedRateFromRates(undefined, asOf)).toBe(0);
    expect(combinedRateFromRates([], asOf)).toBe(0);
  });

  it('sums rates with unset date bounds (backward-compatible seeded case)', () => {
    const rates: Row[] = [
      { rate: 0.0725, is_active: true },
      { rate: 0.0225, is_active: true },
    ];
    expect(combinedRateFromRates(rates, asOf)).toBeCloseTo(0.095, 10);
  });

  it('treats a missing is_active flag as active (undefined !== false)', () => {
    const rates: Row[] = [{ rate: 0.0725 }];
    expect(combinedRateFromRates(rates, asOf)).toBeCloseTo(0.0725, 10);
  });

  it('excludes an explicitly inactive rate regardless of dates', () => {
    const rates: Row[] = [
      { rate: 0.0725, is_active: true },
      { rate: 0.01, is_active: false, effective_date: '2020-01-01', end_date: null },
    ];
    expect(combinedRateFromRates(rates, asOf)).toBeCloseTo(0.0725, 10);
  });

  it('excludes a rate that has not yet taken effect (effective_date > asOf)', () => {
    const rates: Row[] = [
      { rate: 0.0725, is_active: true, effective_date: '2020-01-01' },
      { rate: 0.005, is_active: true, effective_date: '2027-01-01' }, // future district hike
    ];
    expect(combinedRateFromRates(rates, asOf)).toBeCloseTo(0.0725, 10);
  });

  it('excludes a rate that has already expired (end_date < asOf)', () => {
    const rates: Row[] = [
      { rate: 0.0725, is_active: true, end_date: null },
      { rate: 0.01, is_active: true, effective_date: '2018-01-01', end_date: '2022-12-31' },
    ];
    expect(combinedRateFromRates(rates, asOf)).toBeCloseTo(0.0725, 10);
  });

  it('does not inflate when an old rate is superseded by a current one', () => {
    // Same jurisdiction: a 1.0% district rate replaced by 1.5% effective 2025-01-01.
    const rates: Row[] = [
      { rate: 0.0725, is_active: true }, // open-ended state
      { rate: 0.01, is_active: true, effective_date: '2018-01-01', end_date: '2024-12-31' },
      { rate: 0.015, is_active: true, effective_date: '2025-01-01', end_date: null },
    ];
    // Only the state + the current district count — not the retired 1.0%.
    expect(combinedRateFromRates(rates, asOf)).toBeCloseTo(0.0875, 10);
  });

  it('includes a rate on its boundary days (effective_date == asOf, end_date == asOf)', () => {
    const startsToday: Row[] = [{ rate: 0.02, is_active: true, effective_date: asOf }];
    expect(combinedRateFromRates(startsToday, asOf)).toBeCloseTo(0.02, 10);

    const endsToday: Row[] = [{ rate: 0.03, is_active: true, end_date: asOf }];
    expect(combinedRateFromRates(endsToday, asOf)).toBeCloseTo(0.03, 10);
  });

  it('coerces a non-numeric / missing rate to 0 (matches num())', () => {
    const rates: Row[] = [
      { rate: 0.0725, is_active: true },
      { rate: 'n/a', is_active: true },
      { is_active: true },
    ];
    expect(combinedRateFromRates(rates, asOf)).toBeCloseTo(0.0725, 10);
  });
});

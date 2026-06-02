import { describe, it, expect } from 'vitest';
import {
  computeStraightLineSchedule,
  depreciableBaseCents,
  netBookValue,
  netBookValueCents,
  periodEndDate,
} from './depreciation';

/** Σ of a schedule's per-period cents — the figure that must equal the depreciable base. */
const sumCents = (rows: { amountCents: number }[]) => rows.reduce((s, r) => s + r.amountCents, 0);

describe('periodEndDate', () => {
  it('returns the last day of the in-service month at k=1', () => {
    // In service Jan 2026 → period 1 ends 2026-01-31.
    expect(periodEndDate(2026, 1, 1)).toBe('2026-01-31');
  });

  it('returns the last day of each subsequent month', () => {
    expect(periodEndDate(2026, 1, 2)).toBe('2026-02-28'); // 2026 is not a leap year
    expect(periodEndDate(2026, 1, 4)).toBe('2026-04-30');
    expect(periodEndDate(2026, 1, 7)).toBe('2026-07-31');
  });

  it('handles February in a leap year', () => {
    // In service Jan 2024 → period 2 ends 2024-02-29.
    expect(periodEndDate(2024, 1, 2)).toBe('2024-02-29');
  });

  it('rolls correctly across a year boundary', () => {
    // In service Nov 2026, period 3 → Jan 2027 month-end.
    expect(periodEndDate(2026, 11, 3)).toBe('2027-01-31');
  });
});

describe('computeStraightLineSchedule', () => {
  it('matches the DB smoke-test: 10000/1000 over 7 months (Σ = base, remainder in final)', () => {
    const rows = computeStraightLineSchedule({
      cost: 10000,
      salvageValue: 1000,
      usefulLifeMonths: 7,
      inServiceDate: '2026-01-15',
    });
    expect(rows).toHaveLength(7);

    // Depreciable base = (10000 − 1000) × 100 = 900000 cents; Σ must equal it exactly.
    expect(sumCents(rows)).toBe(900000);

    // Per period floor(900000/7) = 128571 cents = $1,285.71; final absorbs the remainder.
    expect(rows[0].amountCents).toBe(128571);
    expect(rows[0].amount).toBe(1285.71);
    expect(rows[5].amountCents).toBe(128571);
    expect(rows[6].amountCents).toBe(128574); // 900000 − 128571*6
    expect(rows[6].amount).toBe(1285.74);

    // Period dates are end-of-month from the in-service month onward.
    expect(rows.map((r) => r.periodDate)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
      '2026-07-31',
    ]);
    expect(rows[0].periodNumber).toBe(1);
    expect(rows[6].periodNumber).toBe(7);
  });

  it('splits an evenly-divisible base into equal periods (no remainder)', () => {
    const rows = computeStraightLineSchedule({
      cost: 1200,
      salvageValue: 0,
      usefulLifeMonths: 12,
      inServiceDate: '2026-01-01',
    });
    expect(rows).toHaveLength(12);
    expect(sumCents(rows)).toBe(120000); // $1,200.00
    // Every period equals $100.00 — base 120000 / 12 = 10000 cents, no remainder.
    for (const r of rows) expect(r.amountCents).toBe(10000);
  });

  it('puts the entire rounding remainder in the final period only', () => {
    // base 100 cents over 3 months: floor(100/3)=33; periods 33,33,34 → Σ 100.
    const rows = computeStraightLineSchedule({
      cost: 1,
      salvageValue: 0,
      usefulLifeMonths: 3,
      inServiceDate: '2026-06-10',
    });
    expect(rows.map((r) => r.amountCents)).toEqual([33, 33, 34]);
    expect(sumCents(rows)).toBe(100);
  });

  it('returns no rows when salvage >= cost (nothing to depreciate)', () => {
    expect(
      computeStraightLineSchedule({ cost: 500, salvageValue: 500, usefulLifeMonths: 12, inServiceDate: '2026-01-01' })
    ).toEqual([]);
    expect(
      computeStraightLineSchedule({ cost: 500, salvageValue: 600, usefulLifeMonths: 12, inServiceDate: '2026-01-01' })
    ).toEqual([]);
  });

  it('returns no rows for a non-positive useful life', () => {
    expect(
      computeStraightLineSchedule({ cost: 1000, salvageValue: 0, usefulLifeMonths: 0, inServiceDate: '2026-01-01' })
    ).toEqual([]);
    expect(
      computeStraightLineSchedule({ cost: 1000, salvageValue: 0, usefulLifeMonths: -5, inServiceDate: '2026-01-01' })
    ).toEqual([]);
  });

  it('a single-month life depreciates the whole base in one period', () => {
    const rows = computeStraightLineSchedule({
      cost: 250,
      salvageValue: 50,
      usefulLifeMonths: 1,
      inServiceDate: '2026-03-20',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].amountCents).toBe(20000); // $200.00
    expect(rows[0].periodDate).toBe('2026-03-31');
  });

  it('handles a sub-dollar base without drift (cents-exact)', () => {
    // base 7 cents over 4 months: floor(7/4)=1; periods 1,1,1,4 → Σ 7.
    const rows = computeStraightLineSchedule({
      cost: 0.07,
      salvageValue: 0,
      usefulLifeMonths: 4,
      inServiceDate: '2026-01-01',
    });
    expect(rows.map((r) => r.amountCents)).toEqual([1, 1, 1, 4]);
    expect(sumCents(rows)).toBe(7);
  });
});

describe('depreciableBaseCents', () => {
  it('is cost − salvage in cents', () => {
    expect(depreciableBaseCents(10000, 1000)).toBe(900000);
  });
  it('never goes negative', () => {
    expect(depreciableBaseCents(100, 250)).toBe(0);
  });
});

describe('netBookValue', () => {
  it('is cost − accumulated, in dollars', () => {
    expect(netBookValue(10000, 1000, 1285.71)).toBe(8714.29);
  });

  it('is floored at salvage (NBV never drops below salvage)', () => {
    // Even with the full depreciable base booked, NBV bottoms out at salvage.
    expect(netBookValue(10000, 1000, 9000)).toBe(1000);
    // And over-booking past the base can't push it below salvage either.
    expect(netBookValue(10000, 1000, 9999)).toBe(1000);
  });

  it('equals cost when nothing is depreciated yet', () => {
    expect(netBookValue(10000, 1000, 0)).toBe(10000);
  });

  it('matches the full-life DB result: lands exactly on salvage', () => {
    // The 7-period schedule sums to 9000.00; cost − 9000 = 1000 = salvage.
    expect(netBookValueCents(10000, 1000, 900000)).toBe(100000); // $1,000.00
  });
});

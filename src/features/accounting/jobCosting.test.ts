import { describe, it, expect } from 'vitest';
import { marginPct, sortJobCosting, totalJobCosting } from './jobCosting';
import type { JobCostingRow } from './types';

/** Build a JobCostingRow with sensible defaults, overriding only what a test needs. */
function row(partial: Partial<JobCostingRow>): JobCostingRow {
  return {
    jobId: partial.jobId ?? 'j',
    jobCode: partial.jobCode ?? null,
    name: partial.name ?? 'Job',
    status: partial.status ?? 'active',
    laborMinutes: partial.laborMinutes ?? 0,
    laborCost: partial.laborCost ?? 0,
    materialCost: partial.materialCost ?? 0,
    revenue: partial.revenue ?? 0,
    margin: partial.margin ?? 0,
  };
}

describe('marginPct', () => {
  it('computes margin as a percentage of revenue, rounded to one decimal', () => {
    // revenue 1000, margin 250 → 25.0%
    expect(marginPct({ revenue: 1000, margin: 250 })).toBe(25);
    // revenue 200, margin 50 → 25.0%
    expect(marginPct({ revenue: 200, margin: 50 })).toBe(25);
  });

  it('rounds to a single decimal place using integer-cents math', () => {
    // 1/3 of revenue → 33.333…% rounds to 33.3
    expect(marginPct({ revenue: 300, margin: 100 })).toBe(33.3);
    // 2/3 → 66.666…% rounds to 66.7
    expect(marginPct({ revenue: 300, margin: 200 })).toBe(66.7);
  });

  it('returns null on zero revenue (divide-by-zero guard), even with a cost incurred', () => {
    // No revenue, no cost → undefined ratio.
    expect(marginPct({ revenue: 0, margin: 0 })).toBeNull();
    // No revenue but money spent (negative margin) → still null, never -Infinity/NaN.
    expect(marginPct({ revenue: 0, margin: -500 })).toBeNull();
  });

  it('handles a negative margin (over-budget job) as a negative percentage', () => {
    // revenue 1000, margin -100 → -10.0%
    expect(marginPct({ revenue: 1000, margin: -100 })).toBe(-10);
  });

  it('can exceed 100% when margin > revenue (e.g. a credit with no cost)', () => {
    expect(marginPct({ revenue: 100, margin: 150 })).toBe(150);
  });

  it('does not drift on values that would lose precision as floats', () => {
    // 0.1 + 0.2 style hazard: revenue 0.30, margin 0.10 → 33.3%
    expect(marginPct({ revenue: 0.3, margin: 0.1 })).toBe(33.3);
  });
});

describe('sortJobCosting', () => {
  const a = row({ jobId: 'a', name: 'Alpha', revenue: 100, margin: 10, status: 'active' });
  const b = row({ jobId: 'b', name: 'Bravo', revenue: 300, margin: 90, status: 'complete' });
  const c = row({ jobId: 'c', name: 'Charlie', revenue: 200, margin: -50, status: 'active' });
  const rows = [a, b, c];

  it('defaults to margin descending (most profitable first)', () => {
    const sorted = sortJobCosting(rows);
    expect(sorted.map((r) => r.jobId)).toEqual(['b', 'a', 'c']); // 90, 10, -50
  });

  it('sorts by margin ascending', () => {
    const sorted = sortJobCosting(rows, 'margin', 'asc');
    expect(sorted.map((r) => r.jobId)).toEqual(['c', 'a', 'b']); // -50, 10, 90
  });

  it('sorts by revenue descending and ascending', () => {
    expect(sortJobCosting(rows, 'revenue', 'desc').map((r) => r.jobId)).toEqual(['b', 'c', 'a']);
    expect(sortJobCosting(rows, 'revenue', 'asc').map((r) => r.jobId)).toEqual(['a', 'c', 'b']);
  });

  it('sorts by name case-insensitively (asc + desc)', () => {
    const mixed = [
      row({ jobId: 'x', name: 'beta' }),
      row({ jobId: 'y', name: 'Alpha' }),
      row({ jobId: 'z', name: 'Gamma' }),
    ];
    expect(sortJobCosting(mixed, 'name', 'asc').map((r) => r.jobId)).toEqual(['y', 'x', 'z']);
    expect(sortJobCosting(mixed, 'name', 'desc').map((r) => r.jobId)).toEqual(['z', 'x', 'y']);
  });

  it('sorts by marginPct, sinking zero-revenue rows (null pct) to the bottom on desc', () => {
    const withZero = [
      row({ jobId: 'p', revenue: 1000, margin: 500 }), // 50%
      row({ jobId: 'q', revenue: 1000, margin: 100 }), // 10%
      row({ jobId: 'r', revenue: 0, margin: -20 }), // null pct (zero revenue)
    ];
    // desc: highest pct first, null last
    expect(sortJobCosting(withZero, 'marginPct', 'desc').map((r) => r.jobId)).toEqual(['p', 'q', 'r']);
    // asc: null first (treated as lowest), then ascending pct
    expect(sortJobCosting(withZero, 'marginPct', 'asc').map((r) => r.jobId)).toEqual(['r', 'q', 'p']);
  });

  it('is stable: rows tied on the key keep their input order', () => {
    const tied = [
      row({ jobId: 'first', margin: 50 }),
      row({ jobId: 'second', margin: 50 }),
      row({ jobId: 'third', margin: 50 }),
    ];
    expect(sortJobCosting(tied, 'margin', 'desc').map((r) => r.jobId)).toEqual([
      'first',
      'second',
      'third',
    ]);
    expect(sortJobCosting(tied, 'margin', 'asc').map((r) => r.jobId)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });

  it('does not mutate the input array', () => {
    const input = [a, b, c];
    const snapshot = input.map((r) => r.jobId);
    sortJobCosting(input, 'revenue', 'asc');
    expect(input.map((r) => r.jobId)).toEqual(snapshot);
  });

  it('returns an empty array unchanged', () => {
    expect(sortJobCosting([])).toEqual([]);
  });
});

describe('totalJobCosting', () => {
  it('sums each money column in integer cents and the blended margin %', () => {
    const rows = [
      row({ revenue: 100.1, materialCost: 20.05, laborCost: 10.0, margin: 70.05 }),
      row({ revenue: 200.2, materialCost: 40.1, laborCost: 30.0, margin: 130.1 }),
    ];
    const t = totalJobCosting(rows);
    expect(t.revenue).toBeCloseTo(300.3, 5);
    expect(t.materialCost).toBeCloseTo(60.15, 5);
    expect(t.laborCost).toBeCloseTo(40.0, 5);
    expect(t.margin).toBeCloseTo(200.15, 5);
    // blended: 200.15 / 300.30 = 66.65% → 66.7 (one decimal)
    expect(t.marginPct).toBe(66.7);
  });

  it('returns zeros and a null margin % for an empty set', () => {
    const t = totalJobCosting([]);
    expect(t).toMatchObject({ revenue: 0, materialCost: 0, laborCost: 0, margin: 0, marginPct: null });
  });
});

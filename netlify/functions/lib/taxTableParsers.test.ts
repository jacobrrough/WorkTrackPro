import { describe, it, expect } from 'vitest';
import { coerceRate, severityOf, buildDiff } from './taxTableParsers.mjs';

/**
 * Server-side TAX-SYNC parsers/diff helpers (advisory-only). These are pure,
 * dependency-free transforms over UNTRUSTED external tax-table data, but they are
 * load-bearing: `buildDiff` decides what an admin sees as proposed drift and its
 * matching rule MUST mirror the apply RPC (accounting.apply_tax_table_drift, which
 * targets accounting.tax_rates by exact `name`). These tests pin the boundary
 * coercion, the diff matching/emission shape, and the severity buckets so a future
 * edit cannot silently change what drift is reported or how it is graded.
 */

describe('coerceRate', () => {
  it('passes a finite fraction in [0,1) through (number path)', () => {
    expect(coerceRate(0.0725)).toBe(0.0725);
    expect(coerceRate(0)).toBe(0);
  });

  it('rejects a number >= 1 (a fraction is < 100%) → null', () => {
    expect(coerceRate(1)).toBeNull();
    expect(coerceRate(7.25)).toBeNull();
  });

  it('parses a percent string by dividing by 100', () => {
    expect(coerceRate('7.25%')).toBe(0.0725);
  });

  it('takes a sub-1 decimal string as a fraction (no scaling)', () => {
    expect(coerceRate('0.05')).toBe(0.05);
  });

  it('treats a bare >= 1 string as a percent written without the sign', () => {
    expect(coerceRate('7.25')).toBe(0.0725);
  });

  it('returns null for empty / garbage / nullish input', () => {
    expect(coerceRate('')).toBeNull();
    expect(coerceRate('   ')).toBeNull();
    expect(coerceRate('abc')).toBeNull();
    expect(coerceRate(null)).toBeNull();
    expect(coerceRate(undefined)).toBeNull();
    expect(coerceRate(NaN)).toBeNull();
    expect(coerceRate(Infinity)).toBeNull();
  });
});

describe('severityOf', () => {
  it("grades an insert-only diff (no stored rate yet) as 'warning'", () => {
    expect(severityOf([{ current_rate: null, new_rate: 0.05 }])).toBe('warning');
  });

  it("grades a >= 1 percentage-point move as 'critical'", () => {
    expect(severityOf([{ current_rate: 0.0725, new_rate: 0.0825 }])).toBe('critical');
  });

  it("grades a small (>0, <1pp) move as 'warning'", () => {
    // severityOf gates 'critical' at a >=0.01 move; any non-zero delta is 'warning'.
    expect(severityOf([{ current_rate: 0.0725, new_rate: 0.0735 }])).toBe('warning');
  });

  it("grades an empty diff (no drift) as 'info'", () => {
    expect(severityOf([])).toBe('info');
    expect(severityOf(null)).toBe('info');
  });

  it("grades a matched entry whose rate did not move as 'info'", () => {
    expect(severityOf([{ current_rate: 0.0725, new_rate: 0.0725 }])).toBe('info');
  });
});

describe('buildDiff', () => {
  it('emits nothing when a matched stored rate is unchanged within 5-dp precision', () => {
    const parsed = [{ jurisdiction: 'CA Statewide Base', rate: 0.0725 }];
    const active = [{ name: 'CA Statewide Base', rate: 0.0725 }];
    expect(buildDiff(parsed, active)).toEqual([]);
  });

  it('emits a change carrying the EXACT stored rate_name when a matched rate differs', () => {
    const parsed = [
      { jurisdiction: 'CA Statewide Base', rate: 0.0775, effectiveDate: '2026-07-01' },
    ];
    const active = [{ name: 'CA Statewide Base', rate: 0.0725 }];
    const diff = buildDiff(parsed, active);
    expect(diff).toHaveLength(1);
    expect(diff[0].rate_name).toBe('CA Statewide Base');
    expect(diff[0].current_rate).toBe(0.0725);
    expect(diff[0].new_rate).toBe(0.0775);
    expect(diff[0].effective_date).toBe('2026-07-01');
  });

  it('emits an INSERT-style proposal (current_rate: null) for a parsed jurisdiction with no stored rate', () => {
    const parsed = [{ jurisdiction: 'Brand New District', rate: 0.01 }];
    const diff = buildDiff(parsed, []);
    expect(diff).toHaveLength(1);
    expect(diff[0].rate_name).toBe('Brand New District');
    expect(diff[0].current_rate).toBeNull();
    expect(diff[0].new_rate).toBe(0.01);
  });

  it('matches case-insensitively but emits the stored casing so the apply RPC (exact name) hits', () => {
    // Parser jurisdiction casing differs from the stored name; buildDiff must still
    // match it and surface match.name verbatim (the RPC targets tax_rates by exact name).
    const parsed = [{ jurisdiction: 'ca statewide base', rate: 0.0775 }];
    const active = [{ name: 'CA Statewide Base', rate: 0.0725 }];
    const diff = buildDiff(parsed, active);
    expect(diff).toHaveLength(1);
    expect(diff[0].rate_name).toBe('CA Statewide Base');
    expect(diff[0].current_rate).toBe(0.0725);
    expect(diff[0].new_rate).toBe(0.0775);
  });
});

import { describe, it, expect } from 'vitest';
import {
  computeAgencyCalendar,
  daysBetween,
  daysInMonth,
  dueDateFor,
  fallbackRuleFor,
  normalizeFrequency,
  periodContaining,
  periodLabel,
} from './taxCalendarMath';
import type { TaxFilingRule } from '../types';

/** The seeded CDTFA quarterly rule (migration 020): due last day of the month after Q-end. */
const CDTFA_RULE: TaxFilingRule = {
  agency: 'CDTFA',
  frequency: 'quarterly',
  periodBasis: 'calendar',
  dueDay: 31,
  dueMonthOffset: 1,
  notes: 'CA sales & use tax — representative cadence.',
};

describe('daysInMonth', () => {
  it('knows month lengths incl. leap February', () => {
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29); // leap year
  });
});

describe('daysBetween', () => {
  it('counts whole days b − a in UTC (no tz drift)', () => {
    expect(daysBetween('2026-06-01', '2026-06-30')).toBe(29);
    expect(daysBetween('2026-06-30', '2026-06-01')).toBe(-29);
    expect(daysBetween('2026-06-01', '2026-06-01')).toBe(0);
  });
});

describe('periodContaining', () => {
  it('maps a month to its calendar quarter', () => {
    expect(periodContaining(2026, 2, 'quarterly')).toMatchObject({ startMonth1: 1, endMonth1: 3 });
    expect(periodContaining(2026, 5, 'quarterly')).toMatchObject({ startMonth1: 4, endMonth1: 6 });
    expect(periodContaining(2026, 12, 'quarterly')).toMatchObject({
      startMonth1: 10,
      endMonth1: 12,
    });
  });
  it('maps a month to itself when monthly, and the year when annual', () => {
    expect(periodContaining(2026, 7, 'monthly')).toMatchObject({ startMonth1: 7, endMonth1: 7 });
    expect(periodContaining(2026, 7, 'annual')).toMatchObject({ startMonth1: 1, endMonth1: 12 });
  });
});

describe('periodLabel', () => {
  it('labels quarters / months / years', () => {
    expect(periodLabel(periodContaining(2026, 5, 'quarterly'), 'quarterly')).toBe(
      'Q2 2026 (Apr–Jun)'
    );
    expect(periodLabel(periodContaining(2026, 6, 'monthly'), 'monthly')).toBe('Jun 2026');
    expect(periodLabel(periodContaining(2026, 6, 'annual'), 'annual')).toBe('FY 2026');
  });
});

describe('dueDateFor — CDTFA quarterly cadence (clamped day)', () => {
  it('Q1 (Jan–Mar) is due Apr 30 (day 31 clamps to 30)', () => {
    const q1 = periodContaining(2026, 2, 'quarterly');
    expect(dueDateFor(q1, 31, 1)).toBe('2026-04-30');
  });
  it('Q2 (Apr–Jun) is due Jul 31', () => {
    const q2 = periodContaining(2026, 5, 'quarterly');
    expect(dueDateFor(q2, 31, 1)).toBe('2026-07-31');
  });
  it('Q3 (Jul–Sep) is due Oct 31', () => {
    const q3 = periodContaining(2026, 8, 'quarterly');
    expect(dueDateFor(q3, 31, 1)).toBe('2026-10-31');
  });
  it('Q4 (Oct–Dec) is due Jan 31 of the NEXT year', () => {
    const q4 = periodContaining(2026, 11, 'quarterly');
    expect(dueDateFor(q4, 31, 1)).toBe('2027-01-31');
  });
});

describe('computeAgencyCalendar — CDTFA from "as of"', () => {
  it('surfaces the just-passed Q and the upcoming quarters, oldest due first', () => {
    // As of 2026-06-01: Q1 (due 2026-04-30) is past due; current period Q2 due 2026-07-31.
    const entries = computeAgencyCalendar(CDTFA_RULE, 'cdtfa', 'CDTFA', {
      asOf: '2026-06-01',
      upcoming: 3,
    });
    const dueDates = entries.map((e) => e.dueDate);
    expect(dueDates).toEqual([
      '2026-04-30', // Q1 (past due)
      '2026-07-31', // Q2
      '2026-10-31', // Q3
      '2027-01-31', // Q4
    ]);

    const past = entries[0];
    expect(past.overdue).toBe(true);
    expect(past.periodLabel).toBe('Q1 2026 (Jan–Mar)');
    expect(past.daysUntilDue).toBe(daysBetween('2026-06-01', '2026-04-30')); // negative
    expect(past.daysUntilDue).toBeLessThan(0);

    const q2 = entries[1];
    expect(q2.overdue).toBe(false);
    expect(q2.periodStart).toBe('2026-04-01');
    expect(q2.periodEnd).toBe('2026-06-30');
    expect(q2.daysUntilDue).toBe(daysBetween('2026-06-01', '2026-07-31')); // 60
    expect(q2.notes).toBe(CDTFA_RULE.notes);
  });

  it('treats a due date EQUAL to "as of" as already due (overdue=false on the boundary)', () => {
    // As of exactly the Q1 due date.
    const entries = computeAgencyCalendar(CDTFA_RULE, 'cdtfa', 'CDTFA', {
      asOf: '2026-04-30',
      upcoming: 1,
    });
    const onDue = entries.find((e) => e.dueDate === '2026-04-30');
    expect(onDue).toBeDefined();
    // due === asOf → not strictly before → not "overdue", and it is the past-due slot.
    expect(onDue?.overdue).toBe(false);
    expect(onDue?.daysUntilDue).toBe(0);
  });

  it('honors includePastDue=false (upcoming only)', () => {
    const entries = computeAgencyCalendar(CDTFA_RULE, 'cdtfa', 'CDTFA', {
      asOf: '2026-06-01',
      upcoming: 2,
      includePastDue: false,
    });
    expect(entries.every((e) => e.dueDate > '2026-06-01')).toBe(true);
    expect(entries.map((e) => e.dueDate)).toEqual(['2026-07-31', '2026-10-31']);
  });

  it('returns [] for an unparseable asOf', () => {
    expect(computeAgencyCalendar(CDTFA_RULE, 'cdtfa', 'CDTFA', { asOf: 'not-a-date' })).toEqual([]);
  });
});

describe('computeAgencyCalendar — monthly + annual cadences', () => {
  it('monthly: due the offset month, oldest first', () => {
    const monthly: TaxFilingRule = {
      ...CDTFA_RULE,
      frequency: 'monthly',
      dueDay: 20,
      dueMonthOffset: 1,
    };
    const entries = computeAgencyCalendar(monthly, 'm', 'Monthly Agency', {
      asOf: '2026-06-15',
      upcoming: 2,
    });
    // May period due Jun 20 (upcoming), current Jun period due Jul 20; past-due = Apr period due May 20.
    expect(entries.map((e) => e.dueDate)).toEqual(['2026-05-20', '2026-06-20', '2026-07-20']);
    expect(entries[0].frequency).toBe('monthly');
  });

  it('annual: one return per year due the following period', () => {
    const annual: TaxFilingRule = {
      ...CDTFA_RULE,
      frequency: 'annual',
      dueDay: 15,
      dueMonthOffset: 1,
    };
    const entries = computeAgencyCalendar(annual, 'y', 'Annual Agency', {
      asOf: '2026-06-01',
      upcoming: 1,
    });
    // FY2026 (Jan–Dec) due 2027-01-15; past-due FY2025 due 2026-01-15.
    expect(entries.map((e) => e.dueDate)).toEqual(['2026-01-15', '2027-01-15']);
  });
});

describe('normalizeFrequency / fallbackRuleFor', () => {
  it('defaults unknown frequency to quarterly', () => {
    expect(normalizeFrequency('weekly')).toBe('quarterly');
    expect(normalizeFrequency(null)).toBe('quarterly');
    expect(normalizeFrequency('monthly')).toBe('monthly');
    expect(normalizeFrequency('annual')).toBe('annual');
  });

  it('builds a representative fallback rule from an agency frequency', () => {
    const rule = fallbackRuleFor({ name: 'Some Agency', filingFrequency: 'monthly' });
    expect(rule).toMatchObject({
      agency: 'Some Agency',
      frequency: 'monthly',
      periodBasis: 'calendar',
      dueDay: 31,
      dueMonthOffset: 1,
    });
    expect(rule.notes).toContain('Representative');
  });

  it('fallback for a null frequency is quarterly', () => {
    expect(fallbackRuleFor({ name: 'X', filingFrequency: null }).frequency).toBe('quarterly');
  });
});

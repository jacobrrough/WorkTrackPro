/**
 * Pure date math for the C1 read-only TAX CALENDAR dashboard. Given a per-agency
 * filing rule (parsed from the `tax_filing_calendar` settings row, or a frequency-only
 * fallback) and an "as of" date, it computes the surrounding filing periods and their
 * due dates — the most recent past-due return plus the next few upcoming ones.
 *
 * This is REPORTING ONLY: it delivers NO notifications and moves no money. It just
 * derives concrete deadlines so the dashboard can list them.
 *
 * Kept free of React/Supabase for trivial unit-testing (see taxCalendarMath.test.ts).
 *
 * DATES: we build periods/due dates with `Date.UTC` and read them back with the UTC
 * getters, so the math never picks up the runtime's local timezone (which could shift
 * a boundary across midnight). ISO `YYYY-MM-DD` strings are compared lexicographically
 * where possible (equivalent to chronological for zero-padded dates), matching
 * periodLock.ts. The representative CDTFA cadence: a calendar quarter's return/payment
 * is due `due_month_offset` months after period-end, on `due_day` (clamped to the
 * month length) — e.g. Q1 (Jan–Mar) → Apr 30, with due_day 31 clamping to 30.
 */
import { toIsoDate } from '../periodLock';
import type { TaxAgency, TaxCalendarEntry, TaxFilingFrequency, TaxFilingRule } from '../types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** Number of months in one filing period for a frequency. */
function periodMonths(freq: TaxFilingFrequency): number {
  switch (freq) {
    case 'monthly':
      return 1;
    case 'quarterly':
      return 3;
    case 'annual':
      return 12;
  }
}

/** Days in a given (1-based) month of a year, via the UTC day-0-of-next-month trick. */
export function daysInMonth(year: number, month1: number): number {
  // month1 is 1..12; Date.UTC month is 0-based, day 0 = last day of previous month.
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** Format a UTC y/m(1-based)/d triple as ISO `YYYY-MM-DD`. */
function iso(year: number, month1: number, day: number): string {
  const mm = String(month1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/** Whole-day difference (b − a) between two ISO dates, computed in UTC. */
export function daysBetween(aIso: string, bIso: string): number {
  const a = Date.parse(`${aIso}T00:00:00Z`);
  const b = Date.parse(`${bIso}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / MS_PER_DAY);
}

/** A calendar filing period: its 0-based start month index from year 0, for stepping. */
interface Period {
  /** Inclusive start year. */
  startYear: number;
  /** Inclusive start month, 1-based. */
  startMonth1: number;
  /** Inclusive end year. */
  endYear: number;
  /** Inclusive end month, 1-based. */
  endMonth1: number;
}

/**
 * The calendar filing period of `freq` that CONTAINS the given (1-based) month, aligned
 * to the calendar year. Monthly → that month; quarterly → its calendar quarter; annual →
 * the whole year. Returned as inclusive start/end month boundaries.
 */
export function periodContaining(year: number, month1: number, freq: TaxFilingFrequency): Period {
  const span = periodMonths(freq);
  // 0-based index of the period start month within the calendar year.
  const startIndex0 = Math.floor((month1 - 1) / span) * span; // 0,3,6,9 for quarters
  const startMonth1 = startIndex0 + 1;
  const endMonth1 = startMonth1 + span - 1;
  return { startYear: year, startMonth1, endYear: year, endMonth1 };
}

/** Step a period forward by `n` whole periods (n may be negative), staying calendar-aligned. */
function shiftPeriod(p: Period, n: number, freq: TaxFilingFrequency): Period {
  const span = periodMonths(freq);
  // Absolute month index (0-based from year 0) of the start, then shift by n*span.
  const startAbs = p.startYear * 12 + (p.startMonth1 - 1) + n * span;
  const startYear = Math.floor(startAbs / 12);
  const startMonth1 = (startAbs % 12) + 1;
  const endAbs = startAbs + span - 1;
  const endYear = Math.floor(endAbs / 12);
  const endMonth1 = (endAbs % 12) + 1;
  return { startYear, startMonth1, endYear, endMonth1 };
}

/** Human label for a period, e.g. "Q2 2026 (Apr–Jun)", "Jun 2026", "FY 2026". */
export function periodLabel(p: Period, freq: TaxFilingFrequency): string {
  const startAbbr = MONTH_ABBR[p.startMonth1 - 1];
  const endAbbr = MONTH_ABBR[p.endMonth1 - 1];
  if (freq === 'monthly') {
    return `${startAbbr} ${p.startYear}`;
  }
  if (freq === 'annual') {
    return `FY ${p.startYear}`;
  }
  // quarterly: which calendar quarter (1..4). Calendar quarters never straddle a
  // year boundary, so the start year labels the quarter.
  const q = Math.floor((p.startMonth1 - 1) / 3) + 1;
  return `Q${q} ${p.startYear} (${startAbbr}–${endAbbr})`;
}

/** The due date `YYYY-MM-DD` for a period under a rule (offset months after period-end, clamped day). */
export function dueDateFor(p: Period, dueDay: number, dueMonthOffset: number): string {
  // Anchor: the period-end month, plus the offset, lands the due month.
  const endAbs = p.endYear * 12 + (p.endMonth1 - 1) + Math.max(0, Math.trunc(dueMonthOffset));
  const dueYear = Math.floor(endAbs / 12);
  const dueMonth1 = (endAbs % 12) + 1;
  const maxDay = daysInMonth(dueYear, dueMonth1);
  const day = Math.min(Math.max(1, Math.trunc(dueDay)), maxDay);
  return iso(dueYear, dueMonth1, day);
}

/**
 * Normalize a frequency-ish value to a TaxFilingFrequency, defaulting to 'quarterly'
 * (the seeded CDTFA cadence). Exported for the mapper/service to share one definition.
 */
export function normalizeFrequency(v: unknown): TaxFilingFrequency {
  return v === 'monthly' || v === 'annual' ? v : 'quarterly';
}

export interface CalendarComputeOptions {
  /** "as of" date `YYYY-MM-DD` (defaults handled by the caller/service). */
  asOf: string;
  /** How many UPCOMING periods (including the current one) to list. Default 4. */
  upcoming?: number;
  /** Whether to include the single most-recent ALREADY-DUE period. Default true. */
  includePastDue?: boolean;
}

/**
 * Build the calendar entries for ONE agency from a filing rule, relative to "as of".
 * Returns entries oldest-due first (the optional past-due one, then upcoming ones).
 *
 * The current period is the one containing "as of". We then walk backward to find the
 * most recent period whose due date is already <= asOf (surfacing an overdue/just-due
 * return), and forward to list the next `upcoming` due dates from "as of".
 */
export function computeAgencyCalendar(
  rule: TaxFilingRule,
  agencyId: string | null,
  agencyName: string,
  options: CalendarComputeOptions
): TaxCalendarEntry[] {
  const asOf = toIsoDate(options.asOf);
  if (!asOf) return [];
  const upcoming = Math.max(1, Math.trunc(options.upcoming ?? 4));
  const includePastDue = options.includePastDue !== false;
  const freq = normalizeFrequency(rule.frequency);

  const asOfYear = Number(asOf.slice(0, 4));
  const asOfMonth1 = Number(asOf.slice(5, 7));

  const makeEntry = (p: Period): TaxCalendarEntry => {
    const dueDate = dueDateFor(p, rule.dueDay, rule.dueMonthOffset);
    const days = daysBetween(asOf, dueDate);
    return {
      agencyId,
      agencyName,
      frequency: freq,
      periodLabel: periodLabel(p, freq),
      periodStart: iso(p.startYear, p.startMonth1, 1),
      periodEnd: iso(p.endYear, p.endMonth1, daysInMonth(p.endYear, p.endMonth1)),
      dueDate,
      daysUntilDue: days,
      overdue: dueDate < asOf,
      notes: rule.notes,
    };
  };

  const current = periodContaining(asOfYear, asOfMonth1, freq);
  const entries: TaxCalendarEntry[] = [];

  // 1. Most-recent already-due period (scan back a bounded number of steps).
  if (includePastDue) {
    for (let back = 0; back <= 8; back++) {
      const p = shiftPeriod(current, -back, freq);
      const due = dueDateFor(p, rule.dueDay, rule.dueMonthOffset);
      if (due <= asOf) {
        entries.push(makeEntry(p));
        break;
      }
    }
  }

  // 2. Upcoming due dates: collect periods whose due date is strictly after "as of",
  //    until we have `upcoming` of them. We must START a few periods BEHIND the current
  //    one: because the due date lands `dueMonthOffset` months AFTER period-end, a recent
  //    (already-ended) period can still be not-yet-due (e.g. monthly, as-of Jun 15: the
  //    May period is due Jun 20 — in the future — yet its period precedes "current"
  //    June). Starting at -(dueMonthOffset + 1) guarantees we never skip such a period.
  const startBack = Math.max(0, Math.trunc(rule.dueMonthOffset)) + 1;
  const seenKeys = new Set(entries.map((e) => `${e.periodStart}|${e.dueDate}`));
  let collected = 0;
  for (let step = -startBack; step <= 64 && collected < upcoming; step++) {
    const p = shiftPeriod(current, step, freq);
    const due = dueDateFor(p, rule.dueDay, rule.dueMonthOffset);
    if (due > asOf) {
      const key = `${iso(p.startYear, p.startMonth1, 1)}|${due}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        entries.push(makeEntry(p));
      }
      collected++;
    }
  }

  // Oldest due date first.
  return entries.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
}

/** A frequency-only fallback rule for an agency that has no config row. */
export function fallbackRuleFor(
  agency: Pick<TaxAgency, 'name' | 'filingFrequency'>
): TaxFilingRule {
  const freq = normalizeFrequency(agency.filingFrequency);
  return {
    agency: agency.name,
    frequency: freq,
    periodBasis: 'calendar',
    // Representative CDTFA-style cadence: due the last day of the month after period-end.
    dueDay: 31,
    dueMonthOffset: 1,
    notes:
      'Representative cadence derived from the agency’s filing frequency. No calendar config on file — verify exact due dates with the agency.',
  };
}

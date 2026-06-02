/**
 * Pure schedule math for recurring transaction templates (B2).
 *
 * These helpers compute when a template is "due" and what its next run date is after
 * a generation, with NO React/Supabase dependency so the date logic is trivially
 * unit-testable (see recurrence.test.ts). They never move money — the recurring
 * service uses them only to advance a template's `next_run_date` cursor; all money
 * still posts through accounting.post_journal_entry.
 *
 * DATE MODEL: the DB columns are Postgres `date` (no time/zone). We treat every date
 * as an ISO `YYYY-MM-DD` string and do all arithmetic in UTC so it never drifts by a
 * day across the user's local timezone. We never construct a Date from the local
 * clock for schedule math.
 */
import type { RecurringFrequency } from './types';

/** Parse an ISO `YYYY-MM-DD` (date-only) into a UTC Date at midnight. */
export function parseISODate(iso: string): Date {
  // `new Date('YYYY-MM-DD')` is parsed as UTC midnight by spec, but we build it
  // explicitly from parts to be robust to longer strings and bad input.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return new Date(NaN);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/** Format a UTC Date back to an ISO `YYYY-MM-DD` (date-only) string. */
export function toISODate(d: Date): string {
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

/** Today's date as an ISO `YYYY-MM-DD` in UTC (the default "as of" for due checks). */
export function todayISO(now: Date = new Date()): string {
  return toISODate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())));
}

/** Number of days in a given UTC month (month is 0-based). */
function daysInMonth(year: number, month0: number): number {
  // Day 0 of the next month is the last day of this month.
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/**
 * Add `count` whole months to a UTC date, clamping the day to the target month's
 * length (so 2026-01-31 + 1 month → 2026-02-28, never spilling into March). When a
 * `dayOfMonth` anchor is supplied it overrides the source day (also clamped), which
 * is how monthly/quarterly/yearly schedules pin to e.g. "the 1st".
 */
function addMonthsClamped(d: Date, count: number, dayOfMonth?: number | null): Date {
  const year = d.getUTCFullYear();
  const month0 = d.getUTCMonth();
  const targetMonthIndex = month0 + count;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth0 = ((targetMonthIndex % 12) + 12) % 12;
  const dim = daysInMonth(targetYear, targetMonth0);
  const desiredDay = dayOfMonth != null ? dayOfMonth : d.getUTCDate();
  const day = Math.min(Math.max(desiredDay, 1), dim);
  return new Date(Date.UTC(targetYear, targetMonth0, day));
}

/** Months advanced per step for the calendar frequencies. */
const MONTHS_PER_STEP: Record<'monthly' | 'quarterly' | 'yearly', number> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};

/**
 * Advance one ISO date by a single schedule step.
 *   daily   → +1 * intervalCount days
 *   weekly  → +7 * intervalCount days
 *   monthly → +1 * intervalCount months (day clamped / pinned to dayOfMonth)
 *   quarterly → +3 * intervalCount months
 *   yearly  → +12 * intervalCount months
 * `intervalCount` < 1 is treated as 1. Returns an ISO `YYYY-MM-DD`.
 */
export function addInterval(
  fromISO: string,
  frequency: RecurringFrequency,
  intervalCount = 1,
  dayOfMonth?: number | null
): string {
  const step = Number.isFinite(intervalCount) && intervalCount >= 1 ? Math.floor(intervalCount) : 1;
  const from = parseISODate(fromISO);
  if (Number.isNaN(from.getTime())) return fromISO;

  if (frequency === 'daily' || frequency === 'weekly') {
    const days = (frequency === 'weekly' ? 7 : 1) * step;
    const next = new Date(from.getTime());
    next.setUTCDate(next.getUTCDate() + days);
    return toISODate(next);
  }

  const months = MONTHS_PER_STEP[frequency] * step;
  return toISODate(addMonthsClamped(from, months, dayOfMonth));
}

/** Inclusive ISO date comparison: is `a` <= `b`? (NaN-safe → false). */
export function isOnOrBefore(aISO: string, bISO: string): boolean {
  const a = parseISODate(aISO).getTime();
  const b = parseISODate(bISO).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return a <= b;
}

/** Inclusive ISO date comparison: is `a` >= `b`? (NaN-safe → false). */
export function isOnOrAfter(aISO: string, bISO: string): boolean {
  const a = parseISODate(aISO).getTime();
  const b = parseISODate(bISO).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return a >= b;
}

/** The minimal schedule shape the due/advance helpers read off a template. */
export interface Schedule {
  frequency: RecurringFrequency;
  intervalCount: number;
  startDate: string;
  endDate?: string | null;
  nextRunDate: string;
  dayOfMonth?: number | null;
  active?: boolean;
}

/**
 * Is a template due to generate as of `asOf` (default today)? True when it is active,
 * its next_run_date is on/before the as-of date, and it has not passed its end_date.
 */
export function isDue(schedule: Schedule, asOf: string = todayISO()): boolean {
  if (schedule.active === false) return false;
  if (!isOnOrBefore(schedule.nextRunDate, asOf)) return false;
  if (schedule.endDate && !isOnOrBefore(schedule.nextRunDate, schedule.endDate)) return false;
  return true;
}

/**
 * The next run date strictly after the current cursor, for one generation. Always a
 * single step from the current `nextRunDate` (occurrences are not "caught up" in a
 * burst — each generate advances exactly one period, which keeps a paused template
 * from firing a backlog all at once). Returns the ISO date.
 */
export function nextRunDate(schedule: Schedule): string {
  return addInterval(
    schedule.nextRunDate,
    schedule.frequency,
    schedule.intervalCount,
    schedule.dayOfMonth
  );
}

/** The result of advancing a schedule by one generation. */
export interface AdvancedSchedule {
  /** The date that was just generated (the prior cursor). */
  ranDate: string;
  /** The new next_run_date, or null when the template has reached its end. */
  nextRunDate: string | null;
  /** True when the advanced next-run would exceed end_date → template should deactivate. */
  ended: boolean;
}

/**
 * Advance a schedule by one generation: the current cursor becomes `ranDate`, and the
 * new `nextRunDate` is one step later — unless that step would pass `endDate`, in which
 * case the template has ended (nextRunDate=null, ended=true) and the caller deactivates
 * it. Pure: it computes the new cursor; persistence is the service's job.
 */
export function advanceSchedule(schedule: Schedule): AdvancedSchedule {
  const ranDate = schedule.nextRunDate;
  const candidate = nextRunDate(schedule);
  const ended = !!schedule.endDate && !isOnOrBefore(candidate, schedule.endDate);
  return {
    ranDate,
    nextRunDate: ended ? null : candidate,
    ended,
  };
}

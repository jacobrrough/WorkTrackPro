/**
 * ⚠️  HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING. Pure hours-derivation for the FLAG-DARK
 *     payroll module. Given a set of public.shifts rows (READ-ONLY timekeeping; payroll NEVER
 *     writes shifts), this derives the regular + overtime hours that feed a paycheck, in
 *     HUNDREDTHS OF AN HOUR ("hour-cents": 1.5h = 150) so partial hours stay integer and the
 *     downstream cents math never sees a float.
 *
 * WHAT A HUMAN MUST VERIFY (this OT model is a STARTING POINT, not legally-complete):
 *   • CALIFORNIA OVERTIME is more complex than the simple weekly-40 rule applied here. CA Labor
 *     Code §510 requires DAILY overtime: 1.5× for hours over 8 in a workday (and over 40 in a
 *     workweek), 2× for hours over 12 in a day, plus 7th-consecutive-day rules. This module
 *     implements ONLY weekly-over-40 OT by default and exposes a `dailyOtThresholdHours` hook;
 *     the full CA daily/double-time/7th-day computation is DEFERRED and on the verify list.
 *   • LUNCH/BREAK deduction: unpaid meal periods are subtracted using the shift's
 *     lunch_start_time/lunch_end_time when present. Whether a given org's breaks are paid/unpaid,
 *     and the meal-period premium for missed breaks, must be verified against the org's policy.
 *   • Rounding: each shift's worked minutes are converted to hour-cents with round-half-up; the
 *     org's timekeeping rounding rule must be confirmed.
 *
 * MONEY/HOURS MATH (G6): hours are integer HUNDREDTHS-OF-AN-HOUR; gross pay (computed by the
 * caller) is integer cents. No floating-point dollar/hour amount is persisted.
 *
 * No I/O, no React, no Supabase — trivially unit-testable (see payrollHours.test.ts). The service
 * fetches the shift rows (read-only) and calls this; the result feeds the gross-pay computation.
 */

/** A minimal read-only view of a public.shifts row (only the columns the engine needs). */
export interface ShiftRecord {
  id: string;
  /** ISO timestamp the shift clocked in (public.shifts.clock_in_time). */
  clockInTime: string | null;
  /** ISO timestamp the shift clocked out; null = still open (skipped — no payable hours yet). */
  clockOutTime: string | null;
  /** ISO timestamp the unpaid lunch started (public.shifts.lunch_start_time); null = none. */
  lunchStartTime?: string | null;
  /** ISO timestamp the unpaid lunch ended (public.shifts.lunch_end_time); null = none. */
  lunchEndTime?: string | null;
}

/** Hundredths-of-an-hour conversion: minutes → hour-cents (round half up). */
export function minutesToHourCents(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return Math.round((minutes / 60) * 100);
}

/** Hour-cents → minutes (for the OT split math; exact since hour-cents are integers). */
function hourCentsToMinutes(hourCents: number): number {
  return (hourCents / 100) * 60;
}

/**
 * Worked minutes for ONE shift: (clock_out − clock_in) minus the unpaid lunch window, floored at
 * 0. An open shift (no clock_out) or an unparseable timestamp yields 0 (not payable yet). The
 * lunch deduction applies only when BOTH lunch timestamps are present and well-ordered.
 */
export function shiftWorkedMinutes(shift: ShiftRecord): number {
  if (!shift.clockInTime || !shift.clockOutTime) return 0;
  const inMs = Date.parse(shift.clockInTime);
  const outMs = Date.parse(shift.clockOutTime);
  if (Number.isNaN(inMs) || Number.isNaN(outMs) || outMs <= inMs) return 0;
  let minutes = (outMs - inMs) / 60000;

  if (shift.lunchStartTime && shift.lunchEndTime) {
    const lsMs = Date.parse(shift.lunchStartTime);
    const leMs = Date.parse(shift.lunchEndTime);
    if (!Number.isNaN(lsMs) && !Number.isNaN(leMs) && leMs > lsMs) {
      minutes -= (leMs - lsMs) / 60000;
    }
  }
  return Math.max(0, minutes);
}

/** The regular + overtime hour-cents derived from a set of shifts for one employee for one period. */
export interface DerivedHours {
  /** Total worked hour-cents across all shifts (regular + overtime). */
  totalHourCents: number;
  /** Hour-cents paid at the regular rate. */
  regularHourCents: number;
  /** Hour-cents paid at the overtime rate (default: weekly hours over 40). */
  overtimeHourCents: number;
  /** The shift ids that contributed (provenance for paychecks.source_shift_ids). */
  sourceShiftIds: string[];
  /** Surfaced warnings (e.g. open shifts skipped) for the UI. */
  warnings: string[];
}

/** Options for the hours derivation. */
export interface DeriveHoursOptions {
  /**
   * Weekly hours over which time is overtime (default 40, the FLSA weekly rule). The whole
   * period's hours are treated as one weekly bucket in this simplified model — for multi-week
   * periods the caller should pass shifts a week at a time, or accept the approximation (on the
   * verify list).
   */
  weeklyOtThresholdHours?: number;
  /**
   * Optional DAILY overtime threshold (e.g. 8 for California). When set, hours over this many in
   * a SINGLE shift are counted as overtime BEFORE the weekly rule is applied. DEFERRED/partial —
   * the full CA daily + double-time + 7th-day rules are NOT implemented (see header). Leave unset
   * to use the weekly-only model.
   */
  dailyOtThresholdHours?: number | null;
}

/** Default OT thresholds (FLSA weekly 40; no daily OT unless the caller opts in). */
export const DEFAULT_WEEKLY_OT_THRESHOLD_HOURS = 40;

/**
 * Derive regular + overtime hour-cents from an employee's shifts for a pay period.
 *
 * Model (SIMPLE — see header for the CA caveat):
 *   1. Sum each shift's worked hour-cents (lunch deducted). Open/invalid shifts contribute 0 and
 *      are reported as warnings.
 *   2. If `dailyOtThresholdHours` is set, split each shift into daily-regular vs daily-OT first.
 *   3. Apply the weekly threshold to the remaining (daily-regular) hours: hours over the weekly
 *      threshold become overtime.
 * Hour-cents are integers, so the splits are exact; the final regular + overtime always sum to
 * the total worked hour-cents.
 */
export function deriveHoursFromShifts(
  shifts: ShiftRecord[],
  options: DeriveHoursOptions = {}
): DerivedHours {
  const weeklyThresholdHourCents = Math.round(
    (options.weeklyOtThresholdHours ?? DEFAULT_WEEKLY_OT_THRESHOLD_HOURS) * 100
  );
  const dailyThresholdHourCents =
    options.dailyOtThresholdHours != null && options.dailyOtThresholdHours > 0
      ? Math.round(options.dailyOtThresholdHours * 100)
      : null;

  const warnings: string[] = [];
  const sourceShiftIds: string[] = [];

  let totalHourCents = 0;
  let dailyOtHourCents = 0;
  let dailyRegularHourCents = 0;

  for (const shift of shifts) {
    const minutes = shiftWorkedMinutes(shift);
    if (minutes <= 0) {
      if (!shift.clockOutTime) {
        warnings.push(`Shift ${shift.id.slice(0, 8)} is still open (no clock-out) — skipped.`);
      }
      continue;
    }
    const hourCents = minutesToHourCents(minutes);
    totalHourCents += hourCents;
    sourceShiftIds.push(shift.id);

    if (dailyThresholdHourCents != null) {
      const ot = Math.max(0, hourCents - dailyThresholdHourCents);
      dailyOtHourCents += ot;
      dailyRegularHourCents += hourCents - ot;
    } else {
      dailyRegularHourCents += hourCents;
    }
  }

  // Apply the weekly rule to the (daily-)regular hours: anything over the weekly threshold is OT.
  const weeklyOtHourCents = Math.max(0, dailyRegularHourCents - weeklyThresholdHourCents);
  const regularHourCents = dailyRegularHourCents - weeklyOtHourCents;
  const overtimeHourCents = dailyOtHourCents + weeklyOtHourCents;

  return {
    totalHourCents,
    regularHourCents,
    overtimeHourCents,
    sourceShiftIds,
    warnings,
  };
}

/**
 * Gross pay (in CENTS) for an HOURLY employee from derived hour-cents and an hourly rate (in
 * cents/hour), applying the overtime multiplier (default 1.5×). All integer math:
 *   regular cents = round(regularHourCents/100 * rateCents/hour)
 *   overtime cents = round(overtimeHourCents/100 * rateCents/hour * multiplier)
 * The minutes round-trip is exact (hour-cents are integers); the final multiply rounds half up.
 */
export function hourlyGrossCents(
  hours: Pick<DerivedHours, 'regularHourCents' | 'overtimeHourCents'>,
  rateCentsPerHour: number,
  overtimeMultiplier = 1.5
): number {
  const rate = Math.max(0, rateCentsPerHour);
  const regHours = hours.regularHourCents / 100;
  const otHours = hours.overtimeHourCents / 100;
  const regular = Math.round(regHours * rate);
  const overtime = Math.round(otHours * rate * overtimeMultiplier);
  return Math.max(0, regular + overtime);
}

/**
 * Gross pay (in CENTS) for a SALARIED employee for ONE pay period: the annual salary (cents/year)
 * divided by the number of pay periods per year, rounded half up. Salaried pay is independent of
 * shift hours (hours are still recorded on the paycheck for the paystub, but do not change gross).
 */
export function salaryGrossCents(annualSalaryCents: number, payPeriodsPerYear: number): number {
  if (payPeriodsPerYear <= 0) return 0;
  return Math.max(0, Math.round(Math.max(0, annualSalaryCents) / payPeriodsPerYear));
}

/** Total worked hours as a human number (for display only — never used in cents math). */
export function hourCentsToHours(hourCents: number): number {
  return Math.round(hourCents) / 100;
}

// Re-export for callers that compose the minutes→hour-cents step directly.
export { hourCentsToMinutes };

/**
 * Pure straight-line depreciation math (D3). No React, no Supabase — trivially
 * unit-testable (see depreciation.test.ts).
 *
 * This is the JS analog of accounting.generate_depreciation_schedule. Given an asset's
 * cost, salvage value, useful life (in whole months) and in-service date, it produces one
 * planned period per month of service, splitting the DEPRECIABLE BASE (cost − salvage) in
 * INTEGER CENTS so no floating-point drift accrues (G6):
 *
 *   • base_cents = round(cost*100) − round(salvage*100)
 *   • per_cents  = floor(base_cents / life)        (integer division, both sides)
 *   • periods 1..N-1 each recognize per_cents
 *   • the FINAL period N absorbs the remainder: base_cents − per_cents*(N-1)
 *   ⇒ Σ amountCents = base_cents EXACTLY (penny-perfect over the asset's life).
 *
 * period_date(k) is the period-END of the k-th month of service (k = 1..N): the last day
 * of the in-service month at k=1 and of each subsequent month — matching the DB's
 *   (date_trunc('month', in_service_date) + k months − 1 day)::date.
 * Computed in UTC so the ISO calendar date never shifts across the local timezone.
 *
 * The DB is the source of truth for the actual postings; this helper exists so the UI can
 * preview an asset's full schedule and net-book-value curve, and so the schedule math is
 * covered by fast unit tests independent of a database round-trip.
 *
 * `declining_balance` is an accepted method but is NOT implemented here yet — like the DB
 * generator, callers fall back to the straight-line schedule for it (the action stays
 * total-correct rather than emitting nothing); a declining-balance generator can be added
 * later with no change elsewhere.
 */
import type { DepreciationPeriod } from './types';
import { toCents } from './accountingViewModel';

const centsToAmount = (cents: number): number => Math.round(cents) / 100;

/** Zero-pad a number to two digits (for ISO date assembly). */
const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Parse an ISO `YYYY-MM-DD` to its [year, month(1-12)] (defaults to epoch on garbage). */
function parseYearMonth(iso: string): { year: number; month: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return { year: 1970, month: 1 };
  return { year: Number(m[1]), month: Number(m[2]) };
}

/**
 * The period-END ISO date for the k-th month (1-based) of service starting in
 * (startYear, startMonth). Equivalent to the DB expression
 *   (date_trunc('month', in_service) + k months − 1 day)::date.
 * Implemented with a UTC Date set to day 0 of (startMonth + k), which lands on the last
 * day of the (startMonth + k − 1) month — so k=1 is the last day of the in-service month.
 */
export function periodEndDate(startYear: number, startMonth: number, k: number): string {
  // Day 0 of month (startMonth + k) === last day of month (startMonth + k − 1).
  // startMonth is 1-based; Date months are 0-based, so (startMonth - 1) + k gives the
  // 0-based month index whose day-0 is the desired period end.
  const d = new Date(Date.UTC(startYear, startMonth - 1 + k, 0));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export interface StraightLineParams {
  /** Acquisition cost in dollars (>= 0). */
  cost: number;
  /** Salvage value in dollars (0 <= salvage <= cost). */
  salvageValue: number;
  /** Depreciable life in whole months (> 0). */
  usefulLifeMonths: number;
  /** In-service date (ISO YYYY-MM-DD); periods run from the END of its month. */
  inServiceDate: string;
}

/**
 * Compute the full straight-line depreciation schedule for an asset. Returns one
 * DepreciationPeriod per month of useful life, in chronological order, with the rounding
 * remainder folded into the final period so Σ amountCents = depreciable base in cents.
 *
 * Returns an EMPTY array when there is nothing to depreciate — a non-positive life, or a
 * depreciable base of zero or less (salvage >= cost) — exactly as the DB generator writes
 * no rows in that case.
 */
export function computeStraightLineSchedule(params: StraightLineParams): DepreciationPeriod[] {
  const life = Math.trunc(params.usefulLifeMonths);
  if (!Number.isFinite(life) || life <= 0) return [];

  const baseCents = toCents(params.cost) - toCents(params.salvageValue);
  if (baseCents <= 0) return [];

  const perCents = Math.floor(baseCents / life); // integer division, matches the DB
  const { year, month } = parseYearMonth(params.inServiceDate);

  const periods: DepreciationPeriod[] = [];
  for (let k = 1; k <= life; k++) {
    const amountCents = k < life ? perCents : baseCents - perCents * (life - 1);
    periods.push({
      periodNumber: k,
      periodDate: periodEndDate(year, month, k),
      amountCents,
      amount: centsToAmount(amountCents),
    });
  }
  return periods;
}

/**
 * The depreciable base (cost − salvage) in integer cents, never negative. This is the
 * exact figure Σ of a straight-line schedule must equal.
 */
export function depreciableBaseCents(cost: number, salvageValue: number): number {
  const base = toCents(cost) - toCents(salvageValue);
  return base > 0 ? base : 0;
}

/**
 * Net book value in integer cents: cost − accumulated depreciation, FLOORED at salvage
 * (NBV never falls below salvage). `accumulatedCents` is the lifetime depreciation booked
 * so far, in cents. Mirrors the view's
 *   greatest(cost − accumulated_depreciation, salvage_value).
 */
export function netBookValueCents(cost: number, salvageValue: number, accumulatedCents: number): number {
  const costCents = toCents(cost);
  const salvageCents = toCents(salvageValue);
  const nbv = costCents - Math.max(0, Math.round(accumulatedCents));
  return Math.max(nbv, salvageCents);
}

/** Convenience: net book value in dollars (see netBookValueCents). */
export function netBookValue(cost: number, salvageValue: number, accumulatedDollars: number): number {
  return centsToAmount(netBookValueCents(cost, salvageValue, toCents(accumulatedDollars)));
}

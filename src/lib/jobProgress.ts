import type { Job, JobStatus } from '@/core/types';
import { getPlannedLaborHours } from '@/lib/laborSuggestion';
import { getMachineTotalsFromJob } from '@/lib/machineHours';
import { totalUnits, sumCounts } from '@/lib/cncDeduction';

// Immutable — do not mutate. Add new statuses here and they propagate to all logic below.
// Named LABOR_COMPLETE to distinguish from TERMINAL_STATUSES in jobWorkflow.ts (which is
// ['paid'] only). This set covers all statuses where labor is considered done for progress
// and scheduling purposes — including QC-predecessor statuses like 'finished'/'delivered'.
const LABOR_COMPLETE_STATUSES = new Set<JobStatus>([
  'finished',
  'delivered',
  'projectCompleted',
  'paid',
]);
// Typed as JobStatus so the compiler catches any future rename of this union value.
const QUALITY_CONTROL_STATUS: JobStatus = 'qualityControl';

/**
 * Minimum logged hours required before trusting the velocity projection.
 * Below this threshold, percentage estimates are applied proportionally against the plan.
 * Exported so tests and tooling can reference the threshold directly.
 */
export const MIN_VELOCITY_LOGGED_HOURS = 1.0;

/** Progress % shown for jobs in Quality Control — labor is done, QC review is in progress. Exported for tests. */
export const QUALITY_CONTROL_WEIGHTED_PERCENT = 80;

const clampPercent = (value: number) => Math.max(0, Math.min(100, value));

export interface JobCompletionProgress {
  laborPercent: number;
  cncPercent: number;
  /** Fraction of units whose CNC milestone is logged done (0–100). */
  cncUnitsPercent: number;
  /** Fraction of units logged fully done (0–100). */
  unitsDonePercent: number;
  /** 0–100. For terminal jobs, only 100 when 3D printing was actually planned (plannedPrinter3DHours > 0). */
  printer3DPercent: number;
  /** Production-only progress (labor + CNC + 3D), 0–100. */
  productionPercent: number;
  /** Display progress: production phase maps to 0–80%; QC phase fixes at 80%; terminal = 100%. */
  weightedPercent: number;
  plannedLaborHours: number;
  plannedCncHours: number;
  plannedPrinter3DHours: number;
  loggedLaborHours: number;
  /**
   * Remaining labor hours for adaptive scheduling.
   * Uses velocity projection when estimate + clocked data are reliable (≥ 1h logged + plan set).
   * When already over-plan, the plan cap is dropped so the job stays on the calendar.
   * Falls back to plan-minus-logged (no estimate), then 0 when no plan exists.
   */
  remainingLaborHours: number;
  /** True when planned labor hours exist and logged hours exceed the plan. */
  laborOverEstimate: boolean;
  /** True when user progress estimate implies total labor would exceed planned labor (at risk). */
  atRiskFromProgressEstimate: boolean;
}

export function computeJobCompletionProgress(
  job: Job,
  loggedLaborHours: number
): JobCompletionProgress {
  const machineTotals = getMachineTotalsFromJob(job);
  const rawPlannedFromJob = getPlannedLaborHours(job);
  // Guard against non-finite values (e.g., Infinity from a corrupt DB field) — treat as 0.
  const plannedFromJob = Number.isFinite(rawPlannedFromJob) ? rawPlannedFromJob : 0;
  // Guard against NaN (e.g., undefined coerced to number by a caller) — treat as 0.
  const logged = Math.max(0, Number.isFinite(loggedLaborHours) ? loggedLaborHours : 0);
  // When no estimate exists, fall back to logged hours so progress bars show 100% rather than 0/0.
  // Scheduling logic uses plannedFromJob directly to avoid self-referential comparisons.
  const plannedLaborHours = plannedFromJob > 0 ? plannedFromJob : logged;
  const plannedCncHours = Math.max(0, machineTotals.cncHours);
  const plannedPrinter3DHours = Math.max(0, machineTotals.printer3DHours);

  // isLaborDone: job is in a post-production status (LABOR_COMPLETE_STATUSES).
  // Distinct from isTerminalStatus() in jobWorkflow.ts which returns true only for 'paid'.
  const isLaborDone = LABOR_COMPLETE_STATUSES.has(job.status);
  const isQualityControl = job.status === QUALITY_CONTROL_STATUS;
  // Labor is fully complete in both labor-done and QC states; used in three places below.
  const isLaborComplete = isLaborDone || isQualityControl;

  const laborPercent = plannedLaborHours > 0 ? clampPercent((logged / plannedLaborHours) * 100) : 0;

  // Per-unit milestone progress. cncUnitsPercent uses all units as the denominator (the precise
  // CNC-able subset lives in the BOM, surfaced exactly in the CNC accordion); here it's a display
  // approximation that still moves the bar as units are logged.
  const unitTotal = totalUnits(job);
  const cncUnitsPercent =
    unitTotal > 0 ? clampPercent((sumCounts(job.cncDoneByVariant) / unitTotal) * 100) : 0;
  const unitsDonePercent =
    unitTotal > 0 ? clampPercent((sumCounts(job.unitsDoneByVariant) / unitTotal) * 100) : 0;
  // CNC is fractional now (no longer a terminal all-or-nothing flag). Keep honoring a legacy
  // cnc_completed_at stamp as 100 for jobs finished before per-unit tracking existed.
  const cncPercent = job.cncCompletedAt != null ? 100 : cncUnitsPercent;
  // Mark 3D done when explicitly completed, or when the job is fully paid (truly
  // terminal — any outstanding steps are assumed resolved). Scoped to 'paid' only
  // rather than all LABOR_COMPLETE_STATUSES: a job can reach 'finished'/'delivered'/
  // 'projectCompleted' without having run the 3D step, so auto-completing it there
  // would be a false positive that inflates productionPercent.
  const printer3DPercent =
    job.printer3DCompletedAt != null || (job.status === 'paid' && plannedPrinter3DHours > 0)
      ? 100
      : 0;

  const plannedTotal = plannedLaborHours + plannedCncHours + plannedPrinter3DHours;
  const productionPercent =
    plannedTotal > 0
      ? clampPercent(
          (laborPercent * plannedLaborHours +
            cncPercent * plannedCncHours +
            printer3DPercent * plannedPrinter3DHours) /
            plannedTotal
        )
      : 0;

  // Validate the user-supplied progress estimate once; reuse for both display and scheduling.
  const rawEstimate = job.progressEstimatePercent;
  // 0% is treated as "not set" (normalized to null) — in this shop context it means the field
  // hasn't been updated yet, not that literally 0% of work is done. Validation starts at >= 1,
  // so validatedEstimate !== null implies validatedEstimate >= 1 throughout this function.
  const validatedEstimate =
    rawEstimate != null && Number.isFinite(rawEstimate) && rawEstimate >= 1 && rawEstimate <= 100
      ? rawEstimate
      : null;

  // Display bar: production phase maps to 0–80%; QC phase fixes at 80%; terminal = 100%.
  // QC overrides any manual estimate — once in QC, labor is complete; the 80% signals review phase.
  // Manual estimate (validatedEstimate) is displayed as-is and is intentionally NOT mapped through
  // the 0–80% production curve — when set, it reflects the employee's direct confidence level.
  // When no plan exists (plannedFromJob === 0), show 0% rather than a misleading 80% that the
  // logged-hours fallback would produce — an unplanned job's progress is genuinely unknown.
  let weightedPercent: number;
  if (isLaborDone) {
    weightedPercent = 100;
  } else if (isQualityControl) {
    weightedPercent = QUALITY_CONTROL_WEIGHTED_PERCENT;
  } else {
    const base =
      validatedEstimate != null
        ? validatedEstimate
        : plannedFromJob > 0
          ? clampPercent(productionPercent * 0.8)
          : 0;
    // Per-unit completion lifts the bar too (production phase capped at 80%): marking units done
    // always moves progress forward even on jobs with no hour estimate. `max` never regresses.
    weightedPercent = Math.max(base, clampPercent(unitsDonePercent * 0.8));
  }

  // Remaining labor hours for adaptive scheduling.
  // Priority order:
  //   1. Terminal / QC / 100% estimate → 0 (labor phase is complete)
  //   2a. Velocity projection, under-plan (estimate + ≥ 1h clocked + plan exists + logged < plan)
  //       — capped at plan-minus-logged so an optimistic early estimate can't erase the schedule.
  //   2b. Velocity projection, overrun (logged ≥ plan) — no plan cap; trust burn-rate projection.
  //       Without this branch, overrun jobs silently drop from the calendar (cap → 0).
  //   3. Proportional against plan when estimate set but job barely started (< MIN_VELOCITY threshold)
  //   4. Plan minus logged (no estimate)
  //   5. No plan → 0 (can't schedule without a basis)
  let remainingLaborHours: number;
  if (isLaborComplete || (validatedEstimate !== null && validatedEstimate >= 100)) {
    // QC = labor complete; remaining capacity reserved for quality review, not production scheduling.
    remainingLaborHours = 0;
  } else if (
    validatedEstimate !== null &&
    logged >= MIN_VELOCITY_LOGGED_HOURS &&
    plannedFromJob > 0
  ) {
    // Velocity projection — shared computation for both under-plan and overrun cases.
    // Division is safe: validatedEstimate >= 1 (enforced above), so denominator >= 0.01.
    const velocityProjected = logged / (validatedEstimate / 100);
    if (logged < plannedFromJob) {
      // Under-plan: cap at plan-minus-logged so an optimistic early estimate can't
      // erase scheduled hours. Falls back to plan-minus-logged if projection is non-finite.
      remainingLaborHours = Number.isFinite(velocityProjected)
        ? Math.max(0, Math.min(velocityProjected - logged, plannedFromJob - logged))
        : Math.max(0, plannedFromJob - logged);
    } else {
      // Overrun: logged hours already exceed the plan. Drop the plan cap — it would
      // always resolve to ≤ 0 — and trust the burn-rate projection directly so the
      // job stays on the calendar until the employee marks it complete.
      remainingLaborHours = Number.isFinite(velocityProjected)
        ? Math.max(0, velocityProjected - logged)
        : 0;
    }
  } else if (validatedEstimate !== null && plannedFromJob > 0) {
    // Estimate set but less than MIN_VELOCITY_LOGGED_HOURS clocked: apply fraction to plan.
    remainingLaborHours = Math.max(0, plannedFromJob * (1 - validatedEstimate / 100));
  } else if (plannedFromJob > 0) {
    remainingLaborHours = Math.max(0, plannedFromJob - logged);
  } else {
    remainingLaborHours = 0;
  }

  const laborOverEstimate = plannedLaborHours > 0 && logged > plannedLaborHours;

  // At risk: velocity projection implies total labor will exceed the original plan.
  // Uses plannedFromJob (not the logged-hours fallback) so unestimated jobs are never false-positive.
  // logged >= plannedFromJob is already covered by laborOverEstimate; atRisk only applies while
  // labor is still in progress and velocity implies an overrun is coming.
  // Division safety: validatedEstimate >= 1 (enforced on line ~90), so denominator >= 0.01.
  // Requires MIN_VELOCITY_LOGGED_HOURS logged to align with the velocity branch in
  // remainingLaborHours — the badge and the hours formula must use the same threshold
  // so the "at risk" signal and the calendar schedule reflect the same data.
  const atRiskFromProgressEstimate =
    plannedFromJob > 0 &&
    logged >= MIN_VELOCITY_LOGGED_HOURS &&
    logged < plannedFromJob &&
    validatedEstimate !== null &&
    validatedEstimate < 100 &&
    !isLaborComplete &&
    logged / (validatedEstimate / 100) > plannedFromJob;

  return {
    laborPercent,
    cncPercent,
    cncUnitsPercent,
    unitsDonePercent,
    printer3DPercent,
    productionPercent,
    weightedPercent,
    plannedLaborHours,
    plannedCncHours,
    plannedPrinter3DHours,
    loggedLaborHours: logged,
    remainingLaborHours,
    laborOverEstimate,
    atRiskFromProgressEstimate,
  };
}

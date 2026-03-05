import type { Job } from '@/core/types';
import { getMachineTotalsFromJob } from '@/lib/machineHours';

const TERMINAL_STATUSES = new Set(['finished', 'delivered', 'projectCompleted', 'paid']);
const QUALITY_CONTROL_STATUS = 'qualityControl';

const clampPercent = (value: number) => Math.max(0, Math.min(100, value));

export interface JobCompletionProgress {
  laborPercent: number;
  cncPercent: number;
  printer3DPercent: number;
  /** Production-only progress (labor + CNC + 3D), 0–100. */
  productionPercent: number;
  /** Display progress: user estimate when set, else 80% from production, 20% for QC; QC = 80%, finished+ = 100%. */
  weightedPercent: number;
  plannedLaborHours: number;
  plannedCncHours: number;
  plannedPrinter3DHours: number;
  loggedLaborHours: number;
  /** True when estimated labor > 0 and clocked labor exceeds it. */
  laborOverEstimate: boolean;
  /** True when user progress estimate implies total labor would exceed planned labor (at risk). */
  atRiskFromProgressEstimate: boolean;
}

export function computeJobCompletionProgress(
  job: Job,
  loggedLaborHours: number
): JobCompletionProgress {
  const machineTotals = getMachineTotalsFromJob(job);
  const plannedLaborHours =
    typeof job.laborHours === 'number' && job.laborHours > 0
      ? job.laborHours
      : Math.max(0, loggedLaborHours);
  const plannedCncHours = Math.max(0, machineTotals.cncHours);
  const plannedPrinter3DHours = Math.max(0, machineTotals.printer3DHours);

  const laborPercent =
    plannedLaborHours > 0
      ? clampPercent((Math.max(0, loggedLaborHours) / plannedLaborHours) * 100)
      : 0;
  const cncPercent = job.cncCompletedAt ? 100 : 0;
  const printer3DPercent = TERMINAL_STATUSES.has(job.status) ? 100 : 0;

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

  // Bar: 80% production, 20% QC. In QC = 80%; finished+ = 100%.
  // When user has set progressEstimatePercent, use it for the bar (adjusts scheduling accuracy).
  let weightedPercent: number;
  if (TERMINAL_STATUSES.has(job.status)) {
    weightedPercent = 100;
  } else if (job.status === QUALITY_CONTROL_STATUS) {
    weightedPercent = 80;
  } else {
    const userEstimate =
      job.progressEstimatePercent != null &&
      Number.isFinite(job.progressEstimatePercent) &&
      job.progressEstimatePercent >= 0 &&
      job.progressEstimatePercent <= 100
        ? job.progressEstimatePercent
        : null;
    weightedPercent =
      userEstimate != null ? clampPercent(userEstimate) : clampPercent(productionPercent * 0.8);
  }

  const laborOverEstimate =
    plannedLaborHours > 0 && Math.max(0, loggedLaborHours) > plannedLaborHours;

  // At risk: user says X% complete but logged hours imply total labor would exceed planned (e.g. 40% done with 20h logged → 50h total vs 40h plan).
  const atRiskFromProgressEstimate =
    plannedLaborHours > 0 &&
    loggedLaborHours > 0 &&
    job.progressEstimatePercent != null &&
    job.progressEstimatePercent > 0 &&
    job.progressEstimatePercent < 100 &&
    !TERMINAL_STATUSES.has(job.status) &&
    Math.max(0, loggedLaborHours) / (job.progressEstimatePercent / 100) > plannedLaborHours;

  return {
    laborPercent,
    cncPercent,
    printer3DPercent,
    productionPercent,
    weightedPercent,
    plannedLaborHours,
    plannedCncHours,
    plannedPrinter3DHours,
    loggedLaborHours: Math.max(0, loggedLaborHours),
    laborOverEstimate,
    atRiskFromProgressEstimate,
  };
}

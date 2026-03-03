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
  /** Display progress: 80% from production, 20% for QC; QC = 80%, finished+ = 100%. */
  weightedPercent: number;
  plannedLaborHours: number;
  plannedCncHours: number;
  plannedPrinter3DHours: number;
  loggedLaborHours: number;
  /** True when estimated labor > 0 and clocked labor exceeds it. */
  laborOverEstimate: boolean;
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
  let weightedPercent: number;
  if (TERMINAL_STATUSES.has(job.status)) {
    weightedPercent = 100;
  } else if (job.status === QUALITY_CONTROL_STATUS) {
    weightedPercent = 80;
  } else {
    weightedPercent = clampPercent(productionPercent * 0.8);
  }

  const laborOverEstimate =
    plannedLaborHours > 0 && Math.max(0, loggedLaborHours) > plannedLaborHours;

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
  };
}

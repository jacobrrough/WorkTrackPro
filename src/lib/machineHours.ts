import type { Job } from '@/core/types';

export interface JobMachineTotals {
  cncHours: number;
  printer3DHours: number;
}

export function getMachineTotalsFromJob(job: Job): JobMachineTotals {
  const entries = Object.values(job.machineBreakdownByVariant ?? {});
  return entries.reduce(
    (acc, entry) => {
      acc.cncHours += Number(entry.cncHoursTotal) || 0;
      acc.printer3DHours += Number(entry.printer3DHoursTotal) || 0;
      return acc;
    },
    { cncHours: 0, printer3DHours: 0 }
  );
}

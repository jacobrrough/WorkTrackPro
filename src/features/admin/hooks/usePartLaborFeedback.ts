import { useMemo } from 'react';
import type { Job, Part, Shift } from '@/core/types';
import { totalFromDashQuantities } from '@/lib/formatJob';
import { variantLaborFromSetComposition } from '@/lib/partDistribution';
import { calculateJobHoursFromShifts } from '@/lib/laborSuggestion';

function normalizeSuffix(suffix: string): string {
  return suffix.replace(/^-/, '');
}

function parseJobSetCount(job: Job): number {
  const dashTotal = totalFromDashQuantities(job.dashQuantities);
  if (dashTotal > 0) return dashTotal;
  const qty = parseFloat((job.qty ?? '').trim());
  return Number.isFinite(qty) && qty > 0 ? qty : 0;
}

function resolveActualHours(job: Job, shifts: Shift[]): number {
  const shiftHours = calculateJobHoursFromShifts(job.id, shifts);
  if (shiftHours > 0) return shiftHours;
  if (job.laborHours && job.laborHours > 0) return job.laborHours;
  return 0;
}

export function usePartJobs(part: Part | null, allJobs: Job[]): Job[] {
  return useMemo(() => {
    if (!part) return [];
    const matched = allJobs.filter((j) => {
      if (j.partId && j.partId === part.id) return true;
      if (
        j.partNumber &&
        (j.partNumber === part.partNumber ||
          j.partNumber.replace(/-\d{2}$/, '') === part.partNumber)
      ) {
        return true;
      }
      if (part.id.toString().startsWith('job-') && j.name?.trim().startsWith(part.partNumber)) {
        return true;
      }
      return false;
    });

    const unique = new Map<string, Job>();
    for (const job of matched) {
      const key = job.id || `${job.jobCode}-${job.partNumber ?? ''}-${job.name ?? ''}`;
      if (!unique.has(key)) unique.set(key, job);
    }
    return Array.from(unique.values());
  }, [allJobs, part]);
}

export function usePartLaborFeedback(part: Part | null, partJobs: Job[], shifts: Shift[]) {
  return useMemo(() => {
    const completedStatuses = new Set(['finished', 'delivered', 'projectCompleted', 'paid']);
    const completedJobs = partJobs.filter((job) => completedStatuses.has(job.status));
    const estimatePerSet = part?.laborHours;

    const jobRows = completedJobs
      .map((job) => {
        const actualHours = resolveActualHours(job, shifts);
        const setCount = parseJobSetCount(job);
        if (actualHours <= 0 || setCount <= 0) return null;
        const estimatedTotalHours = estimatePerSet != null ? estimatePerSet * setCount : undefined;
        return {
          jobId: job.id,
          jobCode: job.jobCode,
          actualHours,
          setCount,
          actualPerSet: actualHours / setCount,
          estimatedTotalHours,
          varianceHours:
            estimatedTotalHours != null ? actualHours - estimatedTotalHours : undefined,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row != null);

    const totalActualHours = jobRows.reduce((sum, row) => sum + row.actualHours, 0);
    const totalSets = jobRows.reduce((sum, row) => sum + row.setCount, 0);
    const averageActualPerSet = totalSets > 0 ? totalActualHours / totalSets : undefined;

    const variantStats = new Map<string, { hours: number; units: number }>();
    for (const job of completedJobs) {
      const actualHours = resolveActualHours(job, shifts);
      if (actualHours <= 0) continue;
      const dashEntries = Object.entries(job.dashQuantities ?? {}).filter(([, qty]) => qty > 0);
      if (dashEntries.length > 0) {
        const totalDashQty = dashEntries.reduce((sum, [, qty]) => sum + qty, 0);
        if (totalDashQty > 0) {
          for (const [suffixRaw, qty] of dashEntries) {
            const suffix = normalizeSuffix(suffixRaw);
            const current = variantStats.get(suffix) ?? { hours: 0, units: 0 };
            current.units += qty;
            current.hours += actualHours * (qty / totalDashQty);
            variantStats.set(suffix, current);
          }
          continue;
        }
      }
      if (job.variantSuffix) {
        const suffix = normalizeSuffix(job.variantSuffix);
        const setCount = parseJobSetCount(job) || 1;
        const current = variantStats.get(suffix) ?? { hours: 0, units: 0 };
        current.units += setCount;
        current.hours += actualHours;
        variantStats.set(suffix, current);
      }
    }

    const variantRows = (part?.variants ?? []).map((variant) => {
      const suffix = normalizeSuffix(variant.variantSuffix);
      const stat = variantStats.get(suffix) ?? { hours: 0, units: 0 };
      const actualPerUnit = stat.units > 0 ? stat.hours / stat.units : undefined;
      const estimatedPerUnit =
        variant.laborHours != null
          ? variant.laborHours
          : part?.laborHours != null && part.setComposition
            ? variantLaborFromSetComposition(
                variant.variantSuffix,
                part.laborHours,
                part.setComposition
              )
            : undefined;
      return {
        variantSuffix: variant.variantSuffix,
        actualHours: stat.hours,
        completedUnits: stat.units,
        actualPerUnit,
        estimatedPerUnit,
        variancePerUnit:
          actualPerUnit != null && estimatedPerUnit != null
            ? actualPerUnit - estimatedPerUnit
            : undefined,
      };
    });

    return {
      completedJobCount: completedJobs.length,
      analyzedJobCount: jobRows.length,
      totalActualHours,
      totalSets,
      estimatePerSet,
      averageActualPerSet,
      variancePerSet:
        averageActualPerSet != null && estimatePerSet != null
          ? averageActualPerSet - estimatePerSet
          : undefined,
      jobRows,
      variantRows,
    };
  }, [part, partJobs, shifts]);
}

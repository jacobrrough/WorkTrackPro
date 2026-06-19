import type { Job, Shift, InventoryItem } from '@/core/types';
import { getMachineTotalsFromJob } from '@/lib/machineHours';
import { calculateJobHoursFromShifts } from '@/lib/laborSuggestion';

/**
 * One averaged material line built from past jobs' consumed inventory.
 * `unitCost` is the raw inventory cost (pre-markup); callers apply markup.
 * `quantity` is averaged across the jobs that actually consumed inventory.
 */
export interface QuoteMaterialLine {
  inventoryId: string;
  name: string;
  unit: string;
  unitCost: number;
  quantity: number;
}

export interface QuoteFromJobsResult {
  /** Average actual labor hours over jobs that logged real labor (completed shifts). */
  laborHours: number;
  /** Average CNC hours over jobs that have CNC time. */
  cncHours: number;
  /** Averaged material lines (quantity divided by jobs that consumed inventory). */
  materials: QuoteMaterialLine[];
  /** How many jobs matched the search (the loose name/description match). */
  matchedCount: number;
  /** How many matched jobs had at least one completed shift. */
  laborContributorCount: number;
  /** How many matched jobs had CNC time. */
  cncContributorCount: number;
  /** How many matched jobs consumed at least one resolvable inventory line. */
  materialContributorCount: number;
  /** How many matched jobs contributed to any component (labor, CNC, or material). */
  contributorCount: number;
  /** Ids of the jobs that contributed real data — the basis the quote is built on. */
  referenceJobIds: string[];
}

/**
 * Build a representative per-job cost basis from a set of similar past jobs.
 *
 * Each of labor, CNC, and materials is averaged ONLY over the jobs that actually have
 * that kind of history. A matched job with no completed shifts no longer drags labor to
 * zero; a job with no CNC time no longer dilutes CNC; a job that consumed no inventory no
 * longer thins out the material bill. Jobs with genuinely no data are excluded entirely
 * instead of being counted as real zeros — that silent dilution is what was under-quoting
 * new work. Every average is divide-by-zero guarded: a component with no contributors
 * returns 0 so callers can fall through to manual entry.
 */
export function buildQuoteFromJobs(
  similarJobs: Job[],
  shifts: Shift[],
  inventory: InventoryItem[]
): QuoteFromJobsResult {
  let totalLabor = 0;
  let laborContributorCount = 0;
  let totalCnc = 0;
  let cncContributorCount = 0;

  const materialMap = new Map<string, QuoteMaterialLine>();
  const materialContributorIds = new Set<string>();
  const contributorIds = new Set<string>();

  // Guard against the same job appearing twice: a duplicate would double its numerator
  // contribution while the Set-based denominators counted it once, skewing the average.
  const seenJobIds = new Set<string>();
  const uniqueJobs = similarJobs.filter((job) => {
    if (seenJobIds.has(job.id)) return false;
    seenJobIds.add(job.id);
    return true;
  });

  for (const job of uniqueJobs) {
    const jobLabor = calculateJobHoursFromShifts(job.id, shifts);
    if (Number.isFinite(jobLabor) && jobLabor > 0) {
      totalLabor += jobLabor;
      laborContributorCount += 1;
      contributorIds.add(job.id);
    }

    const cnc = getMachineTotalsFromJob(job).cncHours;
    if (Number.isFinite(cnc) && cnc > 0) {
      totalCnc += cnc;
      cncContributorCount += 1;
      contributorIds.add(job.id);
    }

    const jobInventory = job.expand?.job_inventory_via_job || job.expand?.job_inventory || [];
    let jobConsumedMaterial = false;
    for (const ji of jobInventory) {
      const invId =
        typeof ji.inventory === 'string'
          ? ji.inventory
          : (ji.inventory as unknown as { id?: string })?.id;
      if (!invId) continue;

      const invItem = inventory.find((i) => i.id === invId);
      if (!invItem) continue;

      // Only a real, positive quantity counts as consumption. A zero/negative/garbage line
      // (e.g. a leftover draft row) must not flip the job into a "material contributor" —
      // doing so would add it to the denominator and dilute every other material.
      const rawQty = Number(ji.quantity);
      if (!Number.isFinite(rawQty) || rawQty <= 0) continue;

      jobConsumedMaterial = true;
      const quantity = rawQty;
      const existing = materialMap.get(invId);
      if (existing) {
        existing.quantity += quantity;
      } else {
        materialMap.set(invId, {
          inventoryId: invId,
          name: invItem.name || 'Unnamed item',
          unit: ji.unit || invItem.unit || 'units',
          unitCost: invItem.price || 0,
          quantity,
        });
      }
    }
    if (jobConsumedMaterial) {
      materialContributorIds.add(job.id);
      contributorIds.add(job.id);
    }
  }

  const materialContributorCount = materialContributorIds.size;

  const laborHours = laborContributorCount > 0 ? totalLabor / laborContributorCount : 0;
  const cncHours = cncContributorCount > 0 ? totalCnc / cncContributorCount : 0;
  const materials = Array.from(materialMap.values()).map((m) => ({
    ...m,
    quantity: materialContributorCount > 0 ? m.quantity / materialContributorCount : 0,
  }));

  return {
    laborHours,
    cncHours,
    materials,
    matchedCount: uniqueJobs.length,
    laborContributorCount,
    cncContributorCount,
    materialContributorCount,
    contributorCount: contributorIds.size,
    referenceJobIds: Array.from(contributorIds),
  };
}

import type { Job, JobStatus, Shift, InventoryItem, QuoteLineItem } from '@/core/types';
import { getMachineTotalsFromJob } from '@/lib/machineHours';
import { calculateJobHoursFromShifts } from '@/lib/laborSuggestion';

/**
 * Statuses whose actuals are complete enough to quote from. A reference job only feeds
 * the average once its build is physically done, so its logged labor and consumed
 * inventory are final rather than mid-flight. In-progress / pending / on-hold / quote- and
 * RFQ-stage jobs are excluded: their partial actuals would drag the estimate down — the
 * same under-quoting the no-history exclusion was meant to fix, through a different door.
 * qualityControl is excluded because failing QC adds rework labor; pod (PO'd) and rush are
 * excluded because a placed order or rushed job is in-flight, not a finished build with
 * final actuals.
 */
export const QUOTE_REFERENCE_STATUSES: ReadonlySet<JobStatus> = new Set<JobStatus>([
  'finished',
  'delivered',
  'waitingForPayment',
  'projectCompleted',
  'paid',
]);

/**
 * One averaged material line built from past jobs' consumed inventory.
 * `unitCost` is the raw inventory cost (pre-markup); callers apply markup.
 * `quantity` is averaged across the jobs that actually consumed THIS item.
 */
export interface QuoteMaterialLine {
  inventoryId: string;
  name: string;
  unit: string;
  unitCost: number;
  quantity: number;
}

export interface QuoteFromJobsResult {
  /** Average ACTUAL labor hours (logged completed shifts) over completed jobs that logged labor. */
  laborHours: number;
  /**
   * Average PLANNED CNC hours over completed jobs that have a CNC plan. Note the asymmetry:
   * labor is measured actuals but CNC is the planned machineBreakdownByVariant total, because
   * the data model has no logged CNC runtime. A consumer pricing both legs at the same rate
   * should know the CNC leg is a forecast, not a measured cost.
   */
  cncHours: number;
  /** Averaged material lines (each quantity divided by the jobs that used that item). */
  materials: QuoteMaterialLine[];
  /** How many jobs matched the search (the loose name/description match). */
  matchedCount: number;
  /** How many matched jobs are completed builds eligible to quote from. */
  eligibleCount: number;
  // The three per-component contributor counts below are reserved for the accounting
  // estimates pipeline UI (a "averaged from N labor / M CNC / K material jobs" breakdown).
  // They are not yet read by a production caller; keep them in sync with the loop above.
  /** How many eligible jobs had at least one completed shift. */
  laborContributorCount: number;
  /** How many eligible jobs had CNC time. */
  cncContributorCount: number;
  /** How many eligible jobs consumed at least one resolvable inventory line. */
  materialContributorCount: number;
  /** How many eligible jobs contributed to any component (labor, CNC, or material). */
  contributorCount: number;
  /** Ids of the jobs that contributed real data — the basis the quote is built on. */
  referenceJobIds: string[];
}

interface MaterialAccumulator {
  line: QuoteMaterialLine;
  /** Jobs that consumed this specific item — the per-material denominator. */
  consumers: Set<string>;
}

/**
 * Build a representative per-job cost basis from a set of similar past jobs.
 *
 * Two filters keep the average honest:
 *  1. Only completed builds (see QUOTE_REFERENCE_STATUSES) are eligible, so half-logged
 *     in-progress jobs can't dilute the estimate.
 *  2. Within the eligible set, each of labor, CNC, and materials is averaged ONLY over the
 *     jobs that actually have that kind of history. A completed job with no CNC time no
 *     longer dilutes CNC, and a material is divided only by the jobs that used that item —
 *     not by every job that happened to consume something — so item-specific stock isn't
 *     under-counted.
 *
 * Every average is divide-by-zero guarded: a component with no contributors returns 0 so
 * callers can fall through to manual entry.
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

  const materialMap = new Map<string, MaterialAccumulator>();
  const materialContributorIds = new Set<string>();
  const contributorIds = new Set<string>();

  // Guard against the same job appearing twice: a duplicate would double its numerator
  // contribution while the Set-based denominators counted it once, skewing the average. Jobs
  // with a missing/falsy id are dropped: id is the key for every per-job denominator, so two
  // distinct id-less rows would collapse into one consumer and double the material average.
  const seenJobIds = new Set<string>();
  const uniqueJobs = similarJobs.filter((job) => {
    if (!job.id || seenJobIds.has(job.id)) return false;
    seenJobIds.add(job.id);
    return true;
  });

  // Only completed builds feed the average; everything else is real but not yet final.
  const eligibleJobs = uniqueJobs.filter((job) => QUOTE_REFERENCE_STATUSES.has(job.status));

  // One lookup map instead of inventory.find() per line — keeps the basis O(jobs × lines)
  // rather than O(jobs × lines × inventory) when this engine feeds a batch estimate refresh.
  const inventoryById = new Map(inventory.map((item) => [item.id, item]));

  for (const job of eligibleJobs) {
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

      const invItem = inventoryById.get(invId);
      if (!invItem) continue;

      // Only a real, positive quantity counts as consumption. A zero/negative/garbage line
      // (e.g. a leftover draft row) must not flip the job into a "material contributor" —
      // doing so would add it to the denominator and dilute every other material.
      const rawQty = Number(ji.quantity);
      if (!Number.isFinite(rawQty) || rawQty <= 0) continue;

      // Price comes from the same untyped source as quantity; guard it the same way so a
      // non-numeric price string can't propagate NaN into the customer-facing dollar total.
      const rawPrice = Number(invItem.price);
      const unitCost = Number.isFinite(rawPrice) && rawPrice >= 0 ? rawPrice : 0;

      jobConsumedMaterial = true;
      const quantity = rawQty;
      const existing = materialMap.get(invId);
      if (existing) {
        existing.line.quantity += quantity;
        existing.consumers.add(job.id);
      } else {
        materialMap.set(invId, {
          line: {
            inventoryId: invId,
            name: invItem.name || 'Unnamed item',
            unit: ji.unit || invItem.unit || 'units',
            unitCost,
            quantity,
          },
          consumers: new Set([job.id]),
        });
      }
    }
    if (jobConsumedMaterial) {
      materialContributorIds.add(job.id);
      contributorIds.add(job.id);
    }
  }

  const laborHours = laborContributorCount > 0 ? totalLabor / laborContributorCount : 0;
  const cncHours = cncContributorCount > 0 ? totalCnc / cncContributorCount : 0;
  // Average each item over the jobs that actually used it, not over every material-consuming
  // job. A bracket used in 1 of 3 jobs reflects that 1 job's quantity, not a third of it.
  const materials = Array.from(materialMap.values()).map(({ line, consumers }) => ({
    ...line,
    quantity: consumers.size > 0 ? line.quantity / consumers.size : 0,
  }));

  return {
    laborHours,
    cncHours,
    materials,
    matchedCount: uniqueJobs.length,
    eligibleCount: eligibleJobs.length,
    laborContributorCount,
    cncContributorCount,
    materialContributorCount: materialContributorIds.size,
    contributorCount: contributorIds.size,
    referenceJobIds: Array.from(contributorIds),
  };
}

/** Rates and markups applied to a raw cost basis. Callers own these (V7 spec lives in the UI). */
export interface QuotePricingConfig {
  /** Dollars per labor hour. */
  laborRate: number;
  /** Dollars per CNC hour. */
  cncRate: number;
  /** Material sell price = raw unit cost × this multiplier. */
  materialMarkupMultiplier: number;
  /** Whole-quote markup applied to the subtotal, as a percent (e.g. 20 = +20%). */
  markupPercent: number;
}

export interface PricedQuote {
  lineItems: QuoteLineItem[];
  materialCost: number;
  laborCost: number;
  cncCost: number;
  subtotal: number;
  markupAmount: number;
  total: number;
}

/**
 * Turn a raw cost basis into priced, marked-up quote figures. Pure and config-driven so the
 * customer-facing dollar math (material markup, labor/CNC rates, whole-quote markup) is unit
 * testable on its own rather than buried in the React calculate handler.
 */
export function priceQuoteFromBasis(
  basis: Pick<QuoteFromJobsResult, 'materials' | 'laborHours' | 'cncHours'>,
  config: QuotePricingConfig
): PricedQuote {
  const lineItems: QuoteLineItem[] = basis.materials.map((item) => {
    const unitPrice = item.unitCost * config.materialMarkupMultiplier;
    return {
      name: item.name,
      inventoryName: item.name,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice,
      totalPrice: item.quantity * unitPrice,
      isManual: false,
    };
  });

  const materialCost = lineItems.reduce((sum, item) => sum + (item.totalPrice ?? 0), 0);
  const laborCost = basis.laborHours * config.laborRate;
  const cncCost = basis.cncHours * config.cncRate;
  const subtotal = materialCost + laborCost + cncCost;
  const markupAmount = subtotal * (config.markupPercent / 100);
  const total = subtotal + markupAmount;

  return { lineItems, materialCost, laborCost, cncCost, subtotal, markupAmount, total };
}

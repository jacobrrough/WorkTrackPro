import type { InventoryItem, Job, Part, PartVariant } from '../../../core/types';
import { calculatePartQuote, normalizeDashQuantities } from '../../../lib/partsCalculations';
import { getDashQuantity } from '../../../lib/variantMath';
import { buildEffectivePartQuantities } from '../../../lib/effectivePartQuantities';
import type { NewInvoiceLineInput } from '../../../features/accounting/types';

/**
 * Build draft invoice lines from a job's linked part(s) so the invoice equals the
 * quote shown on screen. This is the A1 "invoice from a job/quote" seam: it reuses
 * `calculatePartQuote` (via the partsCalculations sanitizer) with the same rate
 * inputs the QuoteCalculator/PartDetail use, so the per-part total matches exactly.
 *
 * One invoice line is emitted per linked part, carrying that part's `partId` so the
 * document line is a real link to public.parts (not just descriptive text) — the
 * editor then shows it in the Part column and re-prices it on qty change. The line's
 * `lineTotal` is the part quote's `.total` (already at the customer-facing price,
 * including the material multiplier and labor); `quantity`/`unitPrice` are filled for
 * display (unitPrice = total / sets). When a part carries a stored `pricePerSet`, it anchors
 * the quote (manualSetPrice) exactly like the on-screen calculator. If no part can
 * be quoted, falls back to a single line built from the job's inventory BOM.
 *
 * IMPORTANT: when the job carries a saved quoted snapshot (`job.quotedPrice`, captured at
 * job creation), that snapshot is billed instead of the live re-quote, so editing a part
 * after the job was created does NOT change the invoice price. The re-quote-from-part path
 * is the fallback for older jobs created before the snapshot existed.
 *
 * Pure (no Supabase) so it is unit-testable; the caller supplies the resolved parts,
 * inventory, and rate settings.
 */

export interface QuoteRateSettings {
  laborRate: number;
  cncRate: number;
  printer3DRate: number;
  /** Material customer multiplier (org "material upcharge"); defaults to calc default. */
  materialMultiplier?: number;
}

export interface InvoiceLinesFromJobParams {
  job: Pick<
    Job,
    | 'id'
    | 'jobCode'
    | 'name'
    | 'partNumber'
    | 'qty'
    | 'dashQuantities'
    | 'parts'
    | 'inventoryItems'
    | 'quotedPrice'
  >;
  /** Fully-loaded parts (with variants/materials) keyed by id or partNumber lookup below. */
  parts: Part[];
  inventory: InventoryItem[];
  settings: QuoteRateSettings;
  /** Income account to assign to each generated line (e.g. default sales income). */
  incomeAccountId?: string | null;
  /** Optional header tax code applied to each generated line. */
  taxCodeId?: string | null;
}

/** Total complete sets a part contributes given the job's dash quantities. */
export function setsForPart(
  part: Part & { setComposition?: Record<string, number> | null },
  dashQuantities: Record<string, number> | null | undefined
): number {
  const dash = normalizeDashQuantities(dashQuantities ?? {});
  const composition = part.setComposition ?? {};

  const compEntries = Object.entries(composition).filter(([, qty]) => (Number(qty) || 0) > 0);
  if (compEntries.length > 0) {
    // Number of complete sets = min over composing variants of floor(dashQty / perSetQty).
    let sets = Infinity;
    for (const [suffix, perSet] of compEntries) {
      const have = getDashQuantity(dash, suffix);
      const need = Number(perSet) || 0;
      if (need <= 0) continue;
      sets = Math.min(sets, Math.floor(have / need));
    }
    if (Number.isFinite(sets) && sets > 0) return sets;
    // A composition was declared but didn't resolve to a complete set: invoice a single
    // set rather than mis-summing every dash quantity into an inflated unit/set count.
    return 1;
  }

  // No set composition: treat the summed dash quantity as the number of units/sets,
  // falling back to 1 so a part-linked job always invoices.
  const summed = Object.values(dash).reduce((s, q) => s + (Number(q) || 0), 0);
  return summed > 0 ? summed : 1;
}

/**
 * A part link a job bills from. `JobPartRef` is the shared shape so the document builder
 * and the editor's part hydration resolve the job's parts the exact same way.
 */
export interface JobPartRef {
  partId?: string;
  partNumber?: string;
  dashQuantities?: Record<string, number> | null;
}

/**
 * The part links a job bills from: the multi-part `job.parts` list when present, else the
 * single primary part (`job.partNumber` + `job.dashQuantities`). Exported so the prefill's
 * part-hydration uses the SAME resolution the line builder uses.
 */
export function jobPartLinks(
  job: Pick<Job, 'parts' | 'partNumber' | 'dashQuantities'>
): JobPartRef[] {
  if (job.parts && job.parts.length > 0) {
    return job.parts.map((p) => ({
      partId: p.partId,
      partNumber: p.partNumber,
      dashQuantities: p.dashQuantities,
    }));
  }
  if (job.partNumber) {
    return [{ partId: undefined, partNumber: job.partNumber, dashQuantities: job.dashQuantities }];
  }
  return [];
}

/**
 * Resolve which Part a job-part link points to (by id, else by partNumber). The number
 * match is case-insensitive so a job carrying 'p-100' still resolves the stored 'P-100'
 * (mirrors partsService.getPartByNumber's case-insensitive fallback).
 */
function findPart(parts: Part[], link: { partId?: string; partNumber?: string }): Part | undefined {
  if (link.partId) {
    const byId = parts.find((p) => p.id === link.partId);
    if (byId) return byId;
  }
  if (link.partNumber) {
    const target = link.partNumber.trim().toUpperCase();
    return parts.find((p) => p.partNumber?.trim().toUpperCase() === target);
  }
  return undefined;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Quote a single part at a given set count, the shared part-pricing core. Reuses
 * `calculatePartQuote` with the same rate inputs the QuoteCalculator/PartDetail use, so the
 * total matches the on-screen calculator exactly. A stored `pricePerSet` anchors the quote
 * (manualSetPrice); a stored `laborHours` overrides labor only when there is no manual price.
 * Returns null when the part cannot be quoted (no quote or a non-positive total).
 */
export function quotePartLine(
  part: Part,
  sets: number,
  inventory: InventoryItem[],
  settings: QuoteRateSettings
): { description: string; unitPrice: number; lineTotal: number } | null {
  const manualSetPrice =
    typeof part.pricePerSet === 'number' &&
    Number.isFinite(part.pricePerSet) &&
    part.pricePerSet > 0
      ? part.pricePerSet
      : undefined;

  const quote = calculatePartQuote(part as Part & { variants?: PartVariant[] }, sets, inventory, {
    laborRate: settings.laborRate,
    cncRate: settings.cncRate,
    printer3DRate: settings.printer3DRate,
    materialMultiplier: settings.materialMultiplier,
    manualSetPrice,
    overrideLaborHours:
      part.laborHours != null && Number.isFinite(part.laborHours) && manualSetPrice == null
        ? part.laborHours
        : undefined,
  });
  if (!quote || quote.total <= 0) return null;

  const lineTotal = round2(quote.total);
  return {
    description: `${part.partNumber}${part.name ? ` — ${part.name}` : ''} (${sets} set${sets === 1 ? '' : 's'})`,
    unitPrice: round2(lineTotal / sets),
    lineTotal,
  };
}

export function buildInvoiceLinesFromJob(params: InvoiceLinesFromJobParams): NewInvoiceLineInput[] {
  const { job, parts, inventory, settings, incomeAccountId, taxCodeId } = params;
  const lines: NewInvoiceLineInput[] = [];

  // Determine the part links: prefer the multi-part list, else the primary part.
  const links = jobPartLinks(job);
  // A single-part job may carry its count only in the free-text `qty` field (empty
  // dash_quantities) — mirror the job screens' `qty`-text fallback so the line counts and
  // prices the part exactly like the on-screen quote instead of collapsing to a single unit.
  // Multi-part jobs persist each link's own dash quantities, so the per-job `qty` doesn't apply.
  const singlePart = links.length === 1;

  // Re-quote each linked part from its current state. The per-part `total` is the live
  // quote; it is what we bill ONLY when the job has no saved quoted snapshot (older jobs).
  // `partId` is carried through so the emitted line links the real part.
  const partTotals: { partId: string; description: string; sets: number; total: number }[] = [];
  for (const link of links) {
    const part = findPart(parts, link);
    if (!part) continue;
    const effectiveDash = singlePart
      ? buildEffectivePartQuantities(part, link.dashQuantities, job.qty)
      : link.dashQuantities;
    const sets = setsForPart(part, effectiveDash);
    if (sets <= 0) continue;

    const quoted = quotePartLine(part, sets, inventory, settings);
    if (!quoted) continue;

    partTotals.push({
      partId: part.id,
      description: quoted.description,
      sets,
      total: quoted.lineTotal,
    });
  }

  if (partTotals.length > 0) {
    // Prefer the job's saved quoted snapshot when present (finite, positive) so the invoice
    // bills what was quoted — NOT a re-quote from a part that may have been edited after the
    // job was created. The snapshot is a single combined total across all linked parts; for a
    // multi-part job we split it across the lines in proportion to their live re-quote so the
    // invoice sum equals the snapshot exactly. When the snapshot is absent (older jobs), each
    // line bills its own live re-quote, preserving the existing behavior.
    const snapshot = job.quotedPrice;
    const useSnapshot = typeof snapshot === 'number' && Number.isFinite(snapshot) && snapshot > 0;
    const reQuoteSum = partTotals.reduce((s, p) => s + p.total, 0);

    partTotals.forEach((p, idx) => {
      let lineTotal: number;
      if (!useSnapshot) {
        lineTotal = p.total;
      } else if (partTotals.length === 1) {
        lineTotal = round2(snapshot!);
      } else if (reQuoteSum > 0) {
        // Proportional split; assign the rounding remainder to the last line so the sum is exact.
        lineTotal =
          idx === partTotals.length - 1
            ? round2(
                snapshot! -
                  partTotals
                    .slice(0, idx)
                    .reduce((s, q) => s + round2(snapshot! * (q.total / reQuoteSum)), 0)
              )
            : round2(snapshot! * (p.total / reQuoteSum));
      } else {
        // Re-quote summed to 0 (cannot proportion): split the snapshot evenly.
        lineTotal =
          idx === partTotals.length - 1
            ? round2(snapshot! - round2(snapshot! / partTotals.length) * (partTotals.length - 1))
            : round2(snapshot! / partTotals.length);
      }
      lines.push({
        partId: p.partId,
        description: p.description,
        quantity: p.sets,
        unitPrice: round2(lineTotal / p.sets),
        lineTotal,
        taxCodeId: taxCodeId ?? null,
        taxable: true,
        incomeAccountId: incomeAccountId ?? null,
        jobId: job.id,
      });
    });
  }

  if (lines.length > 0) return lines;

  // Fallback: no quotable part — build a single line from the job's inventory BOM at
  // raw inventory price × upcharge so a job without a part can still be invoiced.
  const multiplier = settings.materialMultiplier ?? 2.25;
  const priceById = new Map(inventory.map((i) => [i.id, i.price ?? 0]));
  let bomTotal = 0;
  for (const item of job.inventoryItems ?? []) {
    if (!item.inventoryId) continue;
    const price = priceById.get(item.inventoryId) ?? 0;
    bomTotal += (item.quantity || 0) * price * multiplier;
  }
  bomTotal = round2(bomTotal);
  if (bomTotal > 0) {
    lines.push({
      description: `Job ${job.jobCode}${job.name ? ` — ${job.name}` : ''}`,
      quantity: 1,
      unitPrice: bomTotal,
      lineTotal: bomTotal,
      taxCodeId: taxCodeId ?? null,
      taxable: true,
      incomeAccountId: incomeAccountId ?? null,
      jobId: job.id,
    });
  }
  return lines;
}

import type { InventoryItem, Job, Part, PartVariant } from '../../../core/types';
import { calculatePartQuote, normalizeDashQuantities } from '../../../lib/partsCalculations';
import type { NewInvoiceLineInput } from '../../../features/accounting/types';

/**
 * Build draft invoice lines from a job's linked part(s) so the invoice equals the
 * quote shown on screen. This is the A1 "invoice from a job/quote" seam: it reuses
 * `calculatePartQuote` (via the partsCalculations sanitizer) with the same rate
 * inputs the QuoteCalculator/PartDetail use, so the per-part total matches exactly.
 *
 * One invoice line is emitted per linked part. The line's `lineTotal` is the part
 * quote's `.total` (already at the customer-facing price, including the material
 * multiplier and labor); `quantity`/`unitPrice` are filled for display
 * (unitPrice = total / sets). When a part carries a stored `pricePerSet`, it anchors
 * the quote (manualSetPrice) exactly like the on-screen calculator. If no part can
 * be quoted, falls back to a single line built from the job's inventory BOM.
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
  job: Pick<Job, 'id' | 'jobCode' | 'name' | 'partNumber' | 'dashQuantities' | 'parts' | 'inventoryItems'>;
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
  const norm = (s: string) => String(s ?? '').replace(/^-/, '');

  const compEntries = Object.entries(composition).filter(([, qty]) => (Number(qty) || 0) > 0);
  if (compEntries.length > 0) {
    // Number of complete sets = min over composing variants of floor(dashQty / perSetQty).
    let sets = Infinity;
    for (const [suffix, perSet] of compEntries) {
      const have = dash[norm(suffix)] ?? dash[suffix] ?? 0;
      const need = Number(perSet) || 0;
      if (need <= 0) continue;
      sets = Math.min(sets, Math.floor(have / need));
    }
    if (Number.isFinite(sets) && sets > 0) return sets;
  }

  // No set composition (or it didn't resolve): treat the summed dash quantity as the
  // number of units/sets, falling back to 1 so a part-linked job always invoices.
  const summed = Object.values(dash).reduce((s, q) => s + (Number(q) || 0), 0);
  return summed > 0 ? summed : 1;
}

/** Resolve which Part a job-part link points to (by id, else by partNumber). */
function findPart(parts: Part[], link: { partId?: string; partNumber?: string }): Part | undefined {
  if (link.partId) {
    const byId = parts.find((p) => p.id === link.partId);
    if (byId) return byId;
  }
  if (link.partNumber) {
    const target = link.partNumber.trim();
    return parts.find((p) => p.partNumber?.trim() === target);
  }
  return undefined;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function buildInvoiceLinesFromJob(params: InvoiceLinesFromJobParams): NewInvoiceLineInput[] {
  const { job, parts, inventory, settings, incomeAccountId, taxCodeId } = params;
  const lines: NewInvoiceLineInput[] = [];

  // Determine the part links: prefer the multi-part list, else the primary part.
  const links =
    job.parts && job.parts.length > 0
      ? job.parts.map((p) => ({
          partId: p.partId,
          partNumber: p.partNumber,
          dashQuantities: p.dashQuantities,
        }))
      : job.partNumber
        ? [{ partId: undefined, partNumber: job.partNumber, dashQuantities: job.dashQuantities }]
        : [];

  for (const link of links) {
    const part = findPart(parts, link);
    if (!part) continue;
    const sets = setsForPart(part, link.dashQuantities);
    if (sets <= 0) continue;

    const manualSetPrice =
      typeof part.pricePerSet === 'number' && Number.isFinite(part.pricePerSet) && part.pricePerSet > 0
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
    if (!quote || quote.total <= 0) continue;

    const total = round2(quote.total);
    lines.push({
      description: `${part.partNumber}${part.name ? ` — ${part.name}` : ''} (${sets} set${sets === 1 ? '' : 's'})`,
      quantity: sets,
      unitPrice: round2(total / sets),
      lineTotal: total,
      taxCodeId: taxCodeId ?? null,
      taxable: true,
      incomeAccountId: incomeAccountId ?? null,
      jobId: job.id,
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

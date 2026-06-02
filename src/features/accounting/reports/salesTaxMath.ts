/**
 * Pure aggregation for the C1 Sales-Tax Liability report. This is REPORTING ONLY —
 * it posts nothing and moves no money. It takes already-fetched rows (the service
 * does all Supabase I/O) and rolls them up into the SalesTaxLiabilityReport shape the
 * UI renders and the PDF/CSV exporter consumes. Kept free of React/Supabase so the
 * tie-back math is trivially unit-testable (see salesTaxMath.test.ts).
 *
 * TIE-BACK (the invariant this file defends):
 *   tax collected = Σ (credit − debit) over POSTED journal_lines on the 2200
 *   "Sales Tax Payable" account within the date range. Each such credit is attributed
 *   to a tax agency/jurisdiction by walking its source invoice's tax code → tax_rates
 *   → tax_agencies. The report's per-agency collected MUST sum back to that grand total
 *   to the cent — and any credit that CANNOT be tied to a source invoice/agency is put
 *   in an explicit "Unattributed / review" bucket rather than guessed (stop-condition).
 *
 * MONEY: every sum runs in integer cents (accountingViewModel.toCents) and converts
 * back to dollars only at the boundary, exactly the way the GL balance trigger expects.
 * A multi-agency tax code's collected cents are split across its agencies by a
 * largest-remainder apportionment so the parts always re-sum to the whole with no
 * rounding leak.
 */
import { toCents } from '../accountingViewModel';
import type {
  DateRange,
  SalesTaxAgencyLine,
  SalesTaxLiabilityReport,
  TaxAgency,
  TaxFilingFrequency,
} from '../types';
import { UNATTRIBUTED_AGENCY_ID } from '../types';

/** Cents -> dollars at the presentation boundary (rounds half-up like the DB). */
const centsToAmount = (cents: number): number => Math.round(cents) / 100;

/**
 * One posted journal line that hit the liability (2200) account, with just enough of
 * its parent entry to attribute it. `debit`/`credit` are dollars as stored; the source
 * link is the entry's source_type/source_id. Only the liability-account lines are
 * passed in — the service filters by account_id before handing them over.
 */
export interface LiabilityLineInput {
  /** Parent journal entry id (for grouping / debugging). */
  journalEntryId: string;
  sourceType: string;
  /** Parent entry source_id — an invoice id when sourceType === 'invoice'. */
  sourceId: string | null;
  debit: number;
  credit: number;
}

/**
 * One posted invoice that contributes to the report, with its resolved tax-code→agency
 * attribution and its taxable / non-taxable sales base. The service builds these by
 * joining invoices → tax_code_rates → tax_rates → tax_agencies and summing invoice_lines.
 */
export interface InvoiceTaxInput {
  invoiceId: string;
  /** Agency ids this invoice's tax code composes (one per active composing rate's agency). */
  agencyIds: string[];
  /** Taxable sales base for the invoice (Σ taxable line (line_total − discount)), dollars. */
  taxableSales: number;
  /** Non-taxable sales for the invoice, dollars. */
  nonTaxableSales: number;
}

/** Inputs to buildSalesTaxLiability: the liability lines, the invoices, the agencies, the range. */
export interface SalesTaxLiabilityInput {
  range: DateRange;
  liabilityAccountId: string | null;
  liabilityAccountNumber: string | null;
  /** Posted journal lines that hit the liability account, in range. */
  liabilityLines: LiabilityLineInput[];
  /** Posted invoices in range that have any tax attribution. Keyed by id downstream. */
  invoices: InvoiceTaxInput[];
  /** Agency master (id → name/rate/frequency) used to label and weight the split. */
  agencies: TaxAgency[];
}

/** Net credit (credit − debit) of a liability line, in cents. */
export function lineCollectedCents(line: Pick<LiabilityLineInput, 'debit' | 'credit'>): number {
  return toCents(line.credit) - toCents(line.debit);
}

/**
 * Apportion `totalCents` across `weights` by a largest-remainder rule so the parts
 * always re-sum to exactly `totalCents` (no rounding leak). Returns one integer-cents
 * share per weight, in the same order. Handles negative totals (a net debit / refund)
 * symmetrically. When every weight is zero the total is spread as evenly as possible.
 */
export function apportionCents(totalCents: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  if (n === 1) return [totalCents];

  const sign = totalCents < 0 ? -1 : 1;
  const magnitude = Math.abs(totalCents);

  const cleanWeights = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  let weightSum = cleanWeights.reduce((s, w) => s + w, 0);

  // No positive weights → distribute as evenly as possible.
  let effective = cleanWeights;
  if (weightSum <= 0) {
    effective = new Array(n).fill(1);
    weightSum = n;
  }

  const exact = effective.map((w) => (magnitude * w) / weightSum);
  const floors = exact.map((x) => Math.floor(x));
  let remainder = magnitude - floors.reduce((s, f) => s + f, 0);

  // Hand out the leftover cents to the largest fractional parts first.
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const out = floors.slice();
  for (let k = 0; k < order.length && remainder > 0; k++) {
    out[order[k].i] += 1;
    remainder -= 1;
  }
  return out.map((c) => sign * c);
}

/** Internal per-agency accumulator (cents). */
interface AgencyAcc {
  agencyId: string;
  agencyName: string;
  rate: number;
  filingFrequency: TaxFilingFrequency | null;
  collectedCents: number;
  taxableCents: number;
  nonTaxableCents: number;
}

/**
 * Build the CDTFA-style sales-tax liability report from posted liability-account lines,
 * the posted invoices that drove them, and the agency master.
 *
 * Attribution algorithm (cents throughout):
 *   1. Group liability lines by source invoice. Lines whose source is NOT a known
 *      in-range invoice (manual JEs, voids, deleted/edited sources, payments) are
 *      collected into the UNATTRIBUTED bucket — surfaced, never guessed.
 *   2. For each attributed invoice, split its net-credit cents across its agencies by
 *      a largest-remainder apportionment weighted by each agency's combined rate (so a
 *      9.5% LA invoice splits ~7.25/2.25 between the state and district agencies, and
 *      the parts re-sum to the invoice's collected cents exactly). An invoice with a
 *      single agency assigns 100% to it; an invoice with tax but NO resolvable agency
 *      also falls to the unattributed bucket.
 *   3. Sales bases: each invoice's taxable / non-taxable sales are attributed in FULL
 *      to every agency on it (a per-agency base is not additive across agencies), while
 *      the report HEADLINE taxable/non-taxable totals count each invoice once.
 *
 * The grand `taxCollected` is the straight Σ of all liability lines; `reconciled` is
 * true iff that equals Σ(agency.taxCollected) including the unattributed bucket.
 */
export function buildSalesTaxLiability(input: SalesTaxLiabilityInput): SalesTaxLiabilityReport {
  const { range, liabilityAccountId, liabilityAccountNumber, liabilityLines, invoices, agencies } =
    input;

  const agencyById = new Map<string, TaxAgency>();
  for (const a of agencies) agencyById.set(a.id, a);

  const invoiceById = new Map<string, InvoiceTaxInput>();
  for (const inv of invoices) invoiceById.set(inv.invoiceId, inv);

  // 1. Total collected (the tie-back anchor) + collected cents grouped by source invoice.
  let totalCollectedCents = 0;
  const collectedByInvoice = new Map<string, number>();
  let unattributedCents = 0;

  for (const line of liabilityLines) {
    const cents = lineCollectedCents(line);
    totalCollectedCents += cents;
    if (line.sourceType === 'invoice' && line.sourceId && invoiceById.has(line.sourceId)) {
      collectedByInvoice.set(
        line.sourceId,
        (collectedByInvoice.get(line.sourceId) ?? 0) + cents
      );
    } else {
      // Manual JE / payment / void / source not in range → cannot tie to an agency.
      unattributedCents += cents;
    }
  }

  const agencyAccs = new Map<string, AgencyAcc>();
  const ensureAgency = (a: TaxAgency): AgencyAcc => {
    let acc = agencyAccs.get(a.id);
    if (!acc) {
      acc = {
        agencyId: a.id,
        agencyName: a.name,
        rate: a.rate,
        filingFrequency: a.filingFrequency,
        collectedCents: 0,
        taxableCents: 0,
        nonTaxableCents: 0,
      };
      agencyAccs.set(a.id, acc);
    }
    return acc;
  };

  // De-duplicated headline sales bases (each invoice counted once, only those that
  // actually contributed a collected line — so the report's sales reflect taxed sales).
  let headlineTaxableCents = 0;
  let headlineNonTaxableCents = 0;

  // 2 + 3. Attribute each invoice's collected cents and sales bases to its agencies.
  for (const [invoiceId, collectedCents] of collectedByInvoice) {
    const inv = invoiceById.get(invoiceId);
    if (!inv) {
      unattributedCents += collectedCents;
      continue;
    }

    const taxableCents = toCents(inv.taxableSales);
    const nonTaxableCents = toCents(inv.nonTaxableSales);
    headlineTaxableCents += taxableCents;
    headlineNonTaxableCents += nonTaxableCents;

    // Resolve this invoice's agencies (dedupe; keep only known agency ids).
    const seen = new Set<string>();
    const invAgencies: TaxAgency[] = [];
    for (const aid of inv.agencyIds) {
      if (seen.has(aid)) continue;
      const a = agencyById.get(aid);
      if (a) {
        seen.add(aid);
        invAgencies.push(a);
      }
    }

    if (invAgencies.length === 0) {
      // Taxed invoice with no resolvable agency → surface as unattributed.
      unattributedCents += collectedCents;
      continue;
    }

    // Split collected cents across the invoice's agencies by combined rate.
    const weights = invAgencies.map((a) => (a.rate > 0 ? Math.round(a.rate * 1e6) : 0));
    const shares = apportionCents(collectedCents, weights);
    invAgencies.forEach((a, idx) => {
      const acc = ensureAgency(a);
      acc.collectedCents += shares[idx];
      // Sales base attributed IN FULL to every agency on the invoice (not additive
      // across agencies — see the type doc); the headline totals de-dup separately.
      acc.taxableCents += taxableCents;
      acc.nonTaxableCents += nonTaxableCents;
    });
  }

  // Assemble agency lines, largest collected first, then by name for stability.
  const agencyLines: SalesTaxAgencyLine[] = Array.from(agencyAccs.values())
    .map((acc) => ({
      agencyId: acc.agencyId,
      agencyName: acc.agencyName,
      rate: acc.rate,
      filingFrequency: acc.filingFrequency,
      taxCollected: centsToAmount(acc.collectedCents),
      taxableSales: centsToAmount(acc.taxableCents),
      nonTaxableSales: centsToAmount(acc.nonTaxableCents),
    }))
    .sort(
      (a, b) =>
        toCents(b.taxCollected) - toCents(a.taxCollected) ||
        a.agencyName.localeCompare(b.agencyName)
    );

  // Append the explicit unattributed/review bucket when it carries any tax.
  if (unattributedCents !== 0) {
    agencyLines.push({
      agencyId: UNATTRIBUTED_AGENCY_ID,
      agencyName: 'Unattributed / review',
      rate: 0,
      filingFrequency: null,
      taxCollected: centsToAmount(unattributedCents),
      taxableSales: 0,
      nonTaxableSales: 0,
      isUnattributed: true,
    });
  }

  const attributedSumCents = agencyLines.reduce((s, l) => s + toCents(l.taxCollected), 0);
  const reconciliationCents = totalCollectedCents - attributedSumCents;

  return {
    range,
    liabilityAccountId,
    liabilityAccountNumber,
    agencies: agencyLines,
    taxCollected: centsToAmount(totalCollectedCents),
    taxableSales: centsToAmount(headlineTaxableCents),
    nonTaxableSales: centsToAmount(headlineNonTaxableCents),
    grossSales: centsToAmount(headlineTaxableCents + headlineNonTaxableCents),
    unattributedTax: centsToAmount(unattributedCents),
    reconciliationDifference: centsToAmount(reconciliationCents),
    reconciled: reconciliationCents === 0,
  };
}

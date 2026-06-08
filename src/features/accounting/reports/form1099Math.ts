/**
 * Pure aggregation for the #12 1099-NEC worklist. Mirrors managementReportMath.ts: it
 * takes already-fetched per-vendor/per-year rollup rows (from the
 * accounting.v_1099_vendor_totals read-model, joined to the vendor's W-9 record) and
 * builds the ranked worklist the UI renders + the CSV/PDF exporter consumes. Deliberately
 * free of React/Supabase so the math is unit-testable and identical on screen and export.
 *
 * ADVISORY / COMPLIANCE ONLY — this computes a worklist, it does not file anything. Card /
 * third-party-network payments are already excluded upstream (the view drops method='card')
 * because those are 1099-K reportable by the processor, not 1099-NEC.
 *
 * MONEY: every total runs in integer cents (accountingViewModel.toCents) and converts back
 * to dollars only at the boundary, so the displayed amount and the threshold comparison
 * tie to the penny. The 1099-NEC reporting threshold is $600 (60000 cents) per payee per
 * calendar year; a vendor AT OR OVER the threshold is reportable.
 */
import { toCents } from '../accountingViewModel';
import type { Form1099Report, Form1099Row } from '../types';

/** Cents -> dollars at the presentation boundary (rounds half-up like the DB). */
const centsToAmount = (cents: number): number => Math.round(cents) / 100;

/** The IRS 1099-NEC reporting threshold: $600 per payee per calendar year. */
export const FORM_1099_THRESHOLD_CENTS = 60000;

/**
 * One pre-grouped input row for the worklist: a vendor's W-9 identity + its summed posted
 * (non-card) payments for the year. The service emits one of these per vendor (already
 * aggregated by the read-model), keyed by vendorId; the builder ranks them and applies the
 * threshold.
 */
export interface Form1099VendorInput {
  vendorId: string;
  vendorName: string;
  /** W-9 legal name (vendor_tax_info.legal_name), or null when no W-9 is on file. */
  legalName: string | null;
  /** W-9 Taxpayer Identification Number (vendor_tax_info.tax_id), or null when absent. */
  taxId: string | null;
  /** Marked exempt from 1099 reporting on the W-9. */
  exempt: boolean;
  /** Total non-card payments to this vendor in the year, in dollars (view total_paid). */
  totalPaid: number;
  /** Number of payments summed (view payment_count). */
  paymentCount: number;
}

export interface Build1099Options {
  /** The calendar year the worklist is for (stamped onto the report). */
  year: number;
  /** Reporting threshold in cents (default $600). A vendor at or over it is reportable. */
  thresholdCents?: number;
}

/**
 * Build the 1099-NEC worklist for a calendar year: every 1099 vendor AT OR OVER the $600
 * threshold, ranked by total paid (desc, ties broken by name), each with its payment count
 * and a `wComplete` flag (true when BOTH a legal name and a tax id are on file). Vendors
 * below the threshold are excluded from the rows but counted/totalled separately so the UI
 * can show a "below threshold excluded" note without re-fetching.
 */
export function build1099Worklist(
  rows: Form1099VendorInput[],
  { year, thresholdCents = FORM_1099_THRESHOLD_CENTS }: Build1099Options
): Form1099Report {
  const reportable: Form1099Row[] = [];
  let reportableTotalCents = 0;
  let belowThresholdCount = 0;
  let belowThresholdTotalCents = 0;

  for (const row of rows) {
    const cents = toCents(row.totalPaid);
    if (cents >= thresholdCents) {
      reportableTotalCents += cents;
      const legalName = row.legalName?.trim() || null;
      const taxId = row.taxId?.trim() || null;
      reportable.push({
        vendorId: row.vendorId,
        vendorName: row.vendorName,
        legalName,
        // Never echo the actual TIN into the report shape — only whether one is on file.
        hasTaxId: taxId != null,
        exempt: row.exempt,
        wComplete: legalName != null && taxId != null,
        paymentCount: row.paymentCount,
        amount: centsToAmount(cents),
      });
    } else {
      belowThresholdCount += 1;
      belowThresholdTotalCents += cents;
    }
  }

  reportable.sort(
    (a, b) => toCents(b.amount) - toCents(a.amount) || a.vendorName.localeCompare(b.vendorName)
  );

  return {
    year,
    thresholdAmount: centsToAmount(thresholdCents),
    rows: reportable,
    reportableTotal: centsToAmount(reportableTotalCents),
    belowThresholdCount,
    belowThresholdTotal: centsToAmount(belowThresholdTotalCents),
    // How many reportable vendors are missing a complete W-9 (legal name + TIN).
    incompleteCount: reportable.filter((r) => !r.wComplete).length,
  };
}

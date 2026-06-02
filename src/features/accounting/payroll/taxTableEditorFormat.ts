/**
 * ⚠️  HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING. Pure helpers for the Admin Tax-Table editor
 *     (FLAG-DARK payroll module). No React, no Supabase — trivially unit-testable
 *     (taxTableEditorFormat.test.ts). They (a) detect SEEDING GAPS (a tax kind with no active row
 *     means the engine withholds 0 for it) and (b) summarize a tax-table body for the row list.
 *     Editing a rate moves NO money — it only changes how a FUTURE pay run computes withholding.
 *     EVERY value MUST be verified by a CPA/EA against the current IRS Pub 15 / Pub 15-T and CA EDD
 *     DE 44 for the tax year.
 */
import {
  PAYROLL_TAX_KINDS,
  PAYROLL_TAX_KIND_LABELS,
  type PayrollTaxKind,
  type PayrollTaxTable,
  type PayrollTaxTableBody,
} from '../types';

/** The tax kinds that have NO active row for a year (engine withholds 0 for each — a real gap). */
export function missingTaxKinds(seededKinds: PayrollTaxKind[]): PayrollTaxKind[] {
  const present = new Set(seededKinds);
  return PAYROLL_TAX_KINDS.filter((k) => !present.has(k));
}

/** Human label list for the missing kinds (for the gap warning). */
export function missingTaxKindLabels(seededKinds: PayrollTaxKind[]): string[] {
  return missingTaxKinds(seededKinds).map((k) => PAYROLL_TAX_KIND_LABELS[k]);
}

/** Whether a body is the percentage-method (brackets) shape. */
export function isPercentageBody(body: PayrollTaxTableBody): body is Extract<PayrollTaxTableBody, { method: 'percentage' }> {
  return body.method === 'percentage';
}

/**
 * A one-line, human summary of a tax-table body for the row list. Flat-rate kinds read as a rate +
 * any wage-base cap or threshold; percentage-method kinds read as a bracket count. All money is
 * formatted from INTEGER CENTS.
 */
export function summarizeBody(body: PayrollTaxTableBody): string {
  if (isPercentageBody(body)) {
    const n = body.brackets.length;
    return `Percentage method · ${n} bracket${n === 1 ? '' : 's'}`;
  }
  // The employee rate reads first only when the employee actually pays; otherwise lead with the
  // employer rate (employer-only taxes like FUTA/UI/ETT).
  const parts: string[] = [];
  if (body.employeePaid) parts.push(`${pct(body.rate)} employee`);
  // Show the employer rate only when the employer pays AND it is a non-zero rate (so an
  // employee-only tax with a 0 employer rate does not read "0% employer").
  if (body.employerPaid && body.employerRate != null && body.employerRate > 0) {
    parts.push(`${pct(body.employerRate)} employer`);
  }
  if (parts.length === 0) parts.push(`${pct(body.rate)}`);
  if (body.wageBaseCents != null) parts.push(`cap ${dollars(body.wageBaseCents)}`);
  if (body.thresholdCents != null) parts.push(`over ${dollars(body.thresholdCents)}`);
  return parts.join(' · ');
}

/** Format a decimal rate as a trimmed percentage (mirrors payrollFormat.formatRatePct). */
function pct(rate: number): string {
  const safe = Number.isFinite(rate) ? rate : 0;
  return `${(safe * 100).toFixed(4).replace(/\.?0+$/, '')}%`;
}

/** Format integer cents as a whole-dollar label (wage bases/thresholds are large round numbers). */
function dollars(cents: number): string {
  const safe = Number.isFinite(cents) ? cents : 0;
  return (safe / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

/** Group a year's tax-table rows by jurisdiction → kind for the editor list. */
export interface TaxTableGroup {
  jurisdiction: 'federal' | 'CA';
  rows: PayrollTaxTable[];
}

export function groupTaxTables(rows: PayrollTaxTable[]): TaxTableGroup[] {
  const groups: TaxTableGroup[] = [
    { jurisdiction: 'federal', rows: rows.filter((r) => r.jurisdiction === 'federal') },
    { jurisdiction: 'CA', rows: rows.filter((r) => r.jurisdiction === 'CA') },
  ];
  return groups.filter((g) => g.rows.length > 0);
}

/**
 * ⚠️  HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING. Pure presenters for the FLAG-DARK payroll
 *     module: the per-employee PAYSTUB and the W-2 / 1099-NEC / DE-9C statutory report STUBS,
 *     plus the NACHA (direct-deposit) file STUB. NONE of these is filing-grade. They aggregate
 *     ALREADY-FETCHED committed paychecks (no I/O here) and are trivially unit-testable.
 *
 *     The reports are STUBS: several boxes are approximations or omitted, the forms are NOT the
 *     official IRS/EDD layouts, and the NACHA generator produces a clearly-marked NON-FILEABLE
 *     placeholder (never a bankable ACH file). The UI banners every screen + export, and every
 *     object returned here carries an explicit `unverified`/`disclaimer`. A payroll professional
 *     MUST complete and verify each form before any filing; a banking relationship + security
 *     sign-off are required before any real ACH is generated.
 *
 * MONEY (G6): every figure is INTEGER CENTS; the only dollars are in human display strings.
 */
import type {
  Employee,
  NachaStubResult,
  Paycheck,
  PayrollReport,
  PayrollReportKind,
  PayrollReportRow,
  PayRun,
  Paystub,
  PaystubTaxLine,
  PayrollTaxKind,
} from '../../../features/accounting/types';
import { PAYROLL_TAX_KIND_LABELS } from '../../../features/accounting/types';

/** The single source-of-truth UNVERIFIED disclaimer for every payroll report/export. */
export const PAYROLL_UNVERIFIED_DISCLAIMER =
  'UNVERIFIED — NOT FOR FILING. This payroll output is a STUB generated from official published ' +
  'rates that have NOT been verified for the applicable tax year. It is NOT a filing-grade form. ' +
  'A CPA/EA payroll professional and a security reviewer must sign off before it is enabled or filed.';

/** Order the tax lines appear on a paystub. */
const PAYSTUB_TAX_ORDER: PayrollTaxKind[] = [
  'fed_income_pit',
  'ca_pit',
  'fica_ss',
  'fica_medicare',
  'medicare_addl',
  'ca_sdi',
  'futa',
  'ca_ui',
  'ca_ett',
];

/**
 * Build the render-ready paystub for ONE paycheck from the paycheck + its employee + the run.
 * Pure: no I/O. The tax lines are ordered (employee income taxes first, then FICA, then the
 * employer-only taxes) and carry both sides; the on-screen paystub shows the employee column and
 * (optionally) the employer column. The cents identity net = gross − employeeTaxes −
 * otherDeductions is preserved straight from the paycheck.
 */
export function buildPaystub(paycheck: Paycheck, employee: Employee | null, run: PayRun | null): Paystub {
  const taxLines: PaystubTaxLine[] = PAYSTUB_TAX_ORDER.filter((k) => paycheck.taxes[k]).map((kind) => {
    const line = paycheck.taxes[kind]!;
    return {
      taxKind: kind,
      label: PAYROLL_TAX_KIND_LABELS[kind],
      employeeCents: line.employeeCents,
      employerCents: line.employerCents,
    };
  });
  return {
    paycheckId: paycheck.id,
    employeeId: paycheck.employeeId,
    employeeName: employee?.displayName ?? paycheck.employeeName ?? paycheck.employeeId.slice(0, 8),
    payRunId: paycheck.payRunId,
    periodStart: run?.periodStart ?? '',
    periodEnd: run?.periodEnd ?? '',
    payDate: run?.payDate ?? '',
    hoursRegularHundredthHours: paycheck.hoursRegularHundredthHours,
    hoursOtHundredthHours: paycheck.hoursOtHundredthHours,
    grossCents: paycheck.grossCents,
    taxLines,
    deductions: paycheck.deductions,
    employeeTaxesCents: paycheck.employeeTaxesCents,
    employerTaxesCents: paycheck.employerTaxesCents,
    otherDeductionsCents: paycheck.otherDeductionsCents,
    netCents: paycheck.netCents,
  };
}

/** Sum the employee-side cents of a specific tax across a set of paychecks. */
function sumEmployeeTax(paychecks: Paycheck[], kind: PayrollTaxKind): number {
  return paychecks.reduce((s, p) => s + (p.taxes[kind]?.employeeCents ?? 0), 0);
}

/** Sum the taxable-wage cents the engine recorded for a specific tax (post-cap), across paychecks. */
function sumTaxableWage(paychecks: Paycheck[], kind: PayrollTaxKind): number {
  return paychecks.reduce((s, p) => s + (p.taxes[kind]?.taxableWageCents ?? 0), 0);
}

/**
 * Aggregate ONE employee's committed paychecks (for a tax year) into a statutory report STUB row.
 * Wages = Σ gross; the withholding boxes = Σ the respective employee tax. The SS/Medicare/CA
 * "wages" use the engine-recorded taxable-wage (post-cap) where available, falling back to gross.
 * This is a STUB aggregation — box mapping to the real W-2 / DE-9C is APPROXIMATE.
 */
export function buildReportRow(
  employee: Employee,
  paychecks: Paycheck[],
  taxYear: number
): PayrollReportRow {
  const grossWagesCents = paychecks.reduce((s, p) => s + p.grossCents, 0);
  const ssWages = sumTaxableWage(paychecks, 'fica_ss');
  const medWages = sumTaxableWage(paychecks, 'fica_medicare');
  return {
    employeeId: employee.id,
    employeeName: employee.displayName,
    employmentType: employee.employmentType,
    ssnMasked: employee.ssn ? maskSsn(employee.ssn) : null,
    taxYear,
    grossWagesCents,
    fedIncomeWithheldCents: sumEmployeeTax(paychecks, 'fed_income_pit'),
    ssWagesCents: ssWages > 0 ? ssWages : grossWagesCents,
    ssWithheldCents: sumEmployeeTax(paychecks, 'fica_ss'),
    medicareWagesCents: medWages > 0 ? medWages : grossWagesCents,
    medicareWithheldCents: sumEmployeeTax(paychecks, 'fica_medicare') + sumEmployeeTax(paychecks, 'medicare_addl'),
    caWagesCents: grossWagesCents,
    caPitWithheldCents: sumEmployeeTax(paychecks, 'ca_pit'),
    caSdiWithheldCents: sumEmployeeTax(paychecks, 'ca_sdi'),
  };
}

/** Mask an SSN to the last 4 digits (display only; SSN is a Phase-E placeholder anyway). */
export function maskSsn(ssn: string): string {
  const digits = ssn.replace(/\D/g, '');
  if (digits.length < 4) return '•••-••-••••';
  return `•••-••-${digits.slice(-4)}`;
}

/**
 * Build a statutory report STUB (W-2 / 1099-NEC / DE-9C) from per-employee aggregated rows over a
 * tax year. W-2 covers W-2 employees; 1099-NEC covers 1099 contractors; DE-9C is the CA quarterly
 * wage/withholding (this stub aggregates the whole year unless the caller pre-filters paychecks to
 * a quarter and passes `quarter`). The result ALWAYS carries `unverified: true` + the disclaimer.
 *
 * The caller passes already-filtered (employee, paychecks) pairs (committed only). This pure
 * function just shapes them — it does NOT decide filing eligibility, thresholds, or box mapping
 * beyond the approximate aggregation in buildReportRow.
 */
export function buildPayrollReportStub(
  kind: PayrollReportKind,
  taxYear: number,
  entries: Array<{ employee: Employee; paychecks: Paycheck[] }>,
  quarter: number | null = null
): PayrollReport {
  // Filter to the employment type the form applies to (W-2/DE-9C → w2; 1099-NEC → 1099).
  const wantType = kind === '1099_nec' ? '1099' : 'w2';
  const rows = entries
    .filter((e) => e.employee.employmentType === wantType && e.paychecks.length > 0)
    .map((e) => buildReportRow(e.employee, e.paychecks, taxYear))
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  return {
    kind,
    taxYear,
    quarter: kind === 'de9c' ? quarter : null,
    rows,
    unverified: true,
    disclaimer: PAYROLL_UNVERIFIED_DISCLAIMER,
  };
}

/**
 * NACHA (direct-deposit) file generator STUB. This DELIBERATELY does NOT emit a real, bankable
 * NACHA ACH file — it emits a clearly-marked NON-FILEABLE placeholder so the UI can demonstrate
 * the "generate direct deposit" flow while the module stays held. `bankable` is ALWAYS false. No
 * real routing/account numbers are used (the employee bank fields are display-only Phase-E masks
 * and are NOT read here). A real NACHA format, a banking/ODFI relationship, and security sign-off
 * are required before any ACH is generated — see WHAT A HUMAN MUST VERIFY.
 *
 * @param run         the committed pay run (for the header context).
 * @param paychecks   the run's paychecks (each net-pay entry the batch WOULD contain).
 */
export function buildNachaStub(run: PayRun, paychecks: Paycheck[]): NachaStubResult {
  const payable = paychecks.filter((p) => p.netCents > 0);
  const totalNetCents = payable.reduce((s, p) => s + p.netCents, 0);
  const lines: string[] = [
    '*** NACHA DIRECT-DEPOSIT FILE — STUB / NOT FILEABLE ***',
    'UNVERIFIED — NOT FOR FILING. This is a PLACEHOLDER, not a bankable NACHA (ACH) file.',
    'No real routing/account numbers are used and no ACH is initiated. A real NACHA format,',
    'an ODFI/banking relationship, and security sign-off are required before any direct deposit.',
    '',
    `Pay run: ${run.id}`,
    `Pay date: ${run.payDate}`,
    `Period: ${run.periodStart} … ${run.periodEnd}`,
    `Entries (net pay > 0): ${payable.length}`,
    `Total net: $${(totalNetCents / 100).toFixed(2)}`,
    '',
    '--- entries (employee id → net) ---',
    ...payable.map((p) => `${p.employeeId}  net=$${(p.netCents / 100).toFixed(2)}  [BANK DETAILS WITHHELD — Phase E]`),
    '',
    '*** END STUB — NOT A REAL NACHA FILE ***',
  ];
  return {
    content: lines.join('\n'),
    bankable: false,
    entryCount: payable.length,
    totalNetCents,
    disclaimer: PAYROLL_UNVERIFIED_DISCLAIMER,
  };
}

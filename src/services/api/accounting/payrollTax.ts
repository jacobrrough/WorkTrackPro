/**
 * ⚠️  HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING.
 *
 *     This is the pure withholding ENGINE for the FLAG-DARK payroll module. It computes a
 *     single paycheck's federal + California taxes (employee withholding AND employer tax) in
 *     INTEGER CENTS from the admin-updatable accounting.payroll_tax_tables rows. EVERY rate,
 *     wage base, threshold, and bracket it consumes is seeded from an OFFICIAL published source
 *     (cited in migration 20260601000028) but MUST be re-verified by a payroll professional
 *     (CPA/EA) against the CURRENT IRS Pub 15 / Pub 15-T and CA EDD DE 44 / DE 201 for the tax
 *     year being run before this is used to compute, pay, or file anything. The module renders a
 *     PROMINENT "UNVERIFIED — NOT FOR FILING" banner on every screen/report/export, and an Admin
 *     Tax-Table UI lets a verified professional correct any rate. NOTHING here moves money — the
 *     balanced payroll journal entry is posted exclusively by accounting.commit_pay_run.
 *
 * SOURCES (transcribed in good faith from 2025 figures; VERIFY before filing):
 *   • Federal FICA Social Security: IRS Pub 15 (Circular E), 2025 — 6.2% employee + 6.2%
 *     employer on the first $176,100 (indexed yearly).
 *   • Federal FICA Medicare: IRS Pub 15, 2025 — 1.45% employee + 1.45% employer, no wage cap.
 *   • Additional Medicare: IRS Pub 15, 2025 — 0.9% EMPLOYEE-ONLY on YTD wages over $200,000
 *     (employer withholds at $200k regardless of filing status; not employer-matched).
 *   • FUTA: IRS Pub 15 / Form 940, 2025 — 0.6% net (6.0% gross − 5.4% state credit) on the
 *     first $7,000 EMPLOYER-ONLY. ⚠️  CA has been a credit-reduction state — verify the rate.
 *   • CA UI: CA EDD DE 44, 2025 — experience-rated EMPLOYER-ONLY on the first $7,000 (the
 *     seeded 3.4% is a PLACEHOLDER new-employer rate — replace with this employer's EDD rate).
 *   • CA ETT: CA EDD DE 44, 2025 — 0.1% EMPLOYER-ONLY on the first $7,000.
 *   • CA SDI: CA EDD DE 44, 2025 — ~1.2% EMPLOYEE-ONLY; SB 951 removed the wage cap (2024+).
 *   • Federal income-tax withholding: IRS Pub 15-T (2025), Worksheet 1A — Percentage Method,
 *     STANDARD withholding (W-4 Step-2 NOT checked), ANNUAL brackets.
 *   • CA PIT withholding: CA EDD DE 44 (2025), Method B — Exact Calculation, Table 5, ANNUAL.
 *
 * MONEY MATH (G6): every monetary value is INTEGER CENTS; rates are applied as
 * round(wageCents * rate) (banker-free round-half-up to the nearest cent), matching the
 * conventional payroll cent-rounding. NO floating-point dollar amount is ever produced; the
 * only place dollars appear is the JE boundary inside commit_pay_run (cents / 100.0).
 *
 * WHAT THIS ENGINE INTENTIONALLY DOES *NOT* DO (on the HUMAN-VERIFY list — these are explicit
 * gaps, surfaced as such, NOT silent wrong answers):
 *   • DE 44 Tables 1–4 (low-income exemption, standard deduction, exemption-allowance credit)
 *     are NOT applied beyond the per-allowance credit hook below; the seeded CA brackets are
 *     Table 5 only. The CA result is therefore an APPROXIMATION pending the full DE 44 method.
 *   • Pre-2020 W-4 ("withholding allowances") is not modeled — only the 2020+ redesign inputs.
 *   • Pre-tax deduction effects on taxable wages are not applied (all deductions treated
 *     post-tax) — the caller passes statutory taxable wages; benefits cafeteria-plan handling
 *     is a follow-up.
 *   • Multi-state, supplemental-wage flat rates, tip credits, and local taxes are out of scope.
 */
import type {
  Employee,
  FlatRateTaxTable,
  PayFrequency,
  PayrollFilingStatus,
  PayrollTaxKind,
  PayrollTaxTable,
  PercentageBracket,
  PercentageMethodTaxTable,
} from '../../../features/accounting/types';
import { PAY_PERIODS_PER_YEAR } from '../../../features/accounting/types';

// ── Cent-rounding (round half up to the nearest cent) ─────────────────────────

/**
 * Apply a decimal rate to an integer-cents wage and round to the nearest cent (half up). This
 * is the single rounding primitive the whole engine uses, so every tax rounds identically.
 * Negative inputs clamp to 0 (a wage/tax is never negative).
 */
export function applyRateCents(wageCents: number, rate: number): number {
  if (!Number.isFinite(wageCents) || !Number.isFinite(rate) || wageCents <= 0 || rate <= 0) return 0;
  return Math.round(wageCents * rate);
}

/**
 * The portion of `periodWageCents` still BELOW an annual wage base, given `ytdWageCents` already
 * earned this year. Used for capped taxes (SS, FUTA, CA UI/ETT). When `wageBaseCents` is null
 * there is no cap and the whole period wage is taxable. Never returns negative.
 */
export function taxableUnderBaseCents(
  periodWageCents: number,
  ytdWageCents: number,
  wageBaseCents: number | null
): number {
  const period = Math.max(0, Math.trunc(periodWageCents));
  if (wageBaseCents == null) return period;
  const remaining = Math.max(0, wageBaseCents - Math.max(0, Math.trunc(ytdWageCents)));
  return Math.min(period, remaining);
}

/**
 * The portion of `periodWageCents` ABOVE an annual threshold, given `ytdWageCents` already
 * earned. Used for Additional Medicare (0.9% only on the slice over $200k). Never negative.
 */
export function taxableOverThresholdCents(
  periodWageCents: number,
  ytdWageCents: number,
  thresholdCents: number
): number {
  const period = Math.max(0, Math.trunc(periodWageCents));
  const ytd = Math.max(0, Math.trunc(ytdWageCents));
  const endYtd = ytd + period;
  if (endYtd <= thresholdCents) return 0; // still entirely under the threshold
  // The slice of THIS period that lies above the threshold.
  const aboveStart = Math.max(ytd, thresholdCents);
  return Math.max(0, endYtd - aboveStart);
}

// ── Percentage-method bracket walk (annual, then de-annualized) ───────────────

/**
 * Annual tax for an ANNUAL taxable-wage amount (in cents) using a percentage-method bracket
 * table (Pub 15-T Worksheet 1A / DE 44 Method B Table 5). Walks the brackets and returns
 * base + rate × (annualWage − ofExcessOver) for the matching bracket. Cents in, cents out;
 * the per-bracket multiply is rounded half-up. Below the first bracket → 0.
 *
 * The brackets MUST be sorted ascending by overCents and contiguous (the seed guarantees this);
 * the final bracket has butNotOverCents = null (open-ended top rate).
 */
export function annualTaxFromBracketsCents(
  annualTaxableCents: number,
  brackets: PercentageBracket[]
): number {
  const wage = Math.max(0, Math.trunc(annualTaxableCents));
  let match: PercentageBracket | null = null;
  for (const b of brackets) {
    const lo = b.overCents;
    const hi = b.butNotOverCents;
    if (wage > lo && (hi == null || wage <= hi)) {
      match = b;
      break;
    }
  }
  // Fallback: if nothing matched (e.g. wage exactly 0 or a gap), use the highest bracket whose
  // lower bound the wage exceeds, else 0.
  if (!match) {
    for (const b of brackets) {
      if (wage > b.overCents) match = b;
    }
  }
  if (!match) return 0;
  const excess = Math.max(0, wage - match.ofExcessOverCents);
  return Math.max(0, match.baseCents + Math.round(excess * match.rate));
}

// ── Tax-table lookup ──────────────────────────────────────────────────────────

/**
 * A resolved, indexed set of the active payroll tax tables for ONE tax year, so the engine can
 * look a kind/status up in O(1). Built once per pay run from the rows the service fetched.
 */
export interface PayrollTaxTableSet {
  taxYear: number;
  /** Flat-rate kinds (one 'any' row each): fica_ss/fica_medicare/medicare_addl/futa/ca_ui/ca_ett/ca_sdi. */
  flat: Partial<Record<PayrollTaxKind, PayrollTaxTable>>;
  /** Percentage-method rows keyed by `${taxKind}:${filingStatus}` (fed_income_pit / ca_pit). */
  percentage: Record<string, PayrollTaxTable>;
}

const FLAT_KINDS: PayrollTaxKind[] = [
  'fica_ss',
  'fica_medicare',
  'medicare_addl',
  'futa',
  'ca_ui',
  'ca_ett',
  'ca_sdi',
];

/** Build the indexed lookup set from the active tax-table rows for a year (newest-effective wins). */
export function buildTaxTableSet(taxYear: number, rows: PayrollTaxTable[]): PayrollTaxTableSet {
  const flat: Partial<Record<PayrollTaxKind, PayrollTaxTable>> = {};
  const percentage: Record<string, PayrollTaxTable> = {};
  // Sort by effective date ascending so a later row overwrites an earlier one (last wins).
  const sorted = [...rows]
    .filter((r) => r.taxYear === taxYear && r.isActive)
    .sort((a, b) => (a.effectiveDate < b.effectiveDate ? -1 : a.effectiveDate > b.effectiveDate ? 1 : 0));
  for (const row of sorted) {
    if (row.taxKind === 'fed_income_pit' || row.taxKind === 'ca_pit') {
      const status = row.filingStatus === 'any' ? 'single' : row.filingStatus;
      percentage[`${row.taxKind}:${status}`] = row;
    } else if (FLAT_KINDS.includes(row.taxKind)) {
      flat[row.taxKind] = row;
    }
  }
  return { taxYear, flat, percentage };
}

/**
 * Resolve the percentage-method withholding row for a kind + filing status. married_separate
 * falls back to the single schedule (Pub 15-T pairs them); head_of_household falls back to single
 * when no HOH row is seeded (an explicit, surfaced approximation — see HUMAN-VERIFY). Returns
 * null when the kind is entirely unseeded (the caller then withholds 0 and flags the gap).
 */
export function resolvePercentageRow(
  set: PayrollTaxTableSet,
  kind: 'fed_income_pit' | 'ca_pit',
  status: PayrollFilingStatus
): PayrollTaxTable | null {
  const order: PayrollFilingStatus[] =
    status === 'married_separate'
      ? ['married_separate', 'single']
      : status === 'head_of_household'
        ? ['head_of_household', 'single']
        : [status];
  for (const s of order) {
    const row = set.percentage[`${kind}:${s}`];
    if (row) return row;
  }
  // Last resort: any seeded row for the kind (single is always seeded), so we never crash.
  return set.percentage[`${kind}:single`] ?? null;
}

// ── Per-paycheck computation ───────────────────────────────────────────────────

/** The taxable-wage inputs for one paycheck (all INTEGER CENTS), plus the prior-YTD context. */
export interface PaycheckTaxInput {
  /** Gross wages for THIS pay period, in cents (the statutory taxable base in this build). */
  grossCents: number;
  /** Year-to-date gross BEFORE this paycheck, in cents (drives the SS/FUTA/UI caps + Add'l Medicare). */
  ytdGrossCents: number;
  /** The employee's W-4/DE-4 inputs + pay frequency drive annualization + extra withholding. */
  employee: Pick<
    Employee,
    | 'employmentType'
    | 'fedFilingStatus'
    | 'fedMultipleJobs'
    | 'fedDependentsAmountCents'
    | 'fedOtherIncomeCents'
    | 'fedDeductionsCents'
    | 'fedExtraWithholdingCents'
    | 'caFilingStatus'
    | 'caAllowances'
    | 'caExtraWithholdingCents'
  >;
  frequency: PayFrequency;
}

/** One computed tax (employee + employer cents + the table id used) for the paycheck. */
export interface ComputedTaxLine {
  kind: PayrollTaxKind;
  employeeCents: number;
  employerCents: number;
  tableId: string | null;
  /** The taxable wage (post-cap/threshold) the rate applied to, in cents (for the paystub). */
  taxableWageCents: number;
}

/** The full computed tax result for one paycheck: every tax line + the rolled-up totals. */
export interface ComputedPaycheckTaxes {
  lines: ComputedTaxLine[];
  employeeTaxesCents: number;
  employerTaxesCents: number;
  /** Tax kinds the engine could not compute because the table row was missing (surfaced, not silent). */
  missingTables: PayrollTaxKind[];
}

/** Per-allowance annual exemption credit hook for CA DE-4 (placeholder; see HUMAN-VERIFY). */
const CA_ALLOWANCE_ANNUAL_CREDIT_CENTS = 0; // DE 44 Table 4 NOT applied in this build (gap).

/**
 * Annualize a period wage to a full-year amount, subtract the W-4 2020+ annual adjustments
 * (Step 4(b) deductions raise withholding-free wages; Step 4(a) other income + Step 3 are
 * applied to the ANNUAL tax, per Pub 15-T Worksheet 1), and return the annual TAXABLE wage in
 * cents used to walk the federal brackets. This is the Worksheet 1A flow at a high level; the
 * exact line-by-line ordering is on the HUMAN-VERIFY list.
 */
export function federalAnnualTaxableCents(input: PaycheckTaxInput): number {
  const periods = PAY_PERIODS_PER_YEAR[input.frequency];
  const annualGross = input.grossCents * periods;
  // Step 4(a) other income adds to annual wages; Step 4(b) deductions subtract (Pub 15-T W-1, 1a–1h).
  const adjusted =
    annualGross + input.employee.fedOtherIncomeCents - input.employee.fedDeductionsCents;
  return Math.max(0, Math.trunc(adjusted));
}

/**
 * Compute federal income-tax withholding for one paycheck (Pub 15-T percentage method): build
 * the annual taxable wage, walk the annual brackets, subtract the Step-3 dependents credit from
 * the ANNUAL tax, de-annualize back to the pay period, then add the Step 4(c) per-period extra.
 * Employer side is 0 (income tax is employee-only). Returns null when no bracket row is seeded.
 */
export function computeFederalIncomeWithholding(
  input: PaycheckTaxInput,
  set: PayrollTaxTableSet
): ComputedTaxLine | null {
  const row = resolvePercentageRow(set, 'fed_income_pit', input.employee.fedFilingStatus);
  if (!row || row.body.method !== 'percentage') return null;
  const body = row.body as PercentageMethodTaxTable;
  const periods = PAY_PERIODS_PER_YEAR[input.frequency];

  const annualTaxable = federalAnnualTaxableCents(input);
  const annualTaxGross = annualTaxFromBracketsCents(annualTaxable, body.brackets);
  // Step 3 dependents credit reduces ANNUAL tax (Pub 15-T Worksheet 1, line 3).
  const annualTaxAfterCredit = Math.max(0, annualTaxGross - input.employee.fedDependentsAmountCents);
  // De-annualize to the pay period (round half up).
  const perPeriod = Math.round(annualTaxAfterCredit / periods);
  const withheld = perPeriod + Math.max(0, input.employee.fedExtraWithholdingCents);

  return {
    kind: 'fed_income_pit',
    employeeCents: Math.max(0, withheld),
    employerCents: 0,
    tableId: row.id,
    taxableWageCents: input.grossCents,
  };
}

/**
 * Compute CA PIT withholding for one paycheck (EDD DE 44 Method B, Table 5 brackets only): walk
 * the annual brackets on the annualized gross, subtract the per-allowance exemption credit
 * (hook; DE 44 Table 4 not yet applied — see HUMAN-VERIFY), de-annualize, add the DE-4 extra.
 * Employer side is 0. Returns null when no bracket row is seeded.
 *
 * ⚠️  APPROXIMATION: DE 44 Tables 1–3 (low-income exemption + standard deduction) are NOT applied
 *     here, so CA withholding is an over-estimate vs the exact method for many employees. A
 *     payroll professional MUST complete the DE 44 method before this is used for filing.
 */
export function computeCaliforniaWithholding(
  input: PaycheckTaxInput,
  set: PayrollTaxTableSet
): ComputedTaxLine | null {
  const row = resolvePercentageRow(set, 'ca_pit', input.employee.caFilingStatus);
  if (!row || row.body.method !== 'percentage') return null;
  const body = row.body as PercentageMethodTaxTable;
  const periods = PAY_PERIODS_PER_YEAR[input.frequency];

  const annualGross = input.grossCents * periods;
  const annualTaxGross = annualTaxFromBracketsCents(annualGross, body.brackets);
  const allowanceCredit = Math.max(0, input.employee.caAllowances) * CA_ALLOWANCE_ANNUAL_CREDIT_CENTS;
  const annualTaxAfterCredit = Math.max(0, annualTaxGross - allowanceCredit);
  const perPeriod = Math.round(annualTaxAfterCredit / periods);
  const withheld = perPeriod + Math.max(0, input.employee.caExtraWithholdingCents);

  return {
    kind: 'ca_pit',
    employeeCents: Math.max(0, withheld),
    employerCents: 0,
    tableId: row.id,
    taxableWageCents: input.grossCents,
  };
}

/** Compute one flat-rate-with-cap tax (SS / Medicare / FUTA / CA UI / CA ETT). */
function computeFlatRate(
  kind: PayrollTaxKind,
  row: PayrollTaxTable | undefined,
  input: PaycheckTaxInput
): ComputedTaxLine | null {
  if (!row) return null;
  const body = row.body as FlatRateTaxTable;
  // Already-capped taxable slice of this period's wage.
  const taxable = taxableUnderBaseCents(input.grossCents, input.ytdGrossCents, body.wageBaseCents);
  const employeeCents = body.employeePaid ? applyRateCents(taxable, body.rate) : 0;
  const employerRate = body.employerRate ?? body.rate;
  const employerCents = body.employerPaid ? applyRateCents(taxable, employerRate) : 0;
  return { kind, employeeCents, employerCents, tableId: row.id, taxableWageCents: taxable };
}

/**
 * Compute the FULL federal + California tax set for ONE paycheck (employee withholding AND
 * employer tax), in integer cents. A 1099 contractor receives gross with NO withholding (returns
 * empty lines). Missing table rows are surfaced in `missingTables` (the caller flags the gap and
 * withholds 0 for that kind), never silently treated as zero-rate.
 *
 * Order of lines: fed income, CA PIT, SS, Medicare, Add'l Medicare, FUTA, CA UI, CA ETT, CA SDI.
 */
export function computePaycheckTaxes(
  input: PaycheckTaxInput,
  set: PayrollTaxTableSet
): ComputedPaycheckTaxes {
  const lines: ComputedTaxLine[] = [];
  const missing: PayrollTaxKind[] = [];

  // 1099-NEC contractors: gross, no withholding, no employer payroll tax (1099 is not payroll).
  if (input.employee.employmentType === '1099') {
    return { lines: [], employeeTaxesCents: 0, employerTaxesCents: 0, missingTables: [] };
  }

  const push = (line: ComputedTaxLine | null, kind: PayrollTaxKind) => {
    if (line) lines.push(line);
    else missing.push(kind);
  };

  // Income-tax withholding (employee-only).
  push(computeFederalIncomeWithholding(input, set), 'fed_income_pit');
  push(computeCaliforniaWithholding(input, set), 'ca_pit');

  // FICA Social Security (employee + matched employer, capped at the SS wage base).
  push(computeFlatRate('fica_ss', set.flat.fica_ss, input), 'fica_ss');

  // FICA Medicare (employee + matched employer, no cap).
  push(computeFlatRate('fica_medicare', set.flat.fica_medicare, input), 'fica_medicare');

  // Additional Medicare (EMPLOYEE-ONLY, 0.9% on the YTD slice over the threshold).
  const addlRow = set.flat.medicare_addl;
  if (addlRow) {
    const body = addlRow.body as FlatRateTaxTable;
    const overSlice = taxableOverThresholdCents(
      input.grossCents,
      input.ytdGrossCents,
      body.thresholdCents ?? Number.MAX_SAFE_INTEGER
    );
    lines.push({
      kind: 'medicare_addl',
      employeeCents: body.employeePaid ? applyRateCents(overSlice, body.rate) : 0,
      employerCents: 0, // never employer-matched
      tableId: addlRow.id,
      taxableWageCents: overSlice,
    });
  } else {
    missing.push('medicare_addl');
  }

  // FUTA (EMPLOYER-ONLY, capped at $7,000).
  push(computeFlatRate('futa', set.flat.futa, input), 'futa');
  // CA UI (EMPLOYER-ONLY, experience-rated, capped at $7,000).
  push(computeFlatRate('ca_ui', set.flat.ca_ui, input), 'ca_ui');
  // CA ETT (EMPLOYER-ONLY, capped at $7,000).
  push(computeFlatRate('ca_ett', set.flat.ca_ett, input), 'ca_ett');
  // CA SDI (EMPLOYEE-ONLY, no wage cap per SB 951).
  push(computeFlatRate('ca_sdi', set.flat.ca_sdi, input), 'ca_sdi');

  const employeeTaxesCents = lines.reduce((s, l) => s + l.employeeCents, 0);
  const employerTaxesCents = lines.reduce((s, l) => s + l.employerCents, 0);
  return { lines, employeeTaxesCents, employerTaxesCents, missingTables: missing };
}

// ── Whole-paycheck assembly (gross → taxes → net) ─────────────────────────────

/** A non-statutory deduction to apply to a paycheck (the engine treats all as post-tax). */
export interface DeductionInput {
  code: string;
  label: string;
  amountCents: number;
  pretax: boolean;
}

/**
 * The fully-computed cents for ONE paycheck: gross, the per-tax breakdown, employer-tax total,
 * employee-withholding total, other-deduction total, and net. The cents identity
 * net = gross − employeeTaxes − otherDeductions holds EXACTLY (net is clamped at 0). This is the
 * shape the service writes to accounting.paychecks; the commit RPC re-asserts the identity
 * before posting.
 */
export interface ComputedPaycheck {
  grossCents: number;
  taxes: ComputedPaycheckTaxes;
  employeeTaxesCents: number;
  employerTaxesCents: number;
  otherDeductionsCents: number;
  netCents: number;
  /** Surfaced engine warnings (e.g. missing tax tables, net floored at 0) for the UI. */
  warnings: string[];
}

/**
 * Assemble a whole paycheck from a gross amount, the YTD context, the employee, the frequency,
 * and optional deductions. Computes the tax set, sums employee withholding + deductions, and
 * derives net = max(0, gross − employeeTaxes − deductions). If withholding + deductions would
 * exceed gross, net is floored at 0 and a warning is surfaced (the run still balances because
 * the commit RPC books the actual employee-tax + deduction cents against 2300, not a clamped
 * value — but a floored net means something is mis-configured; the human is warned).
 *
 * IMPORTANT: net is floored at 0 for display/storage sanity, BUT the cents identity the commit
 * RPC asserts is net = gross − employeeTaxes − otherDeductions. To keep that identity EXACT when
 * a floor would otherwise break it, this function reduces the LAST deduction (then, if still
 * negative, scales withholding) is NOT done here — instead, when gross is too small to cover the
 * statutory withholding we DO NOT clamp silently: we surface the warning and return the
 * arithmetic net (which the commit RPC will reject if negative, rolling the run back). A negative
 * net is therefore impossible to commit; the engine refuses to fabricate a balanced-but-wrong run.
 */
export function assemblePaycheck(
  grossCents: number,
  ytdGrossCents: number,
  employee: PaycheckTaxInput['employee'],
  frequency: PayFrequency,
  set: PayrollTaxTableSet,
  deductions: DeductionInput[] = []
): ComputedPaycheck {
  const gross = Math.max(0, Math.trunc(grossCents));
  const taxes = computePaycheckTaxes({ grossCents: gross, ytdGrossCents, employee, frequency }, set);
  const otherDeductionsCents = deductions.reduce((s, d) => s + Math.max(0, Math.trunc(d.amountCents)), 0);
  const employeeTaxesCents = taxes.employeeTaxesCents;
  const employerTaxesCents = taxes.employerTaxesCents;
  const netCents = gross - employeeTaxesCents - otherDeductionsCents;

  const warnings: string[] = [];
  if (taxes.missingTables.length > 0) {
    warnings.push(
      `Missing tax tables for: ${taxes.missingTables.join(', ')} — those taxes were withheld as 0. Add the rows in the Admin Tax-Table screen.`
    );
  }
  if (netCents < 0) {
    warnings.push(
      'Withholding + deductions exceed gross pay for this employee — net is negative, so the run cannot be committed. Check the withholding inputs and deductions.'
    );
  }

  return {
    grossCents: gross,
    taxes,
    employeeTaxesCents,
    employerTaxesCents,
    otherDeductionsCents,
    // Return the ARITHMETIC net (may be negative) so the commit RPC's cents-identity assert
    // catches a mis-configuration and rolls back — never a fabricated balanced-but-wrong run.
    netCents,
    warnings,
  };
}

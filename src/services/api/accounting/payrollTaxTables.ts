/**
 * ⚠️  HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING. The Admin Tax-Table service for the
 *     FLAG-DARK payroll module: read + edit the admin-updatable accounting.payroll_tax_tables
 *     statutory reference rows (rates / wage bases / withholding brackets). Editing a rate is a
 *     payroll-privileged operation (RLS write = can_payroll()); the standard audit trigger on the
 *     table is the rate-edit tamper trail. These rows move NO money — they only change how a
 *     FUTURE pay run computes withholding. EVERY value MUST be verified by a CPA/EA against the
 *     current IRS Pub 15 / Pub 15-T and CA EDD DE 44 for the tax year before any real use.
 *
 * Reads THROW (React Query surfaces them); writes return a result object whose `error` carries the
 * DB message (an RLS denial, the natural-key unique violation) for inline display.
 */
import type {
  NewPayrollTaxTableInput,
  PayrollTaxKind,
  PayrollTaxTable,
  PayrollTaxTableBody,
  UpdatePayrollTaxTableInput,
} from '../../../features/accounting/types';
import { acct } from './accountingClient';
import { mapPayrollTaxTableRow, type Row } from './mappers';

/** Convert a domain PayrollTaxTableBody to the snake_case table_json the DB stores. */
function bodyToJson(body: PayrollTaxTableBody): Record<string, unknown> {
  if (body.method === 'percentage') {
    return {
      method: 'percentage',
      pay_periods_per_year: body.payPeriodsPerYear,
      standard_deduction_cents: body.standardDeductionCents,
      brackets: body.brackets.map((b) => ({
        over_cents: b.overCents,
        but_not_over_cents: b.butNotOverCents,
        base_cents: b.baseCents,
        rate: b.rate,
        of_excess_over_cents: b.ofExcessOverCents,
      })),
    };
  }
  const out: Record<string, unknown> = {
    rate: body.rate,
    employer_rate: body.employerRate,
    wage_base_cents: body.wageBaseCents,
    threshold_cents: body.thresholdCents,
    employee_paid: body.employeePaid,
    employer_paid: body.employerPaid,
  };
  if (body.grossRate != null) out.gross_rate = body.grossRate;
  if (body.standardStateCredit != null) out.standard_state_credit = body.standardStateCredit;
  return out;
}

export const payrollTaxTablesService = {
  /**
   * All payroll tax-table rows for a tax year (active + inactive for the admin screen), ordered by
   * jurisdiction → kind → effective date. Pass `includeInactive=false` to show only the live rows.
   */
  async listForYear(taxYear: number, includeInactive = true): Promise<PayrollTaxTable[]> {
    let q = acct()
      .from('payroll_tax_tables')
      .select('*')
      .eq('tax_year', taxYear)
      .order('jurisdiction', { ascending: true })
      .order('tax_kind', { ascending: true })
      .order('effective_date', { ascending: false });
    if (!includeInactive) q = q.eq('is_active', true);
    const { data, error } = await q;
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapPayrollTaxTableRow);
  },

  /** Every distinct tax year that has at least one seeded row (newest first) — for the year picker. */
  async listTaxYears(): Promise<number[]> {
    const { data, error } = await acct().from('payroll_tax_tables').select('tax_year');
    if (error) throw error;
    const years = new Set<number>();
    for (const r of (data ?? []) as Row[]) years.add(Number(r.tax_year));
    return [...years].filter((y) => Number.isFinite(y)).sort((a, b) => b - a);
  },

  /** One tax-table row, or null. */
  async getById(id: string): Promise<PayrollTaxTable | null> {
    const { data, error } = await acct()
      .from('payroll_tax_tables')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    return mapPayrollTaxTableRow(data as Row);
  },

  /**
   * Insert a new tax-table row (admin override / add a missing filing status). source_citation +
   * source_revision are REQUIRED (NOT NULL in the DB) so the provenance the verifier needs is
   * always present. filing_status/pay_frequency default to 'any' for flat-rate kinds.
   */
  async create(
    input: NewPayrollTaxTableInput
  ): Promise<{ row: PayrollTaxTable | null; error?: string }> {
    if (!input.sourceCitation?.trim() || !input.sourceRevision?.trim()) {
      return {
        row: null,
        error: 'A tax-table row needs a source citation and revision (provenance is required).',
      };
    }
    const { data, error } = await acct()
      .from('payroll_tax_tables')
      .insert({
        jurisdiction: input.jurisdiction,
        tax_kind: input.taxKind,
        tax_year: input.taxYear,
        effective_date: input.effectiveDate,
        filing_status: input.filingStatus ?? 'any',
        pay_frequency: input.payFrequency ?? 'any',
        table_json: bodyToJson(input.body),
        source_citation: input.sourceCitation.trim(),
        source_revision: input.sourceRevision.trim(),
        notes: input.notes ?? null,
        is_active: input.isActive ?? true,
      })
      .select('*')
      .single();
    if (error || !data)
      return { row: null, error: error?.message ?? 'Failed to create the tax-table row.' };
    return { row: mapPayrollTaxTableRow(data as Row) };
  },

  /**
   * Patch a tax-table row's body / provenance / active flag (the natural key is immutable — correct
   * a wrong key by deactivating + inserting a new row). A blanked citation/revision is rejected
   * (provenance must remain present).
   */
  async update(
    id: string,
    input: UpdatePayrollTaxTableInput
  ): Promise<{ row: PayrollTaxTable | null; error?: string }> {
    const patch: Record<string, unknown> = {};
    if (input.body !== undefined) patch.table_json = bodyToJson(input.body);
    if (input.effectiveDate !== undefined) patch.effective_date = input.effectiveDate;
    if (input.sourceCitation !== undefined) {
      if (!input.sourceCitation.trim())
        return { row: null, error: 'The source citation cannot be blank.' };
      patch.source_citation = input.sourceCitation.trim();
    }
    if (input.sourceRevision !== undefined) {
      if (!input.sourceRevision.trim())
        return { row: null, error: 'The source revision cannot be blank.' };
      patch.source_revision = input.sourceRevision.trim();
    }
    if (input.notes !== undefined) patch.notes = input.notes;
    if (input.isActive !== undefined) patch.is_active = input.isActive;
    if (Object.keys(patch).length === 0) return { row: await this.getById(id) };
    const { data, error } = await acct()
      .from('payroll_tax_tables')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data)
      return { row: null, error: error?.message ?? 'Failed to update the tax-table row.' };
    return { row: mapPayrollTaxTableRow(data as Row) };
  },

  /** Retire a row without deleting it (keeps the audit trail). Reactivate via update({ isActive:true }). */
  async setActive(id: string, isActive: boolean): Promise<{ ok: boolean; error?: string }> {
    const { error } = await acct()
      .from('payroll_tax_tables')
      .update({ is_active: isActive })
      .eq('id', id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  /**
   * The set of tax kinds that are SEEDED (active) for a year — so the UI can flag GAPS (a missing
   * kind means the engine withholds 0 for it, surfaced as an explicit gap). Returns the present
   * kinds; the caller compares against the full PAYROLL_TAX_KINDS list.
   */
  async seededKinds(taxYear: number): Promise<PayrollTaxKind[]> {
    const rows = await this.listForYear(taxYear, false);
    return [...new Set(rows.map((r) => r.taxKind))];
  },
};

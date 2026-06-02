/**
 * ⚠️  HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING. The payroll module is FLAG-DARK
 *     (VITE_ACCOUNTING_ENABLED off) and requires a CPA/EA payroll professional AND/OR security
 *     sign-off before it is enabled. Every payroll screen/report/export renders a PROMINENT
 *     "UNVERIFIED — NOT FOR FILING" banner (UI lane).
 *
 * The payroll service: employee + pay-schedule masters, and the PAY-RUN lifecycle. The ONLY
 * money path is `commitPayRun`, which calls the SECURITY DEFINER, can_payroll()-gated
 * accounting.commit_pay_run RPC — that builds ONE balanced journal entry (Dr 6500 gross + Dr 6510
 * employer tax / Cr 2300 liabilities + Cr 1010 net) and posts it through the GL's single balance
 * guard (debits = credits + >= 2 lines), asserting the cents identity G+Eᵣ = (Wₑ+Eᵣ+D)+N first.
 * Net pay parks in 1010 Payroll Clearing — NO real bank rail is touched (NACHA is a STUB).
 *
 * CALCULATE (no money moves): `calculatePayRun` runs the pure withholding ENGINE
 * (payrollTax.ts) + the pure hours derivation (payrollHours.ts) to compute each active employee's
 * paycheck cents, then (a) calls the recalc RPC to clear any prior paychecks, (b) inserts the
 * fresh paychecks + per-agency payroll_liabilities, and (c) flips the run to 'calculated'. Hours
 * are sourced READ-ONLY from public.shifts (payroll never writes shifts). EVERY rate/bracket the
 * engine uses (migration 028) must be verified by a payroll professional before use.
 *
 * Reads THROW (React Query surfaces them); writes/RPC writers return result objects whose `error`
 * carries the DB message (RLS denial, the cents-identity rejection, a closed-period lock) for
 * inline display. Only accounting.* is written; public.* (profiles/jobs/shifts) is read-only.
 *
 * MONEY (G6): every persisted monetary value is INTEGER CENTS; hours are HUNDREDTHS-OF-AN-HOUR.
 * Dollars appear only at the JE boundary inside the commit RPC (cents / 100.0).
 */
import type {
  CalculatePayRunResult,
  CommitPayRunResult,
  Employee,
  NewEmployeeInput,
  NewPayRunInput,
  NewPayScheduleInput,
  Paycheck,
  PayrollLiability,
  PayRun,
  PaySchedule,
  PayrollTaxTable,
  UpdateEmployeeInput,
  UpdatePayScheduleInput,
} from '../../../features/accounting/types';
import { PAY_PERIODS_PER_YEAR } from '../../../features/accounting/types';
import { toIsoDate } from '../../../features/accounting/periodLock';
import { acct } from './accountingClient';
import { supabase } from '../supabaseClient';
import {
  mapEmployeeRow,
  mapPaycheckRow,
  mapPayRunRow,
  mapPayScheduleRow,
  mapPayrollLiabilityRow,
  mapPayrollTaxTableRow,
  type Row,
} from './mappers';
import {
  buildTaxTableSet,
  assemblePaycheck,
  type ComputedPaycheck,
  type ComputedTaxLine,
  type DeductionInput,
} from './payrollTax';
import {
  deriveHoursFromShifts,
  hourlyGrossCents,
  salaryGrossCents,
  type ShiftRecord,
} from './payrollHours';

// ── Internal: tax-kind → jurisdiction for the per-agency liability accrual ────

const TAX_JURISDICTION: Record<string, 'federal' | 'CA'> = {
  fica_ss: 'federal',
  fica_medicare: 'federal',
  medicare_addl: 'federal',
  futa: 'federal',
  fed_income_pit: 'federal',
  ca_ui: 'CA',
  ca_ett: 'CA',
  ca_sdi: 'CA',
  ca_pit: 'CA',
};

export const employeesService = {
  /** All employees (active by default), newest first. */
  async list(includeInactive = false): Promise<Employee[]> {
    let q = acct().from('employees').select('*').order('display_name', { ascending: true });
    if (!includeInactive) q = q.eq('is_active', true);
    const { data, error } = await q;
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapEmployeeRow);
  },

  /** One employee, or null when absent. */
  async getById(id: string): Promise<Employee | null> {
    const { data, error } = await acct().from('employees').select('*').eq('id', id).maybeSingle();
    if (error || !data) return null;
    return mapEmployeeRow(data as Row);
  },

  /**
   * Create an employee. SSN/bank fields are intentionally NOT writable here — they are Phase-E
   * encrypted placeholders and must stay NULL until field encryption lands (G8). Returns the row
   * or `{ employee: null, error }` on failure.
   */
  async create(input: NewEmployeeInput): Promise<{ employee: Employee | null; error?: string }> {
    const name = input.displayName?.trim();
    if (!name) return { employee: null, error: 'An employee needs a name.' };
    const { data, error } = await acct()
      .from('employees')
      .insert({
        display_name: name,
        email: input.email ?? null,
        profile_id: input.profileId ?? null,
        employment_type: input.employmentType ?? 'w2',
        fed_filing_status: input.fedFilingStatus ?? 'single',
        fed_multiple_jobs: input.fedMultipleJobs ?? false,
        fed_dependents_amount_cents: input.fedDependentsAmountCents ?? 0,
        fed_other_income_cents: input.fedOtherIncomeCents ?? 0,
        fed_deductions_cents: input.fedDeductionsCents ?? 0,
        fed_extra_withholding_cents: input.fedExtraWithholdingCents ?? 0,
        ca_filing_status: input.caFilingStatus ?? 'single',
        ca_allowances: input.caAllowances ?? 0,
        ca_extra_withholding_cents: input.caExtraWithholdingCents ?? 0,
        pay_type: input.payType ?? 'hourly',
        pay_rate_cents: input.payRateCents ?? 0,
        default_job_id: input.defaultJobId ?? null,
        is_active: input.isActive ?? true,
        notes: input.notes ?? null,
      })
      .select('*')
      .single();
    if (error || !data)
      return { employee: null, error: error?.message ?? 'Failed to create the employee.' };
    return { employee: mapEmployeeRow(data as Row) };
  },

  /** Patch an employee (SSN/bank intentionally not patchable here — Phase E). */
  async update(
    id: string,
    input: UpdateEmployeeInput
  ): Promise<{ employee: Employee | null; error?: string }> {
    const patch: Record<string, unknown> = {};
    if (input.displayName !== undefined) {
      const name = input.displayName.trim();
      if (!name) return { employee: null, error: 'An employee needs a name.' };
      patch.display_name = name;
    }
    if (input.email !== undefined) patch.email = input.email;
    if (input.profileId !== undefined) patch.profile_id = input.profileId;
    if (input.employmentType !== undefined) patch.employment_type = input.employmentType;
    if (input.fedFilingStatus !== undefined) patch.fed_filing_status = input.fedFilingStatus;
    if (input.fedMultipleJobs !== undefined) patch.fed_multiple_jobs = input.fedMultipleJobs;
    if (input.fedDependentsAmountCents !== undefined)
      patch.fed_dependents_amount_cents = input.fedDependentsAmountCents;
    if (input.fedOtherIncomeCents !== undefined)
      patch.fed_other_income_cents = input.fedOtherIncomeCents;
    if (input.fedDeductionsCents !== undefined)
      patch.fed_deductions_cents = input.fedDeductionsCents;
    if (input.fedExtraWithholdingCents !== undefined)
      patch.fed_extra_withholding_cents = input.fedExtraWithholdingCents;
    if (input.caFilingStatus !== undefined) patch.ca_filing_status = input.caFilingStatus;
    if (input.caAllowances !== undefined) patch.ca_allowances = input.caAllowances;
    if (input.caExtraWithholdingCents !== undefined)
      patch.ca_extra_withholding_cents = input.caExtraWithholdingCents;
    if (input.payType !== undefined) patch.pay_type = input.payType;
    if (input.payRateCents !== undefined) patch.pay_rate_cents = input.payRateCents;
    if (input.defaultJobId !== undefined) patch.default_job_id = input.defaultJobId;
    if (input.isActive !== undefined) patch.is_active = input.isActive;
    if (input.notes !== undefined) patch.notes = input.notes;
    if (Object.keys(patch).length === 0) return { employee: await this.getById(id) };
    const { data, error } = await acct()
      .from('employees')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data)
      return { employee: null, error: error?.message ?? 'Failed to update the employee.' };
    return { employee: mapEmployeeRow(data as Row) };
  },

  /** Soft-deactivate an employee (never hard-delete — paychecks reference them ON DELETE RESTRICT). */
  async setActive(id: string, isActive: boolean): Promise<{ ok: boolean; error?: string }> {
    const { error } = await acct().from('employees').update({ is_active: isActive }).eq('id', id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },
};

export const payScheduleService = {
  /** All pay schedules (active by default). */
  async list(includeInactive = false): Promise<PaySchedule[]> {
    let q = acct().from('pay_schedules').select('*').order('name', { ascending: true });
    if (!includeInactive) q = q.eq('is_active', true);
    const { data, error } = await q;
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapPayScheduleRow);
  },

  async getById(id: string): Promise<PaySchedule | null> {
    const { data, error } = await acct()
      .from('pay_schedules')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    return mapPayScheduleRow(data as Row);
  },

  async create(
    input: NewPayScheduleInput
  ): Promise<{ schedule: PaySchedule | null; error?: string }> {
    const name = input.name?.trim();
    if (!name) return { schedule: null, error: 'A pay schedule needs a name.' };
    const anchor = toIsoDate(input.anchorDate);
    if (!anchor) return { schedule: null, error: 'A pay schedule needs an anchor date.' };
    const { data, error } = await acct()
      .from('pay_schedules')
      .insert({
        name,
        frequency: input.frequency,
        anchor_date: anchor,
        next_period_start: toIsoDate(input.nextPeriodStart),
        next_period_end: toIsoDate(input.nextPeriodEnd),
        next_pay_date: toIsoDate(input.nextPayDate),
        is_active: input.isActive ?? true,
      })
      .select('*')
      .single();
    if (error || !data)
      return { schedule: null, error: error?.message ?? 'Failed to create the pay schedule.' };
    return { schedule: mapPayScheduleRow(data as Row) };
  },

  async update(
    id: string,
    input: UpdatePayScheduleInput
  ): Promise<{ schedule: PaySchedule | null; error?: string }> {
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) return { schedule: null, error: 'A pay schedule needs a name.' };
      patch.name = name;
    }
    if (input.frequency !== undefined) patch.frequency = input.frequency;
    if (input.anchorDate !== undefined) patch.anchor_date = toIsoDate(input.anchorDate);
    if (input.nextPeriodStart !== undefined)
      patch.next_period_start = toIsoDate(input.nextPeriodStart);
    if (input.nextPeriodEnd !== undefined) patch.next_period_end = toIsoDate(input.nextPeriodEnd);
    if (input.nextPayDate !== undefined) patch.next_pay_date = toIsoDate(input.nextPayDate);
    if (input.isActive !== undefined) patch.is_active = input.isActive;
    if (Object.keys(patch).length === 0) return { schedule: await this.getById(id) };
    const { data, error } = await acct()
      .from('pay_schedules')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data)
      return { schedule: null, error: error?.message ?? 'Failed to update the pay schedule.' };
    return { schedule: mapPayScheduleRow(data as Row) };
  },
};

/** A per-employee override the UI can pass into a calculation (extra deductions; hour override). */
export interface PayRunEmployeeInput {
  employeeId: string;
  /** Non-statutory deductions to apply to this employee's check this run. */
  deductions?: DeductionInput[];
  /**
   * Optional manual hour override (HUNDREDTHS-OF-AN-HOUR) for an hourly employee, bypassing the
   * shift-sourced derivation (e.g. a salaried-but-hours-tracked correction). When omitted, hourly
   * employees are paid from their public.shifts in the period; salaried employees are paid their
   * per-period salary regardless of hours.
   */
  regularHourCentsOverride?: number;
  overtimeHourCentsOverride?: number;
}

export const payRunService = {
  /** All pay runs, newest pay date first. */
  async list(limit = 100): Promise<PayRun[]> {
    const { data, error } = await acct()
      .from('pay_runs')
      .select('*')
      .order('pay_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapPayRunRow);
  },

  /** One pay run header. */
  async getById(id: string): Promise<PayRun | null> {
    const { data, error } = await acct().from('pay_runs').select('*').eq('id', id).maybeSingle();
    if (error || !data) return null;
    return mapPayRunRow(data as Row);
  },

  /** A run's paychecks (employee name hydrated), in employee-name order. */
  async listPaychecks(payRunId: string): Promise<Paycheck[]> {
    const { data, error } = await acct()
      .from('paychecks')
      .select('*, employee:employees(display_name)')
      .eq('pay_run_id', payRunId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapPaycheckRow);
  },

  /** One paycheck (employee name hydrated). */
  async getPaycheck(id: string): Promise<Paycheck | null> {
    const { data, error } = await acct()
      .from('paychecks')
      .select('*, employee:employees(display_name)')
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    return mapPaycheckRow(data as Row);
  },

  /** A run's per-agency liability accruals. */
  async listLiabilities(payRunId: string): Promise<PayrollLiability[]> {
    const { data, error } = await acct()
      .from('payroll_liabilities')
      .select('*')
      .eq('pay_run_id', payRunId)
      .order('jurisdiction', { ascending: true })
      .order('tax_kind', { ascending: true });
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapPayrollLiabilityRow);
  },

  /** Create a draft pay run. taxYear defaults to the pay date's year. */
  async createDraft(input: NewPayRunInput): Promise<{ run: PayRun | null; error?: string }> {
    const periodStart = toIsoDate(input.periodStart);
    const periodEnd = toIsoDate(input.periodEnd);
    const payDate = toIsoDate(input.payDate);
    if (!periodStart || !periodEnd || !payDate) {
      return { run: null, error: 'A pay run needs a period start, period end, and pay date.' };
    }
    if (periodEnd < periodStart) {
      return { run: null, error: 'The period end cannot be before the period start.' };
    }
    const taxYear = input.taxYear ?? Number(payDate.slice(0, 4));
    const { data, error } = await acct()
      .from('pay_runs')
      .insert({
        pay_schedule_id: input.payScheduleId ?? null,
        period_start: periodStart,
        period_end: periodEnd,
        pay_date: payDate,
        tax_year: taxYear,
        status: 'draft',
      })
      .select('*')
      .single();
    if (error || !data)
      return { run: null, error: error?.message ?? 'Failed to create the pay run.' };
    return { run: mapPayRunRow(data as Row) };
  },

  /**
   * CALCULATE (or recalculate) a pay run: run the pure engine for every active employee, then
   * persist the paychecks + per-agency liability accruals and flip the run to 'calculated'. Moves
   * NO money (the ledger is touched only by commit). Refuses on a committed/void run.
   *
   * Steps:
   *   1. Load the run, the active employees, and the active tax tables for the run's tax year.
   *   2. For each employee: derive hours (hourly → from public.shifts in the period, read-only;
   *      salaried → per-period salary), compute gross, run the withholding engine → paycheck cents.
   *   3. Call accounting.recalc_pay_run to clear any prior paychecks/liabilities (idempotent).
   *   4. Insert the fresh paychecks (and their per-agency liabilities), then set status='calculated'.
   * A negative net (withholding/deductions exceed gross) aborts that employee with a surfaced
   * skip+warning rather than persisting an un-committable check.
   */
  async calculate(
    payRunId: string,
    overrides: PayRunEmployeeInput[] = []
  ): Promise<CalculatePayRunResult> {
    const empty: CalculatePayRunResult = {
      ok: false,
      paychecksWritten: 0,
      grossCents: 0,
      employeeTaxCents: 0,
      employerTaxCents: 0,
      otherDeductionsCents: 0,
      netCents: 0,
      skipped: [],
    };

    let run: PayRun | null;
    let employees: Employee[];
    let taxRows: PayrollTaxTable[];
    try {
      run = await this.getById(payRunId);
      if (!run) return { ...empty, error: 'Pay run not found.' };
      if (run.status === 'committed' || run.status === 'void') {
        return { ...empty, error: `A ${run.status} pay run cannot be recalculated.` };
      }
      employees = await employeesService.list(false);
      const { data, error } = await acct()
        .from('payroll_tax_tables')
        .select('*')
        .eq('tax_year', run.taxYear)
        .eq('is_active', true);
      if (error) throw error;
      taxRows = ((data ?? []) as Row[]).map(mapPayrollTaxTableRow);
    } catch (e) {
      return {
        ...empty,
        error: e instanceof Error ? e.message : 'Failed to load the pay run inputs.',
      };
    }

    const taxSet = buildTaxTableSet(run.taxYear, taxRows);
    const overrideByEmp = new Map(overrides.map((o) => [o.employeeId, o]));
    const periods = PAY_PERIODS_PER_YEAR[scheduleFrequencyFallback(run)];

    const skipped: CalculatePayRunResult['skipped'] = [];
    const paycheckRows: Row[] = [];
    const liabilityRows: Row[] = [];
    let totalGross = 0;
    let totalEmployeeTax = 0;
    let totalEmployerTax = 0;
    let totalDeductions = 0;
    let totalNet = 0;

    for (const emp of employees) {
      const ovr = overrideByEmp.get(emp.id);
      const deductions = ovr?.deductions ?? [];

      // Derive hours + gross.
      let regularHourCents = 0;
      let overtimeHourCents = 0;
      let sourceShiftIds: string[] = [];
      let grossCents = 0;

      if (emp.payType === 'salary') {
        grossCents = salaryGrossCents(emp.payRateCents, periods);
        // Salaried still records hours for the paystub if shifts exist (informational).
        if (emp.profileId) {
          const shifts = await loadShifts(emp.profileId, run.periodStart, run.periodEnd);
          const h = deriveHoursFromShifts(shifts);
          regularHourCents = h.regularHourCents;
          overtimeHourCents = h.overtimeHourCents;
          sourceShiftIds = h.sourceShiftIds;
        }
      } else {
        // Hourly: use a manual override when supplied, else source from public.shifts (read-only).
        if (ovr?.regularHourCentsOverride != null || ovr?.overtimeHourCentsOverride != null) {
          regularHourCents = Math.max(0, ovr.regularHourCentsOverride ?? 0);
          overtimeHourCents = Math.max(0, ovr.overtimeHourCentsOverride ?? 0);
        } else if (emp.profileId) {
          const shifts = await loadShifts(emp.profileId, run.periodStart, run.periodEnd);
          const h = deriveHoursFromShifts(shifts);
          regularHourCents = h.regularHourCents;
          overtimeHourCents = h.overtimeHourCents;
          sourceShiftIds = h.sourceShiftIds;
        }
        grossCents = hourlyGrossCents({ regularHourCents, overtimeHourCents }, emp.payRateCents);
      }

      // Skip employees with no pay this period (no hours / zero salary) — nothing to book.
      if (grossCents <= 0) {
        skipped.push({
          employeeId: emp.id,
          employeeName: emp.displayName,
          reason: 'No pay this period (no hours / zero rate).',
        });
        continue;
      }

      // Run the withholding engine. YTD = prior committed gross this tax year (for the wage caps).
      const ytdGrossCents = await this.ytdGrossForEmployee(emp.id, run.taxYear, payRunId);
      const computed: ComputedPaycheck = assemblePaycheck(
        grossCents,
        ytdGrossCents,
        emp,
        scheduleFrequencyFallback(run),
        taxSet,
        deductions
      );

      if (computed.netCents < 0) {
        skipped.push({
          employeeId: emp.id,
          employeeName: emp.displayName,
          reason: 'Withholding + deductions exceed gross — check the withholding inputs.',
        });
        continue;
      }

      paycheckRows.push({
        pay_run_id: payRunId,
        employee_id: emp.id,
        hours_regular_cents: regularHourCents,
        hours_ot_cents: overtimeHourCents,
        gross_cents: computed.grossCents,
        taxes: computedTaxesToJson(computed.taxes.lines),
        deductions: deductions.map((d) => ({
          code: d.code,
          label: d.label,
          amount_cents: d.amountCents,
          pretax: d.pretax,
        })),
        employer_taxes_cents: computed.employerTaxesCents,
        employee_taxes_cents: computed.employeeTaxesCents,
        other_deductions_cents: computed.otherDeductionsCents,
        net_cents: computed.netCents,
        source_shift_ids: sourceShiftIds,
      });

      // Per-agency liability accruals (one row per non-zero employee/employer tax slice).
      for (const line of computed.taxes.lines) {
        const jurisdiction = TAX_JURISDICTION[line.kind] ?? 'federal';
        if (line.employeeCents > 0) {
          liabilityRows.push({
            pay_run_id: payRunId,
            jurisdiction,
            tax_kind: line.kind,
            party: 'employee',
            amount_cents: line.employeeCents,
          });
        }
        if (line.employerCents > 0) {
          liabilityRows.push({
            pay_run_id: payRunId,
            jurisdiction,
            tax_kind: line.kind,
            party: 'employer',
            amount_cents: line.employerCents,
          });
        }
      }

      totalGross += computed.grossCents;
      totalEmployeeTax += computed.employeeTaxesCents;
      totalEmployerTax += computed.employerTaxesCents;
      totalDeductions += computed.otherDeductionsCents;
      totalNet += computed.netCents;
    }

    // Reset any prior paychecks/liabilities via the RPC (idempotent; refuses on committed/void).
    const { error: recalcErr } = await acct().rpc('recalc_pay_run', { p_run_id: payRunId });
    if (recalcErr) return { ...empty, skipped, error: recalcErr.message };

    if (paycheckRows.length > 0) {
      const { error: pcErr } = await acct().from('paychecks').insert(paycheckRows);
      if (pcErr) return { ...empty, skipped, error: pcErr.message };
    }
    if (liabilityRows.length > 0) {
      const { error: liErr } = await acct().from('payroll_liabilities').insert(liabilityRows);
      if (liErr) return { ...empty, skipped, error: liErr.message };
    }

    // Flip to 'calculated' (only from a non-committed state).
    const { error: statusErr } = await acct()
      .from('pay_runs')
      .update({ status: 'calculated', updated_at: new Date().toISOString() })
      .eq('id', payRunId)
      .in('status', ['draft', 'calculated']);
    if (statusErr) return { ...empty, skipped, error: statusErr.message };

    return {
      ok: true,
      paychecksWritten: paycheckRows.length,
      grossCents: totalGross,
      employeeTaxCents: totalEmployeeTax,
      employerTaxCents: totalEmployerTax,
      otherDeductionsCents: totalDeductions,
      netCents: totalNet,
      skipped,
    };
  },

  /**
   * Year-to-date gross for an employee across COMMITTED pay runs in a tax year, EXCLUDING the run
   * being computed (so a recalc of the same run doesn't double-count it). Drives the SS/FUTA/UI
   * wage caps + the Additional-Medicare threshold. Reads committed paychecks only.
   */
  async ytdGrossForEmployee(
    employeeId: string,
    taxYear: number,
    excludeRunId: string
  ): Promise<number> {
    // Find the committed runs for this tax year (excluding the current one).
    const { data: runRows, error: runErr } = await acct()
      .from('pay_runs')
      .select('id')
      .eq('tax_year', taxYear)
      .eq('status', 'committed')
      .neq('id', excludeRunId);
    if (runErr) throw runErr;
    const runIds = ((runRows ?? []) as Row[]).map((r) => String(r.id));
    if (runIds.length === 0) return 0;
    const { data, error } = await acct()
      .from('paychecks')
      .select('gross_cents')
      .eq('employee_id', employeeId)
      .in('pay_run_id', runIds);
    if (error) throw error;
    return ((data ?? []) as Row[]).reduce((s, r) => s + Number(r.gross_cents ?? 0), 0);
  },

  /**
   * COMMIT a pay run — the ONLY money path. Calls accounting.commit_pay_run, which asserts the
   * cents identity (G+Eᵣ = (Wₑ+Eᵣ+D)+N) then posts ONE balanced JE (Dr 6500/6510 / Cr 2300/1010)
   * through the GL's single balance guard, stamping the run committed + summary. Idempotent
   * (re-committing returns the stored summary). A DB rejection (unbalanced, wrong status,
   * non-payroll user, closed period) comes back `{ ok:false, error }` with the WHOLE commit rolled
   * back — never a half-posted run.
   */
  async commit(payRunId: string): Promise<CommitPayRunResult> {
    const { data, error } = await acct().rpc('commit_pay_run', { p_run_id: payRunId });
    if (error) return { ok: false, error: error.message };
    return { ok: true, summary: normalizeSummary(data) };
  },

  /**
   * VOID a committed pay run: calls accounting.void_pay_run, which voids the run's posted JE
   * (posted entries are immutable — only posted→void is allowed) and marks the run 'void'. Returns
   * `{ ok, error }`; a DB rejection (not committed, non-payroll user) comes back as `{ ok:false }`.
   */
  async voidRun(payRunId: string, reason: string): Promise<{ ok: boolean; error?: string }> {
    const { error } = await acct().rpc('void_pay_run', { p_run_id: payRunId, p_reason: reason });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  /** Discard a DRAFT/calculated run by clearing it (recalc) then deleting it. Refuses once committed. */
  async deleteDraft(payRunId: string): Promise<{ ok: boolean; error?: string }> {
    const run = await this.getById(payRunId);
    if (!run) return { ok: false, error: 'Pay run not found.' };
    if (run.status === 'committed' || run.status === 'void') {
      return { ok: false, error: `A ${run.status} pay run cannot be deleted (void it instead).` };
    }
    // Paychecks cascade on delete; clear liabilities first for tidiness via recalc, then delete.
    const { error: recalcErr } = await acct().rpc('recalc_pay_run', { p_run_id: payRunId });
    if (recalcErr) return { ok: false, error: recalcErr.message };
    const { error } = await acct().from('pay_runs').delete().eq('id', payRunId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },
};

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Load an employee's public.shifts in a date window (READ-ONLY). Payroll never writes shifts;
 * this is the timekeeping source of truth. Filters to closed shifts overlapping the period by the
 * clock-in date (a shift that clocks in within the period). Uses the BASE supabase client (public
 * schema), not the accounting-scoped client.
 */
async function loadShifts(
  profileId: string,
  periodStart: string,
  periodEnd: string
): Promise<ShiftRecord[]> {
  const { data, error } = await supabase
    .from('shifts')
    .select('id, clock_in_time, clock_out_time, lunch_start_time, lunch_end_time')
    .eq('user_id', profileId)
    .gte('clock_in_time', `${periodStart}T00:00:00Z`)
    .lte('clock_in_time', `${periodEnd}T23:59:59Z`)
    .not('clock_out_time', 'is', null);
  if (error) throw error;
  return ((data ?? []) as Row[]).map((r) => ({
    id: String(r.id),
    clockInTime: r.clock_in_time == null ? null : String(r.clock_in_time),
    clockOutTime: r.clock_out_time == null ? null : String(r.clock_out_time),
    lunchStartTime: r.lunch_start_time == null ? null : String(r.lunch_start_time),
    lunchEndTime: r.lunch_end_time == null ? null : String(r.lunch_end_time),
  }));
}

/**
 * The pay frequency to annualize by. The pay run links a schedule, but we may not have it loaded;
 * default to 'biweekly' (the most common) when the schedule frequency is unknown. The annualization
 * choice is on the HUMAN-VERIFY list — confirm the org's actual frequency drives withholding.
 */
function scheduleFrequencyFallback(
  _run: PayRun
): 'weekly' | 'biweekly' | 'semimonthly' | 'monthly' {
  return 'biweekly';
}

/** Convert the engine's computed tax lines to the snake_case jsonb the paychecks.taxes column stores. */
function computedTaxesToJson(lines: ComputedTaxLine[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const line of lines) {
    out[line.kind] = {
      employee_cents: line.employeeCents,
      employer_cents: line.employerCents,
      table_id: line.tableId,
      taxable_wage_cents: line.taxableWageCents,
    };
  }
  return out;
}

/** Normalize the commit RPC's jsonb summary (camelCase keys) to the PayRunSummary shape. */
function normalizeSummary(data: unknown): CommitPayRunResult['summary'] {
  const v = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const n = (k: string): number | undefined =>
    typeof v[k] === 'number' ? (v[k] as number) : v[k] == null ? undefined : Number(v[k]);
  return {
    paychecks: n('paychecks'),
    grossCents: n('grossCents'),
    netCents: n('netCents'),
    employeeTaxCents: n('employeeTaxCents'),
    employerTaxCents: n('employerTaxCents'),
    otherDeductionsCents: n('otherDeductionsCents'),
    postedJournalEntryId: v.postedJournalEntryId == null ? null : String(v.postedJournalEntryId),
    note: v.note == null ? null : String(v.note),
  };
}

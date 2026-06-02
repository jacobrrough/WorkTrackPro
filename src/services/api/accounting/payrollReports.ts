/**
 * ⚠️  HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING. The payroll REPORTS service for the
 *     FLAG-DARK module: it reads COMMITTED paychecks and produces the W-2 / 1099-NEC / DE-9C
 *     statutory STUBS and the NACHA direct-deposit STUB. NONE is filing-grade — the pure
 *     aggregation lives in payrollReportStubs.ts, this service just fetches the inputs. The UI
 *     banners every screen + export. A CPA/EA must complete + verify each form, and a banking
 *     relationship + security sign-off are required before any ACH, before any real use.
 *
 * Reads THROW (React Query surfaces them). NO money moves and NO journal entry is posted here.
 */
import type {
  Employee,
  NachaStubResult,
  Paycheck,
  PayrollReport,
  PayrollReportKind,
} from '../../../features/accounting/types';
import { acct } from './accountingClient';
import { mapEmployeeRow, mapPaycheckRow, mapPayRunRow, type Row } from './mappers';
import { buildNachaStub, buildPayrollReportStub } from './payrollReportStubs';
import { payRunService } from './payroll';

/** The quarter (1..4) a `YYYY-MM-DD` pay date falls in. */
function quarterOf(payDate: string): number {
  const m = Number(payDate.slice(5, 7));
  return Math.min(4, Math.max(1, Math.ceil(m / 3)));
}

export const payrollReportsService = {
  /**
   * Build a statutory report STUB (W-2 / 1099-NEC / DE-9C) for a tax year. Aggregates COMMITTED
   * paychecks across the year (for DE-9C, optionally a single quarter), grouped by employee. NOT
   * filing-grade — every box is approximate and the result carries `unverified: true`.
   *
   * @param kind     'w2' | '1099_nec' | 'de9c'.
   * @param taxYear  the tax year to aggregate.
   * @param quarter  1..4 for DE-9C (omit/null for the whole year, or for W-2/1099-NEC).
   */
  async buildReport(kind: PayrollReportKind, taxYear: number, quarter: number | null = null): Promise<PayrollReport> {
    // 1) Committed runs for the year (optionally filtered to a quarter by pay date).
    const { data: runRows, error: runErr } = await acct()
      .from('pay_runs')
      .select('id, pay_date')
      .eq('tax_year', taxYear)
      .eq('status', 'committed');
    if (runErr) throw runErr;
    const runs = ((runRows ?? []) as Row[])
      .map((r) => ({ id: String(r.id), payDate: String(r.pay_date) }))
      .filter((r) => quarter == null || quarterOf(r.payDate) === quarter);
    const runIds = runs.map((r) => r.id);
    if (runIds.length === 0) {
      return buildPayrollReportStub(kind, taxYear, [], quarter);
    }

    // 2) All paychecks across those runs, joined to their employee.
    const { data: pcRows, error: pcErr } = await acct()
      .from('paychecks')
      .select('*, employee:employees(*)')
      .in('pay_run_id', runIds);
    if (pcErr) throw pcErr;

    // 3) Group paychecks by employee, hydrating the Employee from the embedded row.
    const byEmployee = new Map<string, { employee: Employee; paychecks: Paycheck[] }>();
    for (const row of (pcRows ?? []) as Row[]) {
      const paycheck = mapPaycheckRow(row);
      const empRow = (row.employee ?? null) as Row | null;
      if (!empRow) continue;
      const employee = mapEmployeeRow(empRow);
      const bucket = byEmployee.get(employee.id) ?? { employee, paychecks: [] };
      bucket.paychecks.push(paycheck);
      byEmployee.set(employee.id, bucket);
    }

    return buildPayrollReportStub(kind, taxYear, [...byEmployee.values()], quarter);
  },

  /**
   * Build the NACHA direct-deposit STUB for ONE committed pay run. This is a PLACEHOLDER, NOT a
   * bankable ACH file (`bankable` is always false). No real bank details are read (the employee
   * bank fields are Phase-E masks). Returns `{ stub: null, error }` when the run is missing.
   */
  async buildNachaStub(payRunId: string): Promise<{ stub: NachaStubResult | null; error?: string }> {
    const run = await payRunService.getById(payRunId);
    if (!run) return { stub: null, error: 'Pay run not found.' };
    if (run.status !== 'committed') {
      return { stub: null, error: 'Direct deposit can only be generated for a committed pay run.' };
    }
    const { data, error } = await acct().from('paychecks').select('*').eq('pay_run_id', payRunId);
    if (error) return { stub: null, error: error.message };
    const paychecks = ((data ?? []) as Row[]).map(mapPaycheckRow);
    return { stub: buildNachaStub(run, paychecks) };
  },

  /** Convenience: list the committed pay runs (with summaries) for a year — for the reports index. */
  async committedRunsForYear(taxYear: number) {
    const { data, error } = await acct()
      .from('pay_runs')
      .select('*')
      .eq('tax_year', taxYear)
      .eq('status', 'committed')
      .order('pay_date', { ascending: false });
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapPayRunRow);
  },
};

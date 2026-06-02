/**
 * ⚠️  HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING. The per-paycheck PAYSTUB (FLAG-DARK payroll
 *     module). Renders the PROMINENT UnverifiedBanner (via PayrollScreen) AND a high-contrast
 *     print-safe banner inside any export. The on-screen paystub and the PDF/CSV export are built
 *     from the SAME pure presenter (buildPaystub), and every export carries the loud
 *     "UNVERIFIED — NOT FOR FILING" disclaimer so it survives onto paper. This is NOT a filing-grade
 *     pay statement.
 *
 * Mounted at /app/accounting/payroll/runs/:runId/paychecks/:paycheckId. Money is INTEGER CENTS (G6).
 */
import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { buildPaystub } from '@/services/api/accounting';
import { PayrollScreen } from './PayrollScreen';
import { ExportButtons } from '../reports/ExportButtons';
import type { ReportDocument } from '../reports/reportExport';
import { useEmployee, usePaycheck, usePayRun } from '../hooks/useAccountingQueries';
import { payrollRunPath } from '../constants';
import type { Paystub } from '../types';
import { PAYROLL_EXPORT_DISCLAIMER, formatCents, formatCentsAccounting, formatHundredthHours, formatPayrollDate } from './payrollFormat';

/** A two-column money line within a paystub section. */
function MoneyLine({ label, cents, bold = false }: { label: string; cents: number; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between px-3 py-1.5 text-sm ${bold ? 'font-bold text-white' : 'text-slate-300'}`}>
      <span>{label}</span>
      <span className="font-mono tabular-nums">{formatCentsAccounting(cents)}</span>
    </div>
  );
}

/** A titled block with a header rule. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-sm border border-white/10">
      <div className="border-b border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">
        {title}
      </div>
      <div className="divide-y divide-white/5">{children}</div>
    </div>
  );
}

/** Build the exportable ReportDocument for a paystub (carries the loud payroll disclaimer). */
function buildPaystubDocument(stub: Paystub): ReportDocument {
  const earnings = {
    title: 'Earnings',
    columns: ['Item'],
    rows: [
      { cells: ['Regular hours'], amount: stub.hoursRegularHundredthHours / 100 },
      { cells: ['Overtime hours'], amount: stub.hoursOtHundredthHours / 100 },
      { cells: ['Gross pay'], amount: stub.grossCents / 100, isTotal: true },
    ],
  };
  const withholding = {
    title: 'Employee withholding',
    columns: ['Tax'],
    rows: [
      ...stub.taxLines
        .filter((t) => t.employeeCents > 0)
        .map((t) => ({ cells: [t.label], amount: t.employeeCents / 100 })),
      ...stub.deductions.map((d) => ({ cells: [`${d.label}${d.pretax ? ' (pre-tax)' : ''}`], amount: d.amountCents / 100 })),
      { cells: ['Total withholding & deductions'], amount: (stub.employeeTaxesCents + stub.otherDeductionsCents) / 100, isTotal: true },
    ],
  };
  const employer = {
    title: 'Employer taxes (not withheld from pay)',
    columns: ['Tax'],
    rows: [
      ...stub.taxLines
        .filter((t) => t.employerCents > 0)
        .map((t) => ({ cells: [t.label], amount: t.employerCents / 100 })),
      { cells: ['Total employer tax'], amount: stub.employerTaxesCents / 100, isTotal: true },
    ],
  };
  const net = {
    title: 'Net pay',
    columns: ['Item'],
    rows: [{ cells: ['Net pay'], amount: stub.netCents / 100, isTotal: true }],
  };
  return {
    title: `Paystub — ${stub.employeeName}`,
    subtitle: `Period ${formatPayrollDate(stub.periodStart)} … ${formatPayrollDate(stub.periodEnd)} · pay ${formatPayrollDate(stub.payDate)}`,
    sections: [earnings, withholding, employer, net],
    status: 'UNVERIFIED — NOT A FILING-GRADE PAY STATEMENT',
    disclaimer: PAYROLL_EXPORT_DISCLAIMER,
    filenameBase: `paystub-${stub.employeeName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${stub.payDate}`,
  };
}

export default function PaystubView() {
  const { runId, paycheckId } = useParams<{ runId: string; paycheckId: string }>();
  const navigate = useNavigate();

  const { data: paycheck, isPending, isError, refetch } = usePaycheck(paycheckId);
  const { data: run } = usePayRun(runId);
  const { data: employee } = useEmployee(paycheck?.employeeId);

  const stub = useMemo(
    () => (paycheck ? buildPaystub(paycheck, employee ?? null, run ?? null) : null),
    [paycheck, employee, run]
  );

  if (isPending) {
    return (
      <PayrollScreen section="runs" title="Paystub (Unverified)">
        <p className="text-slate-400">Loading paystub…</p>
      </PayrollScreen>
    );
  }
  if (isError || !paycheck || !stub) {
    return (
      <PayrollScreen section="runs" title="Paystub (Unverified)">
        <div className="flex flex-col items-start gap-3 rounded-sm border border-red-500/30 bg-red-500/10 p-3">
          <p className="text-sm text-red-300">Could not load this paystub.</p>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" icon="refresh" onClick={() => refetch()}>
              Retry
            </Button>
            {runId && (
              <Button size="sm" variant="ghost" onClick={() => navigate(payrollRunPath(runId))}>
                Back to pay run
              </Button>
            )}
          </div>
        </div>
      </PayrollScreen>
    );
  }

  const employerTaxLines = stub.taxLines.filter((t) => t.employerCents > 0);
  const employeeTaxLines = stub.taxLines.filter((t) => t.employeeCents > 0);

  return (
    <PayrollScreen
      section="runs"
      title="Paystub (Unverified)"
      bannerDetail="This paystub is NOT a filing-grade pay statement. The withholding figures come from unverified rates. Exports carry the same warning."
      actions={
        runId ? (
          <Button size="sm" variant="ghost" icon="arrow_back" onClick={() => navigate(payrollRunPath(runId))}>
            Pay run
          </Button>
        ) : undefined
      }
    >
      {/* Identity header */}
      <Card padding="lg" className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white">{stub.employeeName}</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Period {formatPayrollDate(stub.periodStart)} … {formatPayrollDate(stub.periodEnd)} · pay{' '}
            {formatPayrollDate(stub.payDate)}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {formatHundredthHours(stub.hoursRegularHundredthHours)} regular
            {stub.hoursOtHundredthHours > 0 ? ` · ${formatHundredthHours(stub.hoursOtHundredthHours)} OT` : ''}
          </p>
        </div>
        <ExportButtons buildDocument={() => buildPaystubDocument(stub)} />
      </Card>

      {/* Earnings */}
      <Section title="Earnings">
        <MoneyLine label="Gross pay" cents={stub.grossCents} bold />
      </Section>

      {/* Employee withholding */}
      <Section title="Employee withholding">
        {employeeTaxLines.length === 0 && stub.deductions.length === 0 && (
          <p className="px-3 py-2 text-xs text-slate-500">No withholding (e.g. a 1099 contractor or a sub-threshold check).</p>
        )}
        {employeeTaxLines.map((t) => (
          <MoneyLine key={t.taxKind} label={t.label} cents={t.employeeCents} />
        ))}
        {stub.deductions.map((d) => (
          <MoneyLine key={d.code} label={`${d.label}${d.pretax ? ' (pre-tax)' : ''}`} cents={d.amountCents} />
        ))}
        <MoneyLine label="Total withholding & deductions" cents={stub.employeeTaxesCents + stub.otherDeductionsCents} bold />
      </Section>

      {/* Net pay */}
      <Card padding="lg" className="flex items-center justify-between border-emerald-500/30 bg-emerald-500/5">
        <span className="text-sm font-bold uppercase tracking-wide text-emerald-200">Net pay</span>
        <span className="font-mono text-xl font-bold tabular-nums text-white">{formatCents(stub.netCents)}</span>
      </Card>

      {/* Employer taxes (informational — not withheld) */}
      {employerTaxLines.length > 0 && (
        <Section title="Employer taxes (not withheld from pay)">
          {employerTaxLines.map((t) => (
            <MoneyLine key={t.taxKind} label={t.label} cents={t.employerCents} />
          ))}
          <MoneyLine label="Total employer tax" cents={stub.employerTaxesCents} bold />
        </Section>
      )}
    </PayrollScreen>
  );
}

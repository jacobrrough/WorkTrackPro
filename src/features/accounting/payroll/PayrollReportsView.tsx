/**
 * ⚠️  HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING. The statutory report STUBS + NACHA
 *     direct-deposit STUB (FLAG-DARK payroll module). Renders the PROMINENT UnverifiedBanner (via
 *     PayrollScreen) AND a print-safe disclaimer in every export. NONE of these is filing-grade:
 *     the W-2 / 1099-NEC / DE-9C box mapping is APPROXIMATE and the NACHA generator emits a
 *     clearly-marked NON-BANKABLE placeholder (no real routing/account numbers — `bankable` is
 *     always false). A CPA/EA must complete + verify each form and a banking/ODFI relationship +
 *     security sign-off are required before any ACH. Reads COMMITTED paychecks; moves NO money.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PayrollScreen } from './PayrollScreen';
import { ExportButtons } from '../reports/ExportButtons';
import type { ReportDocument } from '../reports/reportExport';
import {
  usePayrollCommittedRuns,
  usePayrollNachaStub,
  usePayrollReport,
  usePayrollTaxTableYears,
} from '../hooks/useAccountingQueries';
import {
  PAYROLL_REPORT_KINDS,
  PAYROLL_REPORT_KIND_LABELS,
  type PayrollReport,
  type PayrollReportKind,
  type PayrollReportRow,
  type PayRun,
} from '../types';
import { PAYROLL_EXPORT_DISCLAIMER, formatCents, formatPayrollDate } from './payrollFormat';

const inputClass =
  'w-full rounded-sm border border-white/10 bg-background-dark px-2 py-1.5 text-white focus:border-primary focus:outline-none';

/** Which columns each report kind surfaces (a STUB — box mapping is approximate). */
function columnsFor(kind: PayrollReportKind): Array<{ key: keyof PayrollReportRow; label: string }> {
  if (kind === '1099_nec') {
    return [{ key: 'grossWagesCents', label: 'Box 1 — Nonemployee comp.' }];
  }
  if (kind === 'de9c') {
    return [
      { key: 'grossWagesCents', label: 'Total subject wages' },
      { key: 'caPitWithheldCents', label: 'CA PIT withheld' },
      { key: 'caSdiWithheldCents', label: 'CA SDI withheld' },
    ];
  }
  // W-2
  return [
    { key: 'grossWagesCents', label: 'Box 1 — Wages' },
    { key: 'fedIncomeWithheldCents', label: 'Box 2 — Fed income tax' },
    { key: 'ssWithheldCents', label: 'Box 4 — SS tax' },
    { key: 'medicareWithheldCents', label: 'Box 6 — Medicare tax' },
  ];
}

/** Build a ReportDocument for a statutory report STUB (carries the loud payroll disclaimer). */
function buildReportDocument(report: PayrollReport): ReportDocument {
  const cols = columnsFor(report.kind);
  const rows = report.rows.map((r) => ({
    cells: [r.employeeName, r.ssnMasked ?? '—', ...cols.slice(1).map((c) => formatCents(r[c.key] as number))],
    amount: (report.rows.length > 0 ? (r[cols[0].key] as number) : 0) / 100,
  }));
  const quarterLabel = report.quarter ? ` Q${report.quarter}` : '';
  return {
    title: `${PAYROLL_REPORT_KIND_LABELS[report.kind]} — ${report.taxYear}${quarterLabel} (STUB)`,
    subtitle: `Aggregated from committed paychecks · ${report.rows.length} recipient${report.rows.length === 1 ? '' : 's'}`,
    sections: [
      {
        title: 'Recipients',
        columns: ['Name', 'SSN', ...cols.slice(1).map((c) => c.label)],
        rows,
      },
    ],
    status: 'UNVERIFIED STUB — box mapping is approximate; NOT a filing-grade form.',
    disclaimer: PAYROLL_EXPORT_DISCLAIMER,
    filenameBase: `payroll-${report.kind}-${report.taxYear}${quarterLabel ? `-q${report.quarter}` : ''}-stub`,
  };
}

/** The report-stub table for the selected kind/year/quarter. */
function ReportStub({
  kind,
  taxYear,
  quarter,
}: {
  kind: PayrollReportKind;
  taxYear: number;
  quarter: number | null;
}) {
  const { data: report, isPending, isError, refetch } = usePayrollReport(kind, taxYear, quarter);
  const cols = columnsFor(kind);

  if (isPending) return <p className="text-slate-400">Building {PAYROLL_REPORT_KIND_LABELS[kind]}…</p>;

  if (isError || !report) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-sm border border-red-500/30 bg-red-500/10 p-3">
        <p className="text-sm text-red-300">Could not build this report stub.</p>
        <Button size="sm" variant="secondary" icon="refresh" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <Card padding="lg" className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-bold text-white">{PAYROLL_REPORT_KIND_LABELS[kind]}</h3>
          <p className="text-xs text-slate-500">
            {report.rows.length} recipient{report.rows.length === 1 ? '' : 's'} · {taxYear}
            {quarter ? ` · Q${quarter}` : ''}
          </p>
        </div>
        <ExportButtons buildDocument={() => buildReportDocument(report)} disabled={report.rows.length === 0} />
      </div>

      <div className="rounded-sm border border-red-500/40 bg-red-500/10 p-2 text-[11px] font-semibold text-red-200">
        STUB — box mapping is approximate and several boxes are omitted. NOT a filing-grade form.
      </div>

      {report.rows.length === 0 ? (
        <p className="text-sm text-slate-400">
          No committed paychecks for the selected {kind === '1099_nec' ? '1099 contractors' : 'employees'} in this period.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-2 py-1.5">Name</th>
                <th className="px-2 py-1.5">SSN</th>
                {cols.map((c) => (
                  <th key={String(c.key)} className="px-2 py-1.5 text-right">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {report.rows.map((r) => (
                <tr key={r.employeeId}>
                  <td className="px-2 py-1.5 text-white">{r.employeeName}</td>
                  <td className="px-2 py-1.5 font-mono text-xs text-slate-400">{r.ssnMasked ?? '—'}</td>
                  {cols.map((c) => (
                    <td key={String(c.key)} className="px-2 py-1.5 text-right font-mono tabular-nums text-slate-200">
                      {formatCents(r[c.key] as number)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** The NACHA direct-deposit STUB for one committed run (a non-bankable placeholder). */
function NachaStubCard({ runs }: { runs: PayRun[] }) {
  const [runId, setRunId] = useState('');
  const selectedId = runId || runs[0]?.id || '';
  const { data, isFetching } = usePayrollNachaStub(selectedId || undefined);
  const stub = data?.stub ?? null;

  const onDownload = () => {
    if (!stub) return;
    const blob = new Blob([stub.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nacha-stub-${selectedId.slice(0, 8)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card padding="lg" className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-bold text-white">Direct deposit (NACHA) — STUB</h3>
          <p className="text-xs text-slate-500">A non-bankable placeholder. No real ACH is initiated.</p>
        </div>
      </div>

      <div className="rounded-sm border border-red-500/40 bg-red-500/10 p-2 text-[11px] font-semibold text-red-200">
        This is NOT a bankable NACHA file. No routing/account numbers are used. A real NACHA format,
        an ODFI/banking relationship, and security sign-off are required before any direct deposit.
      </div>

      {runs.length === 0 ? (
        <p className="text-sm text-slate-400">No committed pay runs this year to generate a stub for.</p>
      ) : (
        <>
          <label className="flex items-center gap-2 text-xs text-slate-400">
            Committed run
            <select className={`${inputClass} w-auto`} value={selectedId} onChange={(e) => setRunId(e.target.value)} aria-label="Committed run">
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {formatPayrollDate(r.periodStart)} … {formatPayrollDate(r.periodEnd)} (pay {formatPayrollDate(r.payDate)})
                </option>
              ))}
            </select>
          </label>

          {isFetching && <p className="text-sm text-slate-400">Building stub…</p>}

          {stub && (
            <>
              <p className="text-xs text-slate-400">
                {stub.entryCount} entr{stub.entryCount === 1 ? 'y' : 'ies'} · {formatCents(stub.totalNetCents)} total net ·{' '}
                <span className="font-semibold text-red-300">not bankable</span>
              </p>
              <pre className="max-h-64 overflow-auto rounded-sm border border-white/10 bg-background-dark p-3 text-[11px] leading-relaxed text-slate-300">
                {stub.content}
              </pre>
              <div className="flex justify-end">
                <Button size="sm" variant="secondary" icon="download" onClick={onDownload}>
                  Download stub (.txt)
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </Card>
  );
}

export default function PayrollReportsView() {
  const { data: years = [] } = usePayrollTaxTableYears();
  const [year, setYear] = useState<number | null>(null);

  useEffect(() => {
    if (year == null) setYear(years[0] ?? new Date().getFullYear());
  }, [years, year]);

  const effectiveYear = year ?? new Date().getFullYear();
  const [kind, setKind] = useState<PayrollReportKind>('w2');
  const [quarter, setQuarter] = useState<number | null>(null);

  const { data: committedRuns = [] } = usePayrollCommittedRuns(effectiveYear);

  const yearOptions = useMemo(() => {
    const set = new Set<number>(years);
    set.add(effectiveYear);
    return [...set].sort((a, b) => b - a);
  }, [years, effectiveYear]);

  return (
    <PayrollScreen
      section="reports"
      title="Payroll reports (Unverified)"
      bannerDetail="W-2 / 1099-NEC / DE-9C are STUBS with approximate box mapping; the NACHA file is a non-bankable placeholder. Nothing here is filing-grade."
    >
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-slate-400">
          Tax year
          <select className={`${inputClass} w-auto`} value={effectiveYear} onChange={(e) => setYear(Number(e.target.value))} aria-label="Tax year">
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-400">
          Form
          <select
            className={`${inputClass} w-auto`}
            value={kind}
            onChange={(e) => {
              const next = e.target.value as PayrollReportKind;
              setKind(next);
              if (next !== 'de9c') setQuarter(null);
            }}
            aria-label="Form"
          >
            {PAYROLL_REPORT_KINDS.map((k) => (
              <option key={k} value={k}>
                {PAYROLL_REPORT_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        {kind === 'de9c' && (
          <label className="flex items-center gap-2 text-xs text-slate-400">
            Quarter
            <select
              className={`${inputClass} w-auto`}
              value={quarter ?? ''}
              onChange={(e) => setQuarter(e.target.value === '' ? null : Number(e.target.value))}
              aria-label="Quarter"
            >
              <option value="">Full year</option>
              <option value="1">Q1</option>
              <option value="2">Q2</option>
              <option value="3">Q3</option>
              <option value="4">Q4</option>
            </select>
          </label>
        )}
      </div>

      <ReportStub kind={kind} taxYear={effectiveYear} quarter={kind === 'de9c' ? quarter : null} />

      <NachaStubCard runs={committedRuns} />
    </PayrollScreen>
  );
}

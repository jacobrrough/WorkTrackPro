/**
 * ⚠️  HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING. The per-run WORKSPACE (FLAG-DARK payroll
 *     module): the calculate → review paychecks → commit → paystubs flow, plus void (committed) and
 *     delete (draft). Renders the PROMINENT UnverifiedBanner (via PayrollScreen).
 *
 * The ONLY money path in the whole payroll module runs from this screen: COMMIT calls
 * accounting.commit_pay_run, the can_payroll()-gated RPC that asserts the cents identity then posts
 * ONE BALANCED journal entry (Dr 6500 gross + Dr 6510 employer tax / Cr 2300 liabilities + Cr 1010
 * net pay) through the GL's single balance guard. A rejected commit (unbalanced, wrong status,
 * non-payroll user, closed period) changes nothing and surfaces inline. CALCULATE writes paychecks
 * but moves NO money; net pay parks in the 1010 clearing account — no real bank rail is touched.
 *
 * Mounted at /app/accounting/payroll/runs/:runId. Every figure is INTEGER CENTS (G6).
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FormField } from '@/components/ui/FormField';
import { PayrollScreen } from './PayrollScreen';
import { usePayRun, usePayRunLiabilities, usePayRunPaychecks } from '../hooks/useAccountingQueries';
import {
  useCalculatePayRun,
  useCommitPayRun,
  useDeletePayRun,
  useVoidPayRun,
} from '../hooks/useAccountingMutations';
import { payrollPaycheckPath, payrollRunsPath } from '../constants';
import type { CalculatePayRunResult, Paycheck, PayrollLiability, PayRun } from '../types';
import { PAYROLL_JURISDICTIONS } from '../types';
import {
  formatCents,
  formatCentsAccounting,
  formatHundredthHours,
  formatPayrollDate,
  payRunStatusBadgeClass,
  payRunStatusLabel,
  taxKindLabel,
} from './payrollFormat';

const inputClass =
  'w-full rounded-sm border border-white/10 bg-background-dark px-2 py-1.5 text-white focus:border-primary focus:outline-none';

/** A labelled cents stat for the run header. */
function Stat({
  label,
  cents,
  tone = 'default',
}: {
  label: string;
  cents: number;
  tone?: 'default' | 'net';
}) {
  return (
    <div className="rounded-sm border border-white/10 bg-background-dark px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={`mt-0.5 font-mono text-sm tabular-nums ${tone === 'net' ? 'font-bold text-white' : 'text-slate-200'}`}
      >
        {formatCentsAccounting(cents)}
      </p>
    </div>
  );
}

/** One paycheck review row → links to the paystub. */
function PaycheckRow({ runId, paycheck }: { runId: string; paycheck: Paycheck }) {
  const navigate = useNavigate();
  return (
    <Card
      onClick={() => navigate(payrollPaycheckPath(runId, paycheck.id))}
      className="flex items-center gap-3"
      padding="md"
    >
      <span className="material-symbols-outlined text-slate-400">receipt</span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-bold text-white">
          {paycheck.employeeName ?? paycheck.employeeId.slice(0, 8)}
        </p>
        <p className="mt-0.5 truncate text-xs text-slate-500">
          {formatHundredthHours(paycheck.hoursRegularHundredthHours)} reg
          {paycheck.hoursOtHundredthHours > 0
            ? ` · ${formatHundredthHours(paycheck.hoursOtHundredthHours)} OT`
            : ''}
          {' · '}
          {formatCents(paycheck.grossCents)} gross
        </p>
      </div>
      <div className="hidden text-right sm:block">
        <p className="font-mono text-sm font-bold tabular-nums text-white">
          {formatCentsAccounting(paycheck.netCents)}
        </p>
        <p className="text-[11px] text-slate-500">net</p>
      </div>
      <span className="material-symbols-outlined text-slate-600">chevron_right</span>
    </Card>
  );
}

/** The per-agency liability accrual breakdown (the 2300 credit detail). */
function LiabilityBreakdown({ liabilities }: { liabilities: PayrollLiability[] }) {
  if (liabilities.length === 0) return null;
  const byJurisdiction = PAYROLL_JURISDICTIONS.map((j) => ({
    jurisdiction: j,
    rows: liabilities.filter((l) => l.jurisdiction === j),
  })).filter((g) => g.rows.length > 0);

  return (
    <Card padding="lg" className="flex flex-col gap-3">
      <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">
        Liability accruals (2300)
      </h3>
      {byJurisdiction.map((group) => (
        <div key={group.jurisdiction}>
          <p className="mb-1 text-xs font-bold text-slate-400">
            {group.jurisdiction === 'CA' ? 'California' : 'Federal'}
          </p>
          <div className="divide-y divide-white/5 overflow-hidden rounded-sm border border-white/10">
            {group.rows.map((l) => (
              <div key={l.id} className="flex items-center justify-between px-3 py-1.5 text-sm">
                <span className="text-slate-300">
                  {taxKindLabel(l.taxKind as never)}
                  <span className="ml-1.5 text-[11px] text-slate-500">({l.party})</span>
                </span>
                <span className="font-mono tabular-nums text-slate-200">
                  {formatCents(l.amountCents)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </Card>
  );
}

/** The calculate result summary (totals + skipped employees). */
function CalcResultCard({ result }: { result: CalculatePayRunResult }) {
  return (
    <Card padding="lg" className="flex flex-col gap-2 border-amber-500/30 bg-amber-500/5">
      <p className="text-sm font-semibold text-amber-100">
        Calculated {result.paychecksWritten} paycheck{result.paychecksWritten === 1 ? '' : 's'}.
      </p>
      {result.skipped.length > 0 && (
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-amber-300">Skipped</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-amber-100/90">
            {result.skipped.map((s) => (
              <li key={s.employeeId}>
                {s.employeeName}: {s.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

/** Confirm-and-commit dialog: states what the balanced JE will do before posting. */
function CommitDialog({ run, onClose }: { run: PayRun; onClose: () => void }) {
  const commit = useCommitPayRun();
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    const res = await commit.mutateAsync(run.id);
    if (!res.ok) {
      setError(res.error ?? 'The commit was rejected and nothing was posted.');
      return;
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-sm border border-white/10 bg-card-dark p-4 shadow-xl">
        <h2 className="text-lg font-bold text-white">Commit pay run</h2>
        <p className="mt-2 text-sm text-slate-300">
          This posts ONE balanced payroll journal entry:
        </p>
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-slate-400">
          <li>Dr 6500 Wages expense (Σ gross) + Dr 6510 Employer payroll tax</li>
          <li>Cr 2300 Payroll liabilities (employee withholdings + employer taxes + deductions)</li>
          <li>Cr 1010 Payroll clearing (Σ net pay — no real bank transfer)</li>
        </ul>
        <p className="mt-2 text-xs text-amber-300">
          UNVERIFIED — the underlying rates/formulas are not filing-grade. Net pay is parked in a
          clearing account; no ACH is initiated.
        </p>

        {error && (
          <p className="mt-3 text-sm text-red-400" role="alert">
            {error}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={commit.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={commit.isPending}>
            {commit.isPending ? 'Committing…' : 'Commit & post entry'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Void dialog: requires a reason; reverses the posted JE. */
function VoidDialog({ run, onClose }: { run: PayRun; onClose: () => void }) {
  const voidRun = useVoidPayRun();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!reason.trim()) {
      setError('Give a reason for voiding this run.');
      return;
    }
    const res = await voidRun.mutateAsync({ runId: run.id, reason: reason.trim() });
    if (!res.ok) {
      setError(res.error ?? 'Could not void this run.');
      return;
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-sm border border-white/10 bg-card-dark p-4 shadow-xl">
        <h2 className="text-lg font-bold text-white">Void pay run</h2>
        <p className="mt-2 text-sm text-slate-300">
          Voiding reverses the posted payroll journal entry (posted entries are immutable — the
          reversal is the correction) and marks the run void.
        </p>
        <FormField label="Reason" htmlFor="void-reason" required className="mt-3">
          <input
            id="void-reason"
            className={inputClass}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. wrong period"
          />
        </FormField>

        {error && (
          <p className="mt-3 text-sm text-red-400" role="alert">
            {error}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={voidRun.isPending}>
            Cancel
          </Button>
          <Button variant="danger" onClick={submit} disabled={voidRun.isPending || !reason.trim()}>
            {voidRun.isPending ? 'Voiding…' : 'Void run'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function PayRunWorkspaceView() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();

  const { data: run, isPending, isError, refetch } = usePayRun(runId);
  const { data: paychecks = [] } = usePayRunPaychecks(runId);
  const { data: liabilities = [] } = usePayRunLiabilities(runId);

  const calculate = useCalculatePayRun();
  const deleteRun = useDeletePayRun();

  const [calcResult, setCalcResult] = useState<CalculatePayRunResult | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showCommit, setShowCommit] = useState(false);
  const [showVoid, setShowVoid] = useState(false);

  const onCalculate = async () => {
    if (!runId) return;
    setActionError(null);
    setCalcResult(null);
    const res = await calculate.mutateAsync({ runId });
    setCalcResult(res);
    if (!res.ok && res.error) setActionError(res.error);
  };

  const onDelete = async () => {
    if (!runId) return;
    setActionError(null);
    const res = await deleteRun.mutateAsync(runId);
    if (!res.ok) {
      setActionError(res.error ?? 'Could not delete the run.');
      return;
    }
    navigate(payrollRunsPath());
  };

  if (isPending) {
    return (
      <PayrollScreen section="runs" title="Pay run (Unverified)">
        <p className="text-slate-400">Loading pay run…</p>
      </PayrollScreen>
    );
  }
  if (isError || !run) {
    return (
      <PayrollScreen section="runs" title="Pay run (Unverified)">
        <div className="flex flex-col items-start gap-3 rounded-sm border border-red-500/30 bg-red-500/10 p-3">
          <p className="text-sm text-red-300">Could not load this pay run.</p>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" icon="refresh" onClick={() => refetch()}>
              Retry
            </Button>
            <Button size="sm" variant="ghost" onClick={() => navigate(payrollRunsPath())}>
              Back to pay runs
            </Button>
          </div>
        </div>
      </PayrollScreen>
    );
  }

  const editable = run.status === 'draft' || run.status === 'calculated';
  const committed = run.status === 'committed';
  const summary = run.summary;

  // Totals for the header: from the live calc result if present, else the run summary (committed),
  // else summed from the loaded paychecks (calculated-but-not-yet-recalced view).
  const totalGross = calcResult?.ok
    ? calcResult.grossCents
    : (summary.grossCents ?? paychecks.reduce((s, p) => s + p.grossCents, 0));
  const totalEmployeeTax = calcResult?.ok
    ? calcResult.employeeTaxCents
    : (summary.employeeTaxCents ?? paychecks.reduce((s, p) => s + p.employeeTaxesCents, 0));
  const totalEmployerTax = calcResult?.ok
    ? calcResult.employerTaxCents
    : (summary.employerTaxCents ?? paychecks.reduce((s, p) => s + p.employerTaxesCents, 0));
  const totalDeductions = calcResult?.ok
    ? calcResult.otherDeductionsCents
    : (summary.otherDeductionsCents ?? paychecks.reduce((s, p) => s + p.otherDeductionsCents, 0));
  const totalNet = calcResult?.ok
    ? calcResult.netCents
    : (summary.netCents ?? paychecks.reduce((s, p) => s + p.netCents, 0));

  return (
    <PayrollScreen
      section="runs"
      title="Pay run (Unverified)"
      actions={
        <Button
          size="sm"
          variant="ghost"
          icon="arrow_back"
          onClick={() => navigate(payrollRunsPath())}
        >
          All runs
        </Button>
      }
    >
      {/* Header */}
      <Card padding="lg" className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-white">
                {formatPayrollDate(run.periodStart)} … {formatPayrollDate(run.periodEnd)}
              </h2>
              <span
                className={`rounded-sm px-1.5 py-0.5 text-[11px] font-semibold ${payRunStatusBadgeClass(run.status)}`}
              >
                {payRunStatusLabel(run.status)}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              Pay {formatPayrollDate(run.payDate)} · tax year {run.taxYear}
              {committed && run.committedAt
                ? ` · committed ${formatPayrollDate(run.committedAt)}`
                : ''}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Stat label="Gross" cents={totalGross} />
          <Stat label="EE tax" cents={totalEmployeeTax} />
          <Stat label="ER tax" cents={totalEmployerTax} />
          <Stat label="Deductions" cents={totalDeductions} />
          <Stat label="Net" cents={totalNet} tone="net" />
        </div>

        {committed && summary.postedJournalEntryId && (
          <p className="text-xs text-emerald-300">
            Posted journal entry{' '}
            <span className="font-mono">{summary.postedJournalEntryId.slice(0, 8)}…</span> (Dr
            6500/6510 · Cr 2300/1010).
          </p>
        )}
        {committed && summary.note && <p className="text-xs text-slate-400">{summary.note}</p>}

        {/* Lifecycle actions */}
        <div className="flex flex-wrap items-center gap-2">
          {editable && (
            <Button size="sm" icon="calculate" onClick={onCalculate} disabled={calculate.isPending}>
              {calculate.isPending
                ? 'Calculating…'
                : run.status === 'draft'
                  ? 'Calculate'
                  : 'Recalculate'}
            </Button>
          )}
          {run.status === 'calculated' && paychecks.length > 0 && (
            <Button size="sm" icon="task_alt" onClick={() => setShowCommit(true)}>
              Commit & post entry
            </Button>
          )}
          {committed && (
            <Button size="sm" variant="danger" icon="undo" onClick={() => setShowVoid(true)}>
              Void run
            </Button>
          )}
          {editable && (
            <Button
              size="sm"
              variant="ghost"
              icon="delete"
              onClick={onDelete}
              disabled={deleteRun.isPending}
            >
              {deleteRun.isPending ? 'Deleting…' : 'Delete draft'}
            </Button>
          )}
        </div>

        {actionError && (
          <p className="text-sm text-red-400" role="alert">
            {actionError}
          </p>
        )}
      </Card>

      {calcResult && <CalcResultCard result={calcResult} />}

      {/* Paychecks review */}
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">Paychecks</h3>
        <span className="text-[11px] text-slate-500">
          {paychecks.length} check{paychecks.length === 1 ? '' : 's'}
        </span>
      </div>

      {paychecks.length === 0 && (
        <Card padding="lg" className="flex flex-col items-center gap-2 text-center">
          <span className="material-symbols-outlined text-3xl text-slate-600">receipt_long</span>
          <p className="text-sm text-slate-400">
            {run.status === 'draft'
              ? 'Calculate the run to compute each active employee’s paycheck (hours sourced read-only from shifts).'
              : 'No paychecks were produced — every employee was skipped (no hours / zero rate). Check the employee pay setup and shifts.'}
          </p>
        </Card>
      )}

      {paychecks.length > 0 && (
        <div className="flex flex-col gap-2">
          {paychecks.map((p) => (
            <PaycheckRow key={p.id} runId={run.id} paycheck={p} />
          ))}
        </div>
      )}

      <LiabilityBreakdown liabilities={liabilities} />

      {showCommit && <CommitDialog run={run} onClose={() => setShowCommit(false)} />}
      {showVoid && <VoidDialog run={run} onClose={() => setShowVoid(false)} />}
    </PayrollScreen>
  );
}

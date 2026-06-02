/**
 * ⚠️  HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING. The pay-run list (FLAG-DARK payroll module).
 *     Renders the PROMINENT UnverifiedBanner (via PayrollScreen). Lists accounting.pay_runs and
 *     opens a draft run (period + pay date); the per-run workspace handles calculate → review →
 *     commit. Creating a draft moves NO money — only committing a run posts the (single, balanced)
 *     payroll journal entry, and that happens in the workspace.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FormField } from '@/components/ui/FormField';
import { PayrollScreen } from './PayrollScreen';
import { usePayRuns, usePaySchedules } from '../hooks/useAccountingQueries';
import { useCreatePayRun } from '../hooks/useAccountingMutations';
import { payrollRunPath } from '../constants';
import type { NewPayRunInput, PayRun } from '../types';
import {
  formatPayrollDate,
  payRunStatusBadgeClass,
  payRunStatusLabel,
  todayIso,
} from './payrollFormat';

const inputClass =
  'w-full rounded-sm border border-white/10 bg-background-dark px-2 py-1.5 text-white focus:border-primary focus:outline-none';

/** Dialog to open a draft pay run for a period + pay date (optionally tied to a schedule). */
function NewPayRunModal({ onClose }: { onClose: (createdId?: string) => void }) {
  const create = useCreatePayRun();
  const { data: schedules = [] } = usePaySchedules(false);
  const [payScheduleId, setPayScheduleId] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [payDate, setPayDate] = useState(todayIso());
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!periodStart || !periodEnd || !payDate) {
      setError('A pay run needs a period start, period end, and pay date.');
      return;
    }
    if (periodEnd < periodStart) {
      setError('The period end cannot be before the period start.');
      return;
    }
    const input: NewPayRunInput = {
      payScheduleId: payScheduleId || null,
      periodStart,
      periodEnd,
      payDate,
    };
    const res = await create.mutateAsync(input);
    if (res.error || !res.run) {
      setError(res.error ?? 'Could not open the pay run. Confirm you have a payroll role.');
      return;
    }
    onClose(res.run.id);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-sm border border-white/10 bg-card-dark p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">New pay run</h2>
          <button
            type="button"
            onClick={() => onClose()}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-sm text-slate-400 hover:bg-white/10 hover:text-white"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="flex flex-col gap-3">
          {schedules.length > 0 && (
            <FormField label="Pay schedule" htmlFor="pr-sched" hint="Optional — informational link.">
              <select id="pr-sched" className={inputClass} value={payScheduleId} onChange={(e) => setPayScheduleId(e.target.value)}>
                <option value="">No schedule</option>
                {schedules.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </FormField>
          )}
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Period start" htmlFor="pr-start" required>
              <input id="pr-start" type="date" className={inputClass} value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
            </FormField>
            <FormField label="Period end" htmlFor="pr-end" required>
              <input id="pr-end" type="date" className={inputClass} value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
            </FormField>
          </div>
          <FormField label="Pay date" htmlFor="pr-pay" required hint="Determines the tax year.">
            <input id="pr-pay" type="date" className={inputClass} value={payDate} onChange={(e) => setPayDate(e.target.value)} />
          </FormField>

          {error && (
            <p className="text-sm text-red-400" role="alert">
              {error}
            </p>
          )}

          <div className="mt-1 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onClose()} disabled={create.isPending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={create.isPending}>
              {create.isPending ? 'Opening…' : 'Open pay run'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PayRunRow({ run, onOpen }: { run: PayRun; onOpen: () => void }) {
  const gross = run.summary.grossCents;
  return (
    <Card onClick={onOpen} className="flex items-center gap-3" padding="md">
      <span className="material-symbols-outlined text-slate-400">payments</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-bold text-white">
            {formatPayrollDate(run.periodStart)} … {formatPayrollDate(run.periodEnd)}
          </p>
          <span className={`rounded-sm px-1.5 py-0.5 text-[11px] font-semibold ${payRunStatusBadgeClass(run.status)}`}>
            {payRunStatusLabel(run.status)}
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-slate-500">
          Pay {formatPayrollDate(run.payDate)} · tax year {run.taxYear}
          {run.status === 'committed' && typeof gross === 'number'
            ? ` · ${(gross / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} gross`
            : ''}
        </p>
      </div>
      <span className="material-symbols-outlined text-slate-600">chevron_right</span>
    </Card>
  );
}

export default function PayRunsView() {
  const navigate = useNavigate();
  const { data: runs = [], isPending, isError, refetch } = usePayRuns();
  const [showCreate, setShowCreate] = useState(false);

  const onClose = (createdId?: string) => {
    setShowCreate(false);
    if (createdId) navigate(payrollRunPath(createdId));
  };

  return (
    <PayrollScreen
      section="runs"
      title="Pay runs (Unverified)"
      actions={
        <Button size="sm" icon="add" onClick={() => setShowCreate(true)}>
          New pay run
        </Button>
      }
    >
      <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Pay runs</h2>
      <p className="text-xs text-slate-500">
        Open a run for a period, calculate withholding from the tax tables, review each paycheck,
        then commit a single balanced payroll journal entry. Net pay parks in a clearing account —
        no real bank rail is touched.
      </p>

      {isPending && <p className="text-slate-400">Loading pay runs…</p>}

      {!isPending && isError && (
        <div className="flex flex-col items-start gap-3 rounded-sm border border-red-500/30 bg-red-500/10 p-3">
          <p className="text-sm text-red-300">
            Could not load pay runs. Confirm the accounting schema is exposed and you have a payroll
            role.
          </p>
          <Button size="sm" variant="secondary" icon="refresh" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!isPending && !isError && runs.length === 0 && (
        <Card padding="lg" className="flex flex-col items-center gap-3 text-center">
          <span className="material-symbols-outlined text-4xl text-slate-600">payments</span>
          <div>
            <p className="font-semibold text-white">No pay runs yet</p>
            <p className="mt-1 text-sm text-slate-400">
              Open a pay run for a pay period to calculate withholding and review paychecks before
              committing.
            </p>
          </div>
          <Button icon="add" onClick={() => setShowCreate(true)}>
            New pay run
          </Button>
        </Card>
      )}

      {!isPending && !isError && runs.length > 0 && (
        <div className="flex flex-col gap-2">
          {runs.map((run) => (
            <PayRunRow key={run.id} run={run} onOpen={() => navigate(payrollRunPath(run.id))} />
          ))}
        </div>
      )}

      {showCreate && <NewPayRunModal onClose={onClose} />}
    </PayrollScreen>
  );
}

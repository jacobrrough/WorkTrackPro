/**
 * ⚠️  HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING. Pay-schedule master (FLAG-DARK payroll
 *     module). Renders the PROMINENT UnverifiedBanner (via PayrollScreen). CRUD over
 *     accounting.pay_schedules: a named pay frequency (weekly … monthly) + an anchor date and the
 *     optional next period/pay window a pay run is opened for. The frequency drives the withholding
 *     ANNUALIZATION in the engine — confirm it matches the org's real cadence (HUMAN-VERIFY). Moves
 *     NO money.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FormField } from '@/components/ui/FormField';
import { PayrollScreen } from './PayrollScreen';
import { usePaySchedules } from '../hooks/useAccountingQueries';
import { useCreatePaySchedule, useUpdatePaySchedule } from '../hooks/useAccountingMutations';
import {
  PAY_FREQUENCIES,
  PAY_FREQUENCY_LABELS,
  type NewPayScheduleInput,
  type PayFrequency,
  type PaySchedule,
} from '../types';
import { formatPayrollDate, payFrequencyLabel, todayIso } from './payrollFormat';

const inputClass =
  'w-full rounded-sm border border-white/10 bg-background-dark px-2 py-1.5 text-white focus:border-primary focus:outline-none';

interface ScheduleForm {
  name: string;
  frequency: PayFrequency;
  anchorDate: string;
  nextPeriodStart: string;
  nextPeriodEnd: string;
  nextPayDate: string;
}

function formFor(schedule: PaySchedule | null): ScheduleForm {
  return {
    name: schedule?.name ?? '',
    frequency: schedule?.frequency ?? 'biweekly',
    anchorDate: schedule?.anchorDate ?? todayIso(),
    nextPeriodStart: schedule?.nextPeriodStart ?? '',
    nextPeriodEnd: schedule?.nextPeriodEnd ?? '',
    nextPayDate: schedule?.nextPayDate ?? '',
  };
}

/** Create/edit dialog for a pay schedule. */
function ScheduleModal({
  schedule,
  onClose,
}: {
  schedule: PaySchedule | null;
  onClose: () => void;
}) {
  const isNew = !schedule;
  const create = useCreatePaySchedule();
  const update = useUpdatePaySchedule();
  const [form, setForm] = useState<ScheduleForm>(() => formFor(schedule));
  const [error, setError] = useState<string | null>(null);
  const busy = create.isPending || update.isPending;

  const set = <K extends keyof ScheduleForm>(key: K, value: ScheduleForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setError(null);
  };

  const submit = async () => {
    setError(null);
    if (!form.name.trim()) {
      setError('A pay schedule needs a name.');
      return;
    }
    if (!form.anchorDate) {
      setError('A pay schedule needs an anchor date.');
      return;
    }
    const input: NewPayScheduleInput = {
      name: form.name.trim(),
      frequency: form.frequency,
      anchorDate: form.anchorDate,
      nextPeriodStart: form.nextPeriodStart || null,
      nextPeriodEnd: form.nextPeriodEnd || null,
      nextPayDate: form.nextPayDate || null,
    };
    if (isNew) {
      const res = await create.mutateAsync(input);
      if (res.error || !res.schedule) {
        setError(
          res.error ?? 'Could not create the pay schedule. Confirm you have a payroll role.'
        );
        return;
      }
    } else {
      const res = await update.mutateAsync({ id: schedule.id, input });
      if (res.error || !res.schedule) {
        setError(res.error ?? 'Could not update the pay schedule.');
        return;
      }
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-sm border border-white/10 bg-card-dark p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">
            {isNew ? 'New pay schedule' : 'Edit pay schedule'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-sm text-slate-400 hover:bg-white/10 hover:text-white"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <FormField label="Name" htmlFor="ps-name" required>
            <input
              id="ps-name"
              className={inputClass}
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Biweekly — hourly"
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Frequency" htmlFor="ps-freq" hint="Drives withholding annualization.">
              <select
                id="ps-freq"
                className={inputClass}
                value={form.frequency}
                onChange={(e) => set('frequency', e.target.value as PayFrequency)}
              >
                {PAY_FREQUENCIES.map((f) => (
                  <option key={f} value={f}>
                    {PAY_FREQUENCY_LABELS[f]}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField
              label="Anchor date"
              htmlFor="ps-anchor"
              required
              hint="A known period boundary."
            >
              <input
                id="ps-anchor"
                type="date"
                className={inputClass}
                value={form.anchorDate}
                onChange={(e) => set('anchorDate', e.target.value)}
              />
            </FormField>
          </div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Next period (optional)
          </p>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Period start" htmlFor="ps-start">
              <input
                id="ps-start"
                type="date"
                className={inputClass}
                value={form.nextPeriodStart}
                onChange={(e) => set('nextPeriodStart', e.target.value)}
              />
            </FormField>
            <FormField label="Period end" htmlFor="ps-end">
              <input
                id="ps-end"
                type="date"
                className={inputClass}
                value={form.nextPeriodEnd}
                onChange={(e) => set('nextPeriodEnd', e.target.value)}
              />
            </FormField>
          </div>
          <FormField label="Pay date" htmlFor="ps-pay">
            <input
              id="ps-pay"
              type="date"
              className={inputClass}
              value={form.nextPayDate}
              onChange={(e) => set('nextPayDate', e.target.value)}
            />
          </FormField>

          {error && (
            <p className="text-sm text-red-400" role="alert">
              {error}
            </p>
          )}

          <div className="mt-1 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={busy || !form.name.trim()}>
              {busy ? 'Saving…' : isNew ? 'Create schedule' : 'Save changes'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ScheduleRow({ schedule, onEdit }: { schedule: PaySchedule; onEdit: () => void }) {
  const window =
    schedule.nextPeriodStart && schedule.nextPeriodEnd
      ? `${formatPayrollDate(schedule.nextPeriodStart)} … ${formatPayrollDate(schedule.nextPeriodEnd)}`
      : 'No next period set';
  return (
    <Card onClick={onEdit} className="flex items-center gap-3" padding="md">
      <span className="material-symbols-outlined text-slate-400">event_repeat</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-bold text-white">{schedule.name}</p>
          <span className="rounded-sm bg-white/10 px-1.5 py-0.5 text-[11px] font-semibold text-slate-300">
            {payFrequencyLabel(schedule.frequency)}
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-slate-500">
          {window}
          {schedule.nextPayDate ? ` · pay ${formatPayrollDate(schedule.nextPayDate)}` : ''}
        </p>
      </div>
      <span className="material-symbols-outlined text-slate-600">chevron_right</span>
    </Card>
  );
}

export default function PaySchedulesView() {
  const { data: schedules = [], isPending, isError, refetch } = usePaySchedules(true);
  const [modal, setModal] = useState<{ open: boolean; schedule: PaySchedule | null }>({
    open: false,
    schedule: null,
  });

  return (
    <PayrollScreen
      section="schedules"
      title="Pay schedules (Unverified)"
      actions={
        <Button size="sm" icon="add" onClick={() => setModal({ open: true, schedule: null })}>
          New schedule
        </Button>
      }
    >
      <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Pay schedules</h2>

      {isPending && <p className="text-slate-400">Loading pay schedules…</p>}

      {!isPending && isError && (
        <div className="flex flex-col items-start gap-3 rounded-sm border border-red-500/30 bg-red-500/10 p-3">
          <p className="text-sm text-red-300">
            Could not load pay schedules. Confirm the accounting schema is exposed and you have a
            payroll role.
          </p>
          <Button size="sm" variant="secondary" icon="refresh" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!isPending && !isError && schedules.length === 0 && (
        <Card padding="lg" className="flex flex-col items-center gap-3 text-center">
          <span className="material-symbols-outlined text-4xl text-slate-600">event_repeat</span>
          <div>
            <p className="font-semibold text-white">No pay schedules yet</p>
            <p className="mt-1 text-sm text-slate-400">
              Create a pay schedule to set the pay frequency (which drives how withholding is
              annualized) and the period a pay run opens for.
            </p>
          </div>
          <Button icon="add" onClick={() => setModal({ open: true, schedule: null })}>
            New schedule
          </Button>
        </Card>
      )}

      {!isPending && !isError && schedules.length > 0 && (
        <div className="flex flex-col gap-2">
          {schedules.map((schedule) => (
            <ScheduleRow
              key={schedule.id}
              schedule={schedule}
              onEdit={() => setModal({ open: true, schedule })}
            />
          ))}
        </div>
      )}

      {modal.open && (
        <ScheduleModal
          schedule={modal.schedule}
          onClose={() => setModal({ open: false, schedule: null })}
        />
      )}
    </PayrollScreen>
  );
}

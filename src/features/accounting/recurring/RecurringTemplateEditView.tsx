import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { AccountingShell } from '../components/AccountingShell';
import { TaxDisclaimer } from '../components/TaxDisclaimer';
import { useRecurringTemplate } from '../hooks/useAccountingQueries';
import {
  useCreateRecurringTemplate,
  useUpdateRecurringTemplate,
} from '../hooks/useAccountingMutations';
import { todayISO } from '../recurrence';
import { RECURRING_BASE } from '../constants';
import { BillPayloadEditor, InvoicePayloadEditor, JournalPayloadEditor } from './PayloadEditors';
import { emptyBillLine, emptyInvoiceLine, emptyJournalLine } from './recurringFormat';
import {
  RECURRING_FREQUENCIES,
  RECURRING_FREQUENCY_LABELS,
  RECURRING_KINDS,
  RECURRING_KIND_LABELS,
  type NewRecurringTemplateInput,
  type RecurringBillPayload,
  type RecurringFrequency,
  type RecurringInvoicePayload,
  type RecurringJournalPayload,
  type RecurringKind,
  type RecurringPayload,
  type UpdateRecurringTemplateInput,
} from '../types';

const inputClass =
  'w-full rounded-sm border border-white/10 bg-background-dark px-2 py-1.5 text-white focus:border-primary focus:outline-none';

/** A fresh payload of the right shape for a kind (used on create + on kind switch). */
function emptyPayloadFor(kind: RecurringKind): RecurringPayload {
  if (kind === 'invoice') {
    return { customerId: '', lines: [emptyInvoiceLine()] } satisfies RecurringInvoicePayload;
  }
  if (kind === 'bill') {
    return { vendorId: '', lines: [emptyBillLine()] } satisfies RecurringBillPayload;
  }
  return { lines: [emptyJournalLine(), emptyJournalLine()] } satisfies RecurringJournalPayload;
}

/** Frequencies that support a day-of-month anchor. */
const MONTH_ANCHORED: RecurringFrequency[] = ['monthly', 'quarterly', 'yearly'];

interface ScheduleState {
  name: string;
  frequency: RecurringFrequency;
  intervalCount: number;
  startDate: string;
  endDate: string;
  nextRunDate: string;
  dayOfMonth: string; // empty string = none
  active: boolean;
}

export default function RecurringTemplateEditView() {
  const navigate = useNavigate();
  const { templateId } = useParams<{ templateId: string }>();
  const isEdit = !!templateId && templateId !== 'new';

  const {
    data: existing,
    isPending: loadingExisting,
    isError,
  } = useRecurringTemplate(isEdit ? templateId : undefined);
  const create = useCreateRecurringTemplate();
  const update = useUpdateRecurringTemplate();

  const [kind, setKind] = useState<RecurringKind>('invoice');
  const [schedule, setSchedule] = useState<ScheduleState>(() => ({
    name: '',
    frequency: 'monthly',
    intervalCount: 1,
    startDate: todayISO(),
    endDate: '',
    nextRunDate: todayISO(),
    dayOfMonth: '',
    active: true,
  }));
  const [payload, setPayload] = useState<RecurringPayload>(() => emptyPayloadFor('invoice'));
  const [error, setError] = useState<string | null>(null);
  // Hydrate-once guard so editing the form doesn't get clobbered by a refetch.
  const [hydrated, setHydrated] = useState(false);

  // Load existing template into form state (edit mode), once.
  useEffect(() => {
    if (!isEdit || !existing || hydrated) return;
    setKind(existing.kind);
    setSchedule({
      name: existing.name,
      frequency: existing.frequency,
      intervalCount: existing.intervalCount,
      startDate: existing.startDate,
      endDate: existing.endDate ?? '',
      nextRunDate: existing.nextRunDate,
      dayOfMonth: existing.dayOfMonth != null ? String(existing.dayOfMonth) : '',
      active: existing.active,
    });
    setPayload(existing.payload);
    setHydrated(true);
  }, [isEdit, existing, hydrated]);

  const patchSchedule = (p: Partial<ScheduleState>) => setSchedule((prev) => ({ ...prev, ...p }));

  // Switching kind (create only) swaps in a fresh payload of the new shape.
  const onKindChange = (next: RecurringKind) => {
    setKind(next);
    setPayload(emptyPayloadFor(next));
  };

  const monthAnchored = MONTH_ANCHORED.includes(schedule.frequency);

  const dayOfMonthNum = useMemo(() => {
    if (!schedule.dayOfMonth.trim()) return null;
    const n = Number.parseInt(schedule.dayOfMonth, 10);
    return Number.isFinite(n) ? Math.min(Math.max(n, 1), 31) : null;
  }, [schedule.dayOfMonth]);

  /** Validate the kind-specific payload before building the input. Returns an error or null. */
  const validatePayload = (): string | null => {
    if (kind === 'invoice') {
      const p = payload as RecurringInvoicePayload;
      if (!p.customerId) return 'Select a customer for the recurring invoice.';
      const real = p.lines.filter(
        (l) => (l.quantity ?? 0) > 0 && ((l.unitPrice ?? 0) > 0 || (l.lineTotal ?? 0) > 0)
      );
      if (real.length === 0) return 'Add at least one invoice line with an amount.';
    } else if (kind === 'bill') {
      const p = payload as RecurringBillPayload;
      if (!p.vendorId) return 'Select a vendor for the recurring bill.';
      const real = p.lines.filter((l) => (l.unitCost ?? 0) > 0 || (l.lineTotal ?? 0) > 0);
      if (real.length === 0) return 'Add at least one bill line with an amount.';
    } else {
      const p = payload as RecurringJournalPayload;
      const real = p.lines.filter(
        (l) => l.accountId && ((l.debit ?? 0) > 0 || (l.credit ?? 0) > 0)
      );
      if (real.length < 2)
        return 'A journal entry needs at least two lines with an account and an amount.';
      const debit = real.reduce((s, l) => s + Math.round((l.debit ?? 0) * 100), 0);
      const credit = real.reduce((s, l) => s + Math.round((l.credit ?? 0) * 100), 0);
      if (debit !== credit) return 'Journal debits and credits must balance before saving.';
      if (real.some((l) => (l.debit ?? 0) > 0 && (l.credit ?? 0) > 0)) {
        return 'Each journal line takes either a debit or a credit, not both.';
      }
    }
    return null;
  };

  /** Strip the payload down to real lines so we never persist empty placeholder rows. */
  const cleanPayload = (): RecurringPayload => {
    if (kind === 'invoice') {
      const p = payload as RecurringInvoicePayload;
      return {
        ...p,
        lines: p.lines.filter(
          (l) => (l.quantity ?? 0) > 0 && ((l.unitPrice ?? 0) > 0 || (l.lineTotal ?? 0) > 0)
        ),
      };
    }
    if (kind === 'bill') {
      const p = payload as RecurringBillPayload;
      return {
        ...p,
        lines: p.lines.filter((l) => (l.unitCost ?? 0) > 0 || (l.lineTotal ?? 0) > 0),
      };
    }
    const p = payload as RecurringJournalPayload;
    return {
      ...p,
      lines: p.lines.filter((l) => l.accountId && ((l.debit ?? 0) > 0 || (l.credit ?? 0) > 0)),
    };
  };

  const submit = async () => {
    setError(null);
    if (!schedule.name.trim()) {
      setError('Give this template a name.');
      return;
    }
    if (schedule.intervalCount < 1) {
      setError('Repeat interval must be at least 1.');
      return;
    }
    if (schedule.endDate && schedule.endDate < schedule.startDate) {
      setError('End date cannot be before the start date.');
      return;
    }
    const payloadError = validatePayload();
    if (payloadError) {
      setError(payloadError);
      return;
    }
    const cleanedPayload = cleanPayload();

    if (isEdit && templateId) {
      const input: UpdateRecurringTemplateInput = {
        name: schedule.name.trim(),
        frequency: schedule.frequency,
        intervalCount: schedule.intervalCount,
        startDate: schedule.startDate,
        endDate: schedule.endDate || null,
        nextRunDate: schedule.nextRunDate,
        dayOfMonth: monthAnchored ? dayOfMonthNum : null,
        payload: cleanedPayload,
        active: schedule.active,
      };
      const res = await update.mutateAsync({ id: templateId, input });
      if (res.error || !res.template) {
        setError(res.error ?? 'Could not save the template.');
        return;
      }
    } else {
      const input: NewRecurringTemplateInput = {
        name: schedule.name.trim(),
        kind,
        frequency: schedule.frequency,
        intervalCount: schedule.intervalCount,
        startDate: schedule.startDate,
        endDate: schedule.endDate || null,
        nextRunDate: schedule.nextRunDate || schedule.startDate,
        dayOfMonth: monthAnchored ? dayOfMonthNum : null,
        payload: cleanedPayload,
        active: schedule.active,
      };
      const res = await create.mutateAsync(input);
      if (res.error || !res.template) {
        setError(res.error ?? 'Could not create the template.');
        return;
      }
    }
    navigate(RECURRING_BASE);
  };

  const busy = create.isPending || update.isPending;
  const title = isEdit ? 'Edit template' : 'New recurring template';

  // Edit-mode loading / not-found guards.
  if (isEdit && loadingExisting && !hydrated) {
    return (
      <AccountingShell active="recurring" title={title}>
        <p className="text-slate-400">Loading template…</p>
      </AccountingShell>
    );
  }
  if (isEdit && (isError || (!loadingExisting && !existing))) {
    return (
      <AccountingShell active="recurring" title={title}>
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 py-16 text-center">
          <span className="material-symbols-outlined text-4xl text-slate-500">search_off</span>
          <p className="text-lg font-bold text-white">Template not found</p>
          <Button variant="secondary" icon="arrow_back" onClick={() => navigate(RECURRING_BASE)}>
            Back to recurring
          </Button>
        </div>
      </AccountingShell>
    );
  }

  return (
    <AccountingShell active="recurring" title={title}>
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <TaxDisclaimer />

        <button
          type="button"
          onClick={() => navigate(RECURRING_BASE)}
          className="flex items-center gap-1 self-start text-sm font-semibold text-slate-400 hover:text-white"
        >
          <span className="material-symbols-outlined text-lg">arrow_back</span>
          Back to recurring
        </button>

        {/* Identity + kind */}
        <section className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Template name" htmlFor="rec-name" required>
              <input
                id="rec-name"
                className={inputClass}
                value={schedule.name}
                onChange={(e) => patchSchedule({ name: e.target.value })}
                placeholder="e.g. Monthly retainer — Acme"
              />
            </FormField>

            <FormField
              label="Type"
              htmlFor="rec-kind"
              hint={isEdit ? 'Type is fixed after creation.' : 'What this template generates.'}
            >
              <select
                id="rec-kind"
                className={inputClass}
                value={kind}
                onChange={(e) => onKindChange(e.target.value as RecurringKind)}
                disabled={isEdit}
              >
                {RECURRING_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {RECURRING_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
        </section>

        {/* Schedule */}
        <section className="flex flex-col gap-3 border-t border-white/10 pt-4">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-400">Schedule</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Frequency" htmlFor="rec-freq">
              <select
                id="rec-freq"
                className={inputClass}
                value={schedule.frequency}
                onChange={(e) => patchSchedule({ frequency: e.target.value as RecurringFrequency })}
              >
                {RECURRING_FREQUENCIES.map((f) => (
                  <option key={f} value={f}>
                    {RECURRING_FREQUENCY_LABELS[f]}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField
              label="Repeat every"
              htmlFor="rec-interval"
              hint="Number of frequency units between runs"
            >
              <input
                id="rec-interval"
                type="number"
                min={1}
                className={`${inputClass} text-right`}
                value={schedule.intervalCount}
                onChange={(e) =>
                  patchSchedule({
                    intervalCount: Math.max(1, Number.parseInt(e.target.value, 10) || 1),
                  })
                }
              />
            </FormField>

            <FormField label="Start date" htmlFor="rec-start">
              <input
                id="rec-start"
                type="date"
                className={inputClass}
                value={schedule.startDate}
                onChange={(e) => {
                  const v = e.target.value;
                  // Keep next-run aligned with start when it hasn't diverged yet.
                  patchSchedule(
                    schedule.nextRunDate === schedule.startDate
                      ? { startDate: v, nextRunDate: v }
                      : { startDate: v }
                  );
                }}
              />
            </FormField>

            <FormField
              label="Next run date"
              htmlFor="rec-next"
              hint="When the next document generates (defaults to start)."
            >
              <input
                id="rec-next"
                type="date"
                className={inputClass}
                value={schedule.nextRunDate}
                onChange={(e) => patchSchedule({ nextRunDate: e.target.value })}
              />
            </FormField>

            <FormField
              label="End date"
              htmlFor="rec-end"
              hint="Optional — leave blank for open-ended."
            >
              <input
                id="rec-end"
                type="date"
                className={inputClass}
                value={schedule.endDate}
                onChange={(e) => patchSchedule({ endDate: e.target.value })}
              />
            </FormField>

            {monthAnchored && (
              <FormField
                label="Day of month"
                htmlFor="rec-dom"
                hint="Optional 1–31 anchor (clamped to month length)."
              >
                <input
                  id="rec-dom"
                  type="number"
                  min={1}
                  max={31}
                  className={`${inputClass} text-right`}
                  value={schedule.dayOfMonth}
                  onChange={(e) => patchSchedule({ dayOfMonth: e.target.value })}
                  placeholder="e.g. 1"
                />
              </FormField>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={schedule.active}
              onChange={(e) => patchSchedule({ active: e.target.checked })}
              className="size-4 accent-primary"
            />
            Active (paused templates never appear as due)
          </label>
        </section>

        {/* Payload (kind-specific) */}
        <section className="flex flex-col gap-3 border-t border-white/10 pt-4">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-400">
            {RECURRING_KIND_LABELS[kind]} details
          </h2>
          {kind === 'invoice' && (
            <InvoicePayloadEditor
              payload={payload as RecurringInvoicePayload}
              onChange={(p) => setPayload(p)}
            />
          )}
          {kind === 'bill' && (
            <BillPayloadEditor
              payload={payload as RecurringBillPayload}
              onChange={(p) => setPayload(p)}
            />
          )}
          {kind === 'journal' && (
            <JournalPayloadEditor
              payload={payload as RecurringJournalPayload}
              onChange={(p) => setPayload(p)}
            />
          )}
        </section>

        {error && (
          <p className="text-sm text-red-400" role="alert">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-white/10 pt-4">
          <Button variant="ghost" onClick={() => navigate(RECURRING_BASE)}>
            Cancel
          </Button>
          <Button icon="save" onClick={submit} disabled={busy}>
            {busy ? 'Saving…' : isEdit ? 'Save template' : 'Create template'}
          </Button>
        </div>
      </div>
    </AccountingShell>
  );
}

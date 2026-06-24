import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { AccountingShell } from '../components/AccountingShell';
import { TaxDisclaimer } from '../components/TaxDisclaimer';
import { useRecurringTemplates } from '../hooks/useAccountingQueries';
import {
  useGenerateAllDueRecurring,
  useGenerateRecurringTemplate,
  useSetRecurringTemplateActive,
} from '../hooks/useAccountingMutations';
import { formatMoney } from '../accountingViewModel';
import { isOnOrBefore, todayISO } from '../recurrence';
import { RECURRING_BASE } from '../constants';
import {
  isTemplateDue,
  payloadGrossCents,
  payloadLineCount,
  scheduleLabel,
} from './recurringFormat';
import {
  RECURRING_KIND_LABELS,
  type GenerateResult,
  type RecurringKind,
  type RecurringTemplate,
} from '../types';

const KIND_ICON: Record<RecurringKind, string> = {
  invoice: 'receipt_long',
  bill: 'request_quote',
  journal: 'menu_book',
};

/** A small status pill for due / paused / scheduled state. */
function StatusBadge({ tpl, asOf }: { tpl: RecurringTemplate; asOf: string }) {
  if (!tpl.active) {
    return (
      <span className="rounded-full bg-slate-500/15 px-2 py-0.5 text-xs font-semibold text-muted">
        Paused
      </span>
    );
  }
  if (isTemplateDue(tpl, asOf)) {
    return (
      <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-300">
        Due
      </span>
    );
  }
  return (
    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-300">
      Scheduled
    </span>
  );
}

/**
 * Has a template reached its end_date and been auto-paused at its final period?
 *
 * When `generateDue` advances past `end_date` it deactivates the template and FREEZES
 * the cursor at the period it just ran (next_run_date := last_run_date, since the real
 * next cursor would be null). Such a template is "ended": its next_run_date points at an
 * already-generated period that is still within the schedule window. Naively flipping
 * `active` back on would make it immediately "Due" and let a Generate re-post that final
 * period's invoice/bill/JE — a duplicate posting. We detect this so Resume can route to
 * the editor (to set a fresh next_run_date) instead of re-activating in place.
 *
 * A template merely paused mid-schedule is NOT ended: its cursor was advanced past the
 * last run (next_run_date > last_run_date), so resuming it is safe.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function isTemplateEnded(
  tpl: Pick<RecurringTemplate, 'active' | 'endDate' | 'nextRunDate' | 'lastRunDate'>
): boolean {
  if (tpl.active) return false;
  if (!tpl.endDate) return false;
  // The cursor was frozen at (or behind) the last generated period — i.e. it was NOT
  // advanced past the last run, the signature of an end-of-schedule auto-pause.
  if (tpl.lastRunDate == null) return false;
  if (!isOnOrBefore(tpl.nextRunDate, tpl.lastRunDate)) return false;
  // …and that frozen cursor is still on/before the end date, so re-activating would
  // immediately re-fire an already-run period.
  return isOnOrBefore(tpl.nextRunDate, tpl.endDate);
}

function TemplateCard({
  tpl,
  asOf,
  onGenerate,
  generating,
}: {
  tpl: RecurringTemplate;
  asOf: string;
  onGenerate: () => void;
  generating: boolean;
}) {
  const navigate = useNavigate();
  const setActive = useSetRecurringTemplateActive();
  const due = isTemplateDue(tpl, asOf);
  const ended = isTemplateEnded(tpl);
  const gross = payloadGrossCents(tpl.kind, tpl.payload);
  const lineCount = payloadLineCount(tpl.payload);
  const busy = generating || setActive.isPending;

  return (
    <div className="flex flex-col gap-3 rounded-sm border border-white/10 bg-card-dark p-3">
      <div className="flex items-start gap-3">
        <span className="material-symbols-outlined mt-0.5 text-xl text-primary">
          {KIND_ICON[tpl.kind]}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate(`${RECURRING_BASE}/${tpl.id}`)}
              className="truncate text-left text-base font-bold text-white hover:text-primary"
            >
              {tpl.name}
            </button>
            <StatusBadge tpl={tpl} asOf={asOf} />
          </div>
          <p className="text-xs text-muted">
            {RECURRING_KIND_LABELS[tpl.kind]} · {scheduleLabel(tpl)} · {lineCount}{' '}
            {lineCount === 1 ? 'line' : 'lines'}
          </p>
        </div>
        <span className="shrink-0 font-mono text-sm tabular-nums text-white">
          {formatMoney(gross / 100)}
        </span>
      </div>

      <div className="flex items-center justify-between gap-3 text-xs text-subtle">
        <span>
          {tpl.active ? (
            <>
              Next run{' '}
              <span className={`font-mono ${due ? 'text-amber-300' : 'text-muted'}`}>
                {tpl.nextRunDate}
              </span>
            </>
          ) : ended ? (
            <>Ended — reschedule to resume</>
          ) : (
            <>Paused — resume to schedule</>
          )}
          {tpl.endDate && <span className="text-subtle"> · ends {tpl.endDate}</span>}
        </span>
        {tpl.lastRunDate && (
          <span className="text-subtle">
            Last {tpl.lastRunDate} · {tpl.occurrencesGenerated}×
          </span>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-white/5 pt-2">
        {ended ? (
          // Ended template: its cursor is frozen at an already-generated period, so a
          // bare re-activate would let Generate re-post a duplicate. Route to the editor
          // to set a fresh next run date past the end date instead.
          <Button
            size="sm"
            variant="ghost"
            icon="event_upcoming"
            onClick={() => navigate(`${RECURRING_BASE}/${tpl.id}`)}
            disabled={busy}
            title="This template reached its end date. Set a new next run date to resume."
          >
            Reschedule
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            icon={tpl.active ? 'pause' : 'play_arrow'}
            onClick={() => setActive.mutate({ id: tpl.id, active: !tpl.active })}
            disabled={busy}
          >
            {tpl.active ? 'Pause' : 'Resume'}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          icon="edit"
          onClick={() => navigate(`${RECURRING_BASE}/${tpl.id}`)}
          disabled={busy}
        >
          Edit
        </Button>
        <Button
          size="sm"
          icon="bolt"
          onClick={onGenerate}
          disabled={busy || !tpl.active}
          title={!tpl.active ? 'Resume the template to generate' : undefined}
        >
          {generating ? 'Generating…' : 'Generate'}
        </Button>
      </div>
    </div>
  );
}

/** One line of the post-run results panel: success → link, failure → reason. */
function ResultRow({ result, templateName }: { result: GenerateResult; templateName: string }) {
  const navigate = useNavigate();
  const ok = !!result.generatedId && !isHardError(result);
  return (
    <div className="flex items-start gap-2 px-3 py-2 text-sm">
      <span
        className={`material-symbols-outlined text-lg ${ok ? 'text-emerald-400' : 'text-red-400'}`}
      >
        {ok ? 'check_circle' : 'error'}
      </span>
      <div className="min-w-0 flex-1">
        <span className="block truncate font-medium text-white">{templateName}</span>
        {ok ? (
          <span className="block text-xs text-muted">
            Posted{result.journalEntryId ? ' a balanced journal entry' : ''}.
            {result.ended && ' Template reached its end date and was paused.'}
            {result.error && <span className="text-amber-300"> {result.error}</span>}
          </span>
        ) : (
          <span className="block text-xs text-red-300">{result.error ?? 'Generation failed.'}</span>
        )}
      </div>
      {ok && result.journalEntryId && (
        <button
          type="button"
          onClick={() => navigate(`/app/accounting/journal/${result.journalEntryId}`)}
          className="shrink-0 text-xs font-semibold text-primary hover:text-primary-hover"
        >
          View JE
        </button>
      )}
    </div>
  );
}

/** A result is a hard failure when nothing was generated (cursor untouched). */
function isHardError(r: GenerateResult): boolean {
  return !r.generatedId;
}

/**
 * B2 — Recurring transactions list. Each template stores a schedule + payload describing
 * the next invoice/bill/journal to materialize. "Generate due" is the money path: it
 * builds the next document and posts a BALANCED journal entry via post_journal_entry,
 * then advances the schedule by exactly one period. Because this surface triggers
 * financial postings, it carries the CPA/EA disclaimer (G9).
 *
 * Catch-up note (from the API lane): each generate advances ONE period, so a template
 * several periods overdue stays "Due" after a run until it is caught up — the results
 * panel and the live "Due" badge reflect that.
 */
export default function RecurringTemplatesView() {
  const navigate = useNavigate();
  const asOf = useMemo(() => todayISO(), []);
  const { data: templates = [], isPending, isError } = useRecurringTemplates(true);
  const generateOne = useGenerateRecurringTemplate();
  const generateAll = useGenerateAllDueRecurring();
  const [results, setResults] = useState<{ result: GenerateResult; name: string }[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const nameById = useMemo(() => new Map(templates.map((t) => [t.id, t.name])), [templates]);

  const dueCount = useMemo(
    () => templates.filter((t) => isTemplateDue(t, asOf)).length,
    [templates, asOf]
  );

  const runOne = async (tpl: RecurringTemplate) => {
    setBusyId(tpl.id);
    setResults(null);
    try {
      const result = await generateOne.mutateAsync({ id: tpl.id });
      setResults([{ result, name: tpl.name }]);
    } finally {
      setBusyId(null);
    }
  };

  const runAll = async () => {
    setResults(null);
    const all = await generateAll.mutateAsync(asOf);
    setResults(
      all.map((result) => ({ result, name: nameById.get(result.templateId) ?? 'Template' }))
    );
  };

  const generatingAll = generateAll.isPending;

  return (
    <AccountingShell
      active="recurring"
      title="Recurring"
      actions={
        <Button size="sm" icon="add" onClick={() => navigate(`${RECURRING_BASE}/new`)}>
          New template
        </Button>
      }
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <TaxDisclaimer />

        <p className="text-sm text-muted">
          Templates generate the next invoice, bill, or journal entry on a schedule. Generating
          posts a balanced journal entry and advances the schedule by one period — it does not
          back-fill several periods at once, so a long-overdue template may stay due after a run.
        </p>

        {/* Due summary + generate-all */}
        {!isPending && !isError && templates.length > 0 && (
          <div className="flex items-center justify-between gap-3 rounded-sm border border-white/10 bg-white/5 px-3 py-2.5">
            <span className="text-sm text-muted">
              {dueCount > 0 ? (
                <>
                  <span className="font-bold text-amber-300">{dueCount}</span>{' '}
                  {dueCount === 1 ? 'template is' : 'templates are'} due as of {asOf}.
                </>
              ) : (
                <>Nothing is due as of {asOf}.</>
              )}
            </span>
            <Button
              size="sm"
              icon="bolt"
              onClick={runAll}
              disabled={generatingAll || dueCount === 0}
            >
              {generatingAll ? 'Generating…' : 'Generate all due'}
            </Button>
          </div>
        )}

        {/* Results of the last run */}
        {results && results.length > 0 && (
          <div className="overflow-hidden rounded-sm border border-white/10">
            <div className="flex items-center justify-between border-b border-white/10 bg-white/5 px-3 py-2">
              <span className="text-sm font-bold text-white">Last run</span>
              <button
                type="button"
                onClick={() => setResults(null)}
                aria-label="Dismiss results"
                className="flex size-7 items-center justify-center rounded-sm text-muted hover:bg-white/10 hover:text-white"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>
            <div className="divide-y divide-white/5">
              {results.map(({ result, name }, i) => (
                <ResultRow key={`${result.templateId}-${i}`} result={result} templateName={name} />
              ))}
            </div>
          </div>
        )}

        {isPending && <p className="text-muted">Loading recurring templates…</p>}
        {isError && (
          <p className="text-red-400">
            Could not load recurring templates. Confirm the accounting schema is exposed and you
            have an accounting role.
          </p>
        )}

        {!isPending && !isError && templates.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 rounded-sm border border-dashed border-white/15 px-6 py-16 text-center">
            <span className="material-symbols-outlined text-4xl text-subtle">event_repeat</span>
            <p className="text-lg font-bold text-white">No recurring templates yet</p>
            <p className="max-w-sm text-sm text-muted">
              Create a template to auto-generate a recurring invoice, bill, or journal entry on a
              schedule — for example, a monthly retainer invoice or a recurring rent bill.
            </p>
            <Button size="sm" icon="add" onClick={() => navigate(`${RECURRING_BASE}/new`)}>
              New template
            </Button>
          </div>
        )}

        {!isPending && !isError && templates.length > 0 && (
          <div className="flex flex-col gap-3">
            {templates.map((tpl) => (
              <TemplateCard
                key={tpl.id}
                tpl={tpl}
                asOf={asOf}
                onGenerate={() => runOne(tpl)}
                generating={busyId === tpl.id && generateOne.isPending}
              />
            ))}
          </div>
        )}
      </div>
    </AccountingShell>
  );
}

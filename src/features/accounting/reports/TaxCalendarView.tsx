import { useNavigate } from 'react-router-dom';
import { AccountingShell } from '../components/AccountingShell';
import { TaxDisclaimer } from '../components/TaxDisclaimer';
import { LedgerTable } from '../components/LedgerTable';
import { REPORTS_BASE } from '../constants';
import { TAX_FILING_FREQUENCY_LABELS, type TaxCalendarEntry } from '../types';
import { useTaxFilingCalendar } from '../hooks/useAccountingQueries';
import { ExportButtons } from './ExportButtons';
import { taxCalendarDocument } from './reportDocuments';
import { ReportEmpty, ReportError, ReportLoading } from './ReportStates';

/**
 * C1 — read-only TAX CALENDAR dashboard. Lists upcoming and recent sales-tax filing
 * deadlines per agency, soonest due first, computed from the `tax_filing_calendar`
 * settings rules (falling back to each agency's filing frequency). This is REPORTING
 * ONLY: it delivers NO notifications/reminders and moves no money — it just surfaces the
 * derived deadlines. Overdue rows are styled red; the soonest upcoming one is highlighted.
 *
 * G9: the disclaimer carries the "Representative rates only." caveat (seeded cadences are
 * representative), and the PDF/CSV export embeds the same wording (taxCalendarDocument).
 */

/** Human "due in N days" / "N days overdue" label from the signed daysUntilDue. */
function dueInLabel(days: number): string {
  if (days === 0) return 'Due today';
  if (days < 0) {
    const n = Math.abs(days);
    return `${n} day${n === 1 ? '' : 's'} overdue`;
  }
  return `Due in ${days} day${days === 1 ? '' : 's'}`;
}

export default function TaxCalendarView() {
  const navigate = useNavigate();
  const { data, isPending, isError } = useTaxFilingCalendar();

  const hasEntries = !!data && data.entries.length > 0;
  // The soonest not-yet-overdue deadline gets a subtle highlight (the "next action").
  const nextDueDate = data?.entries.find((e) => !e.overdue)?.dueDate ?? null;

  return (
    <AccountingShell active="reports" title="Tax Calendar">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <button
          type="button"
          onClick={() => navigate(REPORTS_BASE)}
          className="flex items-center gap-1 self-start text-sm font-semibold text-muted hover:text-white"
        >
          <span className="material-symbols-outlined text-lg">arrow_back</span>
          All reports
        </button>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-white">Tax Calendar</h2>
            <p className="text-sm text-muted">
              Upcoming sales-tax filing deadlines{data ? ` · as of ${data.asOf}` : ''}
            </p>
          </div>
          <ExportButtons
            buildDocument={() => (data ? taxCalendarDocument(data) : null)}
            disabled={!hasEntries}
          />
        </div>

        <TaxDisclaimer representativeRates />

        <p className="text-xs text-subtle">
          This is a read-only reference derived from each agency’s configured (or representative)
          filing cadence. <span className="font-semibold">No reminders are sent</span> — confirm
          exact due dates and obligations with the agency or your CPA/EA.
        </p>

        {isPending && <ReportLoading label="Loading tax calendar…" />}
        {isError && <ReportError />}

        {!isPending && !isError && data && !hasEntries && (
          <ReportEmpty
            icon="event_busy"
            note="No filing deadlines could be derived. Add a tax agency with a filing frequency, or configure the tax filing calendar in settings."
          />
        )}

        {!isPending && !isError && hasEntries && (
          <LedgerTable
            columns={[
              { label: 'Agency' },
              { label: 'Frequency' },
              { label: 'Period' },
              { label: 'Due date', align: 'right' },
              { label: 'Status', align: 'right' },
            ]}
          >
            {data!.entries.map((e, i) => (
              <CalendarRow
                key={`${e.agencyId ?? e.agencyName}-${e.periodStart}-${e.dueDate}-${i}`}
                entry={e}
                isNext={!e.overdue && e.dueDate === nextDueDate}
              />
            ))}
          </LedgerTable>
        )}
      </div>
    </AccountingShell>
  );
}

/** One deadline row: overdue → red tint, the soonest upcoming → primary tint. */
function CalendarRow({ entry, isNext }: { entry: TaxCalendarEntry; isNext: boolean }) {
  const rowClass = entry.overdue
    ? 'border-t border-red-500/30 bg-red-500/[0.07]'
    : isNext
      ? 'border-t border-primary/30 bg-primary/5'
      : 'border-t border-line/60';

  const statusClass = entry.overdue
    ? 'text-red-300'
    : entry.daysUntilDue <= 14
      ? 'text-amber-300'
      : 'text-muted';

  return (
    <tr className={rowClass}>
      <td className="px-3 py-2 text-white">
        {entry.overdue && (
          <span className="material-symbols-outlined mr-1 align-middle text-sm text-red-400">
            warning
          </span>
        )}
        {entry.agencyName}
      </td>
      <td className="px-3 py-2 text-muted">{TAX_FILING_FREQUENCY_LABELS[entry.frequency]}</td>
      <td className="px-3 py-2 text-muted">{entry.periodLabel}</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums text-white">{entry.dueDate}</td>
      <td className={`px-3 py-2 text-right text-xs font-semibold ${statusClass}`}>
        {dueInLabel(entry.daysUntilDue)}
      </td>
    </tr>
  );
}

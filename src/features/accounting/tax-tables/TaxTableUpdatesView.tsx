import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { AccountingShell } from '../components/AccountingShell';
import { TaxDisclaimer } from '../components/TaxDisclaimer';
import {
  useOpenTaxTableDriftCount,
  useTaxTableDrift,
  useTaxTableSources,
} from '../hooks/useAccountingQueries';
import { useCheckTaxTablesNow } from '../hooks/useAccountingMutations';
import { SETTINGS_BASE, taxTableDriftPath } from '../constants';
import {
  TAX_TABLE_DRIFT_SEVERITY_LABELS,
  TAX_TABLE_KIND_LABELS,
  type TaxTableDrift,
  type TaxTableSource,
} from '../types';
import {
  driftChangeSummary,
  formatTimestamp,
  hasOpenDrift,
  lastCheckedLabel,
  openDriftBadgeLabel,
  severityBadgeClass,
} from '../taxTableSyncView';

/** A small pill (kind / severity). */
function Pill({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${className}`}>
      {children}
    </span>
  );
}

/**
 * Banner that runs a manual refresh ("check now"). It POSTs to the server-gated Netlify
 * function — it never fetches external data in the browser. The function is INERT unless
 * the server env ACCOUNTING_TAX_SYNC_ENABLED is set, so the most common outcome today is a
 * graceful "not available yet" message (the function/flag is the backend lane's), surfaced
 * inline rather than thrown. A successful run refreshes the drift inbox automatically.
 */
function CheckNowBar() {
  const check = useCheckTaxTablesNow();
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async () => {
    setFeedback(null);
    const res = await check.mutateAsync();
    if (res.ok) {
      setFeedback({
        ok: true,
        text: res.message || 'Check complete. Any new differences appear below.',
      });
    } else {
      setFeedback({ ok: false, text: res.error || 'The check could not be run.' });
    }
  };

  return (
    <Card padding="lg" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-bold text-white">
            <span className="material-symbols-outlined text-primary">sync</span>
            Check for tax-table updates
          </h2>
          <p className="mt-1 max-w-xl text-sm text-muted">
            Tax tables are checked automatically every quarter. You can also run a check now. A
            check only compares the official published rates against your stored rates and records
            any differences below — it never changes a stored rate on its own.
          </p>
        </div>
        <Button icon="sync" onClick={run} disabled={check.isPending}>
          {check.isPending ? 'Checking…' : 'Check now'}
        </Button>
      </div>

      {feedback && (
        <p
          className={`rounded-lg border p-2 text-sm ${
            feedback.ok
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
          }`}
          role="status"
        >
          {feedback.text}
        </p>
      )}
    </Card>
  );
}

/** One open-drift row in the inbox: source, severity, change count, detected-at → detail. */
function OpenDriftRow({ drift, onOpen }: { drift: TaxTableDrift; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-overlay/5"
    >
      <span className="material-symbols-outlined text-amber-300">warning</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-semibold text-white">
            {drift.sourceName ?? 'Unknown source'}
          </span>
          {drift.sourceKind && (
            <Pill className="bg-slate-500/15 text-muted">
              {TAX_TABLE_KIND_LABELS[drift.sourceKind]}
            </Pill>
          )}
          <Pill className={severityBadgeClass(drift.severity)}>
            {TAX_TABLE_DRIFT_SEVERITY_LABELS[drift.severity]}
          </Pill>
        </div>
        <p className="mt-0.5 text-xs text-subtle">
          {driftChangeSummary(drift.diff)} · detected {formatTimestamp(drift.detectedAt)}
        </p>
      </div>
      <span className="material-symbols-outlined shrink-0 text-subtle">chevron_right</span>
    </button>
  );
}

/** One source row: name, jurisdiction, kind, last-checked, active flag, and a link out. */
function SourceRow({ source }: { source: TaxTableSource }) {
  return (
    <div className="flex items-start gap-3 px-3 py-3">
      <span className="material-symbols-outlined text-muted">
        {source.kind === 'payroll' ? 'badge' : 'receipt_long'}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-semibold text-white">{source.name}</span>
          <Pill className="bg-slate-500/15 text-muted">{TAX_TABLE_KIND_LABELS[source.kind]}</Pill>
          {source.jurisdiction && (
            <Pill className="bg-slate-500/15 text-muted">{source.jurisdiction}</Pill>
          )}
          {!source.active && <Pill className="bg-slate-500/15 text-subtle">Inactive</Pill>}
        </div>
        <p className="mt-0.5 text-xs text-subtle">
          {lastCheckedLabel(source.lastCheckedAt)} · every {source.checkFrequencyDays} days
        </p>
        {(source.officialFileUrl || source.url) && (
          <a
            href={source.officialFileUrl || source.url || undefined}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
            // Don't let an outbound-link click bubble to a parent row handler.
            onClick={(e) => e.stopPropagation()}
          >
            <span className="material-symbols-outlined text-sm">open_in_new</span>
            {source.officialFileUrl ? 'Official data file' : 'Source page'}
          </a>
        )}
      </div>
    </div>
  );
}

/**
 * TAX-SYNC — "Tax table updates" (ADVISORY-ONLY), accounting_admin-only, under Settings.
 *
 * This screen is the in-app admin ALERT surface for the quarterly tax-table refresh: it
 * lists the tax-table sources (CDTFA sales tax + CA EDD payroll) with when each was last
 * checked, and foregrounds any OPEN drift — a detected difference between the latest
 * official rates and the stored accounting.tax_rates. Open drift is the only actionable
 * state; tapping a row opens the detail where an admin reviews old-vs-new and explicitly
 * Applies or Dismisses. Nothing here moves money or posts a journal entry — and the whole
 * module is server-gated OFF until graduation, so "Check now" usually reports it is not yet
 * available rather than fetching anything.
 *
 * G9: carries the CPA/EA + representative-rates disclaimer prominently (seeded rates are
 * representative; the source parsers are best-effort and human-verified).
 */
export default function TaxTableUpdatesView() {
  const navigate = useNavigate();
  const openDrift = useTaxTableDrift('open');
  const openCount = useOpenTaxTableDriftCount();
  const sources = useTaxTableSources(true);

  const driftRows = openDrift.data ?? [];
  const count = openCount.data ?? driftRows.length;
  const badge = openDriftBadgeLabel(count);

  return (
    <AccountingShell active="settings" title="Tax table updates">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        {/* Prominent G9 disclaimer — representative rates + verify with a CPA/EA. */}
        <TaxDisclaimer representativeRates />

        <div className="flex items-start gap-2">
          <Button
            size="sm"
            variant="ghost"
            icon="arrow_back"
            onClick={() => navigate(SETTINGS_BASE)}
          >
            Settings
          </Button>
        </div>

        <div>
          <h1 className="app-section-title flex items-center gap-2 text-white">
            <span className="material-symbols-outlined text-primary">policy</span>
            Tax table updates
          </h1>
          <p className="mt-1 text-sm text-muted">
            Advisory only. We check official sales-tax (CDTFA) and payroll (CA EDD) tables on a
            quarterly schedule and flag when the published rates differ from your stored rates.
            Changes are{' '}
            <span className="font-semibold text-muted">never applied automatically</span> — you
            review and confirm each one.
          </p>
        </div>

        <CheckNowBar />

        {/* ── Open drift (the alert inbox) ─────────────────────────────────────── */}
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-base font-bold text-white">
            <span className="material-symbols-outlined text-primary">notifications_active</span>
            Open alerts
            {badge && (
              <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-on-accent">
                {badge}
              </span>
            )}
          </h2>

          {openDrift.isPending && <p className="text-sm text-muted">Loading alerts…</p>}

          {!openDrift.isPending && openDrift.isError && (
            <div className="flex flex-col items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
              <p className="text-sm text-red-300">
                Could not load drift alerts. Confirm the accounting schema is exposed and you have
                an accounting role.
              </p>
              <Button
                size="sm"
                variant="secondary"
                icon="refresh"
                onClick={() => openDrift.refetch()}
              >
                Retry
              </Button>
            </div>
          )}

          {!openDrift.isPending &&
            !openDrift.isError &&
            !hasOpenDrift(count) &&
            driftRows.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line px-6 py-12 text-center">
                <span className="material-symbols-outlined text-3xl text-emerald-400">
                  task_alt
                </span>
                <p className="font-bold text-white">No open alerts</p>
                <p className="max-w-md text-sm text-muted">
                  Your stored tax rates match the latest checked tables. If a quarterly check (or a
                  manual one) finds a difference, it will appear here for you to review.
                </p>
              </div>
            )}

          {!openDrift.isPending && !openDrift.isError && driftRows.length > 0 && (
            <Card padding="none" className="divide-y divide-overlay/5 overflow-hidden">
              {driftRows.map((drift) => (
                <OpenDriftRow
                  key={drift.id}
                  drift={drift}
                  onOpen={() => navigate(taxTableDriftPath(drift.id))}
                />
              ))}
            </Card>
          )}
        </section>

        {/* ── Sources ──────────────────────────────────────────────────────────── */}
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-base font-bold text-white">
            <span className="material-symbols-outlined text-primary">database</span>
            Sources
          </h2>
          <p className="mb-2 text-sm text-muted">
            The official tables we check, and when each was last pulled.
          </p>

          {sources.isPending && <p className="text-sm text-muted">Loading sources…</p>}

          {!sources.isPending && sources.isError && (
            <div className="flex flex-col items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
              <p className="text-sm text-red-300">Could not load tax-table sources.</p>
              <Button
                size="sm"
                variant="secondary"
                icon="refresh"
                onClick={() => sources.refetch()}
              >
                Retry
              </Button>
            </div>
          )}

          {!sources.isPending && !sources.isError && (sources.data ?? []).length === 0 && (
            <div className="rounded-lg border border-dashed border-line px-6 py-10 text-center text-sm text-muted">
              No tax-table sources are configured.
            </div>
          )}

          {!sources.isPending && !sources.isError && (sources.data ?? []).length > 0 && (
            <Card padding="none" className="divide-y divide-overlay/5 overflow-hidden">
              {(sources.data ?? []).map((source) => (
                <SourceRow key={source.id} source={source} />
              ))}
            </Card>
          )}
        </section>

        <p className="text-xs leading-relaxed text-subtle">
          <span className="font-semibold text-muted">How this works:</span> a scheduled job pulls
          each source&apos;s official data file, records a snapshot, and compares it to your active
          tax rates. A difference becomes an alert here — it does not change anything. Applying an
          alert updates the stored rate only (no journal entry, no money moved); future invoices
          then use the new rate.
        </p>
      </div>
    </AccountingShell>
  );
}

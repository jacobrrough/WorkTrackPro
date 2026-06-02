import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { LedgerTable } from '../components/LedgerTable';
import { AccountingShell } from '../components/AccountingShell';
import { TaxDisclaimer } from '../components/TaxDisclaimer';
import {
  useTaxTableDriftCurrentRates,
  useTaxTableDriftDetail,
} from '../hooks/useAccountingQueries';
import { useApplyTaxTableDrift, useDismissTaxTableDrift } from '../hooks/useAccountingMutations';
import { TAX_TABLES_BASE } from '../constants';
import {
  TAX_TABLE_DRIFT_ACTIONABLE_STATUSES,
  TAX_TABLE_DRIFT_SEVERITY_LABELS,
  TAX_TABLE_DRIFT_STATUS_LABELS,
  TAX_TABLE_KIND_LABELS,
  type TaxTableDrift,
} from '../types';
import {
  applicableRowCount,
  buildDriftComparisonRows,
  confirmApplyMessage,
  confirmDismissMessage,
  formatDriftDate,
  formatRatePct,
  formatTimestamp,
  severityBadgeClass,
  statusBadgeClass,
  type DriftComparisonRow,
} from '../taxTableSyncView';

/** A small pill. */
function Pill({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${className}`}>
      {children}
    </span>
  );
}

/** The action-verb cell for one comparison row (Update / New / Skipped). */
function ActionTag({ row }: { row: DriftComparisonRow }) {
  if (row.action === 'skip') {
    return <Pill className="bg-slate-500/15 text-slate-500">Skipped</Pill>;
  }
  if (row.action === 'insert') {
    return <Pill className="bg-emerald-500/15 text-emerald-300">New rate</Pill>;
  }
  return row.changed ? (
    <Pill className="bg-amber-500/15 text-amber-300">Update</Pill>
  ) : (
    <Pill className="bg-slate-500/15 text-slate-400">No change</Pill>
  );
}

/**
 * Confirmation dialog for Apply or Dismiss. Mirrors the period-lock dialog: it never
 * assumes success — the dialog stays open and shows the DB rejection verbatim (most
 * importantly `insufficient_privilege` when the signed-in admin lacks the accounting_admin
 * role, or the terminal-state guard if the drift was already actioned). It closes (and the
 * caller navigates back) only when the mutation returns ok.
 */
function ConfirmActionDialog({
  mode,
  drift,
  applicableCount,
  onClose,
  onDone,
}: {
  mode: 'apply' | 'dismiss';
  drift: TaxTableDrift;
  applicableCount: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const apply = useApplyTaxTableDrift();
  const dismiss = useDismissTaxTableDrift();
  const [error, setError] = useState<string | null>(null);

  const isApply = mode === 'apply';
  const pending = isApply ? apply.isPending : dismiss.isPending;
  const message = isApply
    ? confirmApplyMessage(drift.sourceName, applicableCount)
    : confirmDismissMessage(drift.sourceName);

  // Apply with nothing applicable is a guaranteed no-op — steer the admin to Dismiss.
  const applyDisabledNoop = isApply && applicableCount === 0;

  const confirm = async () => {
    setError(null);
    if (isApply) {
      const res = await apply.mutateAsync({ driftId: drift.id, diff: drift.diff });
      if (!res.ok) {
        setError(res.error ?? 'The change was rejected.');
        return;
      }
    } else {
      const res = await dismiss.mutateAsync(drift.id);
      if (!res.ok) {
        setError(res.error ?? 'The change was rejected.');
        return;
      }
    }
    onDone();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drift-confirm-title"
    >
      <div className="w-full max-w-md rounded-sm border border-white/10 bg-card-dark p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="drift-confirm-title" className="text-lg font-bold text-white">
            {isApply ? 'Apply these rates?' : 'Dismiss this alert?'}
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

        <p className="mb-4 text-sm text-slate-300">{message}</p>

        <p className="mb-4 text-xs text-slate-500">
          This action is restricted to the <span className="font-semibold">accounting_admin</span>{' '}
          role and is recorded in the accounting audit log.
        </p>

        {error && (
          <p
            className="mb-3 rounded-sm border border-red-500/30 bg-red-500/10 p-2 text-sm text-red-300"
            role="alert"
          >
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant={isApply ? 'primary' : 'secondary'}
            icon={isApply ? 'task_alt' : 'do_not_disturb_on'}
            onClick={confirm}
            disabled={pending || applyDisabledNoop}
          >
            {pending
              ? isApply
                ? 'Applying…'
                : 'Dismissing…'
              : isApply
                ? 'Apply rates'
                : 'Dismiss alert'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Header summary card: source, kind, severity, status, detected/reviewed timestamps. */
function DriftHeader({ drift }: { drift: TaxTableDrift }) {
  return (
    <Card padding="lg" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="material-symbols-outlined text-amber-300">warning</span>
        <span className="text-base font-bold text-white">
          {drift.sourceName ?? 'Unknown source'}
        </span>
        {drift.sourceKind && (
          <Pill className="bg-slate-500/15 text-slate-300">
            {TAX_TABLE_KIND_LABELS[drift.sourceKind]}
          </Pill>
        )}
        <Pill className={severityBadgeClass(drift.severity)}>
          {TAX_TABLE_DRIFT_SEVERITY_LABELS[drift.severity]}
        </Pill>
        <Pill className={statusBadgeClass(drift.status)}>
          {TAX_TABLE_DRIFT_STATUS_LABELS[drift.status]}
        </Pill>
      </div>
      <p className="text-xs text-slate-500">
        Detected {formatTimestamp(drift.detectedAt)}
        {drift.reviewedAt && ` · reviewed ${formatTimestamp(drift.reviewedAt)}`}
      </p>
    </Card>
  );
}

/**
 * TAX-SYNC — drift detail (ADVISORY-ONLY), accounting_admin-only. Renders the proposed
 * rate changes for one drift OLD-vs-NEW side-by-side: the currently-stored active rate next
 * to the proposed rate, with the action Apply would take per row (Update an existing rate /
 * create a New rate / Skip an unusable entry). The on-screen "would change" set is built
 * from the SAME rules the DB RPC uses, so what you see is exactly what Apply does.
 *
 * Two explicit, admin-confirmed actions: APPLY (updates accounting.tax_rates and marks the
 * drift applied — the only path that mutates stored rates; it posts NO journal entry and
 * moves NO money) and DISMISS (marks it dismissed, changes nothing). Terminal drifts
 * (already applied/dismissed) are read-only.
 *
 * G9: carries the CPA/EA + representative-rates disclaimer prominently.
 */
export default function TaxTableDriftDetailView() {
  const navigate = useNavigate();
  const { driftId } = useParams<{ driftId: string }>();
  const driftQuery = useTaxTableDriftDetail(driftId);
  const drift = driftQuery.data ?? null;

  // The currently-stored active rates the diff targets (keyed by exact name). Depends on
  // the loaded drift, so it only fires once the drift is in hand.
  const ratesQuery = useTaxTableDriftCurrentRates(drift);
  const currentRates = useMemo(() => ratesQuery.data ?? new Map(), [ratesQuery.data]);

  const [dialog, setDialog] = useState<'apply' | 'dismiss' | null>(null);

  const rows = useMemo(
    () => (drift ? buildDriftComparisonRows(drift.diff, currentRates) : []),
    [drift, currentRates]
  );
  const applicableCount = applicableRowCount(rows);
  const isActionable = drift ? TAX_TABLE_DRIFT_ACTIONABLE_STATUSES.has(drift.status) : false;

  const backToList = () => navigate(TAX_TABLES_BASE);

  return (
    <AccountingShell active="settings" title="Tax table drift">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <TaxDisclaimer representativeRates />

        <div className="flex items-start gap-2">
          <Button size="sm" variant="ghost" icon="arrow_back" onClick={backToList}>
            Tax table updates
          </Button>
        </div>

        {driftQuery.isPending && <p className="text-sm text-slate-400">Loading drift…</p>}

        {!driftQuery.isPending && driftQuery.isError && (
          <div className="flex flex-col items-start gap-3 rounded-sm border border-red-500/30 bg-red-500/10 p-3">
            <p className="text-sm text-red-300">
              Could not load this drift. Confirm the accounting schema is exposed and you have an
              accounting role.
            </p>
            <Button
              size="sm"
              variant="secondary"
              icon="refresh"
              onClick={() => driftQuery.refetch()}
            >
              Retry
            </Button>
          </div>
        )}

        {!driftQuery.isPending && !driftQuery.isError && !drift && (
          <div className="flex flex-col items-center justify-center gap-2 rounded-sm border border-dashed border-white/15 px-6 py-12 text-center">
            <span className="material-symbols-outlined text-3xl text-slate-500">search_off</span>
            <p className="font-bold text-white">Drift not found</p>
            <p className="max-w-md text-sm text-slate-400">
              This alert may have been removed. Return to the list to see current alerts.
            </p>
            <Button size="sm" icon="arrow_back" onClick={backToList}>
              Back to tax table updates
            </Button>
          </div>
        )}

        {!driftQuery.isPending && !driftQuery.isError && drift && (
          <>
            <DriftHeader drift={drift} />

            <section>
              <h2 className="mb-2 text-base font-bold text-white">Proposed rate changes</h2>
              <p className="mb-2 text-sm text-slate-400">
                The published rate next to your stored rate. Applying overwrites the matching active
                rate (or creates it when missing). Entries we can&apos;t apply (no usable rate name
                or no valid new rate) are shown but skipped.
              </p>

              {ratesQuery.isError && (
                <p
                  className="mb-2 rounded-sm border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-300"
                  role="alert"
                >
                  Could not load your current stored rates, so the “stored” column may be
                  incomplete. The proposed values are still accurate.
                </p>
              )}

              {rows.length === 0 ? (
                <div className="rounded-sm border border-dashed border-white/15 px-6 py-10 text-center text-sm text-slate-400">
                  This alert lists no rate changes.
                </div>
              ) : (
                <LedgerTable
                  columns={[
                    { label: 'Rate' },
                    { label: 'Jurisdiction' },
                    { label: 'Stored', align: 'right' },
                    { label: 'Proposed', align: 'right' },
                    { label: 'Effective' },
                    { label: 'Action' },
                  ]}
                >
                  {rows.map((row, i) => (
                    <tr key={`${row.rateName}-${i}`} className="border-t border-white/5">
                      <td className="px-3 py-2">
                        <span className="font-medium text-white">{row.rateName || '—'}</span>
                        {row.label && (
                          <span className="block text-xs text-slate-500">{row.label}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-300">{row.jurisdiction ?? '—'}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-400">
                        {formatRatePct(row.currentRate)}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-mono tabular-nums ${
                          row.changed ? 'font-bold text-white' : 'text-slate-400'
                        }`}
                      >
                        {formatRatePct(row.newRate)}
                      </td>
                      <td className="px-3 py-2 text-slate-300">
                        {formatDriftDate(row.effectiveDate)}
                      </td>
                      <td className="px-3 py-2">
                        <ActionTag row={row} />
                      </td>
                    </tr>
                  ))}
                </LedgerTable>
              )}
            </section>

            {/* ── Actions ──────────────────────────────────────────────────────── */}
            {isActionable ? (
              <Card padding="lg" className="flex flex-col gap-3">
                <p className="text-sm text-slate-300">
                  {applicableCount > 0 ? (
                    <>
                      Applying will change{' '}
                      <span className="font-bold text-white">
                        {applicableCount} {applicableCount === 1 ? 'rate' : 'rates'}
                      </span>{' '}
                      in your stored tax rates. No journal entry is posted and no money moves.
                    </>
                  ) : (
                    'There are no applicable rate changes to apply. You can dismiss this alert.'
                  )}
                </p>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    variant="secondary"
                    icon="do_not_disturb_on"
                    onClick={() => setDialog('dismiss')}
                  >
                    Dismiss
                  </Button>
                  <Button
                    icon="task_alt"
                    onClick={() => setDialog('apply')}
                    disabled={applicableCount === 0}
                  >
                    Apply{applicableCount > 0 ? ` ${applicableCount}` : ''}
                  </Button>
                </div>
              </Card>
            ) : (
              <div className="rounded-sm border border-white/10 bg-white/5 p-3 text-sm text-slate-400">
                This alert is{' '}
                <span className="font-semibold text-slate-300">
                  {TAX_TABLE_DRIFT_STATUS_LABELS[drift.status].toLowerCase()}
                </span>{' '}
                and can no longer be applied or dismissed.
              </div>
            )}
          </>
        )}
      </div>

      {dialog && drift && (
        <ConfirmActionDialog
          mode={dialog}
          drift={drift}
          applicableCount={applicableCount}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            // After a successful apply/dismiss the drift leaves the open inbox; go back to
            // the list (the hook already invalidated the TAX-SYNC subtree).
            backToList();
          }}
        />
      )}
    </AccountingShell>
  );
}

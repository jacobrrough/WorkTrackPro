import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { AccountingShell } from '../components/AccountingShell';
import { TaxDisclaimer } from '../components/TaxDisclaimer';
import { useFixedAssetRegister } from '../hooks/useAccountingQueries';
import { useRunDepreciationForPeriod } from '../hooks/useAccountingMutations';
import { FIXED_ASSETS_BASE } from '../constants';
import {
  formatAssetDate,
  formatMoney,
  methodLabel,
  statusBadgeClass,
  statusLabel,
  totalFixedAssetRegister,
} from './fixedAssetFormat';
import type { FixedAssetRegisterRow, RunDepreciationResult } from '../types';

const inputClass =
  'w-full rounded-lg border border-line bg-background-dark px-2 py-1.5 text-white focus:border-primary focus:outline-none';

/** Today as a bare ISO `YYYY-MM-DD` for the run-depreciation date default. */
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Right-aligned, tabular money cell; matches the report / valuation tables. */
function MoneyCell({
  amount,
  strong = false,
  muted = false,
}: {
  amount: number;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <td
      className={`px-3 py-2 text-right font-mono tabular-nums ${
        strong ? 'font-bold text-white' : muted ? 'text-muted' : 'text-white'
      }`}
    >
      {formatMoney(amount)}
    </td>
  );
}

/** One labeled figure in the summary strip. */
function SummaryStat({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'accent';
}) {
  return (
    <div className="rounded-2xl border border-line bg-card-dark p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-subtle">{label}</p>
      <p
        className={`mt-1 font-mono text-lg font-bold tabular-nums ${
          tone === 'accent' ? 'text-primary' : 'text-white'
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-subtle">{hint}</p>}
    </div>
  );
}

/** Lifecycle pill. */
function StatusBadge({ status }: { status: FixedAssetRegisterRow['status'] }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusBadgeClass(status)}`}
    >
      {statusLabel(status)}
    </span>
  );
}

/**
 * Dialog: run depreciation for a period. Posts every DUE (unposted, period_date <= date)
 * schedule row across all non-disposed assets, each as a BALANCED Dr depreciation-expense /
 * Cr 1510 Accumulated Depreciation entry through accounting.post_journal_entry (the
 * books-closed lock is honored by the RPC). Idempotent — already-posted rows are skipped.
 * On success it reports how many entries posted and the dollar total; on a DB rejection
 * (RLS denial, a closed-period row) it surfaces the message inline and nothing is posted.
 */
function RunDepreciationModal({ onClose }: { onClose: () => void }) {
  const run = useRunDepreciationForPeriod();
  const [periodDate, setPeriodDate] = useState(todayISO());
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RunDepreciationResult | null>(null);

  const submit = async () => {
    setError(null);
    setResult(null);
    if (!periodDate) {
      setError('Choose the period-end date to post depreciation through.');
      return;
    }
    const res = await run.mutateAsync(periodDate);
    if (res.error) {
      setError(res.error);
      return;
    }
    setResult(res);
  };

  return (
    <div className="app-modal-backdrop z-[100] p-4">
      <div className="w-full max-w-md rounded-2xl border border-line bg-card-dark p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">Run depreciation</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-overlay/10 hover:text-white"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <p className="mb-3 text-sm text-muted">
          Posts every scheduled depreciation period due on or before this date — one balanced
          journal entry per period (Dr Depreciation Expense / Cr 1510 Accumulated Depreciation).
          Periods already posted are skipped, so it is safe to re-run.
        </p>

        {result ? (
          <div className="flex flex-col gap-3">
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300">
              {result.postedCount === 0 ? (
                <p>
                  Nothing was due through{' '}
                  <span className="font-semibold">{formatAssetDate(result.periodDate)}</span>. No
                  entries were posted.
                </p>
              ) : (
                <p>
                  Posted{' '}
                  <span className="font-semibold">
                    {result.postedCount} {result.postedCount === 1 ? 'entry' : 'entries'}
                  </span>{' '}
                  totaling{' '}
                  <span className="font-mono font-semibold tabular-nums">
                    {formatMoney(result.totalAmount)}
                  </span>{' '}
                  through {formatAssetDate(result.periodDate)}.
                </p>
              )}
            </div>
            <div className="flex justify-end">
              <Button onClick={onClose}>Done</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <FormField
              label="Post through (period end)"
              htmlFor="run-depr-date"
              required
              hint="All periods dated on or before this date are posted."
            >
              <input
                id="run-depr-date"
                type="date"
                className={inputClass}
                value={periodDate}
                onChange={(e) => setPeriodDate(e.target.value)}
              />
            </FormField>

            {error && (
              <p
                className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-sm text-red-300"
                role="alert"
              >
                {error}
              </p>
            )}

            <div className="mt-1 flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose} disabled={run.isPending}>
                Cancel
              </Button>
              <Button icon="play_arrow" onClick={submit} disabled={run.isPending || !periodDate}>
                {run.isPending ? 'Posting…' : 'Run depreciation'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * D3 — Fixed asset register. The module's depreciation home: every capitalized asset with
 * its acquisition cost, accumulated depreciation (Σ POSTED schedule rows), net book value
 * (cost − accumulated, floored at salvage), and the still-unposted remaining plan — sourced
 * from `accounting.v_fixed_asset_register`. A header action runs depreciation for a chosen
 * period (the only money path on this surface; it posts balanced JEs via the RPC). Rows
 * drill into the per-asset detail + schedule.
 *
 * Financial output → carries the CPA/EA disclaimer (G9). The footer sums run in integer
 * cents (totalFixedAssetRegister) so cost / accumulated / NBV tie to the ledger to the penny.
 */
export default function FixedAssetsView() {
  const navigate = useNavigate();
  const { data: rows = [], isPending, isError } = useFixedAssetRegister();
  const [showRun, setShowRun] = useState(false);

  const totals = useMemo(() => totalFixedAssetRegister(rows), [rows]);

  const openAsset = (row: FixedAssetRegisterRow) => navigate(`${FIXED_ASSETS_BASE}/${row.id}`);

  return (
    <AccountingShell
      active="fixed-assets"
      title="Fixed assets"
      actions={
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" icon="play_arrow" onClick={() => setShowRun(true)}>
            Run depreciation
          </Button>
          <Button size="sm" icon="add" onClick={() => navigate(`${FIXED_ASSETS_BASE}/new`)}>
            New asset
          </Button>
        </div>
      }
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <TaxDisclaimer />

        <p className="text-sm text-muted">
          Capitalized assets and their depreciation. Net book value is acquisition cost minus
          accumulated depreciation (the sum of posted depreciation periods), floored at the
          asset&apos;s salvage value. Running depreciation posts one balanced journal entry per due
          period — Dr Depreciation Expense / Cr 1510 Accumulated Depreciation.
        </p>

        {isPending && <p className="text-muted">Loading fixed assets…</p>}
        {isError && (
          <p className="text-red-400">
            Could not load the asset register. Confirm the accounting schema is exposed and you have
            an accounting role.
          </p>
        )}

        {!isPending && !isError && rows.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-line px-6 py-16 text-center">
            <span className="material-symbols-outlined text-4xl text-subtle">
              precision_manufacturing
            </span>
            <p className="text-lg font-bold text-white">No fixed assets yet</p>
            <p className="max-w-md text-sm text-muted">
              Add a capitalized asset — its cost, salvage value, useful life and the accounts its
              depreciation touches — and a straight-line depreciation schedule is generated for it.
              Run depreciation each period to post the expense.
            </p>
            <Button size="sm" icon="add" onClick={() => navigate(`${FIXED_ASSETS_BASE}/new`)}>
              New asset
            </Button>
          </div>
        )}

        {!isPending && !isError && rows.length > 0 && (
          <>
            {/* Summary strip — NBV ties to (asset account − 1510 contra) */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <SummaryStat label="Cost" value={formatMoney(totals.cost)} hint="acquisition" />
              <SummaryStat
                label="Accumulated"
                value={formatMoney(totals.accumulatedDepreciation)}
                hint="posted to 1510"
              />
              <SummaryStat
                label="Net book value"
                value={formatMoney(totals.netBookValue)}
                hint="cost − accumulated"
                tone="accent"
              />
              <SummaryStat
                label="Remaining"
                value={formatMoney(totals.remainingPlanned)}
                hint="unposted plan"
              />
            </div>

            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line bg-overlay/5 text-muted">
                    <th className="px-3 py-2 text-left font-semibold">Asset</th>
                    <th className="px-3 py-2 text-left font-semibold">In service</th>
                    <th className="px-3 py-2 text-right font-semibold">Cost</th>
                    <th className="px-3 py-2 text-right font-semibold">Accumulated</th>
                    <th className="px-3 py-2 text-right font-semibold">Net book value</th>
                    <th className="px-3 py-2 text-right font-semibold">Remaining</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.id}
                      onClick={() => openAsset(row)}
                      className="cursor-pointer border-t border-line/60 hover:bg-overlay/5"
                    >
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="block truncate font-medium text-white">{row.name}</span>
                          <StatusBadge status={row.status} />
                        </div>
                        <span className="block text-xs text-subtle">
                          {methodLabel(row.method)} · {row.usefulLifeMonths} mo
                          {row.periodsRemaining > 0
                            ? ` · ${row.periodsRemaining} period${row.periodsRemaining === 1 ? '' : 's'} left`
                            : ' · fully scheduled'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted">{formatAssetDate(row.inServiceDate)}</td>
                      <MoneyCell amount={row.cost} />
                      <MoneyCell amount={row.accumulatedDepreciation} muted />
                      <MoneyCell amount={row.netBookValue} strong />
                      <MoneyCell amount={row.remainingPlanned} muted />
                    </tr>
                  ))}
                  {/* Grand totals */}
                  <tr className="border-t border-line bg-overlay/5">
                    <td className="px-3 py-2 font-bold text-white" colSpan={2}>
                      {totals.assetCount} {totals.assetCount === 1 ? 'asset' : 'assets'}
                    </td>
                    <MoneyCell amount={totals.cost} strong />
                    <MoneyCell amount={totals.accumulatedDepreciation} strong />
                    <MoneyCell amount={totals.netBookValue} strong />
                    <MoneyCell amount={totals.remainingPlanned} strong />
                  </tr>
                </tbody>
              </table>
            </div>

            <p className="text-xs leading-relaxed text-subtle">
              <span className="font-semibold text-muted">How these are figured:</span> Accumulated
              depreciation is the sum of an asset&apos;s POSTED schedule periods; net book value is
              cost minus that, clamped so it never drops below salvage. Remaining is the
              still-unposted plan. Tap a row to see the asset&apos;s full schedule and post
              individual periods.
            </p>
          </>
        )}
      </div>

      {showRun && <RunDepreciationModal onClose={() => setShowRun(false)} />}
    </AccountingShell>
  );
}

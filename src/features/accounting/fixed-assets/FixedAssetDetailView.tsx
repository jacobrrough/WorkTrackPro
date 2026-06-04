import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { AccountingShell } from '../components/AccountingShell';
import { TaxDisclaimer } from '../components/TaxDisclaimer';
import { useFixedAssetRegisterRow, useFixedAssetSchedule } from '../hooks/useAccountingQueries';
import { usePostDepreciationRow, useSetFixedAssetStatus } from '../hooks/useAccountingMutations';
import { ACCOUNTING_BASE, FIXED_ASSETS_BASE } from '../constants';
import {
  depreciationProgress,
  formatAssetDate,
  formatMoney,
  methodLabel,
  statusBadgeClass,
  statusLabel,
} from './fixedAssetFormat';
import {
  FIXED_ASSET_STATUS_LABELS,
  FIXED_ASSET_STATUSES,
  type DepreciationScheduleRow,
  type FixedAssetRegisterRow,
  type FixedAssetStatus,
} from '../types';

/** Today as a bare ISO `YYYY-MM-DD`, used to flag which planned periods are now due. */
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** One labeled figure. `tone` accents the net-book-value (the headline figure). */
function StatCard({
  label,
  children,
  hint,
  tone = 'default',
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  tone?: 'default' | 'accent';
}) {
  return (
    <div className="rounded-sm border border-white/10 bg-card-dark p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={`mt-1 font-mono text-lg font-bold tabular-nums ${
          tone === 'accent' ? 'text-primary' : 'text-white'
        }`}
      >
        {children}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

/** Lifecycle status switcher (active → fully_depreciated → disposed). */
function StatusSwitcher({ asset }: { asset: FixedAssetRegisterRow }) {
  const setStatus = useSetFixedAssetStatus();
  const [error, setError] = useState<string | null>(null);

  const onSet = async (status: FixedAssetStatus) => {
    setError(null);
    const res = await setStatus.mutateAsync({ id: asset.id, status });
    if (res.error) setError(res.error);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-slate-500">Status:</span>
        {FIXED_ASSET_STATUSES.map((s) => {
          const active = asset.status === s;
          return (
            <button
              key={s}
              type="button"
              disabled={setStatus.isPending || active}
              onClick={() => onSet(s)}
              aria-pressed={active}
              className={`rounded-sm px-2 py-0.5 font-semibold transition-colors disabled:cursor-default ${
                active
                  ? 'bg-primary text-white'
                  : 'bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white disabled:opacity-50'
              }`}
            >
              {FIXED_ASSET_STATUS_LABELS[s]}
            </button>
          );
        })}
      </div>
      {error && (
        <p className="text-xs text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** A single schedule period row, with a per-row "post now" for a due, unposted period. */
function ScheduleRow({
  row,
  index,
  isDue,
  onView,
}: {
  row: DepreciationScheduleRow;
  index: number;
  isDue: boolean;
  onView: (journalEntryId: string) => void;
}) {
  const postRow = usePostDepreciationRow();
  const [error, setError] = useState<string | null>(null);

  const onPost = async () => {
    setError(null);
    const res = await postRow.mutateAsync(row.id);
    if (res.error) setError(res.error);
  };

  return (
    <>
      <tr className="border-t border-white/5">
        <td className="px-3 py-2 text-slate-400">{index + 1}</td>
        <td className="px-3 py-2 text-slate-200">{formatAssetDate(row.periodDate)}</td>
        <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-200">
          {formatMoney(row.amount)}
        </td>
        <td className="px-3 py-2">
          {row.posted ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
              <span className="material-symbols-outlined text-sm">check_circle</span>
              Posted
            </span>
          ) : isDue ? (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
              Due
            </span>
          ) : (
            <span className="rounded-full bg-slate-500/15 px-2 py-0.5 text-[11px] font-semibold text-slate-400">
              Planned
            </span>
          )}
        </td>
        <td className="px-3 py-2 text-right">
          {row.posted ? (
            row.journalEntryId ? (
              <button
                type="button"
                onClick={() => onView(row.journalEntryId as string)}
                className="text-sm font-semibold text-primary hover:text-primary-hover"
              >
                View entry
              </button>
            ) : (
              <span className="text-xs text-slate-500">—</span>
            )
          ) : (
            <Button
              size="sm"
              variant="ghost"
              icon="play_arrow"
              onClick={onPost}
              disabled={postRow.isPending}
            >
              {postRow.isPending ? 'Posting…' : 'Post now'}
            </Button>
          )}
        </td>
      </tr>
      {error && (
        <tr>
          <td colSpan={5} className="px-3 pb-2">
            <p className="text-xs text-red-400" role="alert">
              {error}
            </p>
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * D3 — Fixed asset detail. The asset's headline figures (cost, salvage, accumulated
 * depreciation, net book value) come from its `accounting.v_fixed_asset_register` row; the
 * full planned/posted depreciation schedule comes from accounting.depreciation_schedule.
 * Each still-unposted period has a "Post now" that posts ONE balanced Dr depreciation-expense
 * / Cr 1510 Accumulated Depreciation entry through accounting.post_journal_entry (the
 * books-closed lock is honored by the RPC, and an already-posted period is idempotent).
 * Posted periods link to the journal entry that booked them.
 *
 * Financial output → carries the CPA/EA disclaimer (G9).
 */
export default function FixedAssetDetailView() {
  const { assetId } = useParams<{ assetId: string }>();
  const navigate = useNavigate();
  const {
    data: asset,
    isPending: assetLoading,
    isError: assetError,
  } = useFixedAssetRegisterRow(assetId);
  const {
    data: schedule = [],
    isPending: scheduleLoading,
    isError: scheduleError,
  } = useFixedAssetSchedule(assetId);

  const today = todayISO();

  // A period is "due" when it is unposted and dated on or before today (the run action
  // would post it). Purely for the row badge — the DB decides what actually posts.
  const dueCount = useMemo(
    () => schedule.filter((r) => !r.posted && r.periodDate <= today).length,
    [schedule, today]
  );

  const progress = asset
    ? depreciationProgress(asset.cost, asset.salvageValue, asset.accumulatedDepreciation)
    : 0;

  const viewEntry = (journalEntryId: string) =>
    navigate(`${ACCOUNTING_BASE}/journal/${journalEntryId}`);

  return (
    <AccountingShell
      active="fixed-assets"
      title={asset ? asset.name : 'Fixed asset'}
      actions={
        <Button
          size="sm"
          variant="ghost"
          icon="arrow_back"
          onClick={() => navigate(FIXED_ASSETS_BASE)}
        >
          Register
        </Button>
      }
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <TaxDisclaimer />

        {assetLoading && <p className="text-slate-400">Loading asset…</p>}
        {assetError && (
          <p className="text-red-400" role="alert">
            Could not load this asset. It may have been deleted, or the accounting schema is not
            exposed for your role.
          </p>
        )}

        {!assetLoading && !assetError && !asset && (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <span className="material-symbols-outlined text-4xl text-slate-500">
              precision_manufacturing
            </span>
            <p className="text-slate-400">No fixed asset found for this id.</p>
            <Button
              size="sm"
              variant="ghost"
              icon="arrow_back"
              onClick={() => navigate(FIXED_ASSETS_BASE)}
            >
              Back to register
            </Button>
          </div>
        )}

        {asset && (
          <>
            {/* Identity row */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold text-white">{asset.name}</h2>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusBadgeClass(asset.status)}`}
                  >
                    {statusLabel(asset.status)}
                  </span>
                </div>
                <p className="text-sm text-slate-400">
                  {methodLabel(asset.method)} · {asset.usefulLifeMonths} months · in service{' '}
                  {formatAssetDate(asset.inServiceDate)}
                </p>
              </div>
              <StatusSwitcher asset={asset} />
            </div>

            {/* Headline figures */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <StatCard label="Cost" hint="acquisition">
                {formatMoney(asset.cost)}
              </StatCard>
              <StatCard label="Accumulated" hint="posted to 1510">
                {formatMoney(asset.accumulatedDepreciation)}
              </StatCard>
              <StatCard label="Net book value" hint="cost − accumulated" tone="accent">
                {formatMoney(asset.netBookValue)}
              </StatCard>
              <StatCard label="Salvage" hint="NBV floor">
                {formatMoney(asset.salvageValue)}
              </StatCard>
            </div>

            {/* Progress bar — fraction of the depreciable base recognized */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>
                  {asset.periodsPosted} of {asset.periodsPosted + asset.periodsRemaining} periods
                  posted
                </span>
                <span className="font-mono tabular-nums">{Math.round(progress * 100)}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
              {asset.remainingPlanned > 0 && (
                <p className="text-xs text-slate-500">
                  {formatMoney(asset.remainingPlanned)} of depreciation remains across{' '}
                  {asset.periodsRemaining} unposted{' '}
                  {asset.periodsRemaining === 1 ? 'period' : 'periods'}
                  {dueCount > 0 ? ` (${dueCount} now due)` : ''}.
                </p>
              )}
            </div>

            {/* Depreciation schedule */}
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-bold uppercase tracking-wide text-slate-400">
                Depreciation schedule
              </h3>

              {scheduleLoading && <p className="text-slate-400">Loading schedule…</p>}
              {scheduleError && (
                <p className="text-red-400" role="alert">
                  Could not load the depreciation schedule.
                </p>
              )}

              {!scheduleLoading && !scheduleError && schedule.length === 0 && (
                <div className="rounded-sm border border-dashed border-white/15 px-4 py-8 text-center text-sm text-slate-400">
                  No schedule rows. This asset has nothing to depreciate (salvage may equal cost),
                  or the schedule has not been generated.
                </div>
              )}

              {!scheduleLoading && !scheduleError && schedule.length > 0 && (
                <div className="overflow-x-auto rounded-sm border border-white/10">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-white/10 bg-white/5 text-slate-400">
                        <th className="px-3 py-2 text-left font-semibold">#</th>
                        <th className="px-3 py-2 text-left font-semibold">Period end</th>
                        <th className="px-3 py-2 text-right font-semibold">Amount</th>
                        <th className="px-3 py-2 text-left font-semibold">Status</th>
                        <th className="px-3 py-2 text-right font-semibold">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {schedule.map((row, i) => (
                        <ScheduleRow
                          key={row.id}
                          row={row}
                          index={i}
                          isDue={!row.posted && row.periodDate <= today}
                          onView={viewEntry}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <p className="text-xs leading-relaxed text-slate-500">
                Each period posts one balanced entry — Dr Depreciation Expense / Cr 1510 Accumulated
                Depreciation — through the general ledger. Posting is idempotent and respects the
                books-closed lock; to post several due periods at once, use{' '}
                <span className="font-semibold text-slate-300">Run depreciation</span> on the
                register.
              </p>
            </section>
          </>
        )}
      </div>
    </AccountingShell>
  );
}

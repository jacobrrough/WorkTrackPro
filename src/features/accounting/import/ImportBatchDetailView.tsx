/**
 * ⚠️  HELD / UNVERIFIED — NOT FOR FILING. Import/migration is FLAG-DARK and requires CPA
 *     and/or security sign-off before it is enabled. This screen carries the UnverifiedBanner.
 *     The ONLY money path is the explicit admin "Commit" button, which calls the admin-only
 *     accounting.commit_import_batch RPC → accounting.post_journal_entry (balanced opening-
 *     balance entries; offsets 3050 Opening Balance Equity / 2050 Opening Balance Liabilities).
 *     HUMAN MUST VERIFY: account-mapping fidelity, no double-posting, and that opening balances
 *     reconcile to the source trial balance (the reconciliation panel surfaces that check).
 *
 * The per-batch wizard host:
 *   1) batch header (source / status / file meta / opening-balance "as of" date),
 *   2) chart-of-accounts mapping wizard (one row per distinct source account → a target in
 *      our chart, or create-as-new with a type),
 *   3) reconciliation panel (Σ debits/credits in cents + the equity/liability plugs, and the
 *      "source trial balance balances" check),
 *   4) staged-rows preview (verbatim raw + per-row mapped/skip state, with parse warnings),
 *   5) the admin commit flow: Mark ready → review blockers → Commit (confirm dialog).
 */
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { AccountingShell } from '../components/AccountingShell';
import { AccountPicker } from '../components/AccountPicker';
import { UnverifiedBanner } from '../components/UnverifiedBanner';
import { LedgerTable } from '../components/LedgerTable';
import {
  useImportAccountMap,
  useImportBatch,
  useImportReadyBlockers,
  useImportReconciliation,
  useImportStaging,
} from '../hooks/useAccountingQueries';
import {
  useCommitImportBatch,
  useDiscardImportBatch,
  useMarkImportReady,
  useReopenImportMapping,
  useSetImportOpeningBalanceDate,
  useSetImportStagingSkipped,
  useUpdateImportAccountMap,
} from '../hooks/useAccountingMutations';
import {
  ACCOUNT_TYPE_LABELS,
  ACCOUNT_TYPES,
  IMPORT_BATCH_STATUS_LABELS,
  type AccountType,
  type ImportAccountMap,
  type ImportBatch,
  type ImportStagingRow,
  type ImportSummary,
} from '../types';
import type { OpeningBalanceReconciliation } from '@/services/api/accounting';
import { IMPORT_BASE } from '../constants';
import {
  entityTypeLabel,
  formatCents,
  formatCentsAccounting,
  shortDateTime,
  sourceLabel,
} from './importFormat';
import { BatchStatusPill, StagingStatusPill } from './importPills';

const inputClass =
  'w-full rounded-sm border border-white/10 bg-background-dark px-2 py-1.5 text-white focus:border-primary focus:outline-none';

const MAX_PREVIEW_ROWS = 100;

// ── Batch header ─────────────────────────────────────────────────────────────────

function BatchHeader({ batch }: { batch: ImportBatch }) {
  const setDate = useSetImportOpeningBalanceDate();
  const [date, setDate2] = useState(batch.openingBalanceDate ?? '');
  const editable = batch.status !== 'committed' && batch.status !== 'discarded';

  return (
    <div className="rounded-sm border border-white/10 bg-card-dark p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="material-symbols-outlined text-primary">cloud_upload</span>
        <h2 className="font-bold text-white">{batch.fileMeta?.name ?? sourceLabel(batch.source)}</h2>
        <BatchStatusPill status={batch.status} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Field label="Source" value={sourceLabel(batch.source)} />
        <Field label="Format" value={batch.sourceDetail ?? '—'} />
        <Field
          label="Rows"
          value={typeof batch.stagingCount === 'number' ? String(batch.stagingCount) : '—'}
        />
        <Field label="Created" value={shortDateTime(batch.createdAt)} />
      </dl>

      <div className="mt-3 max-w-xs">
        <FormField
          label="Opening-balance date"
          htmlFor="ob-date"
          hint="The “as of” date posted entries carry."
        >
          <div className="flex items-center gap-2">
            <input
              id="ob-date"
              type="date"
              className={inputClass}
              value={date}
              disabled={!editable || setDate.isPending}
              onChange={(e) => setDate2(e.target.value)}
            />
            {editable && (
              <Button
                size="sm"
                variant="secondary"
                disabled={setDate.isPending || (date || null) === (batch.openingBalanceDate ?? null)}
                onClick={() => setDate.mutate({ id: batch.id, date: date || null })}
              >
                Save
              </Button>
            )}
          </div>
        </FormField>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="truncate font-semibold text-white">{value}</dd>
    </div>
  );
}

// ── Chart-of-accounts mapping wizard ─────────────────────────────────────────────

function AccountMapRow({ row, editable }: { row: ImportAccountMap; editable: boolean }) {
  const update = useUpdateImportAccountMap();
  const isCreate = row.createAsNew;

  return (
    <div className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold text-white">
          {row.sourceAccountName ?? row.sourceAccountKey}
        </div>
        <div className="truncate text-xs text-slate-500">
          <span className="font-mono">{row.sourceAccountKey}</span>
          {row.sourceAccountType ? ` · ${row.sourceAccountType}` : ''}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2">
        {isCreate ? (
          <div className="flex items-center gap-2">
            <span className="shrink-0 rounded-sm bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-sky-400">
              Create new
            </span>
            <select
              aria-label={`New account type for ${row.sourceAccountKey}`}
              className={inputClass}
              value={row.newAccountType ?? ''}
              disabled={!editable || update.isPending}
              onChange={(e) =>
                update.mutate({
                  id: row.id,
                  patch: { createAsNew: true, newAccountType: (e.target.value || null) as AccountType | null },
                })
              }
            >
              <option value="">Choose type…</option>
              {ACCOUNT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ACCOUNT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <AccountPicker
            ariaLabel={`Target account for ${row.sourceAccountKey}`}
            value={row.targetAccountId ?? ''}
            onChange={(targetAccountId) =>
              update.mutate({ id: row.id, patch: { targetAccountId: targetAccountId || null, createAsNew: false } })
            }
          />
        )}

        {editable && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <button
              type="button"
              className="font-semibold text-slate-400 hover:text-white"
              onClick={() =>
                update.mutate({
                  id: row.id,
                  patch: isCreate
                    ? { createAsNew: false }
                    : { createAsNew: true, targetAccountId: null, newAccountType: row.newAccountType ?? null },
                })
              }
            >
              {isCreate ? 'Map to existing instead' : 'Create as new account'}
            </button>
            <button
              type="button"
              className={`font-semibold ${
                row.status === 'ignored' ? 'text-amber-400' : 'text-slate-500 hover:text-white'
              }`}
              onClick={() =>
                update.mutate({
                  id: row.id,
                  patch:
                    row.status === 'ignored'
                      ? { status: 'unmapped', targetAccountId: null, createAsNew: false }
                      : { status: 'ignored' },
                })
              }
            >
              {row.status === 'ignored' ? 'Un-ignore' : 'Ignore'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function AccountMapWizard({ batchId, editable }: { batchId: string; editable: boolean }) {
  const { data: maps = [], isPending, isError } = useImportAccountMap(batchId);

  const unmapped = maps.filter(
    (m) => m.status !== 'ignored' && !m.targetAccountId && !m.createAsNew
  ).length;

  return (
    <section className="rounded-sm border border-white/10 bg-card-dark">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2.5">
        <h2 className="font-bold text-white">Map accounts</h2>
        <span className="text-xs text-slate-400">
          {maps.length} source account{maps.length === 1 ? '' : 's'}
          {unmapped > 0 ? ` · ${unmapped} unmapped` : ' · all mapped'}
        </span>
      </div>

      {isPending && <p className="px-3 py-4 text-sm text-slate-400">Loading account map…</p>}
      {isError && (
        <p className="px-3 py-4 text-sm text-red-400">Could not load the account map.</p>
      )}
      {!isPending && !isError && maps.length === 0 && (
        <p className="px-3 py-4 text-sm text-slate-400">
          No source accounts were discovered in this import.
        </p>
      )}

      <div className="divide-y divide-white/5">
        {maps.map((row) => (
          <AccountMapRow key={row.id} row={row} editable={editable} />
        ))}
      </div>

      <p className="border-t border-white/10 px-3 py-2 text-xs text-slate-500">
        HUMAN MUST VERIFY each source account maps to the correct target type and normal balance.
        Create-as-new accounts are created by the commit, classed by the type you choose.
      </p>
    </section>
  );
}

// ── Reconciliation panel ─────────────────────────────────────────────────────────

function ReconciliationPanel({ recon }: { recon: OpeningBalanceReconciliation | undefined }) {
  if (!recon) return null;
  const balanced = recon.sourceBalances;
  return (
    <section
      className={`rounded-sm border p-4 ${
        balanced ? 'border-green-500/30 bg-green-500/5' : 'border-amber-500/40 bg-amber-500/10'
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`material-symbols-outlined ${balanced ? 'text-green-400' : 'text-amber-400'}`}
        >
          {balanced ? 'check_circle' : 'error'}
        </span>
        <h2 className="font-bold text-white">Reconcile to source trial balance</h2>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Field label="Opening rows" value={String(recon.rowCount)} />
        <Field label="Σ Debits" value={formatCents(recon.totalDebitCents)} />
        <Field label="Σ Credits" value={formatCents(recon.totalCreditCents)} />
        <Field
          label="Imbalance"
          value={formatCentsAccounting(recon.sourceImbalanceCents)}
        />
      </div>

      {recon.plugs.length > 0 && (
        <div className="mt-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Offset plugs the commit will book
          </div>
          <ul className="mt-1 space-y-0.5 text-sm text-slate-300">
            {recon.plugs.map((p) => (
              <li key={p.offset} className="font-mono">
                {p.offset === 'equity' ? '3050 Opening Balance Equity' : '2050 Opening Balance Liabilities'}
                {' — '}
                {p.debitCents > 0 ? `Dr ${formatCents(p.debitCents)}` : `Cr ${formatCents(p.creditCents)}`}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className={`mt-3 text-xs ${balanced ? 'text-green-300' : 'text-amber-300'}`}>
        {balanced
          ? 'The source trial balance balances (Σ debits = Σ credits) before any offset. Verify the totals match the figures on your source report.'
          : 'The source trial balance does NOT balance on its own — the difference will be absorbed by Opening Balance Equity / Liabilities. Reconcile this against your source report before committing.'}
      </p>
    </section>
  );
}

// ── Commit flow ──────────────────────────────────────────────────────────────────

function CommitConfirmDialog({
  batch,
  recon,
  onClose,
}: {
  batch: ImportBatch;
  recon: OpeningBalanceReconciliation | undefined;
  onClose: () => void;
}) {
  const commit = useCommitImportBatch();
  const [result, setResult] = useState<{ ok: boolean; error?: string; summary?: ImportSummary } | null>(
    null
  );

  const run = async () => {
    const res = await commit.mutateAsync(batch.id);
    setResult(res);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-sm border border-white/10 bg-card-dark p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">Commit import</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-sm text-slate-400 hover:bg-white/10 hover:text-white"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <UnverifiedBanner variant="compact" className="mb-3" />

        {result ? (
          result.ok ? (
            <div className="rounded-sm border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-300">
              <p className="font-bold text-white">Import committed.</p>
              <ul className="mt-2 space-y-0.5">
                <li>Opening-balance rows: {result.summary?.openingBalanceRows ?? 0}</li>
                <li>Journal-entry rows: {result.summary?.journalEntryRows ?? 0}</li>
                <li>Accounts created: {result.summary?.accountsCreated ?? 0}</li>
                <li>Lines posted: {result.summary?.lines ?? 0}</li>
                <li>Opening-balance total: {formatCents(result.summary?.openingBalanceCents)}</li>
              </ul>
              <div className="mt-3 flex justify-end">
                <Button size="sm" onClick={onClose}>
                  Done
                </Button>
              </div>
            </div>
          ) : (
            <div className="rounded-sm border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
              <p className="font-bold text-white">Commit was rejected — nothing posted.</p>
              <p className="mt-1">{result.error}</p>
              <div className="mt-3 flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={onClose}>
                  Close
                </Button>
                <Button size="sm" onClick={() => setResult(null)}>
                  Try again
                </Button>
              </div>
            </div>
          )
        ) : (
          <>
            <p className="text-sm text-slate-300">
              This posts the staged opening balances as one balanced journal entry (offsets 3050 /
              2050) and any historical journal entries as their own balanced entries, via the
              admin-only commit RPC. Posted entries are immutable — correct only by voiding and
              reversing.
            </p>
            {recon && !recon.sourceBalances && (
              <p className="mt-2 rounded-sm border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-300">
                The source trial balance does not balance on its own; the difference of{' '}
                {formatCentsAccounting(recon.sourceImbalanceCents)} will land in Opening Balance
                Equity / Liabilities. Confirm this is intended.
              </p>
            )}
            <p className="mt-2 text-xs text-slate-500">
              Opening-balance date: {batch.openingBalanceDate ?? 'not set (defaults at the DB)'}.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose} disabled={commit.isPending}>
                Cancel
              </Button>
              <Button variant="danger" icon="gavel" onClick={run} disabled={commit.isPending}>
                {commit.isPending ? 'Posting…' : 'Commit & post'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function CommitPanel({ batch }: { batch: ImportBatch }) {
  const { data: blockersResult } = useImportReadyBlockers(batch.id);
  const { data: recon } = useImportReconciliation(batch.id);
  const markReady = useMarkImportReady();
  const reopen = useReopenImportMapping();
  const [showConfirm, setShowConfirm] = useState(false);
  const [readyMsg, setReadyMsg] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<string[] | null>(null);

  const blockerList = blockers ?? blockersResult?.blockers ?? [];
  const hasBlockers = blockerList.length > 0;

  const onMarkReady = async () => {
    setReadyMsg(null);
    setBlockers(null);
    const res = await markReady.mutateAsync(batch.id);
    if (res.ok) {
      setReadyMsg('Batch is ready to commit.');
    } else if (res.blockers && res.blockers.length > 0) {
      setBlockers(res.blockers);
    } else {
      setReadyMsg(res.error ?? 'Could not mark the batch ready.');
    }
  };

  if (batch.status === 'committed') {
    return (
      <section className="rounded-sm border border-green-500/30 bg-green-500/5 p-4">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-green-400">task_alt</span>
          <h2 className="font-bold text-white">Committed</h2>
        </div>
        <p className="mt-2 text-sm text-slate-300">
          This import posted {batch.summary?.lines ?? 0} line
          {batch.summary?.lines === 1 ? '' : 's'} ({formatCents(batch.summary?.openingBalanceCents)}{' '}
          opening balance). Committing again is a safe no-op. To undo, void the posted entries and
          post a reversing entry — imported rows are never deleted.
        </p>
      </section>
    );
  }

  if (batch.status === 'discarded') {
    return (
      <section className="rounded-sm border border-white/10 bg-card-dark p-4 text-sm text-slate-400">
        This batch was discarded. Its staged rows are kept for the audit trail.
      </section>
    );
  }

  const isReady = batch.status === 'ready';

  return (
    <section className="rounded-sm border border-white/10 bg-card-dark p-4">
      <h2 className="font-bold text-white">Commit</h2>
      <p className="mt-1 text-sm text-slate-400">
        Map every account, reconcile the opening balances, then mark the batch ready and commit. Only
        an accounting admin can commit; the commit posts balanced entries and is idempotent.
      </p>

      {hasBlockers && (
        <div className="mt-3 rounded-sm border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-300">
          <p className="font-semibold">Resolve these before committing:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
            {blockerList.slice(0, 20).map((b, i) => (
              <li key={i}>{b}</li>
            ))}
            {blockerList.length > 20 && <li>…and {blockerList.length - 20} more.</li>}
          </ul>
        </div>
      )}

      {readyMsg && !hasBlockers && (
        <p className="mt-3 text-sm text-slate-300" role="status">
          {readyMsg}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {!isReady && (
          <Button
            icon="checklist"
            variant="secondary"
            onClick={onMarkReady}
            disabled={markReady.isPending}
          >
            {markReady.isPending ? 'Checking…' : 'Mark ready'}
          </Button>
        )}
        {isReady && (
          <Button
            icon="lock_open"
            variant="ghost"
            onClick={() => reopen.mutate(batch.id)}
            disabled={reopen.isPending}
          >
            Re-open mapping
          </Button>
        )}
        <Button
          icon="gavel"
          variant="danger"
          onClick={() => setShowConfirm(true)}
          disabled={!isReady || hasBlockers}
        >
          Commit & post
        </Button>
        {!isReady && (
          <span className="text-xs text-slate-500">Commit unlocks once the batch is marked ready.</span>
        )}
      </div>

      {showConfirm && (
        <CommitConfirmDialog batch={batch} recon={recon} onClose={() => setShowConfirm(false)} />
      )}
    </section>
  );
}

// ── Staged-rows preview ──────────────────────────────────────────────────────────

function rawSummary(row: ImportStagingRow): string {
  const r = row.raw ?? {};
  // Show a couple of human-meaningful fields without assuming a fixed shape.
  const name =
    (r.name as string) ?? (r.account as string) ?? (r.Account as string) ?? (r.memo as string) ?? '';
  return typeof name === 'string' ? name : JSON.stringify(r).slice(0, 80);
}

function StagedRowAmount({ row }: { row: ImportStagingRow }) {
  const m = (row.mapped ?? {}) as Record<string, unknown>;
  const debit = Number(m.debitCents ?? m.debit_cents ?? 0);
  const credit = Number(m.creditCents ?? m.credit_cents ?? 0);
  if (!debit && !credit) return <span className="text-slate-600">—</span>;
  return (
    <span className="font-mono tabular-nums text-slate-300">
      {debit > 0 ? `Dr ${formatCents(debit)}` : `Cr ${formatCents(credit)}`}
    </span>
  );
}

function StagedRowsPreview({ batchId, editable }: { batchId: string; editable: boolean }) {
  const { data: rows = [], isPending, isError } = useImportStaging(batchId);
  const setSkipped = useSetImportStagingSkipped();
  const preview = rows.slice(0, MAX_PREVIEW_ROWS);
  const extra = rows.length - preview.length;

  return (
    <section className="rounded-sm border border-white/10 bg-card-dark">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2.5">
        <h2 className="font-bold text-white">Staged rows</h2>
        <span className="text-xs text-slate-400">{rows.length} total</span>
      </div>

      {isPending && <p className="px-3 py-4 text-sm text-slate-400">Loading staged rows…</p>}
      {isError && <p className="px-3 py-4 text-sm text-red-400">Could not load staged rows.</p>}
      {!isPending && !isError && rows.length === 0 && (
        <p className="px-3 py-4 text-sm text-slate-400">No rows staged.</p>
      )}

      {rows.length > 0 && (
        <LedgerTable
          columns={[
            { label: 'Type' },
            { label: 'Detail' },
            { label: 'Amount', align: 'right' },
            { label: 'Status', align: 'right' },
            ...(editable ? [{ label: '', align: 'right' as const }] : []),
          ]}
        >
          {preview.map((row) => {
            const postable = row.entityType === 'opening_balance' || row.entityType === 'journal_entry';
            return (
              <tr key={row.id} className="border-t border-white/5">
                <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-400">
                  {entityTypeLabel(row.entityType)}
                </td>
                <td className="px-3 py-2 text-sm text-white">
                  <span className="line-clamp-1">{rawSummary(row) || '—'}</span>
                  {row.error && <span className="block text-xs text-red-400">{row.error}</span>}
                </td>
                <td className="px-3 py-2 text-right text-sm">
                  <StagedRowAmount row={row} />
                </td>
                <td className="px-3 py-2 text-right">
                  <StagingStatusPill status={row.status} />
                </td>
                {editable && (
                  <td className="px-3 py-2 text-right">
                    {postable && (
                      <button
                        type="button"
                        className="text-xs font-semibold text-slate-400 hover:text-white"
                        disabled={setSkipped.isPending}
                        onClick={() =>
                          setSkipped.mutate({ id: row.id, skipped: row.status !== 'skipped' })
                        }
                      >
                        {row.status === 'skipped' ? 'Include' : 'Skip'}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </LedgerTable>
      )}

      {extra > 0 && (
        <p className="px-3 py-2 text-center text-xs text-slate-500">
          Showing the first {MAX_PREVIEW_ROWS} of {rows.length}.
        </p>
      )}
    </section>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────────

export default function ImportBatchDetailView() {
  const { batchId } = useParams<{ batchId: string }>();
  const navigate = useNavigate();
  const { data: batch, isPending, isError } = useImportBatch(batchId);
  const { data: recon } = useImportReconciliation(batchId);
  const discard = useDiscardImportBatch();
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const editable = useMemo(
    () => !!batch && batch.status !== 'committed' && batch.status !== 'discarded',
    [batch]
  );

  return (
    <AccountingShell active="import" title="Import / Migration">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <UnverifiedBanner detail="Imported data is staged only; nothing posts to the ledger without an explicit admin commit. Human must verify account mapping, that nothing is double-posted, and that opening balances reconcile to the source trial balance." />

        <button
          type="button"
          onClick={() => navigate(IMPORT_BASE)}
          className="flex items-center gap-1 self-start text-sm font-semibold text-slate-400 hover:text-white"
        >
          <span className="material-symbols-outlined text-lg">arrow_back</span>
          All imports
        </button>

        {isPending && <p className="text-slate-400">Loading import…</p>}
        {isError && (
          <p className="text-red-400">
            Could not load this import. Confirm you have an accounting-admin role.
          </p>
        )}
        {!isPending && !isError && !batch && (
          <p className="text-slate-400">This import batch was not found.</p>
        )}

        {batch && (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-slate-500">
                Status: {IMPORT_BATCH_STATUS_LABELS[batch.status]}
              </span>
              {editable && (
                <button
                  type="button"
                  className="text-xs font-semibold text-slate-500 hover:text-red-400"
                  onClick={() => setConfirmDiscard(true)}
                >
                  Discard batch
                </button>
              )}
            </div>

            <BatchHeader batch={batch} />
            <ReconciliationPanel recon={recon} />
            <AccountMapWizard batchId={batch.id} editable={editable} />
            <StagedRowsPreview batchId={batch.id} editable={editable} />
            <CommitPanel batch={batch} />
          </>
        )}
      </div>

      {confirmDiscard && batch && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-sm border border-white/10 bg-card-dark p-4 shadow-xl">
            <h2 className="text-lg font-bold text-white">Discard this import?</h2>
            <p className="mt-2 text-sm text-slate-400">
              The batch is marked discarded. Staged rows are kept for the audit trail; nothing is
              posted. This cannot be un-done from here.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirmDiscard(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={discard.isPending}
                onClick={async () => {
                  await discard.mutateAsync(batch.id);
                  setConfirmDiscard(false);
                  navigate(IMPORT_BASE);
                }}
              >
                {discard.isPending ? 'Discarding…' : 'Discard'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </AccountingShell>
  );
}

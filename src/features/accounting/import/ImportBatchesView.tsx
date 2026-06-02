/**
 * ⚠️  HELD / UNVERIFIED — NOT FOR FILING. Import/migration is FLAG-DARK and requires CPA
 *     and/or security sign-off before it is enabled. This screen carries the UnverifiedBanner.
 *     Uploading + parsing happens in the browser and only STAGES rows (deduped by content
 *     hash). NOTHING posts to the ledger here — posting happens only on an explicit admin
 *     commit on the batch wizard. HUMAN MUST VERIFY: account mapping, no double-posting, and
 *     that opening balances reconcile to the source trial balance.
 *
 * Import batches list + a "new import" panel: choose a QuickBooks Online (CSV/JSON),
 * QuickBooks Desktop (.IIF), or generic Excel/CSV export; it is parsed locally; on confirm
 * we create a draft batch, stage the parsed rows, seed the chart-of-accounts mapping wizard,
 * and open the batch.
 */
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { AccountingShell } from '../components/AccountingShell';
import { UnverifiedBanner } from '../components/UnverifiedBanner';
import { useImportBatches } from '../hooks/useAccountingQueries';
import { useCreateImportBatch, useStageImportParse } from '../hooks/useAccountingMutations';
import { IMPORT_SOURCE_LABELS, type ImportBatch, type ImportParseResult } from '../types';
import { importBatchPath } from '../constants';
import {
  countPostable,
  formatCents,
  readAndParseImportFile,
  shortDateTime,
  sourceLabel,
} from './importFormat';
import { BatchStatusPill } from './importPills';

/** A simple sha-free digest for file_meta (re-upload dedup hint, not security). */
async function fileSha256(file: File): Promise<string | undefined> {
  try {
    if (!('crypto' in window) || !window.crypto?.subtle) return undefined;
    const buf = await file.arrayBuffer();
    const digest = await window.crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return undefined;
  }
}

/** The upload + parse-preview + create-batch panel at the top of the list. */
function NewImportPanel() {
  const navigate = useNavigate();
  const createBatch = useCreateImportBatch();
  const stageParse = useStageImportParse();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ImportParseResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const reset = () => {
    setFile(null);
    setParsed(null);
    setParseError(null);
    setCreateError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const onFile = async (f: File) => {
    setParsed(null);
    setParseError(null);
    setCreateError(null);
    setFile(f);
    const res = await readAndParseImportFile(f);
    if (res.error) {
      setParseError(res.error);
      return;
    }
    setParsed(res.parsed);
  };

  const onCreate = async () => {
    if (!parsed || !file) return;
    setBusy(true);
    setCreateError(null);
    try {
      const sha256 = await fileSha256(file);
      const { batch, error } = await createBatch.mutateAsync({
        source: parsed.source,
        sourceDetail: parsed.sourceDetail,
        fileMeta: {
          name: file.name,
          bytes: file.size,
          rowCount: parsed.records.length,
          sha256,
          importedShapes: [parsed.sourceDetail],
        },
      });
      if (!batch) {
        setCreateError(
          error ?? 'Could not create the import batch. Check your accounting-admin role.'
        );
        return;
      }
      // Stage the parsed rows + seed the account-map wizard (deduped by content hash).
      await stageParse.mutateAsync({ batchId: batch.id, parsed });
      navigate(importBatchPath(batch.id));
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Could not stage the import.');
    } finally {
      setBusy(false);
    }
  };

  const counts = parsed ? countPostable(parsed) : null;

  return (
    <div className="rounded-sm border border-white/10 bg-card-dark p-4">
      <h2 className="mb-1 font-bold text-white">Start a new import</h2>
      <p className="mb-3 text-sm text-slate-400">
        Choose a QuickBooks Online export (CSV / JSON), a QuickBooks Desktop{' '}
        <span className="font-mono">.IIF</span>, or a generic Excel/CSV trial balance. The file is
        parsed in your browser — nothing is uploaded, and nothing posts to the ledger until you
        review the mapping and an admin commits.
      </p>

      <input
        ref={fileInputRef}
        type="file"
        accept=".iif,.csv,.json,.tsv,.txt,text/csv,application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
        }}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          icon="folder_open"
          onClick={() => fileInputRef.current?.click()}
        >
          Choose file
        </Button>
        {file && <span className="text-sm text-slate-300">{file.name}</span>}
        {(parsed || parseError) && (
          <button
            type="button"
            onClick={reset}
            className="text-sm font-semibold text-slate-400 hover:text-white"
          >
            Clear
          </button>
        )}
      </div>

      {parseError && (
        <div className="mt-3 rounded-sm border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {parseError}
        </div>
      )}

      {parsed && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Source" value={IMPORT_SOURCE_LABELS[parsed.source]} />
            <Stat label="Records" value={String(parsed.records.length)} />
            <Stat label="Opening balances" value={String(counts?.openingBalances ?? 0)} />
            <Stat label="Source accounts" value={String(parsed.sourceAccounts.length)} />
          </div>

          {(counts?.journalEntries ?? 0) > 0 && (
            <p className="text-xs text-slate-400">
              Also detected{' '}
              <span className="font-semibold text-white">{counts?.journalEntries}</span> historical
              journal entr{counts?.journalEntries === 1 ? 'y' : 'ies'} (each posts as its own
              balanced entry on commit).
            </p>
          )}

          {parsed.warnings.length > 0 && (
            <details className="rounded-sm border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">
              <summary className="cursor-pointer font-semibold">
                {parsed.warnings.length} parse warning{parsed.warnings.length === 1 ? '' : 's'}
              </summary>
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs">
                {parsed.warnings.slice(0, 25).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
                {parsed.warnings.length > 25 && <li>…and {parsed.warnings.length - 25} more.</li>}
              </ul>
            </details>
          )}

          {parsed.records.length === 0 ? (
            <p className="text-sm text-amber-400">
              No importable records were found in this file. Check that it is a supported export.
            </p>
          ) : (
            <div className="flex items-center justify-end gap-2">
              {createError && (
                <span className="mr-auto text-sm text-red-400" role="alert">
                  {createError}
                </span>
              )}
              <Button icon="upload_file" onClick={onCreate} disabled={busy}>
                {busy ? 'Staging…' : 'Create import batch'}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm bg-background-dark px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="truncate font-bold text-white">{value}</div>
    </div>
  );
}

function BatchRow({ batch, onOpen }: { batch: ImportBatch; onOpen: () => void }) {
  const ob = batch.summary?.openingBalanceCents;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-white/5"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-primary/15 text-primary">
        <span className="material-symbols-outlined text-lg">cloud_upload</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-semibold text-white">
            {batch.fileMeta?.name ?? sourceLabel(batch.source)}
          </span>
          <BatchStatusPill status={batch.status} />
        </span>
        <span className="block truncate text-xs text-slate-500">
          {sourceLabel(batch.source)}
          {typeof batch.stagingCount === 'number' ? ` · ${batch.stagingCount} rows` : ''}
          {' · created '}
          {shortDateTime(batch.createdAt)}
        </span>
      </span>
      {batch.status === 'committed' && typeof ob === 'number' && (
        <span className="hidden w-28 shrink-0 text-right font-mono text-sm tabular-nums text-slate-300 sm:block">
          {formatCents(ob)}
        </span>
      )}
      <span className="material-symbols-outlined text-slate-600">chevron_right</span>
    </button>
  );
}

export default function ImportBatchesView() {
  const navigate = useNavigate();
  const { data: batches = [], isPending, isError } = useImportBatches();

  return (
    <AccountingShell active="import" title="Import / Migration">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <UnverifiedBanner detail="Imported data is staged only; nothing posts to the ledger without an explicit admin commit. Human must verify account mapping, that nothing is double-posted, and that opening balances reconcile to the source trial balance." />

        <p className="text-sm text-slate-400">
          Bring historical data in from QuickBooks Online, QuickBooks Desktop, or a spreadsheet.
          Each import is staged and mapped to your chart of accounts; only an explicit admin commit
          posts balanced opening-balance journal entries.
        </p>

        <NewImportPanel />

        <div className="mt-2">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">
            Import batches
          </h2>

          {isPending && <p className="text-slate-400">Loading import batches…</p>}
          {isError && (
            <p className="text-red-400">
              Could not load import batches. Confirm the accounting schema is exposed and you have
              an accounting-admin role.
            </p>
          )}

          {!isPending && !isError && batches.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 rounded-sm border border-dashed border-white/15 px-6 py-12 text-center">
              <span className="material-symbols-outlined text-4xl text-slate-500">inventory_2</span>
              <p className="font-bold text-white">No imports yet</p>
              <p className="max-w-sm text-sm text-slate-400">
                Start a new import above. You can review every parsed row and map every account
                before anything is committed.
              </p>
            </div>
          )}

          {batches.length > 0 && (
            <div className="divide-y divide-white/5 overflow-hidden rounded-sm border border-white/10">
              {batches.map((batch) => (
                <BatchRow
                  key={batch.id}
                  batch={batch}
                  onOpen={() => navigate(importBatchPath(batch.id))}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </AccountingShell>
  );
}

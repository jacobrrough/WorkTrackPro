import { Fragment, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { customersService, journalService, vendorsService } from '@/services/api/accounting';
import { AccountingShell } from '../components/AccountingShell';
import { ACCOUNTING_QUERY_KEYS } from '../constants';
import { useAccounts } from '../hooks/useAccountingQueries';
import {
  Chip,
  ColumnMapper,
  ImportStepper,
  UploadDropzone,
  selectClass,
  useCsvUpload,
  type ColumnRoleDef,
} from './importKit';
import { uuidv5 } from './deterministicId';
import {
  autoDetectLedgerColumns,
  buildAccountLookup,
  buildPartyLookup,
  groupTransactions,
  normName,
  prepareLedgerEntries,
  summarizeEntries,
  toNewJournalEntryInput,
  type EntryStatus,
} from './qboLedgerImport';

const ROLES: ColumnRoleDef[] = [
  { role: 'date', label: 'Date', required: true },
  { role: 'type', label: 'Transaction type' },
  { role: 'num', label: 'Num / Ref' },
  { role: 'name', label: 'Name (customer/vendor)' },
  { role: 'account', label: 'Account', required: true },
  { role: 'debit', label: 'Debit', required: true },
  { role: 'credit', label: 'Credit', required: true },
  { role: 'memo', label: 'Memo / description' },
];

const fmt = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATUS_INFO: Record<EntryStatus, { label: string; className: string }> = {
  ready: { label: 'Balanced', className: 'bg-emerald-500/15 text-emerald-300' },
  unbalanced: { label: 'Unbalanced', className: 'bg-red-500/15 text-red-300' },
  unmapped: { label: 'Unmatched account', className: 'bg-amber-500/15 text-amber-300' },
  'too-few-lines': { label: 'Only 1 line', className: 'bg-amber-500/15 text-amber-300' },
  'bad-date': { label: 'Bad date', className: 'bg-amber-500/15 text-amber-300' },
  empty: { label: 'No lines', className: 'bg-slate-500/15 text-slate-300' },
};

interface ImportResult {
  created: number;
  skippedExisting: number;
  excluded: number;
  failed: { label: string; error: string }[];
}

const PREVIEW_LIMIT = 250;

export default function TransactionsImport() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const accountsData = useAccounts().data;
  const customersData = useQuery({
    queryKey: [...ACCOUNTING_QUERY_KEYS.customers, 'all-for-import'],
    queryFn: () => customersService.getAll(true),
  }).data;
  const vendorsData = useQuery({
    queryKey: [...ACCOUNTING_QUERY_KEYS.vendors, 'all-for-import'],
    queryFn: () => vendorsService.getAll(true),
  }).data;
  const accounts = useMemo(() => accountsData ?? [], [accountsData]);
  const customers = useMemo(() => customersData ?? [], [customersData]);
  const vendors = useMemo(() => vendorsData ?? [], [vendorsData]);

  const csv = useCsvUpload(autoDetectLedgerColumns);

  const [accountOverrides, setAccountOverrides] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<ImportResult | null>(null);

  const lookup = useMemo(() => buildAccountLookup(accounts), [accounts]);
  const customerLookup = useMemo(() => buildPartyLookup(customers), [customers]);
  const vendorLookup = useMemo(() => buildPartyLookup(vendors), [vendors]);

  const entries = useMemo(() => {
    const txns = groupTransactions(csv.rows, csv.columnMap);
    return prepareLedgerEntries(txns, lookup, { accountOverrides });
  }, [csv.rows, csv.columnMap, lookup, accountOverrides]);

  const summary = useMemo(() => summarizeEntries(entries), [entries]);
  const missingRequired =
    !csv.columnMap.date ||
    !csv.columnMap.account ||
    (!csv.columnMap.debit && !csv.columnMap.credit);

  const visible = useMemo(() => {
    const filtered = onlyIssues ? entries.filter((e) => e.status !== 'ready') : entries;
    return filtered.slice(0, PREVIEW_LIMIT);
  }, [entries, onlyIssues]);

  const setOverride = (qboName: string, accountId: string) =>
    setAccountOverrides((o) => {
      const next = { ...o };
      if (accountId) next[normName(qboName)] = accountId;
      else delete next[normName(qboName)];
      return next;
    });

  const toggle = (index: number) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  const startOver = () => {
    csv.reset();
    setAccountOverrides({});
    setExpanded(new Set());
    setResult(null);
    setOnlyIssues(false);
    setProgress({ done: 0, total: 0 });
  };

  const runImport = async () => {
    const ready = entries.filter((e) => e.status === 'ready');
    if (ready.length === 0) return;
    setImporting(true);
    setProgress({ done: 0, total: ready.length });

    // Deterministic source_id per transaction, then skip any already imported.
    const withIds = await Promise.all(
      ready.map(async (e) => ({ e, sourceId: await uuidv5(e.key) }))
    );
    let already = new Set<string>();
    try {
      already = await journalService.existingImportSourceIds(withIds.map((w) => w.sourceId));
    } catch {
      // If the lookup fails we proceed; the DB still can't create a duplicate of a
      // posted entry id, and a re-run would re-skip once the lookup works.
    }

    let created = 0;
    let skippedExisting = 0;
    const failed: ImportResult['failed'] = [];
    for (let i = 0; i < withIds.length; i++) {
      const { e, sourceId } = withIds[i];
      const label = [e.type, e.num && `#${e.num}`, e.date].filter(Boolean).join(' ');
      if (already.has(sourceId)) {
        skippedExisting += 1;
      } else {
        const input = toNewJournalEntryInput(e, {
          sourceId,
          customers: customerLookup,
          vendors: vendorLookup,
        });
        if (!input) {
          failed.push({ label, error: 'Could not build entry' });
        } else {
          const res = await journalService.createAndPost(input);
          if (res.entryId) created += 1;
          else failed.push({ label, error: res.error ?? 'Rejected by the ledger' });
        }
      }
      setProgress({ done: i + 1, total: withIds.length });
    }

    await queryClient.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.journal });
    await queryClient.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.reports });
    setResult({ created, skippedExisting, excluded: entries.length - ready.length, failed });
    setImporting(false);
    csv.setStep('done');
  };

  return (
    <AccountingShell active="import" title="Import · Transaction history">
      <div className="mx-auto max-w-6xl space-y-4">
        <ImportStepper steps={['Upload', 'Review & balance', 'Done']} current={csv.step} />

        {csv.error && (
          <div className="rounded-sm border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {csv.error}
          </div>
        )}

        {csv.step === 'upload' && (
          <>
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
              <strong>Import your Chart of Accounts first</strong> (and ideally customers &amp;
              vendors). Every transaction line maps onto an account by name — accounts that
              aren&apos;t found are flagged here so you can map them before anything is posted.
            </div>
            <UploadDropzone
              dragging={csv.dragging}
              fileInputRef={csv.fileInputRef}
              onPick={csv.openPicker}
              onFileInput={csv.onFileInput}
              dragHandlers={csv.dragHandlers}
              title="Drop your QuickBooks Journal CSV or Excel file here"
              subtitle="Reports → Journal → All Dates → export to Excel or CSV"
              instructions={
                <>
                  <h3 className="mb-2 flex items-center gap-2 font-semibold text-white">
                    <span className="material-symbols-outlined text-lg text-amber-400">help</span>
                    Export your full history
                  </h3>
                  <ol className="list-decimal space-y-1.5 pl-4">
                    <li>
                      In QuickBooks Online open <strong>Reports</strong> and run the{' '}
                      <strong>Journal</strong> report.
                    </li>
                    <li>
                      Set the date range to <strong>All Dates</strong>.
                    </li>
                    <li>
                      Use the <strong>export</strong> icon → <strong>Export to Excel</strong>.
                    </li>
                    <li>Upload that Excel file here — or save it as CSV first. Either works.</li>
                  </ol>
                  <p className="mt-3 text-xs text-slate-400">
                    Each transaction posts as one balanced journal entry. Re-running is safe —
                    entries already imported are skipped.
                  </p>
                </>
              }
            />
          </>
        )}

        {csv.step === 'review' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm text-slate-300">
                <span className="material-symbols-outlined text-lg text-slate-400">
                  description
                </span>
                <span className="font-semibold text-white">{csv.fileName}</span>
                <span className="text-slate-500">· {entries.length} transactions</span>
              </p>
              <Button variant="ghost" size="sm" icon="restart_alt" onClick={startOver}>
                Start over
              </Button>
            </div>

            <ColumnMapper
              roles={ROLES}
              headers={csv.headers}
              value={csv.columnMap}
              onChange={csv.setColumn}
              note={
                missingRequired
                  ? 'Choose the Date, Account, and Debit/Credit columns to continue.'
                  : undefined
              }
            />

            <div className="flex flex-wrap gap-2">
              <Chip className="bg-emerald-500/15 text-emerald-300">
                {summary.ready} balanced &amp; ready
              </Chip>
              {summary.unmapped > 0 && (
                <Chip className="bg-amber-500/15 text-amber-300">
                  {summary.unmapped} unmatched account
                </Chip>
              )}
              {summary.unbalanced > 0 && (
                <Chip className="bg-red-500/15 text-red-300">{summary.unbalanced} unbalanced</Chip>
              )}
              {summary.tooFewLines > 0 && (
                <Chip className="bg-amber-500/15 text-amber-300">
                  {summary.tooFewLines} single-line
                </Chip>
              )}
              {summary.badDate > 0 && (
                <Chip className="bg-amber-500/15 text-amber-300">{summary.badDate} bad date</Chip>
              )}
            </div>

            {summary.unmappedAccountNames.length > 0 && (
              <div className="rounded-md border border-amber-500/30 bg-card-dark p-4">
                <h3 className="mb-1 text-sm font-semibold text-amber-300">
                  Unmatched accounts ({summary.unmappedAccountNames.length})
                </h3>
                <p className="mb-3 text-xs text-slate-400">
                  These names don&apos;t match your Chart of Accounts. Map each to an account, or
                  import your Chart of Accounts first and come back. Transactions touching an
                  unmatched account can&apos;t be imported until every line maps.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {summary.unmappedAccountNames.map((name) => (
                    <div key={name} className="flex items-center gap-2 text-sm">
                      <span className="flex-1 truncate text-slate-300" title={name}>
                        {name}
                      </span>
                      <span className="text-slate-600">→</span>
                      <select
                        value={accountOverrides[normName(name)] ?? ''}
                        onChange={(e) => setOverride(name, e.target.value)}
                        className={`${selectClass} max-w-[200px]`}
                      >
                        <option value="">Leave unmatched</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.accountNumber ? `${a.accountNumber} ` : ''}
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={onlyIssues}
                  onChange={(e) => setOnlyIssues(e.target.checked)}
                  className="size-4 accent-primary"
                />
                Show only transactions that need attention
              </label>
              {entries.length > PREVIEW_LIMIT && (
                <span className="text-xs text-slate-500">
                  Showing {visible.length} of{' '}
                  {onlyIssues ? entries.filter((e) => e.status !== 'ready').length : entries.length}
                </span>
              )}
            </div>

            <div className="max-h-[50vh] overflow-auto rounded-md border border-white/10">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 bg-background-dark text-left text-xs uppercase text-slate-400">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Date</th>
                    <th className="px-3 py-2 font-semibold">Type</th>
                    <th className="px-3 py-2 font-semibold">Num</th>
                    <th className="px-3 py-2 font-semibold">Name</th>
                    <th className="px-3 py-2 text-right font-semibold">Amount</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((e) => (
                    <Fragment key={e.index}>
                      <tr
                        onClick={() => toggle(e.index)}
                        className="cursor-pointer border-t border-white/5 hover:bg-white/5"
                      >
                        <td className="px-3 py-1.5 text-slate-300">{e.date || '—'}</td>
                        <td className="px-3 py-1.5 text-slate-400">{e.type || '—'}</td>
                        <td className="px-3 py-1.5 text-slate-500">{e.num || '—'}</td>
                        <td className="px-3 py-1.5 text-slate-300">{e.name || '—'}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-slate-300">
                          {fmt(e.totalDebit)}
                        </td>
                        <td className="px-3 py-1.5">
                          <span
                            className={`rounded-sm px-1.5 py-0.5 text-xs font-semibold ${STATUS_INFO[e.status].className}`}
                            title={
                              e.status === 'unbalanced'
                                ? `Off by ${fmt(Math.abs(e.difference))}`
                                : undefined
                            }
                          >
                            {STATUS_INFO[e.status].label}
                            {e.status === 'unbalanced' && ` (${fmt(Math.abs(e.difference))})`}
                          </span>
                        </td>
                      </tr>
                      {expanded.has(e.index) &&
                        e.lines.map((l, li) => (
                          <tr key={li} className="bg-black/20 text-xs">
                            <td className="px-3 py-1" colSpan={3} />
                            <td className="px-3 py-1 text-slate-300">
                              {l.account}
                              {!l.accountId && <span className="text-amber-300"> · unmatched</span>}
                            </td>
                            <td className="px-3 py-1 text-right tabular-nums text-slate-400">
                              {l.debit ? fmt(l.debit) : `(${fmt(l.credit)})`}
                            </td>
                            <td className="px-3 py-1" />
                          </tr>
                        ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={runImport}
                disabled={importing || missingRequired || summary.ready === 0}
                icon="cloud_upload"
              >
                {importing
                  ? `Importing ${progress.done}/${progress.total}…`
                  : `Import ${summary.ready} balanced ${summary.ready === 1 ? 'entry' : 'entries'}`}
              </Button>
              {importing && (
                <div className="h-2 w-48 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{
                      width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
                    }}
                  />
                </div>
              )}
              <p className="text-xs text-slate-500">
                Only balanced, fully-mapped transactions post. The ledger rejects anything
                unbalanced; re-running skips what&apos;s already imported.
              </p>
            </div>
          </div>
        )}

        {csv.step === 'done' && result && (
          <div className="space-y-4">
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-5 text-center">
              <span className="material-symbols-outlined text-5xl text-emerald-400">task_alt</span>
              <h2 className="mt-2 text-xl font-bold text-white">History imported</h2>
              <p className="mt-1 text-sm text-slate-300">
                <strong className="text-emerald-300">{result.created}</strong> posted ·{' '}
                <strong>{result.skippedExisting}</strong> already imported ·{' '}
                <strong>{result.excluded}</strong> excluded (needs attention) ·{' '}
                <strong className={result.failed.length ? 'text-red-300' : ''}>
                  {result.failed.length}
                </strong>{' '}
                failed
              </p>
            </div>
            {result.failed.length > 0 && (
              <div className="rounded-md border border-red-500/20 bg-card-dark p-4 text-sm">
                <h3 className="mb-2 font-semibold text-red-300">Transactions that failed</h3>
                <ul className="max-h-60 space-y-1 overflow-auto text-slate-300">
                  {result.failed.map((f, i) => (
                    <li key={i}>
                      {f.label} — <span className="text-red-300">{f.error}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => navigate('/app/accounting/journal')} icon="menu_book">
                View Journal
              </Button>
              <Button
                variant="secondary"
                onClick={() => navigate('/app/accounting/reports/trial-balance')}
                icon="balance"
              >
                Check Trial Balance
              </Button>
              <Button variant="ghost" onClick={startOver} icon="upload_file">
                Import another file
              </Button>
            </div>
          </div>
        )}
      </div>
    </AccountingShell>
  );
}

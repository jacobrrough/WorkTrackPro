import { useCallback, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { accountsService } from '@/services/api/accounting';
import { AccountingShell } from '../components/AccountingShell';
import { ACCOUNTING_QUERY_KEYS } from '../constants';
import { useAccounts } from '../hooks/useAccountingQueries';
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABELS, type AccountType } from '../types';
import { parseCsv } from './csvImport';
import {
  autoDetectColumns,
  buildAccountRows,
  defaultClassification,
  findDuplicate,
  toNewAccountInput,
  type AccountClassification,
  type AccountImportRow,
  type ColumnMap,
  type ColumnRole,
} from './qboAccountMapping';

type Step = 'upload' | 'review' | 'done';
type RowStatus = 'ready' | 'duplicate' | 'needs-type' | 'error';

interface AnnotatedRow extends AccountImportRow {
  effectiveClassification: AccountClassification | null;
  duplicateName: string | null;
  status: RowStatus;
}

interface ImportResult {
  created: number;
  skipped: number;
  failed: { rowNumber: number; name: string; error: string }[];
}

const selectClass =
  'w-full rounded-sm border border-white/10 bg-background-dark px-2 py-1.5 text-sm text-white focus:border-primary focus:outline-none';

const COLUMN_ROLES: { role: ColumnRole; label: string; required?: boolean }[] = [
  { role: 'name', label: 'Account name', required: true },
  { role: 'type', label: 'Type', required: true },
  { role: 'detailType', label: 'Detail type' },
  { role: 'number', label: 'Account #' },
  { role: 'description', label: 'Description' },
];

const STATUS_BADGE: Record<RowStatus, { label: string; className: string }> = {
  ready: { label: 'Ready', className: 'bg-emerald-500/15 text-emerald-300' },
  duplicate: { label: 'Already exists', className: 'bg-slate-500/15 text-slate-300' },
  'needs-type': { label: 'Pick a type', className: 'bg-amber-500/15 text-amber-300' },
  error: { label: 'Skip', className: 'bg-red-500/15 text-red-300' },
};

export default function QuickBooksImportView() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const accountsQuery = useAccounts();
  const existing = useMemo(() => accountsQuery.data ?? [], [accountsQuery.data]);

  const [step, setStep] = useState<Step>('upload');
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [parsedRows, setParsedRows] = useState<Record<string, string>[]>([]);
  const [columnMap, setColumnMap] = useState<ColumnMap>({});
  const [overrides, setOverrides] = useState<Record<number, AccountType>>({});
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    try {
      const text = await file.text();
      const parsed = parseCsv(text);
      if (parsed.headers.length === 0 || parsed.rows.length === 0) {
        setError(
          'That file has no data rows. Export the Chart of Accounts from QuickBooks Online and try again.'
        );
        return;
      }
      setFileName(file.name);
      setHeaders(parsed.headers);
      setParsedRows(parsed.rows);
      setColumnMap(autoDetectColumns(parsed.headers));
      setOverrides({});
      setResult(null);
      setStep('review');
    } catch {
      setError('Could not read that file. Make sure it is a .csv exported from QuickBooks Online.');
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) void handleFile(file);
    },
    [handleFile]
  );

  // Re-derive previewable rows whenever the file, column map, or overrides change.
  const annotatedRows: AnnotatedRow[] = useMemo(() => {
    const base = buildAccountRows(parsedRows, columnMap);
    return base.map((row) => {
      const override = overrides[row.rowNumber];
      const effectiveClassification =
        row.classification ?? (override ? defaultClassification(override) : null);
      const duplicate = findDuplicate(row, existing);
      let status: RowStatus;
      if (!row.name) status = 'error';
      else if (duplicate) status = 'duplicate';
      else if (!effectiveClassification) status = 'needs-type';
      else status = 'ready';
      return {
        ...row,
        effectiveClassification,
        duplicateName: duplicate?.name ?? null,
        status,
      };
    });
  }, [parsedRows, columnMap, overrides, existing]);

  const counts = useMemo(() => {
    const c = { ready: 0, duplicate: 0, 'needs-type': 0, error: 0 } as Record<RowStatus, number>;
    annotatedRows.forEach((r) => (c[r.status] += 1));
    return c;
  }, [annotatedRows]);

  const setColumn = (role: ColumnRole, header: string) =>
    setColumnMap((m) => ({ ...m, [role]: header || undefined }));

  const setOverride = (rowNumber: number, type: AccountType | '') =>
    setOverrides((o) => {
      const next = { ...o };
      if (type) next[rowNumber] = type;
      else delete next[rowNumber];
      return next;
    });

  const resetAll = () => {
    setStep('upload');
    setFileName('');
    setHeaders([]);
    setParsedRows([]);
    setColumnMap({});
    setOverrides({});
    setResult(null);
    setError(null);
    setProgress({ done: 0, total: 0 });
  };

  const runImport = async () => {
    const ready = annotatedRows.filter((r) => r.status === 'ready');
    if (ready.length === 0) return;
    setImporting(true);
    setError(null);
    setProgress({ done: 0, total: ready.length });

    let created = 0;
    const failed: ImportResult['failed'] = [];
    for (let i = 0; i < ready.length; i++) {
      const r = ready[i];
      const input = toNewAccountInput(r, r.effectiveClassification);
      if (!input) {
        failed.push({ rowNumber: r.rowNumber, name: r.name, error: 'Could not build account' });
      } else {
        try {
          const acc = await accountsService.create(input);
          if (acc) created += 1;
          else
            failed.push({
              rowNumber: r.rowNumber,
              name: r.name,
              error: 'Rejected — account number may already exist',
            });
        } catch (e) {
          failed.push({
            rowNumber: r.rowNumber,
            name: r.name,
            error: e instanceof Error ? e.message : 'Failed to create',
          });
        }
      }
      setProgress({ done: i + 1, total: ready.length });
    }

    await queryClient.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.accounts });
    setResult({ created, skipped: counts.duplicate, failed });
    setImporting(false);
    setStep('done');
  };

  return (
    <AccountingShell active="import" title="Import from QuickBooks">
      <div className="mx-auto max-w-5xl space-y-4">
        <Stepper step={step} />

        {error && (
          <div className="rounded-sm border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        {step === 'upload' && (
          <UploadStep
            dragging={dragging}
            fileInputRef={fileInputRef}
            onPick={() => fileInputRef.current?.click()}
            onFileInput={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = '';
            }}
            onDrop={onDrop}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
          />
        )}

        {step === 'review' && (
          <ReviewStep
            fileName={fileName}
            headers={headers}
            columnMap={columnMap}
            setColumn={setColumn}
            rows={annotatedRows}
            counts={counts}
            setOverride={setOverride}
            importing={importing}
            progress={progress}
            onImport={runImport}
            onReset={resetAll}
          />
        )}

        {step === 'done' && result && (
          <DoneStep
            result={result}
            onImportAnother={resetAll}
            onViewAccounts={() => navigate('/app/accounting/accounts')}
          />
        )}
      </div>
    </AccountingShell>
  );
}

// ── Steps ────────────────────────────────────────────────────────────────────

function Stepper({ step }: { step: Step }) {
  const items: { key: Step; label: string }[] = [
    { key: 'upload', label: '1. Upload' },
    { key: 'review', label: '2. Review & map' },
    { key: 'done', label: '3. Done' },
  ];
  const order: Step[] = ['upload', 'review', 'done'];
  const current = order.indexOf(step);
  return (
    <div className="flex items-center gap-2 text-sm">
      {items.map((it, i) => (
        <div key={it.key} className="flex items-center gap-2">
          <span
            className={`rounded-sm px-2 py-1 font-semibold ${
              i <= current ? 'bg-primary/20 text-primary' : 'bg-white/5 text-slate-500'
            }`}
          >
            {it.label}
          </span>
          {i < items.length - 1 && <span className="text-slate-600">›</span>}
        </div>
      ))}
    </div>
  );
}

function UploadStep({
  dragging,
  fileInputRef,
  onPick,
  onFileInput,
  onDrop,
  onDragOver,
  onDragLeave,
}: {
  dragging: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onPick: () => void;
  onFileInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-[1fr_320px]">
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={`flex flex-col items-center justify-center gap-3 rounded-md border-2 border-dashed p-10 text-center transition-colors ${
          dragging ? 'border-primary bg-primary/5' : 'border-white/15 bg-card-dark'
        }`}
      >
        <span className="material-symbols-outlined text-5xl text-primary">upload_file</span>
        <div>
          <p className="font-semibold text-white">Drop your Chart of Accounts CSV here</p>
          <p className="text-sm text-slate-400">or choose a file to upload</p>
        </div>
        <Button onClick={onPick} icon="folder_open">
          Choose CSV file
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv,text/plain"
          className="hidden"
          onChange={onFileInput}
        />
      </div>

      <aside className="rounded-md border border-white/10 bg-card-dark p-4 text-sm text-slate-300">
        <h3 className="mb-2 flex items-center gap-2 font-semibold text-white">
          <span className="material-symbols-outlined text-lg text-amber-400">help</span>
          Export from QuickBooks Online
        </h3>
        <ol className="list-decimal space-y-1.5 pl-4">
          <li>
            Open <strong>Settings</strong> (gear icon) → <strong>Chart of accounts</strong>.
          </li>
          <li>
            Above the table, click the small <strong>export / printer</strong> icon and choose{' '}
            <strong>Export to Excel</strong>.
          </li>
          <li>
            Open the file and <strong>Save As / Download as CSV</strong> (.csv).
          </li>
          <li>Upload that .csv here.</li>
        </ol>
        <p className="mt-3 text-xs text-slate-400">
          This first step imports your <strong>accounts</strong>. Customers, vendors, and your full
          transaction history come next, and they map onto these accounts — so start here.
        </p>
      </aside>
    </div>
  );
}

function ReviewStep({
  fileName,
  headers,
  columnMap,
  setColumn,
  rows,
  counts,
  setOverride,
  importing,
  progress,
  onImport,
  onReset,
}: {
  fileName: string;
  headers: string[];
  columnMap: ColumnMap;
  setColumn: (role: ColumnRole, header: string) => void;
  rows: AnnotatedRow[];
  counts: Record<RowStatus, number>;
  setOverride: (rowNumber: number, type: AccountType | '') => void;
  importing: boolean;
  progress: { done: number; total: number };
  onImport: () => void;
  onReset: () => void;
}) {
  const missingRequired = !columnMap.name || !columnMap.type;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm text-slate-300">
          <span className="material-symbols-outlined text-lg text-slate-400">description</span>
          <span className="font-semibold text-white">{fileName}</span>
          <span className="text-slate-500">· {rows.length} rows</span>
        </p>
        <Button variant="ghost" size="sm" icon="restart_alt" onClick={onReset}>
          Start over
        </Button>
      </div>

      {/* Column mapping */}
      <div className="rounded-md border border-white/10 bg-card-dark p-4">
        <h3 className="mb-3 text-sm font-semibold text-white">Match your columns</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {COLUMN_ROLES.map(({ role, label, required }) => (
            <label key={role} className="block text-sm">
              <span className="mb-1 block text-slate-400">
                {label}
                {required && <span className="text-red-400"> *</span>}
              </span>
              <select
                value={columnMap[role] ?? ''}
                onChange={(e) => setColumn(role, e.target.value)}
                className={selectClass}
              >
                <option value="">— Not in file —</option>
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        {missingRequired && (
          <p className="mt-2 text-xs text-amber-300">
            Choose which columns hold the account name and type to continue.
          </p>
        )}
      </div>

      {/* Summary chips */}
      <div className="flex flex-wrap gap-2 text-sm">
        <Chip className="bg-emerald-500/15 text-emerald-300">{counts.ready} ready to import</Chip>
        {counts['needs-type'] > 0 && (
          <Chip className="bg-amber-500/15 text-amber-300">{counts['needs-type']} need a type</Chip>
        )}
        {counts.duplicate > 0 && (
          <Chip className="bg-slate-500/15 text-slate-300">
            {counts.duplicate} already exist (skipped)
          </Chip>
        )}
        {counts.error > 0 && (
          <Chip className="bg-red-500/15 text-red-300">{counts.error} skipped</Chip>
        )}
      </div>

      {/* Preview table */}
      <div className="max-h-[48vh] overflow-auto rounded-md border border-white/10">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-background-dark text-left text-xs uppercase text-slate-400">
            <tr>
              <th className="px-3 py-2 font-semibold">#</th>
              <th className="px-3 py-2 font-semibold">Name</th>
              <th className="px-3 py-2 font-semibold">QuickBooks type</th>
              <th className="px-3 py-2 font-semibold">Imports as</th>
              <th className="px-3 py-2 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.rowNumber} className="border-t border-white/5">
                <td className="px-3 py-1.5 text-slate-500">{r.accountNumber ?? r.rowNumber}</td>
                <td className="px-3 py-1.5 text-white">
                  {r.name || <em className="text-slate-500">—</em>}
                </td>
                <td className="px-3 py-1.5 text-slate-400">{r.qboType || '—'}</td>
                <td className="px-3 py-1.5">
                  {r.effectiveClassification ? (
                    <span className="text-slate-300">
                      {ACCOUNT_TYPE_LABELS[r.effectiveClassification.accountType]}
                      <span className="text-slate-500">
                        {' '}
                        · {r.effectiveClassification.accountSubtype.replace(/_/g, ' ')}
                      </span>
                    </span>
                  ) : r.name ? (
                    <select
                      value={''}
                      onChange={(e) => setOverride(r.rowNumber, e.target.value as AccountType | '')}
                      className={`${selectClass} max-w-[160px]`}
                    >
                      <option value="">Choose type…</option>
                      {ACCOUNT_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {ACCOUNT_TYPE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </td>
                <td className="px-3 py-1.5">
                  <span
                    className={`rounded-sm px-1.5 py-0.5 text-xs font-semibold ${STATUS_BADGE[r.status].className}`}
                    title={
                      r.status === 'duplicate' && r.duplicateName
                        ? `Matches "${r.duplicateName}"`
                        : undefined
                    }
                  >
                    {STATUS_BADGE[r.status].label}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Import action */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={onImport}
          disabled={importing || missingRequired || counts.ready === 0}
          icon="cloud_upload"
        >
          {importing
            ? `Importing ${progress.done}/${progress.total}…`
            : `Import ${counts.ready} account${counts.ready === 1 ? '' : 's'}`}
        </Button>
        {importing && (
          <div className="h-2 w-48 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
            />
          </div>
        )}
        <p className="text-xs text-slate-500">
          Accounts that already exist (matched by number or name) are skipped — safe to re-run.
        </p>
      </div>
    </div>
  );
}

function DoneStep({
  result,
  onImportAnother,
  onViewAccounts,
}: {
  result: ImportResult;
  onImportAnother: () => void;
  onViewAccounts: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-5 text-center">
        <span className="material-symbols-outlined text-5xl text-emerald-400">task_alt</span>
        <h2 className="mt-2 text-xl font-bold text-white">Import complete</h2>
        <p className="mt-1 text-sm text-slate-300">
          <strong className="text-emerald-300">{result.created}</strong> created ·{' '}
          <strong>{result.skipped}</strong> already existed ·{' '}
          <strong className={result.failed.length ? 'text-red-300' : ''}>
            {result.failed.length}
          </strong>{' '}
          failed
        </p>
      </div>

      {result.failed.length > 0 && (
        <div className="rounded-md border border-red-500/20 bg-card-dark p-4">
          <h3 className="mb-2 text-sm font-semibold text-red-300">Rows that failed</h3>
          <ul className="space-y-1 text-sm text-slate-300">
            {result.failed.map((f) => (
              <li key={f.rowNumber}>
                <span className="text-slate-500">Row {f.rowNumber}:</span> {f.name} —{' '}
                <span className="text-red-300">{f.error}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <Button onClick={onViewAccounts} icon="account_tree">
          View Chart of Accounts
        </Button>
        <Button variant="secondary" onClick={onImportAnother} icon="upload_file">
          Import another file
        </Button>
      </div>
    </div>
  );
}

function Chip({ children, className }: { children: React.ReactNode; className: string }) {
  return <span className={`rounded-sm px-2 py-1 font-semibold ${className}`}>{children}</span>;
}

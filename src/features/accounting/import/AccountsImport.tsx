import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { accountsService } from '@/services/api/accounting';
import { AccountingShell } from '../components/AccountingShell';
import { ACCOUNTING_QUERY_KEYS } from '../constants';
import { useAccounts } from '../hooks/useAccountingQueries';
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABELS, type AccountType } from '../types';
import {
  Chip,
  ColumnMapper,
  ImportStepper,
  UploadDropzone,
  selectClass,
  useCsvUpload,
  type ColumnRoleDef,
} from './importKit';
import {
  autoDetectColumns,
  buildAccountRows,
  defaultClassification,
  findDuplicate,
  toNewAccountInput,
  type AccountClassification,
} from './qboAccountMapping';

type RowStatus = 'ready' | 'duplicate' | 'needs-type' | 'error';

interface ImportResult {
  created: number;
  skipped: number;
  failed: { rowNumber: number; name: string; error: string }[];
}

const ROLES: ColumnRoleDef[] = [
  { role: 'name', label: 'Account name', required: true },
  { role: 'type', label: 'Type', required: true },
  { role: 'detailType', label: 'Detail type' },
  { role: 'number', label: 'Account #' },
  { role: 'description', label: 'Description' },
];

const STATUS_BADGE: Record<RowStatus, { label: string; className: string }> = {
  ready: { label: 'Ready', className: 'bg-emerald-500/15 text-emerald-300' },
  duplicate: { label: 'Already exists', className: 'bg-slate-500/15 text-muted' },
  'needs-type': { label: 'Pick a type', className: 'bg-amber-500/15 text-amber-300' },
  error: { label: 'Skip', className: 'bg-red-500/15 text-red-300' },
};

export default function AccountsImport() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const accountsData = useAccounts().data;
  const existing = useMemo(() => accountsData ?? [], [accountsData]);
  const csv = useCsvUpload(autoDetectColumns);

  const [overrides, setOverrides] = useState<Record<number, AccountType>>({});
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<ImportResult | null>(null);

  const rows = useMemo(() => {
    const base = buildAccountRows(csv.rows, csv.columnMap);
    return base.map((row) => {
      const override = overrides[row.rowNumber];
      const classification: AccountClassification | null =
        row.classification ?? (override ? defaultClassification(override) : null);
      const duplicate = findDuplicate(row, existing);
      let status: RowStatus;
      if (!row.name) status = 'error';
      else if (duplicate) status = 'duplicate';
      else if (!classification) status = 'needs-type';
      else status = 'ready';
      return { ...row, classification, duplicateName: duplicate?.name ?? null, status };
    });
  }, [csv.rows, csv.columnMap, overrides, existing]);

  const counts = useMemo(() => {
    const c: Record<RowStatus, number> = { ready: 0, duplicate: 0, 'needs-type': 0, error: 0 };
    rows.forEach((r) => (c[r.status] += 1));
    return c;
  }, [rows]);

  const missingRequired = !csv.columnMap.name || !csv.columnMap.type;

  const setOverride = (rowNumber: number, type: AccountType | '') =>
    setOverrides((o) => {
      const next = { ...o };
      if (type) next[rowNumber] = type;
      else delete next[rowNumber];
      return next;
    });

  const startOver = () => {
    csv.reset();
    setOverrides({});
    setResult(null);
    setProgress({ done: 0, total: 0 });
  };

  const runImport = async () => {
    const ready = rows.filter((r) => r.status === 'ready');
    if (ready.length === 0) return;
    setImporting(true);
    setProgress({ done: 0, total: ready.length });
    let created = 0;
    const failed: ImportResult['failed'] = [];
    for (let i = 0; i < ready.length; i++) {
      const r = ready[i];
      const input = toNewAccountInput(r, r.classification);
      if (!input)
        failed.push({ rowNumber: r.rowNumber, name: r.name, error: 'Could not build account' });
      else {
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
    csv.setStep('done');
  };

  return (
    <AccountingShell active="import" title="Import · Chart of Accounts">
      <div className="mx-auto max-w-5xl space-y-4">
        <ImportStepper steps={['Upload', 'Review & map', 'Done']} current={csv.step} />

        {csv.error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {csv.error}
          </div>
        )}

        {csv.step === 'upload' && (
          <UploadDropzone
            dragging={csv.dragging}
            fileInputRef={csv.fileInputRef}
            onPick={csv.openPicker}
            onFileInput={csv.onFileInput}
            dragHandlers={csv.dragHandlers}
            title="Drop your Chart of Accounts CSV or Excel file here"
            subtitle="or choose a file to upload"
            instructions={
              <>
                <h3 className="mb-2 flex items-center gap-2 font-semibold text-white">
                  <span className="material-symbols-outlined text-lg text-amber-400">help</span>
                  Export from QuickBooks Online
                </h3>
                <ol className="list-decimal space-y-1.5 pl-4">
                  <li>
                    Open <strong>Settings</strong> (gear) → <strong>Chart of accounts</strong>.
                  </li>
                  <li>
                    Click the small <strong>export</strong> icon above the table →{' '}
                    <strong>Export to Excel</strong>.
                  </li>
                  <li>Upload that Excel file here — or save it as CSV first. Either works.</li>
                </ol>
              </>
            }
          />
        )}

        {csv.step === 'review' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm text-muted">
                <span className="material-symbols-outlined text-lg text-muted">description</span>
                <span className="font-semibold text-white">{csv.fileName}</span>
                <span className="text-subtle">· {rows.length} rows</span>
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
                  ? 'Choose which columns hold the account name and type to continue.'
                  : undefined
              }
            />

            <div className="flex flex-wrap gap-2">
              <Chip className="bg-emerald-500/15 text-emerald-300">{counts.ready} ready</Chip>
              {counts['needs-type'] > 0 && (
                <Chip className="bg-amber-500/15 text-amber-300">
                  {counts['needs-type']} need a type
                </Chip>
              )}
              {counts.duplicate > 0 && (
                <Chip className="bg-slate-500/15 text-muted">{counts.duplicate} already exist</Chip>
              )}
              {counts.error > 0 && (
                <Chip className="bg-red-500/15 text-red-300">{counts.error} skipped</Chip>
              )}
            </div>

            <div className="max-h-[48vh] overflow-auto rounded-lg border border-line">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 bg-background-dark text-left text-xs uppercase text-muted">
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
                    <tr key={r.rowNumber} className="border-t border-line/60">
                      <td className="px-3 py-1.5 text-subtle">{r.accountNumber ?? r.rowNumber}</td>
                      <td className="px-3 py-1.5 text-white">
                        {r.name || <em className="text-subtle">—</em>}
                      </td>
                      <td className="px-3 py-1.5 text-muted">{r.qboType || '—'}</td>
                      <td className="px-3 py-1.5">
                        {r.classification ? (
                          <span className="text-muted">
                            {ACCOUNT_TYPE_LABELS[r.classification.accountType]}
                            <span className="text-subtle">
                              {' '}
                              · {r.classification.accountSubtype.replace(/_/g, ' ')}
                            </span>
                          </span>
                        ) : r.name ? (
                          <select
                            value=""
                            onChange={(e) =>
                              setOverride(r.rowNumber, e.target.value as AccountType | '')
                            }
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
                          <span className="text-subtle">—</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-xs font-semibold ${STATUS_BADGE[r.status].className}`}
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

            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={runImport}
                disabled={importing || missingRequired || counts.ready === 0}
                icon="cloud_upload"
              >
                {importing
                  ? `Importing ${progress.done}/${progress.total}…`
                  : `Import ${counts.ready} account${counts.ready === 1 ? '' : 's'}`}
              </Button>
              <p className="text-xs text-subtle">
                Accounts that already exist (matched by number or name) are skipped — safe to
                re-run.
              </p>
            </div>
          </div>
        )}

        {csv.step === 'done' && result && (
          <div className="space-y-4">
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-5 text-center">
              <span className="material-symbols-outlined text-5xl text-emerald-400">task_alt</span>
              <h2 className="mt-2 text-xl font-bold text-white">Accounts imported</h2>
              <p className="mt-1 text-sm text-muted">
                <strong className="text-emerald-300">{result.created}</strong> created ·{' '}
                <strong>{result.skipped}</strong> already existed ·{' '}
                <strong className={result.failed.length ? 'text-red-300' : ''}>
                  {result.failed.length}
                </strong>{' '}
                failed
              </p>
            </div>
            {result.failed.length > 0 && (
              <div className="rounded-lg border border-red-500/20 bg-card-dark p-4 text-sm">
                <h3 className="mb-2 font-semibold text-red-300">Rows that failed</h3>
                <ul className="space-y-1 text-muted">
                  {result.failed.map((f) => (
                    <li key={f.rowNumber}>
                      <span className="text-subtle">Row {f.rowNumber}:</span> {f.name} —{' '}
                      <span className="text-red-300">{f.error}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => navigate('/app/accounting/accounts')} icon="account_tree">
                View Chart of Accounts
              </Button>
              <Button
                variant="secondary"
                onClick={() => navigate('/app/accounting/import/customers')}
                icon="groups"
              >
                Next: import customers
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

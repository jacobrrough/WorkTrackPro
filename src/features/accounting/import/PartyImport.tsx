import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { customersService, vendorsService } from '@/services/api/accounting';
import { AccountingShell } from '../components/AccountingShell';
import { ACCOUNTING_QUERY_KEYS } from '../constants';
import {
  Chip,
  ColumnMapper,
  ImportStepper,
  UploadDropzone,
  useCsvUpload,
  type ColumnRoleDef,
} from './importKit';
import {
  autoDetectCustomerColumns,
  autoDetectVendorColumns,
  buildCustomerRows,
  buildVendorRows,
  findDuplicateParty,
  toNewCustomerInput,
  toNewVendorInput,
} from './qboPartyMapping';

type PartyKind = 'customer' | 'vendor';
type RowStatus = 'ready' | 'duplicate' | 'error';

interface AnnotatedRow {
  rowNumber: number;
  displayName: string;
  detail: string; // secondary line (company / email)
  extra: string; // kind-specific (terms / 1099)
  problem: string | null;
  status: RowStatus;
  duplicateName: string | null;
  build: () => unknown | null;
}

interface ImportResult {
  created: number;
  skipped: number;
  failed: { rowNumber: number; name: string; error: string }[];
}

const ROLES: Record<PartyKind, ColumnRoleDef[]> = {
  customer: [
    { role: 'displayName', label: 'Customer name', required: true },
    { role: 'companyName', label: 'Company' },
    { role: 'contactName', label: 'Contact' },
    { role: 'email', label: 'Email' },
    { role: 'phone', label: 'Phone' },
    { role: 'terms', label: 'Terms' },
    { role: 'notes', label: 'Notes' },
  ],
  vendor: [
    { role: 'displayName', label: 'Vendor name', required: true },
    { role: 'companyName', label: 'Company' },
    { role: 'email', label: 'Email' },
    { role: 'phone', label: 'Phone' },
    { role: 'terms', label: 'Terms' },
    { role: 'taxId', label: 'Tax ID' },
    { role: 'is1099', label: 'Track 1099' },
    { role: 'notes', label: 'Notes' },
  ],
};

const COPY: Record<
  PartyKind,
  {
    title: string;
    noun: string;
    plural: string;
    listName: string;
    next?: { label: string; path: string };
  }
> = {
  customer: {
    title: 'Import · Customers',
    noun: 'customer',
    plural: 'customers',
    listName: 'Customer list',
    next: { label: 'Next: import vendors', path: '/app/accounting/import/vendors' },
  },
  vendor: {
    title: 'Import · Vendors',
    noun: 'vendor',
    plural: 'vendors',
    listName: 'Vendor list',
    next: { label: 'Next: import transactions', path: '/app/accounting/import/transactions' },
  },
};

export default function PartyImport({ kind }: { kind: PartyKind }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const copy = COPY[kind];
  const queryKey =
    kind === 'customer' ? ACCOUNTING_QUERY_KEYS.customers : ACCOUNTING_QUERY_KEYS.vendors;

  // Both masters share the fields the duplicate check needs; query to that shape so
  // the customer/vendor branches unify.
  const existingQuery = useQuery<{ displayName: string; email: string | null }[]>({
    queryKey: [...queryKey, 'all-for-import'],
    queryFn: () =>
      kind === 'customer' ? customersService.getAll(true) : vendorsService.getAll(true),
  });
  const existing = useMemo(() => existingQuery.data ?? [], [existingQuery.data]);

  const autoDetect = kind === 'customer' ? autoDetectCustomerColumns : autoDetectVendorColumns;
  const csv = useCsvUpload(autoDetect);

  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<ImportResult | null>(null);

  const rows: AnnotatedRow[] = useMemo(() => {
    if (kind === 'customer') {
      return buildCustomerRows(csv.rows, csv.columnMap).map((r) => {
        const dup = findDuplicateParty(r, existing);
        const status: RowStatus = r.problem ? 'error' : dup ? 'duplicate' : 'ready';
        return {
          rowNumber: r.rowNumber,
          displayName: r.displayName,
          detail: r.companyName ?? r.email ?? '',
          extra: r.terms ?? '',
          problem: r.problem,
          status,
          duplicateName: dup?.displayName ?? null,
          build: () => toNewCustomerInput(r),
        };
      });
    }
    return buildVendorRows(csv.rows, csv.columnMap).map((r) => {
      const dup = findDuplicateParty(
        r,
        existing as { displayName: string; email: string | null }[]
      );
      const status: RowStatus = r.problem ? 'error' : dup ? 'duplicate' : 'ready';
      return {
        rowNumber: r.rowNumber,
        displayName: r.displayName,
        detail: r.companyName ?? r.email ?? '',
        extra: r.is1099 ? '1099' : '',
        problem: r.problem,
        status,
        duplicateName: dup?.displayName ?? null,
        build: () => toNewVendorInput(r),
      };
    });
  }, [kind, csv.rows, csv.columnMap, existing]);

  const counts = useMemo(() => {
    const c: Record<RowStatus, number> = { ready: 0, duplicate: 0, error: 0 };
    rows.forEach((r) => (c[r.status] += 1));
    return c;
  }, [rows]);

  const missingRequired = !csv.columnMap.displayName;

  const startOver = () => {
    csv.reset();
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
      const input = r.build();
      if (!input)
        failed.push({
          rowNumber: r.rowNumber,
          name: r.displayName,
          error: 'Could not build record',
        });
      else {
        try {
          const saved =
            kind === 'customer'
              ? await customersService.create(
                  input as Parameters<typeof customersService.create>[0]
                )
              : await vendorsService.create(input as Parameters<typeof vendorsService.create>[0]);
          if (saved) created += 1;
          else
            failed.push({
              rowNumber: r.rowNumber,
              name: r.displayName,
              error: 'Rejected by the server',
            });
        } catch (e) {
          failed.push({
            rowNumber: r.rowNumber,
            name: r.displayName,
            error: e instanceof Error ? e.message : 'Failed to create',
          });
        }
      }
      setProgress({ done: i + 1, total: ready.length });
    }
    await queryClient.invalidateQueries({ queryKey });
    setResult({ created, skipped: counts.duplicate, failed });
    setImporting(false);
    csv.setStep('done');
  };

  return (
    <AccountingShell active="import" title={copy.title}>
      <div className="mx-auto max-w-5xl space-y-4">
        <ImportStepper steps={['Upload', 'Review', 'Done']} current={csv.step} />

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
            title={`Drop your ${copy.listName} CSV or Excel file here`}
            subtitle="or choose a file to upload"
            instructions={
              <>
                <h3 className="mb-2 flex items-center gap-2 font-semibold text-white">
                  <span className="material-symbols-outlined text-lg text-amber-400">help</span>
                  Export from QuickBooks Online
                </h3>
                <ol className="list-decimal space-y-1.5 pl-4">
                  <li>
                    Go to{' '}
                    <strong>
                      Sales → {kind === 'customer' ? 'Customers' : 'Expenses → Vendors'}
                    </strong>{' '}
                    (or <strong>Get paid &amp; pay</strong>).
                  </li>
                  <li>
                    Click the <strong>export</strong> icon above the list → it downloads an Excel
                    file.
                  </li>
                  <li>Upload that Excel file here — or save it as CSV first. Either works.</li>
                </ol>
                <p className="mt-3 text-xs text-muted">
                  Existing {copy.plural} (matched by name or email) are skipped, so this is safe to
                  re-run.
                </p>
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
              roles={ROLES[kind]}
              headers={csv.headers}
              value={csv.columnMap}
              onChange={csv.setColumn}
              note={
                missingRequired
                  ? `Choose which column holds the ${copy.noun} name to continue.`
                  : undefined
              }
            />

            <div className="flex flex-wrap gap-2">
              <Chip className="bg-emerald-500/15 text-emerald-300">{counts.ready} ready</Chip>
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
                    <th className="px-3 py-2 font-semibold">Company / email</th>
                    <th className="px-3 py-2 font-semibold">
                      {kind === 'vendor' ? '1099' : 'Terms'}
                    </th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.rowNumber} className="border-t border-line/60">
                      <td className="px-3 py-1.5 text-subtle">{r.rowNumber}</td>
                      <td className="px-3 py-1.5 text-white">
                        {r.displayName || <em className="text-subtle">—</em>}
                      </td>
                      <td className="px-3 py-1.5 text-muted">{r.detail || '—'}</td>
                      <td className="px-3 py-1.5 text-muted">{r.extra || '—'}</td>
                      <td className="px-3 py-1.5">
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-xs font-semibold ${
                            r.status === 'ready'
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : r.status === 'duplicate'
                                ? 'bg-slate-500/15 text-muted'
                                : 'bg-red-500/15 text-red-300'
                          }`}
                          title={
                            r.duplicateName
                              ? `Matches "${r.duplicateName}"`
                              : (r.problem ?? undefined)
                          }
                        >
                          {r.status === 'ready'
                            ? 'Ready'
                            : r.status === 'duplicate'
                              ? 'Already exists'
                              : 'Skip'}
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
                  : `Import ${counts.ready} ${counts.ready === 1 ? copy.noun : copy.plural}`}
              </Button>
            </div>
          </div>
        )}

        {csv.step === 'done' && result && (
          <div className="space-y-4">
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-5 text-center">
              <span className="material-symbols-outlined text-5xl text-emerald-400">task_alt</span>
              <h2 className="mt-2 text-xl font-bold text-white">{copy.plural} imported</h2>
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
              {copy.next && (
                <Button onClick={() => navigate(copy.next!.path)} icon="arrow_forward">
                  {copy.next.label}
                </Button>
              )}
              <Button
                variant="secondary"
                onClick={() => navigate('/app/accounting/import')}
                icon="grid_view"
              >
                Back to import hub
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

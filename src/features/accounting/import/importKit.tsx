/**
 * Shared building blocks for the QuickBooks import wizards (Accounts, Customers,
 * Vendors, Transactions). The mechanical parts — read a CSV file, parse it,
 * auto-detect columns, drive the upload → review → done step machine, and the
 * presentational pieces (dropzone, column mapper, stepper) — live here so every
 * importer behaves identically. The kind-specific logic (how rows map to records,
 * how they're previewed and written) stays in each wizard.
 */
import { useCallback, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { parseCsv } from './csvImport';

export type ImportStep = 'upload' | 'review' | 'done';
export type AnyColumnMap = Record<string, string | undefined>;

export interface ColumnRoleDef {
  role: string;
  label: string;
  required?: boolean;
}

const selectClass =
  'w-full rounded-sm border border-white/10 bg-background-dark px-2 py-1.5 text-sm text-white focus:border-primary focus:outline-none';

/**
 * Encapsulates the upload + parse + auto-map + step state shared by every wizard.
 * `autoDetect` is kind-specific (which headers map to which roles).
 */
export function useCsvUpload(autoDetect: (headers: string[]) => AnyColumnMap) {
  const [step, setStep] = useState<ImportStep>('upload');
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [columnMap, setColumnMap] = useState<AnyColumnMap>({});
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      try {
        const parsed = parseCsv(await file.text());
        if (parsed.headers.length === 0 || parsed.rows.length === 0) {
          setError('That file has no data rows. Export the report from QuickBooks and try again.');
          return;
        }
        setFileName(file.name);
        setHeaders(parsed.headers);
        setRows(parsed.rows);
        setColumnMap(autoDetect(parsed.headers));
        setStep('review');
      } catch {
        setError('Could not read that file. Make sure it is a .csv exported from QuickBooks.');
      }
    },
    [autoDetect]
  );

  const setColumn = useCallback(
    (role: string, header: string) => setColumnMap((m) => ({ ...m, [role]: header || undefined })),
    []
  );

  const reset = useCallback(() => {
    setStep('upload');
    setFileName('');
    setHeaders([]);
    setRows([]);
    setColumnMap({});
    setError(null);
  }, []);

  const openPicker = useCallback(() => fileInputRef.current?.click(), []);
  const onFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void handleFile(file);
      e.target.value = '';
    },
    [handleFile]
  );
  const dragHandlers = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) void handleFile(file);
    },
  };

  return {
    step,
    setStep,
    fileName,
    headers,
    rows,
    columnMap,
    setColumn,
    error,
    setError,
    dragging,
    fileInputRef,
    handleFile,
    reset,
    openPicker,
    onFileInput,
    dragHandlers,
  };
}

// ── Presentational ───────────────────────────────────────────────────────────

export function ImportStepper({ steps, current }: { steps: string[]; current: ImportStep }) {
  const order: ImportStep[] = ['upload', 'review', 'done'];
  const idx = order.indexOf(current);
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {steps.map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          <span
            className={`rounded-sm px-2 py-1 font-semibold ${
              i <= idx ? 'bg-primary/20 text-primary' : 'bg-white/5 text-slate-500'
            }`}
          >
            {i + 1}. {label}
          </span>
          {i < steps.length - 1 && <span className="text-slate-600">›</span>}
        </div>
      ))}
    </div>
  );
}

export function UploadDropzone({
  dragging,
  fileInputRef,
  onPick,
  onFileInput,
  dragHandlers,
  title,
  subtitle,
  instructions,
}: {
  dragging: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onPick: () => void;
  onFileInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
  dragHandlers: {
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: () => void;
    onDrop: (e: React.DragEvent) => void;
  };
  title: string;
  subtitle?: string;
  instructions?: React.ReactNode;
}) {
  return (
    <div className={`grid gap-4 ${instructions ? 'md:grid-cols-[1fr_340px]' : ''}`}>
      <div
        {...dragHandlers}
        className={`flex flex-col items-center justify-center gap-3 rounded-md border-2 border-dashed p-10 text-center transition-colors ${
          dragging ? 'border-primary bg-primary/5' : 'border-white/15 bg-card-dark'
        }`}
      >
        <span className="material-symbols-outlined text-5xl text-primary">upload_file</span>
        <div>
          <p className="font-semibold text-white">{title}</p>
          {subtitle && <p className="text-sm text-slate-400">{subtitle}</p>}
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
      {instructions && (
        <aside className="rounded-md border border-white/10 bg-card-dark p-4 text-sm text-slate-300">
          {instructions}
        </aside>
      )}
    </div>
  );
}

export function ColumnMapper({
  roles,
  headers,
  value,
  onChange,
  note,
}: {
  roles: ColumnRoleDef[];
  headers: string[];
  value: AnyColumnMap;
  onChange: (role: string, header: string) => void;
  note?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-white/10 bg-card-dark p-4">
      <h3 className="mb-3 text-sm font-semibold text-white">Match your columns</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {roles.map(({ role, label, required }) => (
          <label key={role} className="block text-sm">
            <span className="mb-1 block text-slate-400">
              {label}
              {required && <span className="text-red-400"> *</span>}
            </span>
            <select
              value={value[role] ?? ''}
              onChange={(e) => onChange(role, e.target.value)}
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
      {note && <div className="mt-2 text-xs text-amber-300">{note}</div>}
    </div>
  );
}

export function Chip({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <span className={`rounded-sm px-2 py-1 text-sm font-semibold ${className}`}>{children}</span>
  );
}

export { selectClass };

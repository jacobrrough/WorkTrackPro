/**
 * Unifies CSV and Excel (.xlsx) uploads into the same { headers, rows } shape the
 * import wizards consume, and — importantly for QuickBooks *report* exports —
 * skips the title rows QBO puts above the real column header.
 *
 * QBO "Export to Excel/CSV" for a report (e.g. the Journal) prepends a few rows:
 * the company name, the report name, and the date range, then the real header
 * (Date, Transaction Type, Account, Debit, Credit, …). findHeaderRow() locates
 * that header so the columns map and transactions actually show up.
 *
 * CSV uses the dependency-free tokenizer in csvImport.ts; .xlsx is read with
 * read-excel-file (loaded lazily, only when an .xlsx is dropped). The cell→string
 * conversion and header detection are pure and unit-tested.
 */
import { parseCsvMatrix, type ParsedCsv } from './csvImport';

/** A .xlsx file (legacy binary .xls is handled separately with a friendly error). */
export function isXlsxFile(file: File): boolean {
  return (
    /\.xlsx$/i.test(file.name) ||
    file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
}

function formatDate(d: Date): string {
  // read-excel-file decodes Excel date serials to a UTC Date; read it back in UTC
  // so there is no timezone drift (yyyy-mm-dd is what parseDateToIso expects).
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Normalise any spreadsheet cell value to the trimmed string the pipeline expects. */
export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return formatDate(value);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value).trim();
}

// Column-name fragments common to the QuickBooks exports the wizards accept. The
// header row matches several of these; title/preamble rows (company name, report
// title, date range) match at most one, so a >=2 threshold reliably finds it.
const HEADER_TOKENS = [
  'date',
  'account',
  'debit',
  'credit',
  'type',
  'num',
  'name',
  'memo',
  'description',
  'customer',
  'vendor',
  'company',
  'email',
  'phone',
  'terms',
  'balance',
  'amount',
  'detail',
  'subtype',
];

/**
 * Index of the most likely header row among the first rows: the first row whose
 * cells match at least two known column-name fragments. Falls back to 0 (so a file
 * with no recognisable header behaves as before — first row is the header).
 */
export function findHeaderRow(rows: string[][]): number {
  const limit = Math.min(rows.length, 20);
  for (let i = 0; i < limit; i++) {
    let matches = 0;
    for (const cell of rows[i]) {
      const c = cell.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (c && HEADER_TOKENS.some((t) => c.includes(t))) matches += 1;
    }
    if (matches >= 2) return i;
  }
  return 0;
}

/**
 * Turn a 2-D array of raw cell values into headers + header-keyed row objects,
 * dropping any title rows above the detected header. Fully-empty rows are removed;
 * blank header columns are ignored; short rows are padded.
 */
export function cellsToTable(matrix: unknown[][]): ParsedCsv {
  const stringRows = matrix
    .map((row) => (Array.isArray(row) ? row.map(formatCell) : []))
    .filter((row) => row.some((c) => c !== ''));
  if (stringRows.length === 0) return { headers: [], rows: [] };

  const headerIndex = findHeaderRow(stringRows);
  const headerCells = stringRows[headerIndex].map((h) => h.trim());
  const rows = stringRows.slice(headerIndex + 1).map((cells) => {
    const obj: Record<string, string> = {};
    headerCells.forEach((h, i) => {
      if (h) obj[h] = (cells[i] ?? '').trim();
    });
    return obj;
  });
  return { headers: headerCells.filter(Boolean), rows };
}

/**
 * Read a dropped/selected file (CSV or .xlsx) into { headers, rows }. Both paths
 * go through cellsToTable so report preambles are skipped consistently.
 */
export async function readSpreadsheet(file: File): Promise<ParsedCsv> {
  if (/\.xls$/i.test(file.name)) {
    throw new Error(
      'Old .xls files aren’t supported. In Excel use “Save As” to create a .xlsx, or export as CSV.'
    );
  }
  if (isXlsxFile(file)) {
    // read-excel-file v9 exposes only subpath entries; /browser reads a File/Blob.
    // The named `readSheet` returns the first sheet's rows (the default export
    // returns every sheet wrapped as { sheet, data }).
    const { readSheet } = await import('read-excel-file/browser');
    return cellsToTable((await readSheet(file)) as unknown[][]);
  }
  return cellsToTable(parseCsvMatrix(await file.text()));
}

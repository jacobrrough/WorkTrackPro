/**
 * Unifies CSV and Excel (.xlsx) uploads into the same { headers, rows } shape the
 * import wizards consume. CSV uses the dependency-free parser in csvImport.ts;
 * Excel is read with read-excel-file (loaded lazily, only when an .xlsx is actually
 * dropped, so it stays out of every other chunk).
 *
 * The cell→string conversion (cellsToTable / formatCell) is pure and unit-tested;
 * the binary .xlsx decoding is delegated to the library, which handles the things
 * that are easy to get wrong by hand — shared strings, number formats, and Excel's
 * date serial numbers (dates come back as JS Date and are normalised to ISO here).
 */
import { parseCsv, type ParsedCsv } from './csvImport';

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

/**
 * Turn a 2-D array of raw cell values (as read-excel-file returns) into headers +
 * header-keyed row objects — the same contract as csvImport.parseCsv. The first
 * row with any non-empty cell is the header; fully-empty rows are dropped; short
 * rows are padded so every header key is present.
 */
export function cellsToTable(matrix: unknown[][]): ParsedCsv {
  const stringRows = matrix
    .map((row) => (Array.isArray(row) ? row.map(formatCell) : []))
    .filter((row) => row.some((c) => c !== ''));
  if (stringRows.length === 0) return { headers: [], rows: [] };

  const headers = stringRows[0].map((h) => h.trim());
  const rows = stringRows.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = (cells[i] ?? '').trim();
    });
    return obj;
  });
  return { headers, rows };
}

/**
 * Read a dropped/selected file (CSV or .xlsx) into { headers, rows }. The Excel
 * reader is dynamically imported so it only loads when needed.
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
    const matrix = (await readSheet(file)) as unknown[][];
    return cellsToTable(matrix);
  }
  return parseCsv(await file.text());
}

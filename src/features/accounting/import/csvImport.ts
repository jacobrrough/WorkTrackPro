/**
 * Minimal, dependency-free CSV reader for the QuickBooks import wizard.
 *
 * Handles the dialect QuickBooks Online produces on "Export to Excel" → Save as
 * CSV:
 *  - comma, tab, or semicolon delimited (auto-detected from the header row)
 *  - RFC-4180 double-quoted fields, with "" as an escaped quote
 *  - fields containing the delimiter or newlines inside quotes
 *  - a UTF-8 BOM prefix (Excel adds one)
 *  - CRLF or LF line endings, and blank / fully-empty rows
 *
 * It deliberately does NOT interpret values — every cell is returned as the raw
 * trimmed string. Type/number coercion is the caller's job (see qboAccountMapping).
 */

export interface ParsedCsv {
  /** Header labels from the first non-empty row, trimmed. */
  headers: string[];
  /** One object per data row, keyed by header label (raw, trimmed cell strings). */
  rows: Record<string, string>[];
}

const DELIMITERS = [',', '\t', ';'] as const;

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Pick the delimiter that appears most on the header line (outside quotes).
 * Comma wins ties, since it is by far the most common QBO export delimiter.
 */
export function detectDelimiter(text: string): string {
  const firstLine = stripBom(text).split(/\r?\n/, 1)[0] ?? '';
  let best = ',';
  let bestCount = 0;
  for (const d of DELIMITERS) {
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < firstLine.length; i++) {
      const ch = firstLine[i];
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === d && !inQuotes) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

/** Tokenise a CSV document into a matrix of raw string cells (incl. header row). */
export function parseCsvMatrix(text: string, delimiter?: string): string[][] {
  const src = stripBom(text);
  const delim = delimiter ?? detectDelimiter(src);
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++; // consume the escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch === '\r') {
      // ignore; a following \n (if present) terminates the row
    } else {
      field += ch;
    }
  }
  // Flush the final field/row when the file has no trailing newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Parse a CSV document into headers + row objects. The first row that contains
 * any non-empty cell is treated as the header; fully-empty rows are dropped.
 * Ragged rows are padded so every header key is always present (never undefined).
 */
export function parseCsv(text: string, delimiter?: string): ParsedCsv {
  const matrix = parseCsvMatrix(text, delimiter).filter((r) => r.some((c) => c.trim() !== ''));
  if (matrix.length === 0) return { headers: [], rows: [] };

  const headers = matrix[0].map((h) => h.trim());
  const rows = matrix.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = (cells[idx] ?? '').trim();
    });
    return obj;
  });
  return { headers, rows };
}

/**
 * Pure, dependency-free parsers for bank-statement imports (A4 Banking).
 *
 * These turn the text of a CSV / OFX / QFX file into a normalized list of
 * `ParsedBankTransaction`s. They run entirely client-side (no Supabase, no React,
 * no npm parser dep) so they are trivially unit-testable and add zero weight to the
 * flag-off bundle. The import *service* (bankTransactions.import) takes this output,
 * derives a stable `external_id` for any row the file did not number, and inserts —
 * the DB unique (bank_account_id, external_id) makes re-importing the same statement
 * idempotent.
 *
 * SIGN CONVENTION (see BankTransaction in types.ts): the returned `amount` is signed
 * from the bank's perspective — positive = money in (deposit/credit), negative =
 * money out (withdrawal/debit). OFX amounts already carry their sign. CSV files vary
 * wildly, so the CSV parser supports both a single signed "Amount" column and the
 * common split "Debit"/"Credit" (or "Withdrawal"/"Deposit") column pair.
 *
 * Plaid is explicitly OUT OF SCOPE here (deferred behind user keys) — manual file
 * import is the whole surface.
 */
import type { ParsedBankTransaction } from '../../../features/accounting/types';

export type BankImportFormat = 'csv' | 'ofx';

export interface ParseResult {
  format: BankImportFormat;
  transactions: ParsedBankTransaction[];
  /** Non-fatal per-row issues (e.g. an unparseable date) the UI can surface. */
  warnings: string[];
}

/** Thrown when the file cannot be parsed at all (wrong format / no usable rows). */
export class BankImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BankImportError';
  }
}

// ── Shared normalizers ───────────────────────────────────────────────────────

/**
 * Parse a money token to a number of dollars (2dp). Handles "$1,234.56",
 * parentheses-negatives "(45.00)", trailing-minus "45.00-", and leading "+".
 * Returns null when there is no number at all.
 */
export function parseAmount(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  let negative = false;
  // Accounting parentheses mean negative.
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  // Trailing minus (some exports put the sign after the number).
  if (/-\s*$/.test(s)) {
    negative = true;
    s = s.replace(/-\s*$/, '');
  }
  if (/^\s*-/.test(s)) negative = true;
  // Strip currency symbols, thousands separators, spaces and the leading sign.
  const cleaned = s.replace(/[^0-9.]/g, '');
  if (cleaned === '' || cleaned === '.') return null;
  const n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n)) return null;
  const dollars = Math.round(n * 100) / 100;
  return negative ? -dollars : dollars;
}

/**
 * Normalize a date token to ISO `YYYY-MM-DD`. Accepts:
 *   • ISO `2026-06-01` (optionally with a time),
 *   • OFX timestamps `20260601`, `20260601120000`, `20260601120000.000[-8:PST]`,
 *   • US `MM/DD/YYYY` or `MM/DD/YY` and `MM-DD-YYYY`,
 *   • `YYYY/MM/DD`.
 * Returns null when no date can be read.
 */
export function normalizeDate(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // ISO YYYY-MM-DD (with optional time). Checked first so an ISO string is never
  // misread as the OFX-compact form below.
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const [, y, m, d] = iso;
    return isoIfValid(y, m, d);
  }

  // YYYY/MM/DD.
  const ymd = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (ymd) {
    const [, y, m, d] = ymd;
    return isoIfValid(y, m, d);
  }

  // US M/D/Y or M-D-Y (2- or 4-digit year).
  const mdy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (mdy) {
    const [, m, d, rawYear] = mdy;
    const y = rawYear.length === 2 ? `20${rawYear}` : rawYear;
    return isoIfValid(y, m, d);
  }

  // OFX compact datetime: 8 leading digits = YYYYMMDD, then an optional time and/or
  // a `[-8:PST]` tz suffix (which is why we cannot reject on a later '-'). By this
  // point the separator-bearing forms above have already been tried.
  const ofx = s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (ofx) {
    const [, y, m, d] = ofx;
    return isoIfValid(y, m, d);
  }

  return null;
}

function isoIfValid(y: string, m: string, d: string): string | null {
  const yy = Number(y);
  const mm = Number(m);
  const dd = Number(d);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${yy}-${pad(mm)}-${pad(dd)}`;
}

const clean = (v: string | null | undefined): string | null => {
  if (v == null) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
};

/**
 * A stable synthetic external id for a row that arrived without one (many CSVs and
 * some OFX rows omit FITID). It is a deterministic non-crypto hash of the natural
 * key (date|signed-amount|description|merchant) so re-importing the same statement
 * dedups, while two genuinely different rows that happen to share a date+amount keep
 * their order via the per-batch `index` salt. Format: `gen:<hash>`.
 */
export function syntheticExternalId(
  txn: Pick<ParsedBankTransaction, 'txnDate' | 'amount' | 'description' | 'merchant'>,
  index: number
): string {
  const basis = [
    txn.txnDate,
    txn.amount.toFixed(2),
    (txn.description ?? '').toLowerCase().replace(/\s+/g, ' ').trim(),
    (txn.merchant ?? '').toLowerCase().replace(/\s+/g, ' ').trim(),
    String(index),
  ].join('|');
  return `gen:${djb2(basis)}`;
}

/** Tiny deterministic string hash (djb2, xor variant) rendered as base36. */
function djb2(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = (h * 33) ^ input.charCodeAt(i);
  }
  // >>> 0 coerces to an unsigned 32-bit int for a stable, non-negative value.
  return (h >>> 0).toString(36);
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

/** Sniff the format from the text and parse. Throws BankImportError on failure. */
export function parseBankFile(text: string, fileName?: string): ParseResult {
  const detected = detectFormat(text, fileName);
  return detected === 'ofx' ? parseOfx(text) : parseCsv(text);
}

/** Heuristic format sniff: OFX/QFX contain an <OFX> root or SGML headers. */
export function detectFormat(text: string, fileName?: string): BankImportFormat {
  const head = text.slice(0, 4000).toUpperCase();
  if (head.includes('<OFX>') || head.includes('OFXHEADER') || head.includes('<STMTTRN>')) {
    return 'ofx';
  }
  const ext = (fileName ?? '').toLowerCase();
  if (ext.endsWith('.ofx') || ext.endsWith('.qfx')) return 'ofx';
  return 'csv';
}

// ── CSV ──────────────────────────────────────────────────────────────────────

/** Column-name synonyms (lower-cased, non-alphanumerics stripped) → logical field. */
const CSV_HEADERS: Record<string, 'date' | 'amount' | 'debit' | 'credit' | 'description' | 'merchant' | 'fitid'> = {
  date: 'date',
  transactiondate: 'date',
  posteddate: 'date',
  postingdate: 'date',
  postdate: 'date',
  amount: 'amount',
  transactionamount: 'amount',
  amt: 'amount',
  debit: 'debit',
  withdrawal: 'debit',
  withdrawalamount: 'debit',
  paymentamount: 'debit',
  credit: 'credit',
  deposit: 'credit',
  depositamount: 'credit',
  description: 'description',
  memo: 'description',
  name: 'description',
  details: 'description',
  narrative: 'description',
  payee: 'merchant',
  merchant: 'merchant',
  merchantname: 'merchant',
  fitid: 'fitid',
  transactionid: 'fitid',
  referencenumber: 'fitid',
  refnumber: 'fitid',
  reference: 'fitid',
};

const normHeader = (h: string): string => h.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Parse a delimited statement. Auto-detects comma/semicolon/tab, requires a header
 * row that names at least a date and either an amount or a debit/credit pair, and
 * supports quoted fields with embedded delimiters and "" escapes.
 */
export function parseCsv(text: string): ParseResult {
  const rows = splitRows(text);
  if (rows.length < 2) {
    throw new BankImportError('CSV file has no data rows (need a header plus at least one row).');
  }
  const delimiter = detectDelimiter(rows[0]);
  const header = parseLine(rows[0], delimiter).map(normHeader);

  const col: Partial<Record<'date' | 'amount' | 'debit' | 'credit' | 'description' | 'merchant' | 'fitid', number>> = {};
  header.forEach((h, i) => {
    const logical = CSV_HEADERS[h];
    // First occurrence wins (don't let a later "name" clobber an earlier mapping).
    if (logical && col[logical] === undefined) col[logical] = i;
  });

  if (col.date === undefined) {
    throw new BankImportError('CSV is missing a recognizable date column (e.g. "Date").');
  }
  const hasSigned = col.amount !== undefined;
  const hasSplit = col.debit !== undefined || col.credit !== undefined;
  if (!hasSigned && !hasSplit) {
    throw new BankImportError('CSV is missing an amount column (or a Debit/Credit pair).');
  }

  const transactions: ParsedBankTransaction[] = [];
  const warnings: string[] = [];

  for (let r = 1; r < rows.length; r++) {
    const rawLine = rows[r];
    if (!rawLine.trim()) continue;
    const cells = parseLine(rawLine, delimiter);
    const at = (i: number | undefined): string | null => (i === undefined ? null : clean(cells[i]));

    const txnDate = normalizeDate(at(col.date));
    if (!txnDate) {
      warnings.push(`Row ${r + 1}: unrecognized date "${at(col.date) ?? ''}" — skipped.`);
      continue;
    }

    let amount: number | null;
    if (hasSigned) {
      amount = parseAmount(at(col.amount));
    } else {
      // Split columns: debit is money out (negative), credit is money in (positive).
      // Each is typically a positive magnitude; honor an explicit sign if present.
      const debit = parseAmount(at(col.debit));
      const credit = parseAmount(at(col.credit));
      if (debit != null && debit !== 0) amount = -Math.abs(debit);
      else if (credit != null && credit !== 0) amount = Math.abs(credit);
      else amount = 0;
    }
    if (amount == null) {
      warnings.push(`Row ${r + 1}: unreadable amount — skipped.`);
      continue;
    }

    transactions.push({
      txnDate,
      amount,
      description: at(col.description),
      merchant: at(col.merchant),
      externalId: at(col.fitid),
    });
  }

  if (transactions.length === 0) {
    throw new BankImportError('No transactions could be read from the CSV.');
  }
  return { format: 'csv', transactions, warnings };
}

/** Split the file into raw row strings, tolerating \r\n, \r and \n line endings. */
function splitRows(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

/** Pick the delimiter by counting candidates in the header line. */
function detectDelimiter(headerLine: string): string {
  const candidates = [',', ';', '\t'];
  let best = ',';
  let bestCount = -1;
  for (const d of candidates) {
    const count = headerLine.split(d).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

/**
 * Parse one delimited line into fields, honoring double-quoted segments (which may
 * contain the delimiter) and the "" in-quote escape for a literal quote.
 */
function parseLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      out.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out;
}

// ── OFX / QFX ────────────────────────────────────────────────────────────────

/**
 * Parse OFX/QFX. Both are SGML; we extract every <STMTTRN>…</STMTTRN> block and
 * read its child tags. OFX 1.x omits closing tags (value runs to the next tag),
 * which this tolerant tag reader handles; OFX 2.x is well-formed XML and also works.
 *
 *   <TRNAMT> is already signed (negative = debit). <DTPOSTED> is a compact datetime.
 *   <FITID> is the bank's stable id → our external_id (so re-import dedups exactly).
 *   <NAME>/<MEMO> populate merchant/description; <PAYEE><NAME> is used when present.
 */
export function parseOfx(text: string): ParseResult {
  const blocks = text.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi);
  if (!blocks || blocks.length === 0) {
    throw new BankImportError('No <STMTTRN> transactions found in the OFX/QFX file.');
  }

  const transactions: ParsedBankTransaction[] = [];
  const warnings: string[] = [];

  blocks.forEach((block, i) => {
    const dt = normalizeDate(ofxTag(block, 'DTPOSTED') ?? ofxTag(block, 'DTUSER'));
    const amt = parseAmount(ofxTag(block, 'TRNAMT'));
    if (!dt) {
      warnings.push(`Transaction ${i + 1}: missing/invalid <DTPOSTED> — skipped.`);
      return;
    }
    if (amt == null) {
      warnings.push(`Transaction ${i + 1}: missing/invalid <TRNAMT> — skipped.`);
      return;
    }
    // Prefer a structured <PAYEE><NAME>, then <NAME>, for the merchant.
    const payeeName = ofxTag(block, 'NAME');
    const memo = ofxTag(block, 'MEMO');
    transactions.push({
      txnDate: dt,
      amount: amt,
      description: clean(memo ?? payeeName),
      merchant: clean(payeeName),
      externalId: clean(ofxTag(block, 'FITID')),
    });
  });

  if (transactions.length === 0) {
    throw new BankImportError('No usable transactions in the OFX/QFX file.');
  }
  return { format: 'ofx', transactions, warnings };
}

/**
 * Read a single OFX tag's value from a block. Works for both closed
 * (`<TAG>value</TAG>`) and SGML-unclosed (`<TAG>value` up to the next `<`) forms.
 */
export function ofxTag(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)(?:</${tag}>|<)`, 'i');
  const m = block.match(re);
  if (!m) return null;
  const v = m[1].trim();
  return v === '' ? null : v;
}

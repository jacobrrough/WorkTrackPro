/**
 * ⚠️  HELD / UNVERIFIED — NOT FOR FILING. Part of the import/migration module, which is
 *     FLAG-DARK and requires CPA and/or security sign-off before it is enabled. The UI
 *     renders the "UNVERIFIED — NOT FOR FILING" banner on every screen + export.
 *
 * Pure, dependency-free parsers for historical-data imports (Phase D — Import/Migration).
 *
 * These turn the text of a QuickBooks Desktop .IIF, a QuickBooks Online CSV/JSON export,
 * or a generic Excel/CSV file into a normalized list of `ParsedImportRecord`s plus the
 * distinct source chart-of-accounts accounts (for the mapping wizard). They run entirely
 * client-side (no Supabase, no React, no npm parser dep) so they are trivially
 * unit-testable and add ZERO weight to the flag-off bundle. The import *service*
 * (importService) stages this output and, only on an explicit admin commit, posts
 * BALANCED opening-balance journal entries via the accounting.commit_import_batch RPC.
 *
 * MONEY MATH IS INTEGER CENTS throughout (G6). Every record carries a deterministic
 * `contentHash` (sha-free djb2 over its canonical key) so re-staging the same source
 * record is a no-op (the DB unique(batch_id, content_hash) backstops it).
 *
 * OFFICIAL FORMAT SOURCES (cited so a human can verify fidelity):
 *  • IIF (Intuit Interchange Format): tab-delimited; each section begins with a header
 *    row whose first cell is a "!"-prefixed keyword (e.g. "!ACCNT", "!TRNS", "!SPL"),
 *    followed by data rows of the same column order. Transactions are TRNS … SPL … (one
 *    or more) … ENDTRNS. The chart of accounts is the ACCNT section; an account's opening
 *    balance is its OBAMOUNT column. Ref: Intuit "Import and export IIF files" /
 *    "IIF Import Kit" field reference (ACCNT: NAME, ACCNTTYPE, OBAMOUNT; TRNS/SPL: TRNSTYPE,
 *    DATE, ACCNT, AMOUNT, MEMO, NAME). Amounts are decimal dollars, debit-positive on TRNS,
 *    and each transaction's TRNS+SPL lines sum to zero.
 *  • QBO JSON export (Accounting API entity shapes): an Account has Name, Number (optional),
 *    AccountType/Classification and CurrentBalance; a JournalEntry has Line[] each with a
 *    JournalEntryLineDetail { PostingType: 'Debit'|'Credit', AccountRef:{value,name} } and
 *    an Amount; a TrialBalance report has Rows with ColData [account, debit, credit]. Ref:
 *    Intuit Developer entity references (Account, JournalEntry) + Reports (TrialBalance).
 *  • QBO CSV / generic CSV: a delimited file. The common shapes are a Trial Balance
 *    (Account[, Type], Debit, Credit) and an Account list (Account/Name[, Number][, Type],
 *    Balance). Debit/Credit are positive magnitudes; a single signed Balance is treated as
 *    a debit-normal amount (positive = debit) unless a Type marks it credit-normal.
 *
 * ACCOUNT-TYPE NORMALIZATION maps the many QBO/QBD type strings to our five
 * AccountType buckets (asset/liability/equity/income/expense) and a normal balance, which
 * the mapping wizard uses to suggest a target and to decide debit-vs-credit for an opening
 * balance. A HUMAN MUST VERIFY these mappings against the real source chart.
 */
import type {
  AccountType,
  ImportEntityType,
  ImportParseResult,
  ImportSource,
  ImportSourceDetail,
  MappedOpeningBalance,
  MappedJournalEntry,
  MappedJournalLine,
  ParsedImportRecord,
  ParsedSourceAccount,
} from '../../../features/accounting/types';

/** Thrown when a file cannot be parsed at all (wrong format / no usable rows). */
export class ImportParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportParseError';
  }
}

// ── Shared numeric / string normalizers ───────────────────────────────────────

/**
 * Parse a money token to INTEGER CENTS. Handles "$1,234.56", parentheses-negatives
 * "(45.00)", trailing-minus "45.00-", a leading "+", and bare numbers. Returns null
 * when there is no number at all. Rounding is half-away-from-zero at the cent.
 */
export function parseCents(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    return Math.round(raw * 100);
  }
  let s = String(raw).trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/-\s*$/.test(s)) {
    negative = true;
    s = s.replace(/-\s*$/, '');
  }
  if (/^\s*-/.test(s)) negative = true;
  const cleaned = s.replace(/[^0-9.]/g, '');
  if (cleaned === '' || cleaned === '.') return null;
  const n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n)) return null;
  // Round in cents to avoid float drift (e.g. 19.99 * 100).
  const cents = Math.round(Math.abs(n) * 100);
  return negative ? -cents : cents;
}

/**
 * Normalize a date token to ISO `YYYY-MM-DD`. Accepts ISO (optionally with a time),
 * US `M/D/YYYY` or `M/D/YY` (and `-` separators) — the IIF default — and `YYYY/MM/DD`.
 * Returns null when no date can be read.
 */
export function normalizeImportDate(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return isoIfValid(iso[1], iso[2], iso[3]);

  const ymd = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (ymd) return isoIfValid(ymd[1], ymd[2], ymd[3]);

  // US M/D/Y or M-D-Y (2- or 4-digit year) — QuickBooks' usual export format.
  const mdy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (mdy) {
    const y = mdy[3].length === 2 ? `20${mdy[3]}` : mdy[3];
    return isoIfValid(y, mdy[1], mdy[2]);
  }
  return null;
}

function isoIfValid(y: string, m: string, d: string): string | null {
  const yy = Number(y);
  const mm = Number(m);
  const dd = Number(d);
  if (!Number.isFinite(yy) || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${yy}-${pad(mm)}-${pad(dd)}`;
}

const clean = (v: unknown): string | null => {
  if (v == null) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
};

/** Tiny deterministic string hash (djb2, xor variant) as base36 — the dedup basis. */
function djb2(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = (h * 33) ^ input.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

/**
 * Stable content hash for a parsed record. Canonicalizes by stably stringifying the
 * record's identity (entity type + the salient raw fields + an index salt so two
 * genuinely-distinct rows that share a natural key keep distinct hashes). Re-importing
 * the same file yields the same hashes → dedup. Format: `<entity>:<hash>`.
 */
export function contentHashFor(
  entityType: ImportEntityType,
  identity: Record<string, unknown>,
  index: number
): string {
  const basis = `${entityType}|${canonicalJson(identity)}|${index}`;
  return `${entityType}:${djb2(basis)}`;
}

/** Deterministic JSON: keys sorted, so {a,b} and {b,a} hash identically. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

// ── Account-type normalization (QBO/QBD type string → our 5 buckets) ───────────
//
// HUMAN MUST VERIFY: these mappings drive the suggested target type AND whether an
// opening balance is posted as a debit or a credit. They follow Intuit's published
// AccountType/AccountSubType classification and the IIF ACCNTTYPE codes.

export type NormalBalanceSide = 'debit' | 'credit';

interface TypeClass {
  type: AccountType;
  normal: NormalBalanceSide;
}

const ASSET: TypeClass = { type: 'asset', normal: 'debit' };
const LIABILITY: TypeClass = { type: 'liability', normal: 'credit' };
const EQUITY: TypeClass = { type: 'equity', normal: 'credit' };
const INCOME: TypeClass = { type: 'income', normal: 'credit' };
const EXPENSE: TypeClass = { type: 'expense', normal: 'debit' };

/**
 * IIF ACCNTTYPE codes (QuickBooks Desktop). Ref: Intuit IIF field reference.
 *   BANK/AR/OCASSET/FIXASSET/OASSET → asset; AP/CCARD/OCLIAB/LTLIAB → liability;
 *   EQUITY → equity; INC/EXINC (other income) → income; EXP/EXEXP/COGS → expense.
 */
const IIF_ACCNTTYPE: Record<string, TypeClass> = {
  BANK: ASSET,
  AR: ASSET,
  OCASSET: ASSET,
  FIXASSET: ASSET,
  OASSET: ASSET,
  AP: LIABILITY,
  CCARD: LIABILITY,
  OCLIAB: LIABILITY,
  LTLIAB: LIABILITY,
  EQUITY,
  INC: INCOME,
  EXINC: INCOME,
  EXP: EXPENSE,
  EXEXP: EXPENSE,
  COGS: EXPENSE,
};

/**
 * Classify a free-text or coded account-type string from any source into our bucket +
 * normal balance. Tries the exact IIF code first, then keyword heuristics over the QBO
 * AccountType / Classification strings (e.g. "Accounts Receivable", "Cost of Goods Sold",
 * "Credit Card", "Long Term Liabilities", "Other Income"). Returns null when unknown so
 * the wizard surfaces it for a human instead of guessing.
 */
export function classifyAccountType(raw: string | null | undefined): TypeClass | null {
  const s0 = clean(raw);
  if (!s0) return null;
  const code = s0.toUpperCase();
  if (IIF_ACCNTTYPE[code]) return IIF_ACCNTTYPE[code];

  const s = s0.toLowerCase();
  // Order matters: check the more specific phrases before the generic bucket words.
  if (s.includes('accounts receivable') || s === 'receivable' || s.includes('a/r')) return ASSET;
  if (s.includes('accounts payable') || s === 'payable' || s.includes('a/p')) return LIABILITY;
  if (s.includes('cost of goods sold') || s.includes('cogs')) return EXPENSE;
  if (s.includes('credit card')) return LIABILITY;
  if (s.includes('other income') || s.includes('other current income')) return INCOME;
  if (s.includes('income') || s.includes('revenue') || s.includes('sales')) return INCOME;
  if (s.includes('expense') || s.includes('overhead')) return EXPENSE;
  if (s.includes('liabilit') || s.includes('loan') || s.includes('payable') || s.includes('note payable')) {
    return LIABILITY;
  }
  if (s.includes('equity') || s.includes('retained earnings') || s.includes('capital') || s.includes('owner')) {
    return EQUITY;
  }
  if (
    s.includes('bank') ||
    s.includes('asset') ||
    s.includes('cash') ||
    s.includes('inventory') ||
    s.includes('checking') ||
    s.includes('savings')
  ) {
    return ASSET;
  }
  return null;
}

/**
 * Build the candidate opening-balance mapped payload from a signed cents amount and the
 * account's normal side. A positive amount lands on the normal side (asset/expense →
 * debit, liability/equity/income → credit); a negative amount flips. targetAccountId is
 * filled later by the wizard (left '' here). The offset bucket defaults to 'equity'
 * (3050); a liability-normal source defaults its offset to 'liability' (2050) so the
 * plug lands sensibly — a human can override either.
 */
export function openingBalanceFromSigned(
  signedCents: number,
  cls: TypeClass
): Omit<MappedOpeningBalance, 'targetAccountId'> {
  // Magnitude on the normal side; a negative source amount reverses the side.
  const onNormalSide = signedCents >= 0;
  const magnitude = Math.abs(signedCents);
  const debitSide = cls.normal === 'debit' ? onNormalSide : !onNormalSide;
  return {
    debitCents: debitSide ? magnitude : 0,
    creditCents: debitSide ? 0 : magnitude,
    offset: cls.type === 'liability' ? 'liability' : 'equity',
  };
}

// ── Dispatch ───────────────────────────────────────────────────────────────────
// The public entry point is `parseImport` (bottom of file): it sniffs the shape, runs
// the right parser, and finalizes to an ImportParseResult. The per-shape parsers below
// return an ImportResultBuilder so a caller can inspect `.warnings` before `.build()`.

/**
 * Heuristic shape sniff. IIF files start with (or contain) a "!"-prefixed header
 * keyword line; JSON starts with `{`/`[`; everything else is delimited. The `.iif`
 * extension forces IIF; `.json` forces JSON.
 */
export function detectImportShape(text: string, fileName?: string): ImportSourceDetail {
  const ext = (fileName ?? '').toLowerCase();
  if (ext.endsWith('.iif')) return 'iif';
  if (ext.endsWith('.json')) return 'qbo_json';

  // Strip a leading UTF-8 BOM (U+FEFF) so a BOM-prefixed JSON export still sniffs as JSON.
  const head = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).slice(0, 4000);
  const trimmed = head.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'qbo_json';
  // IIF: a line whose first tab-cell is a !-keyword we recognize.
  if (/^!(ACCNT|TRNS|SPL|CUST|VEND|ENDTRNS)\b/im.test(head)) return 'iif';
  // A QBO CSV trial balance usually has Debit AND Credit columns; otherwise generic CSV.
  const firstLine = trimmed.split(/\r?\n/, 1)[0]?.toLowerCase() ?? '';
  if (firstLine.includes('debit') && firstLine.includes('credit')) return 'qbo_csv';
  return 'csv';
}

/** Map our coarse source-detail to the batch `source` enum. */
export function sourceForDetail(detail: ImportSourceDetail): ImportSource {
  if (detail === 'iif') return 'qbd';
  if (detail === 'qbo_csv' || detail === 'qbo_json') return 'qbo';
  return 'csv';
}

// ── IIF (QuickBooks Desktop) ────────────────────────────────────────────────────

/**
 * Parse a QuickBooks Desktop .IIF (tab-delimited, sectioned by !-headers).
 *
 * We read two sections:
 *   • ACCNT → the chart of accounts (a source account + an OBAMOUNT opening balance).
 *     Each account becomes a ParsedSourceAccount; a non-zero OBAMOUNT also yields an
 *     'opening_balance' record (debit-positive per IIF, mapped onto the account's normal
 *     side). NB: QuickBooks itself offsets account opening balances to Opening Balance
 *     Equity — we do the same at commit (3050/2050), which a human must reconcile.
 *   • TRNS/SPL/ENDTRNS → historical journal entries. Each TRNS starts an entry; the TRNS
 *     line plus its SPL lines are the entry's lines (AMOUNT is debit-positive). These are
 *     classified 'journal_entry' and post as balanced entries on commit.
 *
 * Customer/vendor (CUST/VEND) sections are classified as master data ('customer'/'vendor')
 * — staged for reference, never posted here.
 */
export function parseIif(text: string): ImportResultBuilder {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const out = new ImportResultBuilder('qbd', 'iif');

  // The active header (column names) per section keyword.
  let headerKey: string | null = null;
  let header: string[] = [];
  // Transaction assembly state.
  let txnLines: Array<Record<string, string>> = [];
  let inTxn = false;
  let txnIndex = 0;

  const cellMap = (cells: string[]): Record<string, string> => {
    const m: Record<string, string> = {};
    header.forEach((h, i) => {
      m[h] = cells[i] ?? '';
    });
    return m;
  };

  const flushTxn = () => {
    if (txnLines.length === 0) return;
    emitIifTransaction(out, txnLines, txnIndex);
    txnIndex += 1;
    txnLines = [];
  };

  for (const rawLine of lines) {
    if (!rawLine.trim()) continue;
    const cells = rawLine.split('\t');
    const first = (cells[0] ?? '').trim();

    if (first.startsWith('!')) {
      // A section header. First cell is "!KEYWORD"; the rest name the columns.
      headerKey = first.slice(1).toUpperCase();
      header = cells.map((c, i) => (i === 0 ? c.slice(1).trim().toUpperCase() : c.trim().toUpperCase()));
      continue;
    }
    if (!headerKey) continue; // data before any header — ignore.

    const keyword = first.toUpperCase();

    if (keyword === 'TRNS') {
      flushTxn(); // a new TRNS without ENDTRNS closes the prior one defensively.
      inTxn = true;
      txnLines = [cellMap(cells)];
      continue;
    }
    if (keyword === 'SPL') {
      if (inTxn) txnLines.push(cellMap(cells));
      continue;
    }
    if (keyword === 'ENDTRNS') {
      flushTxn();
      inTxn = false;
      continue;
    }

    // A plain data row belongs to the current section (ACCNT / CUST / VEND / …).
    const row = cellMap(cells);
    if (headerKey === 'ACCNT') {
      emitIifAccount(out, row);
    } else if (headerKey === 'CUST') {
      emitMaster(out, 'customer', row, ['NAME', 'CUSTOMER']);
    } else if (headerKey === 'VEND') {
      emitMaster(out, 'vendor', row, ['NAME', 'VENDOR']);
    }
    // Other sections (CLASS, ITEM, …) are out of scope → ignored (not 'unsupported'
    // noise; only rows we recognize are staged).
  }
  flushTxn(); // trailing transaction with no ENDTRNS.

  out.assertNonEmpty('No usable ACCNT or TRNS rows found in the IIF file.');
  return out;
}

function emitIifAccount(out: ImportResultBuilder, row: Record<string, string>): void {
  const name = clean(row.NAME);
  if (!name) return;
  const typeStr = clean(row.ACCNTTYPE);
  out.addSourceAccount({
    sourceAccountKey: name,
    sourceAccountName: name,
    sourceAccountType: typeStr,
  });

  const obCents = parseCents(row.OBAMOUNT);
  if (obCents == null || obCents === 0) return; // no opening balance → master only.
  const cls = classifyAccountType(typeStr) ?? ASSET;
  const ob = openingBalanceFromSigned(obCents, cls);
  out.addRecord({
    entityType: 'opening_balance',
    raw: { ...row },
    mapped: { targetAccountId: '', ...ob, sourceAccountKey: name, memo: `Opening balance (IIF): ${name}` },
    sourceAccountKey: name,
    sourceAccountName: name,
    sourceAccountType: typeStr,
  });
}

function emitIifTransaction(
  out: ImportResultBuilder,
  txnLines: Array<Record<string, string>>,
  index: number
): void {
  // Build the mapped journal-entry: one line per TRNS/SPL row. AMOUNT is debit-positive.
  const head = txnLines[0];
  const memo = clean(head.MEMO) ?? clean(head.DOCNUM) ?? `Imported (IIF) ${clean(head.TRNSTYPE) ?? 'transaction'}`;
  const mappedLines: MappedJournalLine[] = [];
  for (const ln of txnLines) {
    const acct = clean(ln.ACCNT);
    if (acct) {
      out.addSourceAccount({ sourceAccountKey: acct, sourceAccountName: acct, sourceAccountType: null });
    }
    const cents = parseCents(ln.AMOUNT);
    if (cents == null || cents === 0) continue;
    mappedLines.push({
      // accountId is bound from the account map at the resolve step using sourceAccountKey;
      // it stays '' until then (a 'ready' batch has all line accountIds resolved to UUIDs).
      accountId: '',
      sourceAccountKey: acct,
      debitCents: cents > 0 ? cents : 0,
      creditCents: cents < 0 ? -cents : 0,
      memo: clean(ln.MEMO),
    });
  }
  if (mappedLines.length < 2) {
    // A single-line (or empty) transaction cannot post a balanced entry; surface it.
    out.warn(`IIF transaction ${index + 1} has < 2 amount lines — staged but not postable as a balanced entry.`);
  }
  const mapped: MappedJournalEntry = { memo, lines: mappedLines };
  out.addRecord({
    entityType: 'journal_entry',
    raw: { lines: txnLines },
    mapped,
    sourceAccountKey: clean(head.ACCNT),
    sourceAccountName: clean(head.ACCNT),
    sourceAccountType: null,
  });
}

// ── QBO JSON export ──────────────────────────────────────────────────────────────

/**
 * Parse a QuickBooks Online JSON export. We accept several real-world shapes:
 *   • An array of entities, or an object with an entity array under a well-known key
 *     (Account / JournalEntry), or a QueryResponse wrapper.
 *   • A TrialBalance report ({ Rows: { Row: [ { ColData:[acct, debit, credit] } ] } }).
 * Anything we cannot classify becomes an 'unsupported' record (surfaced, not guessed).
 */
export function parseQboJson(text: string): ImportResultBuilder {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ImportParseError('The QBO JSON file is not valid JSON.');
  }
  const out = new ImportResultBuilder('qbo', 'qbo_json');

  // TrialBalance report shape.
  const tb = extractTrialBalanceRows(parsed);
  if (tb) {
    tb.forEach((r) => emitTrialBalanceRow(out, r.account, r.type, r.debit, r.credit));
    out.assertNonEmpty('The QBO TrialBalance report had no account rows.');
    return out;
  }

  const root = parsed as Record<string, unknown>;
  const accounts = collectEntities(root, 'Account');
  const journals = collectEntities(root, 'JournalEntry');

  if (accounts.length === 0 && journals.length === 0) {
    throw new ImportParseError(
      'Unrecognized QBO JSON: expected an Account/JournalEntry array or a TrialBalance report.'
    );
  }

  accounts.forEach((a) => emitQboAccount(out, a as Record<string, unknown>));
  journals.forEach((j, i) => emitQboJournalEntry(out, j as Record<string, unknown>, i));

  out.assertNonEmpty('No usable Account or JournalEntry records in the QBO JSON.');
  return out;
}

/** Pull an entity array out of common QBO wrappers, or [] if absent. */
function collectEntities(root: Record<string, unknown>, key: string): unknown[] {
  if (Array.isArray(root)) {
    // A bare array — keep items whose shape matches the requested entity.
    return (root as unknown[]).filter((it) => matchesEntity(it, key));
  }
  const direct = root[key];
  if (Array.isArray(direct)) return direct;
  if (direct && typeof direct === 'object') return [direct];
  // QueryResponse wrapper: { QueryResponse: { Account: [...] } }.
  const qr = root.QueryResponse as Record<string, unknown> | undefined;
  if (qr && Array.isArray(qr[key])) return qr[key] as unknown[];
  return [];
}

function matchesEntity(item: unknown, key: string): boolean {
  if (!item || typeof item !== 'object') return false;
  const o = item as Record<string, unknown>;
  if (key === 'Account') return 'AccountType' in o || 'Classification' in o || ('Name' in o && 'CurrentBalance' in o);
  if (key === 'JournalEntry') return Array.isArray(o.Line) && 'Line' in o;
  return false;
}

function emitQboAccount(out: ImportResultBuilder, a: Record<string, unknown>): void {
  const name = clean(a.Name) ?? clean(a.FullyQualifiedName);
  if (!name) return;
  const number = clean(a.AcctNum) ?? clean(a.Number);
  const typeStr = clean(a.AccountType) ?? clean(a.Classification) ?? clean(a.AccountSubType);
  const key = number ?? name;
  out.addSourceAccount({ sourceAccountKey: key, sourceAccountName: name, sourceAccountType: typeStr });

  const balCents = parseCents(a.CurrentBalance as number | string | undefined);
  if (balCents == null || balCents === 0) return;
  const cls = classifyAccountType(typeStr) ?? ASSET;
  const ob = openingBalanceFromSigned(balCents, cls);
  out.addRecord({
    entityType: 'opening_balance',
    raw: { ...a },
    mapped: { targetAccountId: '', ...ob, sourceAccountKey: key, memo: `Opening balance (QBO): ${name}` },
    sourceAccountKey: key,
    sourceAccountName: name,
    sourceAccountType: typeStr,
  });
}

function emitQboJournalEntry(out: ImportResultBuilder, j: Record<string, unknown>, index: number): void {
  const linesRaw = Array.isArray(j.Line) ? (j.Line as Array<Record<string, unknown>>) : [];
  const mappedLines: MappedJournalLine[] = [];
  for (const ln of linesRaw) {
    const detail = (ln.JournalEntryLineDetail ?? {}) as Record<string, unknown>;
    const acctRef = (detail.AccountRef ?? {}) as Record<string, unknown>;
    const acctName = clean(acctRef.name) ?? clean(acctRef.value);
    if (acctName) out.addSourceAccount({ sourceAccountKey: acctName, sourceAccountName: acctName, sourceAccountType: null });
    const cents = parseCents(ln.Amount as number | string | undefined);
    if (cents == null || cents === 0) continue;
    const posting = String(detail.PostingType ?? '').toLowerCase();
    const isDebit = posting === 'debit';
    mappedLines.push({
      accountId: '',
      sourceAccountKey: acctName,
      debitCents: isDebit ? Math.abs(cents) : 0,
      creditCents: isDebit ? 0 : Math.abs(cents),
      memo: clean(ln.Description),
    });
  }
  if (mappedLines.length < 2) {
    out.warn(`QBO JournalEntry ${index + 1} has < 2 lines — staged but not postable as a balanced entry.`);
  }
  const memo = clean(j.PrivateNote) ?? clean(j.DocNumber) ?? `Imported (QBO) journal entry`;
  out.addRecord({
    entityType: 'journal_entry',
    raw: { ...j },
    mapped: { memo, lines: mappedLines },
    sourceAccountKey: null,
  });
}

/** Extract `[ {account,type,debit,credit} ]` from a QBO TrialBalance report, or null. */
function extractTrialBalanceRows(
  parsed: unknown
): Array<{ account: string; type: string | null; debit: string | null; credit: string | null }> | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const root = parsed as Record<string, unknown>;
  const header = root.Header as Record<string, unknown> | undefined;
  const isTb = clean(header?.ReportName)?.toLowerCase().includes('trial balance');
  const rowsContainer = root.Rows as Record<string, unknown> | undefined;
  const rowArr = rowsContainer && Array.isArray(rowsContainer.Row) ? (rowsContainer.Row as unknown[]) : null;
  if (!rowArr) return null;
  if (!isTb && !rowArr.some((r) => Array.isArray((r as Record<string, unknown>).ColData))) return null;

  const out: Array<{ account: string; type: string | null; debit: string | null; credit: string | null }> = [];
  const walk = (rows: unknown[]) => {
    for (const r of rows) {
      const ro = r as Record<string, unknown>;
      const col = ro.ColData as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(col) && col.length >= 3) {
        const account = clean(col[0]?.value);
        if (account) {
          out.push({
            account,
            type: null,
            debit: clean(col[1]?.value),
            credit: clean(col[2]?.value),
          });
        }
      }
      const sub = ro.Rows as Record<string, unknown> | undefined;
      if (sub && Array.isArray(sub.Row)) walk(sub.Row as unknown[]);
    }
  };
  walk(rowArr);
  return out.length > 0 ? out : null;
}

// ── QBO CSV / generic delimited ──────────────────────────────────────────────────

/** Column-name synonyms (lower-cased, non-alphanumerics stripped) → logical field. */
const CSV_HEADERS: Record<string, 'account' | 'number' | 'type' | 'debit' | 'credit' | 'balance' | 'name'> = {
  account: 'account',
  accountname: 'account',
  glaccount: 'account',
  name: 'name',
  number: 'number',
  acctnum: 'number',
  accountnumber: 'number',
  accountno: 'number',
  no: 'number',
  type: 'type',
  accounttype: 'type',
  debit: 'debit',
  debits: 'debit',
  credit: 'credit',
  credits: 'credit',
  balance: 'balance',
  amount: 'balance',
  currentbalance: 'balance',
  openingbalance: 'balance',
};

const normHeader = (h: string): string => h.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Parse a delimited (CSV/TSV) chart-of-accounts / trial-balance export. Auto-detects the
 * delimiter, requires a header naming at least an account/name column and either a
 * Debit/Credit pair or a single Balance/Amount column, and supports quoted fields.
 *
 * Each row becomes a ParsedSourceAccount; a non-zero balance also yields an
 * 'opening_balance' record. Debit/Credit are positive magnitudes (debit−credit = signed
 * debit-positive amount); a single Balance is debit-positive unless its Type is
 * credit-normal, in which case the same magnitude is placed on the credit side.
 */
export function parseDelimited(text: string, detail: ImportSourceDetail): ImportResultBuilder {
  const out = new ImportResultBuilder(sourceForDetail(detail), detail);
  const rows = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const nonEmpty = rows.filter((r) => r.trim() !== '');
  if (nonEmpty.length < 2) {
    throw new ImportParseError('CSV file has no data rows (need a header plus at least one row).');
  }
  const delimiter = detectDelimiter(nonEmpty[0]);
  const header = parseLine(nonEmpty[0], delimiter).map(normHeader);

  const col: Partial<Record<'account' | 'number' | 'type' | 'debit' | 'credit' | 'balance' | 'name', number>> = {};
  header.forEach((h, i) => {
    const logical = CSV_HEADERS[h];
    if (logical && col[logical] === undefined) col[logical] = i;
  });

  const acctCol = col.account ?? col.name;
  if (acctCol === undefined) {
    throw new ImportParseError('CSV is missing a recognizable account column (e.g. "Account" or "Name").');
  }
  const hasDebitCredit = col.debit !== undefined || col.credit !== undefined;
  const hasBalance = col.balance !== undefined;
  if (!hasDebitCredit && !hasBalance) {
    throw new ImportParseError('CSV is missing a Debit/Credit pair or a Balance/Amount column.');
  }

  for (let r = 1; r < nonEmpty.length; r++) {
    const cells = parseLine(nonEmpty[r], delimiter);
    const at = (i: number | undefined): string | null => (i === undefined ? null : clean(cells[i]));
    const account = at(acctCol);
    if (!account) continue;
    const lower = account.toLowerCase();
    // Skip subtotal / total summary rows a TB export interleaves.
    if (lower === 'total' || lower.startsWith('total ') || lower.startsWith('total for')) continue;

    const number = at(col.number);
    const typeStr = at(col.type);
    const key = number ?? account;
    out.addSourceAccount({ sourceAccountKey: key, sourceAccountName: account, sourceAccountType: typeStr });

    emitTrialBalanceRow(out, account, typeStr, at(col.debit), at(col.credit), {
      balance: at(col.balance),
      key,
      number,
    });
  }

  out.assertNonEmpty('No account rows could be read from the CSV.');
  return out;
}

/**
 * Emit one opening-balance record from a (debit, credit) pair or a single balance. Shared
 * by the QBO TrialBalance JSON path and the delimited path. A zero net is master-only.
 */
function emitTrialBalanceRow(
  out: ImportResultBuilder,
  account: string,
  typeStr: string | null,
  debitRaw: string | null,
  creditRaw: string | null,
  extra?: { balance: string | null; key: string; number: string | null }
): void {
  out.addSourceAccount({
    sourceAccountKey: extra?.key ?? account,
    sourceAccountName: account,
    sourceAccountType: typeStr,
  });

  const debit = parseCents(debitRaw) ?? 0;
  const credit = parseCents(creditRaw) ?? 0;
  let debitCents = Math.abs(debit);
  let creditCents = Math.abs(credit);

  if (debitCents === 0 && creditCents === 0 && extra) {
    // No D/C columns populated — fall back to a single signed Balance.
    const balCents = parseCents(extra.balance);
    if (balCents == null || balCents === 0) return;
    const cls = classifyAccountType(typeStr);
    const ob = openingBalanceFromSigned(balCents, cls ?? ASSET);
    debitCents = ob.debitCents;
    creditCents = ob.creditCents;
    out.addRecord({
      entityType: 'opening_balance',
      raw: { account, type: typeStr, balance: extra.balance, number: extra.number },
      mapped: {
        targetAccountId: '',
        debitCents,
        creditCents,
        offset: ob.offset,
        sourceAccountKey: extra.key,
        memo: `Opening balance: ${account}`,
      },
      sourceAccountKey: extra.key,
      sourceAccountName: account,
      sourceAccountType: typeStr,
    });
    return;
  }

  if (debitCents === 0 && creditCents === 0) return; // truly zero row → master only.

  // A row should not carry both a debit and a credit; if it does, net them (debit-positive).
  if (debitCents > 0 && creditCents > 0) {
    const net = debitCents - creditCents;
    debitCents = net > 0 ? net : 0;
    creditCents = net < 0 ? -net : 0;
    if (debitCents === 0 && creditCents === 0) return;
  }

  const cls = classifyAccountType(typeStr);
  const offset = cls?.type === 'liability' ? 'liability' : 'equity';
  const srcKey = extra?.key ?? account;
  out.addRecord({
    entityType: 'opening_balance',
    raw: { account, type: typeStr, debit: debitRaw, credit: creditRaw },
    mapped: {
      targetAccountId: '',
      debitCents,
      creditCents,
      offset,
      sourceAccountKey: srcKey,
      memo: `Opening balance: ${account}`,
    },
    sourceAccountKey: srcKey,
    sourceAccountName: account,
    sourceAccountType: typeStr,
  });
}

function emitMaster(
  out: ImportResultBuilder,
  entityType: ImportEntityType,
  row: Record<string, string>,
  nameKeys: string[]
): void {
  const name = nameKeys.map((k) => clean(row[k])).find((v) => v != null);
  if (!name) return;
  out.addRecord({ entityType, raw: { ...row }, mapped: null, sourceAccountKey: null });
}

// ── Delimited helpers (same robust CSV reader as bankImportParsers) ──────────────

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

// ── Result builder ───────────────────────────────────────────────────────────────

/**
 * Accumulates records + distinct source accounts + warnings while a parser runs, then
 * finalizes to an ImportParseResult (stamping a stable contentHash + sortOrder per
 * record). Distinct source accounts are de-duplicated by key (first occurrence wins).
 */
export class ImportResultBuilder {
  private records: Array<Omit<ParsedImportRecord, 'contentHash' | 'sortOrder'>> = [];
  private accounts = new Map<string, ParsedSourceAccount>();
  readonly warnings: string[] = [];

  constructor(
    private readonly source: ImportSource,
    private readonly sourceDetail: ImportSourceDetail
  ) {}

  addRecord(rec: Omit<ParsedImportRecord, 'contentHash' | 'sortOrder'>): void {
    this.records.push(rec);
  }

  addSourceAccount(acct: ParsedSourceAccount): void {
    if (!acct.sourceAccountKey) return;
    if (!this.accounts.has(acct.sourceAccountKey)) {
      this.accounts.set(acct.sourceAccountKey, acct);
    } else {
      // Backfill a name/type if the first sighting lacked it.
      const existing = this.accounts.get(acct.sourceAccountKey)!;
      if (!existing.sourceAccountName && acct.sourceAccountName) existing.sourceAccountName = acct.sourceAccountName;
      if (!existing.sourceAccountType && acct.sourceAccountType) existing.sourceAccountType = acct.sourceAccountType;
    }
  }

  warn(message: string): void {
    this.warnings.push(message);
  }

  assertNonEmpty(message: string): void {
    if (this.records.length === 0 && this.accounts.size === 0) {
      throw new ImportParseError(message);
    }
  }

  build(): ImportParseResult {
    const records: ParsedImportRecord[] = this.records.map((rec, i) => ({
      ...rec,
      sortOrder: i,
      contentHash: contentHashFor(rec.entityType, hashIdentity(rec), i),
    }));
    return {
      source: this.source,
      sourceDetail: this.sourceDetail,
      records,
      sourceAccounts: Array.from(this.accounts.values()),
      warnings: this.warnings,
    };
  }
}

/** The fields that define a record's identity for dedup (kept small + stable). */
function hashIdentity(rec: Omit<ParsedImportRecord, 'contentHash' | 'sortOrder'>): Record<string, unknown> {
  return {
    e: rec.entityType,
    a: rec.sourceAccountKey ?? null,
    m: rec.mapped ?? null,
  };
}

/** Convenience: parse and finalize in one call (the public entry the service uses). */
export function parseImport(text: string, fileName?: string): ImportParseResult {
  const detail = detectImportShape(text, fileName);
  let builder: ImportResultBuilder;
  switch (detail) {
    case 'iif':
      builder = parseIif(text);
      break;
    case 'qbo_json':
      builder = parseQboJson(text);
      break;
    default:
      builder = parseDelimited(text, detail);
      break;
  }
  return builder.build();
}

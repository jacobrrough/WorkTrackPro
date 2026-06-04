/**
 * Turns a QuickBooks Online **Journal** report CSV (Reports → Journal, All Dates,
 * exported to CSV) into balanced double-entry journal entries for our general
 * ledger. This is the highest-risk importer — it writes real ledger data — so all
 * the logic lives here, pure and unit-tested, and the writer (TransactionsImport)
 * only posts entries this module has already validated as balanced.
 *
 * Pipeline: parse amounts/dates → group rows into transactions (handles QBO's
 * header-on-first-line *and* header-repeated layouts) → resolve each line's account
 * name to an account id → validate (≥2 lines, debits = credits, all accounts mapped)
 * → build a NewJournalEntryInput. A deterministic per-transaction key feeds a UUIDv5
 * source_id so re-running never double-posts (see deterministicId.ts).
 */
import type { Account, NewJournalEntryInput, NewJournalLineInput } from '../types';
import { columnTaker } from './columnDetect';
import type { AnyColumnMap } from './importKit';

// ── Value parsing ────────────────────────────────────────────────────────────

/**
 * Parse a money cell to a number rounded to cents. Handles "$1,234.56",
 * "(123.45)" / trailing- or leading-minus negatives, currency symbols, blanks.
 */
export function parseAmount(raw: string): number {
  if (!raw) return 0;
  let s = raw.trim();
  if (!s) return 0;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/-\s*$/.test(s)) {
    negative = true;
    s = s.replace(/-\s*$/, '');
  }
  if (/^\s*-/.test(s)) {
    negative = true;
    s = s.replace(/^\s*-/, '');
  }
  s = s.replace(/[^0-9.]/g, '');
  if (s === '' || s === '.') return 0;
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return 0;
  return Math.round((negative ? -n : n) * 100) / 100;
}

/** Parse a QBO date to ISO yyyy-mm-dd (no timezone shifting), or null. */
export function parseDateToIso(raw: string): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const pad = (x: string) => x.padStart(2, '0');
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/); // MM/DD/YYYY (US)
  if (m) return `${m[3]}-${pad(m[1])}-${pad(m[2])}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/); // MM/DD/YY
  if (m) return `20${m[3]}-${pad(m[1])}-${pad(m[2])}`;
  return null;
}

// ── Column detection ─────────────────────────────────────────────────────────

export function autoDetectLedgerColumns(headers: string[]): AnyColumnMap {
  const { map, take, takeExact } = columnTaker(headers);
  takeExact('date', ['date', 'transactiondate', 'txndate']);
  take('date', (c) => c.n.includes('date'));
  takeExact('type', ['transactiontype', 'txntype', 'type']);
  take('type', (c) => c.n.includes('transactiontype') || c.n === 'type');
  takeExact('num', ['num', 'number', 'docnum', 'refnumber', 'referencenumber', 'refno']);
  take('num', (c) => c.n === 'num' || c.n.includes('docnum'));
  takeExact('name', ['name', 'payee', 'customervendor', 'namecustomervendor']);
  take('name', (c) => c.n === 'name' || c.n.includes('payee'));
  takeExact('account', ['account', 'accountname', 'accountfullname']);
  take(
    'account',
    (c) => c.n.includes('account') && !c.n.includes('number') && !c.n.includes('type')
  );
  takeExact('debit', ['debit', 'debitamount', 'dr']);
  take('debit', (c) => c.n.includes('debit'));
  takeExact('credit', ['credit', 'creditamount', 'cr']);
  take('credit', (c) => c.n.includes('credit'));
  takeExact('memo', ['memo', 'memodescription', 'description', 'desc', 'memodesc']);
  take('memo', (c) => c.n.includes('memo') || c.n.includes('description'));
  return map;
}

// ── Grouping ─────────────────────────────────────────────────────────────────

export interface RawLedgerLine {
  rowNumber: number;
  account: string;
  debit: number;
  credit: number;
  memo: string;
}

export interface QboTransaction {
  date: string;
  type: string;
  num: string;
  name: string;
  lines: RawLedgerLine[];
}

function isTotalRow(date: string, account: string, name: string): boolean {
  return /^total\b/i.test(account) || /^total\b/i.test(name) || /^total\b/i.test(date);
}

/**
 * Group flat rows into transactions, handling QBO's two export layouts:
 *
 *   • "header-on-first-line": each transaction's first line carries the Date and
 *     subsequent split lines have a BLANK Date. Detected by the presence of any
 *     blank-Date data row — then every dated row begins a new transaction (so two
 *     identical consecutive transactions stay distinct).
 *   • "header-repeated": every line repeats the Date/Type/Num. Detected when no
 *     data row has a blank Date — then a new transaction begins whenever the
 *     (date|type|num|name) identity changes.
 *
 * Each kept line is sign-normalised so it never has both a debit and a credit,
 * and zero / total rows are dropped.
 */
export function groupTransactions(
  rows: Record<string, string>[],
  map: AnyColumnMap
): QboTransaction[] {
  const cell = (r: Record<string, string>, role: string) =>
    map[role] ? (r[map[role]!] ?? '').trim() : '';

  // Detect the layout: do any non-total data rows have a blank Date?
  let anyBlankDate = false;
  for (const r of rows) {
    const date = cell(r, 'date');
    const account = cell(r, 'account');
    if (isTotalRow(date, account, cell(r, 'name'))) continue;
    if (date === '' && account === '') continue; // wholly blank row
    if (date === '') {
      anyBlankDate = true;
      break;
    }
  }
  const headerOnFirstLine = anyBlankDate;

  const txns: QboTransaction[] = [];
  let current: QboTransaction | null = null;
  let currentKey: string | null = null;

  rows.forEach((r, i) => {
    const rowNumber = i + 2;
    const date = cell(r, 'date');
    const type = cell(r, 'type');
    const num = cell(r, 'num');
    const name = cell(r, 'name');
    const account = cell(r, 'account');
    const memo = cell(r, 'memo');
    const debit = parseAmount(cell(r, 'debit'));
    const credit = parseAmount(cell(r, 'credit'));

    if (isTotalRow(date, account, name)) return;

    if (headerOnFirstLine) {
      if (date !== '') {
        if (current) txns.push(current);
        current = { date, type, num, name, lines: [] };
      }
      // a blank-Date row continues the current transaction
    } else {
      const idKey = `${date}|${type}|${num}|${name}`;
      if (current === null || idKey !== currentKey) {
        if (current) txns.push(current);
        current = { date, type, num, name, lines: [] };
        currentKey = idKey;
      }
    }
    if (!current) return; // continuation line with no preceding header — skip

    const net = Math.round((debit - credit) * 100) / 100;
    if (account !== '' && net !== 0) {
      current.lines.push({
        rowNumber,
        account,
        debit: net > 0 ? net : 0,
        credit: net < 0 ? -net : 0,
        memo,
      });
    }
  });
  if (current) txns.push(current);
  return txns;
}

// ── Account / party resolution ───────────────────────────────────────────────

/** trim + lowercase + collapse internal whitespace. */
export function normName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

export interface AccountLookup {
  byName: Map<string, string>;
  byLeaf: Map<string, string>; // only leaves that are unambiguous across the COA
  byNumber: Map<string, string>;
}

export function buildAccountLookup(accounts: Account[]): AccountLookup {
  const byName = new Map<string, string>();
  const byNumber = new Map<string, string>();
  const leafFirst = new Map<string, string>();
  const leafCount = new Map<string, number>();
  for (const a of accounts) {
    byName.set(normName(a.name), a.id);
    if (a.accountNumber) byNumber.set(a.accountNumber.trim(), a.id);
    const leaf = normName(a.name.split(':').pop() ?? a.name);
    leafCount.set(leaf, (leafCount.get(leaf) ?? 0) + 1);
    if (!leafFirst.has(leaf)) leafFirst.set(leaf, a.id);
  }
  const byLeaf = new Map<string, string>();
  for (const [leaf, id] of leafFirst) {
    if (leafCount.get(leaf) === 1) byLeaf.set(leaf, id);
  }
  return { byName, byLeaf, byNumber };
}

/**
 * Resolve a QBO account label to an account id. Tries, in order: a manual
 * override, a leading "1000 Name" account number, the full normalised name, the
 * sub-account leaf ("Utilities:Gas" → "Gas"), and the leaf with a number prefix
 * stripped. Returns null when nothing matches (the caller flags the transaction).
 */
export function resolveAccountId(
  rawName: string,
  lookup: AccountLookup,
  overrides?: Record<string, string>
): string | null {
  const norm = normName(rawName);
  if (overrides && overrides[norm]) return overrides[norm];

  const numMatch = rawName.trim().match(/^(\d{2,})\s+(.+)$/);
  if (numMatch && lookup.byNumber.has(numMatch[1])) return lookup.byNumber.get(numMatch[1])!;

  if (lookup.byName.has(norm)) return lookup.byName.get(norm)!;

  const leaf = normName(rawName.split(':').pop() ?? rawName);
  if (lookup.byName.has(leaf)) return lookup.byName.get(leaf)!;
  if (lookup.byLeaf.has(leaf)) return lookup.byLeaf.get(leaf)!;

  const leafNoNum = leaf.replace(/^\d{2,}\s+/, '');
  if (leafNoNum !== leaf && lookup.byName.has(leafNoNum)) return lookup.byName.get(leafNoNum)!;

  return null;
}

export type PartyLookup = Map<string, string>; // normName(displayName) -> id

export function buildPartyLookup(parties: { id: string; displayName: string }[]): PartyLookup {
  const m = new Map<string, string>();
  for (const p of parties)
    if (!m.has(normName(p.displayName))) m.set(normName(p.displayName), p.id);
  return m;
}

/** Best-effort customer/vendor dimension from the transaction Name + type. */
export function pickParty(
  name: string,
  type: string,
  customers?: PartyLookup,
  vendors?: PartyLookup
): { customerId?: string; vendorId?: string } {
  if (!name) return {};
  const n = normName(name);
  const c = customers?.get(n);
  const v = vendors?.get(n);
  const t = type.toLowerCase();
  const prefersVendor = /bill|vendor|check|expense|purchase/.test(t);
  const prefersCustomer = /invoice|sales|receipt|payment|deposit|refund|credit memo/.test(t);
  if (prefersVendor && v) return { vendorId: v };
  if (prefersCustomer && c) return { customerId: c };
  if (c) return { customerId: c };
  if (v) return { vendorId: v };
  return {};
}

// ── Preparation + validation ─────────────────────────────────────────────────

export type EntryStatus =
  | 'ready'
  | 'empty'
  | 'too-few-lines'
  | 'unbalanced'
  | 'unmapped'
  | 'bad-date';

export interface PreparedLine {
  account: string;
  accountId: string | null;
  debit: number;
  credit: number;
  memo: string;
}

export interface PreparedEntry {
  index: number;
  date: string;
  dateIso: string | null;
  type: string;
  num: string;
  name: string;
  lines: PreparedLine[];
  totalDebit: number;
  totalCredit: number;
  difference: number; // debit − credit, rounded to cents
  unmappedAccounts: string[];
  status: EntryStatus;
  /** Stable idempotency key (content-addressed; deterministic across re-imports). */
  key: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function stableKey(txn: QboTransaction, dateIso: string | null): string {
  const lineSig = txn.lines
    .map((l) => `${normName(l.account)}:${l.debit}:${l.credit}`)
    .sort()
    .join(';');
  return `${dateIso ?? txn.date}|${normName(txn.type)}|${txn.num.trim()}|${normName(txn.name)}||${lineSig}`;
}

export interface PrepareOptions {
  accountOverrides?: Record<string, string>;
}

/** Resolve, validate, and assign a stable key to every grouped transaction. */
export function prepareLedgerEntries(
  txns: QboTransaction[],
  lookup: AccountLookup,
  opts: PrepareOptions = {}
): PreparedEntry[] {
  const keyCounts = new Map<string, number>();

  return txns.map((txn, index) => {
    const dateIso = parseDateToIso(txn.date);
    const unmapped: string[] = [];
    const lines: PreparedLine[] = txn.lines.map((l) => {
      const accountId = resolveAccountId(l.account, lookup, opts.accountOverrides);
      if (!accountId && !unmapped.includes(l.account)) unmapped.push(l.account);
      return { account: l.account, accountId, debit: l.debit, credit: l.credit, memo: l.memo };
    });

    const totalDebit = round2(lines.reduce((s, l) => s + l.debit, 0));
    const totalCredit = round2(lines.reduce((s, l) => s + l.credit, 0));
    const difference = round2(totalDebit - totalCredit);

    let status: EntryStatus;
    if (lines.length === 0) status = 'empty';
    else if (!dateIso) status = 'bad-date';
    else if (unmapped.length > 0) status = 'unmapped';
    else if (lines.length < 2) status = 'too-few-lines';
    else if (difference !== 0) status = 'unbalanced';
    else status = 'ready';

    // De-duplicate identical keys within one file (true in-file duplicates) by
    // appending an occurrence index, kept deterministic by file order.
    const baseKey = stableKey(txn, dateIso);
    const seen = keyCounts.get(baseKey) ?? 0;
    keyCounts.set(baseKey, seen + 1);
    const key = seen === 0 ? baseKey : `${baseKey}#${seen}`;

    return {
      index,
      date: txn.date,
      dateIso,
      type: txn.type,
      num: txn.num,
      name: txn.name,
      lines,
      totalDebit,
      totalCredit,
      difference,
      unmappedAccounts: unmapped,
      status,
      key,
    };
  });
}

export interface BuildEntryOptions {
  sourceId?: string | null;
  customers?: PartyLookup;
  vendors?: PartyLookup;
}

/** Build a postable NewJournalEntryInput from a 'ready' entry. Returns null otherwise. */
export function toNewJournalEntryInput(
  entry: PreparedEntry,
  opts: BuildEntryOptions = {}
): NewJournalEntryInput | null {
  if (entry.status !== 'ready' || !entry.dateIso) return null;
  const party = pickParty(entry.name, entry.type, opts.customers, opts.vendors);
  const lines: NewJournalLineInput[] = entry.lines.map((l) => ({
    accountId: l.accountId as string,
    debit: l.debit,
    credit: l.credit,
    lineMemo: l.memo || null,
    customerId: party.customerId ?? null,
    vendorId: party.vendorId ?? null,
  }));
  const memoBits = [entry.type, entry.num ? `#${entry.num}` : '', entry.name]
    .map((b) => b.trim())
    .filter(Boolean);
  return {
    entryDate: entry.dateIso,
    memo: memoBits.join(' · ') || null,
    sourceType: 'import',
    sourceId: opts.sourceId ?? null,
    lines,
  };
}

export interface LedgerSummary {
  total: number;
  ready: number;
  unbalanced: number;
  unmapped: number;
  tooFewLines: number;
  empty: number;
  badDate: number;
  unmappedAccountNames: string[];
}

export function summarizeEntries(entries: PreparedEntry[]): LedgerSummary {
  const unmappedNames = new Set<string>();
  const s: LedgerSummary = {
    total: entries.length,
    ready: 0,
    unbalanced: 0,
    unmapped: 0,
    tooFewLines: 0,
    empty: 0,
    badDate: 0,
    unmappedAccountNames: [],
  };
  for (const e of entries) {
    if (e.status === 'ready') s.ready += 1;
    else if (e.status === 'unbalanced') s.unbalanced += 1;
    else if (e.status === 'unmapped') {
      s.unmapped += 1;
      e.unmappedAccounts.forEach((a) => unmappedNames.add(a));
    } else if (e.status === 'too-few-lines') s.tooFewLines += 1;
    else if (e.status === 'empty') s.empty += 1;
    else if (e.status === 'bad-date') s.badDate += 1;
  }
  s.unmappedAccountNames = [...unmappedNames];
  return s;
}

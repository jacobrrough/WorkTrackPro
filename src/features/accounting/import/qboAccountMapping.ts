/**
 * Maps a QuickBooks Online Chart-of-Accounts export into our internal account
 * model (accounting.accounts). Two concerns live here, both pure + unit-tested:
 *
 *  1. classifyQboAccount() — turn QBO's "Type" / "Detail Type" text into our
 *     {accountType, accountSubtype, normalBalance} triple.
 *  2. autoDetectColumns() + buildAccountRows() — figure out which CSV columns
 *     hold the name / number / type, and turn each row into a previewable
 *     import row (with a `problem` string when it can't be imported as-is).
 *
 * Keeping this UI-free means the column/type logic is tested without React.
 */
import type { Account, AccountType, NewAccountInput, NormalBalance } from '../types';

/** The accounting.accounts.account_subtype CHECK enum (see the COA migration). */
export type AccountSubtype =
  | 'bank'
  | 'accounts_receivable'
  | 'other_current_asset'
  | 'inventory'
  | 'fixed_asset'
  | 'accumulated_depreciation'
  | 'other_asset'
  | 'accounts_payable'
  | 'credit_card'
  | 'other_current_liability'
  | 'long_term_liability'
  | 'equity'
  | 'income'
  | 'other_income'
  | 'cost_of_goods_sold'
  | 'expense'
  | 'other_expense';

export interface AccountClassification {
  accountType: AccountType;
  accountSubtype: AccountSubtype;
  normalBalance: NormalBalance;
}

/** Canonical {type, subtype, normalBalance} for every subtype we support. */
const CLASSIFICATION: Record<AccountSubtype, AccountClassification> = {
  bank: { accountType: 'asset', accountSubtype: 'bank', normalBalance: 'debit' },
  accounts_receivable: {
    accountType: 'asset',
    accountSubtype: 'accounts_receivable',
    normalBalance: 'debit',
  },
  other_current_asset: {
    accountType: 'asset',
    accountSubtype: 'other_current_asset',
    normalBalance: 'debit',
  },
  inventory: { accountType: 'asset', accountSubtype: 'inventory', normalBalance: 'debit' },
  fixed_asset: { accountType: 'asset', accountSubtype: 'fixed_asset', normalBalance: 'debit' },
  // Contra-asset: lives under assets but carries a credit balance.
  accumulated_depreciation: {
    accountType: 'asset',
    accountSubtype: 'accumulated_depreciation',
    normalBalance: 'credit',
  },
  other_asset: { accountType: 'asset', accountSubtype: 'other_asset', normalBalance: 'debit' },
  accounts_payable: {
    accountType: 'liability',
    accountSubtype: 'accounts_payable',
    normalBalance: 'credit',
  },
  credit_card: { accountType: 'liability', accountSubtype: 'credit_card', normalBalance: 'credit' },
  other_current_liability: {
    accountType: 'liability',
    accountSubtype: 'other_current_liability',
    normalBalance: 'credit',
  },
  long_term_liability: {
    accountType: 'liability',
    accountSubtype: 'long_term_liability',
    normalBalance: 'credit',
  },
  equity: { accountType: 'equity', accountSubtype: 'equity', normalBalance: 'credit' },
  income: { accountType: 'income', accountSubtype: 'income', normalBalance: 'credit' },
  other_income: { accountType: 'income', accountSubtype: 'other_income', normalBalance: 'credit' },
  cost_of_goods_sold: {
    accountType: 'expense',
    accountSubtype: 'cost_of_goods_sold',
    normalBalance: 'debit',
  },
  expense: { accountType: 'expense', accountSubtype: 'expense', normalBalance: 'debit' },
  other_expense: {
    accountType: 'expense',
    accountSubtype: 'other_expense',
    normalBalance: 'debit',
  },
};

/** Lowercase + strip every non-alphanumeric, so "Other Current Assets" === "othercurrentasset(s)". */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Classify a QBO account from its "Type" (primary) and optional "Detail Type".
 * Detail Type disambiguates a couple of cases that share a top-level Type with
 * their siblings (Accumulated Depreciation, Inventory). Returns null when the
 * type text is unrecognised — the caller then asks the user to pick a type.
 */
export function classifyQboAccount(qboType: string, detailType = ''): AccountClassification | null {
  const t = norm(qboType);
  const d = norm(detailType);

  // Detail-type refinements first — they pin down a specific subtype.
  if (d.includes('accumulateddepreciation')) return CLASSIFICATION.accumulated_depreciation;
  if (d === 'inventory' || d.includes('inventoryasset')) return CLASSIFICATION.inventory;

  // High-level QBO Type buckets. Order matters: more specific patterns
  // ("otherincome", "othercurrentasset") must precede their generic siblings
  // ("income", "otherasset").
  const byType: Array<[RegExp, AccountSubtype]> = [
    [/^bank/, 'bank'],
    [/^creditcard/, 'credit_card'],
    [/accountsreceivable|^ar$/, 'accounts_receivable'],
    [/accountspayable|^ap$/, 'accounts_payable'],
    [/othercurrentasset/, 'other_current_asset'],
    [/fixedasset/, 'fixed_asset'],
    [/otherasset/, 'other_asset'],
    [/othercurrentliabilit/, 'other_current_liability'],
    [/longtermliabilit/, 'long_term_liability'],
    [/costofgoodssold|^cogs$/, 'cost_of_goods_sold'],
    [/otherincome/, 'other_income'],
    [/otherexpense/, 'other_expense'],
    [/equity/, 'equity'],
    [/income|revenue|sales/, 'income'],
    [/expense/, 'expense'],
  ];
  for (const [re, sub] of byType) {
    if (re.test(t)) return CLASSIFICATION[sub];
  }
  return null;
}

/** A sensible default classification when the user picks only a top-level type. */
export function defaultClassification(type: AccountType): AccountClassification {
  switch (type) {
    case 'asset':
      return CLASSIFICATION.other_current_asset;
    case 'liability':
      return CLASSIFICATION.other_current_liability;
    case 'equity':
      return CLASSIFICATION.equity;
    case 'income':
      return CLASSIFICATION.income;
    case 'expense':
      return CLASSIFICATION.expense;
  }
}

// ── Column detection ─────────────────────────────────────────────────────────

export type ColumnRole = 'number' | 'name' | 'type' | 'detailType' | 'description';
export type ColumnMap = Partial<Record<ColumnRole, string>>;

interface Col {
  raw: string;
  n: string;
  lower: string;
}

/**
 * Best-effort guess of which header holds each role. QBO's own export labels the
 * number column "Account #" and the name column "Account" — after normalisation
 * both collapse toward "account", so number detection keys off the literal "#"
 * and type/detail are claimed before name to avoid "Account Type" being grabbed
 * as the name. Every guess is overridable in the UI.
 */
export function autoDetectColumns(headers: string[]): ColumnMap {
  const map: ColumnMap = {};
  const used = new Set<string>();
  const cols: Col[] = headers.map((h) => ({ raw: h, n: norm(h), lower: h.toLowerCase() }));

  const take = (role: ColumnRole, pred: (c: Col) => boolean) => {
    if (map[role]) return;
    const m = cols.find((c) => !used.has(c.raw) && pred(c));
    if (m) {
      map[role] = m.raw;
      used.add(m.raw);
    }
  };

  // Number: a literal "#", or an explicit number/code header.
  take('number', (c) => c.lower.includes('#'));
  take('number', (c) =>
    [
      'number',
      'accountnumber',
      'acctnumber',
      'accountno',
      'acctno',
      'code',
      'accountcode',
    ].includes(c.n)
  );
  // Detail type / type before name, so "Account Type" isn't mistaken for the name.
  take('detailType', (c) =>
    ['detailtype', 'accountdetailtype', 'subtype', 'accountsubtype'].includes(c.n)
  );
  take('detailType', (c) => c.n.includes('detailtype'));
  take('type', (c) => c.n === 'accounttype' || c.n === 'type');
  take('type', (c) => c.n.includes('type'));
  // Name last among the "account*" family.
  take('name', (c) => ['name', 'accountname', 'fullname', 'accountfullname'].includes(c.n));
  take('name', (c) => c.n === 'account');
  take('description', (c) => ['description', 'memo', 'desc', 'note', 'notes'].includes(c.n));
  take('description', (c) => c.n.includes('description'));

  return map;
}

// ── Row building ─────────────────────────────────────────────────────────────

export interface AccountImportRow {
  /** 1-based source row number (header is row 1), for human-readable errors. */
  rowNumber: number;
  name: string;
  accountNumber: string | null;
  qboType: string;
  /** null => couldn't be auto-classified; the user must pick a type. */
  classification: AccountClassification | null;
  description: string | null;
  /** Non-null => this row can't be imported as-is (shown in the preview). */
  problem: string | null;
}

/** Turn parsed CSV rows + a column map into previewable import rows. */
export function buildAccountRows(
  rows: Record<string, string>[],
  map: ColumnMap
): AccountImportRow[] {
  return rows.map((r, i) => {
    const cell = (role: ColumnRole) => (map[role] ? (r[map[role]!] ?? '').trim() : '');
    const name = cell('name');
    const accountNumber = cell('number') || null;
    const qboType = cell('type');
    const detailType = cell('detailType');
    const description = cell('description') || null;
    const classification = qboType || detailType ? classifyQboAccount(qboType, detailType) : null;

    let problem: string | null = null;
    if (!name) problem = 'Missing account name';
    else if (!classification) {
      problem = qboType ? `Unrecognised type "${qboType}"` : 'Missing account type';
    }

    return { rowNumber: i + 2, name, accountNumber, qboType, classification, description, problem };
  });
}

/** Build the create-payload for a row, or null when it isn't importable. */
export function toNewAccountInput(
  row: AccountImportRow,
  classification = row.classification
): NewAccountInput | null {
  if (!classification || !row.name) return null;
  return {
    name: row.name,
    accountNumber: row.accountNumber,
    accountType: classification.accountType,
    accountSubtype: classification.accountSubtype,
    normalBalance: classification.normalBalance,
    description: row.description,
  };
}

/**
 * Is this row already in the chart of accounts? Matches on account number when
 * present (the strong key), else on a case-insensitive name match. Keeps the
 * import idempotent — re-running never duplicates the seeded/system accounts.
 */
export function findDuplicate(row: AccountImportRow, existing: Account[]): Account | null {
  if (row.accountNumber) {
    const byNumber = existing.find(
      (a) => a.accountNumber != null && a.accountNumber === row.accountNumber
    );
    if (byNumber) return byNumber;
  }
  const n = row.name.toLowerCase();
  return existing.find((a) => a.name.toLowerCase() === n) ?? null;
}

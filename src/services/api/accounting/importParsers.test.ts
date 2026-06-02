import { describe, it, expect } from 'vitest';
import {
  ImportParseError,
  classifyAccountType,
  contentHashFor,
  detectImportShape,
  normalizeImportDate,
  openingBalanceFromSigned,
  parseCents,
  parseDelimited,
  parseIif,
  parseImport,
  parseQboJson,
  sourceForDetail,
} from './importParsers';
import type { MappedJournalEntry, MappedOpeningBalance } from '../../../features/accounting/types';

// HELD / UNVERIFIED module tests — they prove parser FIDELITY + dedup + the integer-cents
// money math. A human still verifies real-file mapping/reconciliation before enabling.

describe('parseCents', () => {
  it('reads a plain decimal into integer cents', () => {
    expect(parseCents('42.50')).toBe(4250);
  });
  it('strips currency symbols and thousands separators', () => {
    expect(parseCents('$1,234.56')).toBe(123456);
  });
  it('treats parentheses as negative', () => {
    expect(parseCents('(45.00)')).toBe(-4500);
  });
  it('handles a trailing minus and a leading minus', () => {
    expect(parseCents('45.00-')).toBe(-4500);
    expect(parseCents('-12.34')).toBe(-1234);
  });
  it('accepts a JS number directly', () => {
    expect(parseCents(19.99)).toBe(1999);
    expect(parseCents(-7)).toBe(-700);
  });
  it('avoids float drift', () => {
    // 0.1 + 0.2 style inputs must land exactly on the cent.
    expect(parseCents('1010.10')).toBe(101010);
    expect(parseCents(1010.1)).toBe(101010);
  });
  it('returns null for empty / non-numeric', () => {
    expect(parseCents('')).toBeNull();
    expect(parseCents('  ')).toBeNull();
    expect(parseCents('abc')).toBeNull();
    expect(parseCents(null)).toBeNull();
    expect(parseCents(undefined)).toBeNull();
  });
});

describe('normalizeImportDate', () => {
  it('passes through ISO', () => {
    expect(normalizeImportDate('2026-01-31')).toBe('2026-01-31');
  });
  it('reads US M/D/YYYY (QuickBooks default)', () => {
    expect(normalizeImportDate('1/31/2026')).toBe('2026-01-31');
    expect(normalizeImportDate('12/9/2025')).toBe('2025-12-09');
  });
  it('expands a 2-digit year', () => {
    expect(normalizeImportDate('1/5/26')).toBe('2026-01-05');
  });
  it('rejects an impossible date', () => {
    expect(normalizeImportDate('13/40/2026')).toBeNull();
    expect(normalizeImportDate('not a date')).toBeNull();
  });
});

describe('classifyAccountType', () => {
  it('maps IIF ACCNTTYPE codes', () => {
    expect(classifyAccountType('BANK')).toEqual({ type: 'asset', normal: 'debit' });
    expect(classifyAccountType('AP')).toEqual({ type: 'liability', normal: 'credit' });
    expect(classifyAccountType('CCARD')).toEqual({ type: 'liability', normal: 'credit' });
    expect(classifyAccountType('EQUITY')).toEqual({ type: 'equity', normal: 'credit' });
    expect(classifyAccountType('INC')).toEqual({ type: 'income', normal: 'credit' });
    expect(classifyAccountType('COGS')).toEqual({ type: 'expense', normal: 'debit' });
  });
  it('maps QBO AccountType phrases', () => {
    expect(classifyAccountType('Accounts Receivable')?.type).toBe('asset');
    expect(classifyAccountType('Accounts Payable')?.type).toBe('liability');
    expect(classifyAccountType('Cost of Goods Sold')?.type).toBe('expense');
    expect(classifyAccountType('Long Term Liabilities')?.type).toBe('liability');
    expect(classifyAccountType('Other Income')?.type).toBe('income');
    expect(classifyAccountType('Retained Earnings')?.type).toBe('equity');
  });
  it('returns null when it cannot classify (so the wizard surfaces it)', () => {
    expect(classifyAccountType('')).toBeNull();
    expect(classifyAccountType('Zxqw')).toBeNull();
    expect(classifyAccountType(null)).toBeNull();
  });
});

describe('openingBalanceFromSigned', () => {
  const ASSET = { type: 'asset', normal: 'debit' } as const;
  const LIAB = { type: 'liability', normal: 'credit' } as const;

  it('puts a positive asset balance on the debit side, offset to equity', () => {
    const ob = openingBalanceFromSigned(10000, ASSET);
    expect(ob).toEqual({ debitCents: 10000, creditCents: 0, offset: 'equity' });
  });
  it('puts a positive liability balance on the credit side, offset to liability', () => {
    const ob = openingBalanceFromSigned(40000, LIAB);
    expect(ob).toEqual({ debitCents: 0, creditCents: 40000, offset: 'liability' });
  });
  it('flips the side for a negative source amount (contra)', () => {
    const ob = openingBalanceFromSigned(-2500, ASSET);
    expect(ob).toEqual({ debitCents: 0, creditCents: 2500, offset: 'equity' });
  });
});

describe('contentHashFor (dedup key)', () => {
  it('is stable for identical identity+index', () => {
    const a = contentHashFor('opening_balance', { a: '1000', m: { debitCents: 100 } }, 0);
    const b = contentHashFor('opening_balance', { a: '1000', m: { debitCents: 100 } }, 0);
    expect(a).toBe(b);
  });
  it('is key-order independent', () => {
    const a = contentHashFor('opening_balance', { a: '1', b: '2' }, 3);
    const b = contentHashFor('opening_balance', { b: '2', a: '1' }, 3);
    expect(a).toBe(b);
  });
  it('differs for different content', () => {
    const a = contentHashFor('opening_balance', { a: '1000' }, 0);
    const b = contentHashFor('opening_balance', { a: '2000' }, 0);
    expect(a).not.toBe(b);
  });
  it('is prefixed by entity type', () => {
    expect(contentHashFor('journal_entry', { x: 1 }, 0).startsWith('journal_entry:')).toBe(true);
  });
});

describe('detectImportShape', () => {
  it('detects IIF by header keyword', () => {
    expect(detectImportShape('!ACCNT\tNAME\tACCNTTYPE\n')).toBe('iif');
  });
  it('detects IIF by extension', () => {
    expect(detectImportShape('whatever', 'export.iif')).toBe('iif');
  });
  it('detects JSON by leading brace', () => {
    expect(detectImportShape('{"Account":[]}')).toBe('qbo_json');
    expect(detectImportShape('[]', 'x.json')).toBe('qbo_json');
  });
  it('detects a QBO trial-balance CSV by Debit+Credit header', () => {
    expect(detectImportShape('Account,Debit,Credit\n')).toBe('qbo_csv');
  });
  it('falls back to generic csv', () => {
    expect(detectImportShape('Name,Balance\n')).toBe('csv');
  });
});

describe('sourceForDetail', () => {
  it('maps detail to the batch source enum', () => {
    expect(sourceForDetail('iif')).toBe('qbd');
    expect(sourceForDetail('qbo_csv')).toBe('qbo');
    expect(sourceForDetail('qbo_json')).toBe('qbo');
    expect(sourceForDetail('csv')).toBe('csv');
  });
});

// ── IIF ──────────────────────────────────────────────────────────────────────

const IIF_SAMPLE = [
  '!ACCNT\tNAME\tACCNTTYPE\tOBAMOUNT',
  'ACCNT\tChecking\tBANK\t10000.00',
  'ACCNT\tEquipment Loan\tOCLIAB\t4000.00',
  'ACCNT\tSales Income\tINC\t0.00',
  '!TRNS\tTRNSTYPE\tDATE\tACCNT\tAMOUNT\tMEMO',
  '!SPL\tTRNSTYPE\tDATE\tACCNT\tAMOUNT\tMEMO',
  'TRNS\tGENERAL JOURNAL\t1/1/2026\tChecking\t500.00\tOpening cash',
  'SPL\tGENERAL JOURNAL\t1/1/2026\tSales Income\t-500.00\tOpening sale',
  'ENDTRNS',
].join('\n');

describe('parseIif', () => {
  it('reads ACCNT rows as source accounts + non-zero OBAMOUNT as opening balances', () => {
    const res = parseIif(IIF_SAMPLE).build();
    expect(res.source).toBe('qbd');
    expect(res.sourceDetail).toBe('iif');

    const keys = res.sourceAccounts.map((a) => a.sourceAccountKey).sort();
    expect(keys).toEqual(['Checking', 'Equipment Loan', 'Sales Income']);

    const obs = res.records.filter((r) => r.entityType === 'opening_balance');
    // Checking (10000 asset, debit) + Equipment Loan (4000 liability, credit); the 0.00
    // Sales Income row yields no opening balance.
    expect(obs).toHaveLength(2);

    const checking = obs.find((r) => r.sourceAccountKey === 'Checking')!
      .mapped as MappedOpeningBalance;
    expect(checking.debitCents).toBe(1000000);
    expect(checking.creditCents).toBe(0);
    expect(checking.offset).toBe('equity');
    expect(checking.sourceAccountKey).toBe('Checking');

    const loan = obs.find((r) => r.sourceAccountKey === 'Equipment Loan')!
      .mapped as MappedOpeningBalance;
    expect(loan.creditCents).toBe(400000);
    expect(loan.debitCents).toBe(0);
    expect(loan.offset).toBe('liability');
  });

  it('reads a TRNS/SPL block as a balanced journal entry with source keys per line', () => {
    const res = parseIif(IIF_SAMPLE).build();
    const je = res.records.find((r) => r.entityType === 'journal_entry')!
      .mapped as MappedJournalEntry;
    expect(je.lines).toHaveLength(2);
    // AMOUNT is debit-positive: +500 → debit, −500 → credit.
    const debitLine = je.lines.find((l) => l.debitCents > 0)!;
    const creditLine = je.lines.find((l) => l.creditCents > 0)!;
    expect(debitLine.debitCents).toBe(50000);
    expect(debitLine.sourceAccountKey).toBe('Checking');
    expect(creditLine.creditCents).toBe(50000);
    expect(creditLine.sourceAccountKey).toBe('Sales Income');
    // The mapped entry balances at the source (Σdebit = Σcredit).
    const d = je.lines.reduce((s, l) => s + l.debitCents, 0);
    const c = je.lines.reduce((s, l) => s + l.creditCents, 0);
    expect(d).toBe(c);
  });

  it('throws on a file with no recognizable rows', () => {
    expect(() => parseIif('!CLASS\tNAME\nCLASS\tFoo\n').build()).toThrow(ImportParseError);
  });
});

// ── QBO JSON ───────────────────────────────────────────────────────────────────

describe('parseQboJson', () => {
  it('reads an Account array with CurrentBalance into opening balances', () => {
    const json = JSON.stringify({
      Account: [
        { Name: 'Checking', AcctNum: '1000', AccountType: 'Bank', CurrentBalance: 10000 },
        { Name: 'Loan', AccountType: 'Long Term Liabilities', CurrentBalance: 4000 },
        { Name: 'Sales', AccountType: 'Income', CurrentBalance: 0 },
      ],
    });
    const res = parseQboJson(json).build();
    expect(res.source).toBe('qbo');
    const obs = res.records.filter((r) => r.entityType === 'opening_balance');
    expect(obs).toHaveLength(2);
    // Account number is the source key when present.
    const checking = obs.find((r) => r.sourceAccountKey === '1000')!
      .mapped as MappedOpeningBalance;
    expect(checking.debitCents).toBe(1000000);
    const loan = obs.find((r) => r.sourceAccountKey === 'Loan')!
      .mapped as MappedOpeningBalance;
    expect(loan.creditCents).toBe(400000);
    expect(loan.offset).toBe('liability');
  });

  it('reads a JournalEntry with Debit/Credit PostingType lines', () => {
    const json = JSON.stringify({
      JournalEntry: [
        {
          PrivateNote: 'Migration JE',
          Line: [
            {
              Amount: 250.0,
              JournalEntryLineDetail: { PostingType: 'Debit', AccountRef: { name: 'Checking' } },
            },
            {
              Amount: 250.0,
              JournalEntryLineDetail: { PostingType: 'Credit', AccountRef: { name: 'Sales' } },
            },
          ],
        },
      ],
    });
    const res = parseQboJson(json).build();
    const je = res.records.find((r) => r.entityType === 'journal_entry')!
      .mapped as MappedJournalEntry;
    expect(je.memo).toBe('Migration JE');
    expect(je.lines).toHaveLength(2);
    expect(je.lines[0].debitCents).toBe(25000);
    expect(je.lines[0].sourceAccountKey).toBe('Checking');
    expect(je.lines[1].creditCents).toBe(25000);
  });

  it('reads a TrialBalance report (Rows.Row[].ColData)', () => {
    const json = JSON.stringify({
      Header: { ReportName: 'TrialBalance' },
      Rows: {
        Row: [
          { ColData: [{ value: 'Checking' }, { value: '10000.00' }, { value: '' }] },
          { ColData: [{ value: 'Opening Balance Equity' }, { value: '' }, { value: '10000.00' }] },
        ],
      },
    });
    const res = parseQboJson(json).build();
    const obs = res.records.filter((r) => r.entityType === 'opening_balance');
    expect(obs).toHaveLength(2);
    const totalDebit = obs.reduce((s, r) => s + (r.mapped as MappedOpeningBalance).debitCents, 0);
    const totalCredit = obs.reduce((s, r) => s + (r.mapped as MappedOpeningBalance).creditCents, 0);
    // A well-formed source trial balance balances.
    expect(totalDebit).toBe(totalCredit);
    expect(totalDebit).toBe(1000000);
  });

  it('throws on invalid JSON and on an unrecognized shape', () => {
    expect(() => parseQboJson('{not json').build()).toThrow(ImportParseError);
    expect(() => parseQboJson('{"Foo":[]}').build()).toThrow(ImportParseError);
  });
});

// ── CSV / generic ──────────────────────────────────────────────────────────────

describe('parseDelimited', () => {
  it('reads a Debit/Credit trial balance and balances', () => {
    const csv = [
      'Account,Type,Debit,Credit',
      'Checking,Bank,"10,000.00",',
      'Accounts Payable,Accounts Payable,,4000.00',
      'Opening Balance Equity,Equity,,6000.00',
      'Total,,10000.00,10000.00',
    ].join('\n');
    const res = parseDelimited(csv, 'qbo_csv').build();
    const obs = res.records.filter((r) => r.entityType === 'opening_balance');
    // The "Total" summary row is skipped.
    expect(obs).toHaveLength(3);
    const d = obs.reduce((s, r) => s + (r.mapped as MappedOpeningBalance).debitCents, 0);
    const c = obs.reduce((s, r) => s + (r.mapped as MappedOpeningBalance).creditCents, 0);
    expect(d).toBe(1000000);
    expect(c).toBe(1000000);
    // The AP row's offset bucket is 'liability'.
    const ap = obs.find((r) => r.sourceAccountName === 'Accounts Payable')!
      .mapped as MappedOpeningBalance;
    expect(ap.offset).toBe('liability');
    expect(ap.creditCents).toBe(400000);
  });

  it('reads a single signed Balance column with a Type for sign', () => {
    const csv = ['Name,Type,Balance', 'Checking,Bank,10000.00', 'Loan,Long Term Liability,4000.00'].join('\n');
    const res = parseDelimited(csv, 'csv').build();
    const obs = res.records.filter((r) => r.entityType === 'opening_balance');
    expect(obs).toHaveLength(2);
    const checking = obs.find((r) => r.sourceAccountName === 'Checking')!
      .mapped as MappedOpeningBalance;
    expect(checking.debitCents).toBe(1000000); // asset → debit
    const loan = obs.find((r) => r.sourceAccountName === 'Loan')!
      .mapped as MappedOpeningBalance;
    expect(loan.creditCents).toBe(400000); // liability → credit
  });

  it('throws when there is no account column', () => {
    expect(() => parseDelimited('Debit,Credit\n100,0\n', 'csv').build()).toThrow(ImportParseError);
  });
  it('throws when there is no amount/balance column', () => {
    expect(() => parseDelimited('Account\nChecking\n', 'csv').build()).toThrow(ImportParseError);
  });
});

// ── End-to-end dispatch + dedup ─────────────────────────────────────────────────

describe('parseImport (dispatch + finalize)', () => {
  it('sniffs IIF and finalizes records with stable content hashes', () => {
    const a = parseImport(IIF_SAMPLE, 'books.iif');
    const b = parseImport(IIF_SAMPLE, 'books.iif');
    expect(a.records.length).toBeGreaterThan(0);
    // Re-parsing the same file yields identical content hashes → the service dedups.
    expect(a.records.map((r) => r.contentHash)).toEqual(b.records.map((r) => r.contentHash));
  });

  it('produces all-distinct content hashes within one file', () => {
    const res = parseImport(IIF_SAMPLE, 'books.iif');
    const hashes = res.records.map((r) => r.contentHash);
    expect(new Set(hashes).size).toBe(hashes.length);
  });
});

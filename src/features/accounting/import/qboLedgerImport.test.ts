import { describe, it, expect } from 'vitest';
import type { Account } from '../types';
import { parseCsv } from './csvImport';
import {
  parseAmount,
  parseDateToIso,
  autoDetectLedgerColumns,
  groupTransactions,
  buildAccountLookup,
  resolveAccountId,
  buildPartyLookup,
  pickParty,
  prepareLedgerEntries,
  toNewJournalEntryInput,
  summarizeEntries,
} from './qboLedgerImport';

describe('parseAmount', () => {
  it.each([
    ['1,234.56', 1234.56],
    ['$1,234.56', 1234.56],
    ['(123.45)', -123.45],
    ['-50', -50],
    ['50-', -50],
    ['', 0],
    ['  ', 0],
    ['100.005', 100.01], // rounds to cents
    ['1.2', 1.2],
  ])('parses %s', (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });
});

describe('parseDateToIso', () => {
  it.each([
    ['01/15/2023', '2023-01-15'],
    ['1/5/2023', '2023-01-05'],
    ['2023-01-15', '2023-01-15'],
    ['12-31-2024', '2024-12-31'],
    ['01/15/23', '2023-01-15'],
  ])('parses %s', (input, expected) => {
    expect(parseDateToIso(input)).toBe(expected);
  });

  it('returns null for unparseable dates', () => {
    expect(parseDateToIso('')).toBeNull();
    expect(parseDateToIso('Jan 15')).toBeNull();
  });
});

describe('autoDetectLedgerColumns', () => {
  it('maps a standard QBO Journal report header', () => {
    const map = autoDetectLedgerColumns([
      'Date',
      'Transaction Type',
      'Num',
      'Name',
      'Memo/Description',
      'Account',
      'Debit',
      'Credit',
    ]);
    expect(map).toMatchObject({
      date: 'Date',
      type: 'Transaction Type',
      num: 'Num',
      name: 'Name',
      memo: 'Memo/Description',
      account: 'Account',
      debit: 'Debit',
      credit: 'Credit',
    });
  });
});

const MAP = {
  date: 'Date',
  type: 'Transaction Type',
  num: 'Num',
  name: 'Name',
  account: 'Account',
  debit: 'Debit',
  credit: 'Credit',
};

describe('groupTransactions', () => {
  it('groups the header-on-first-line layout', () => {
    const csv =
      'Date,Transaction Type,Num,Name,Account,Debit,Credit\n' +
      '01/15/2023,Invoice,1001,Acme Co,Accounts Receivable,100.00,\n' +
      ',,,,Sales Income,,100.00\n' +
      '01/16/2023,Bill,5001,Bolt Supply,Job Materials,50.00,\n' +
      ',,,,Accounts Payable,,50.00\n';
    const { rows } = parseCsv(csv);
    const txns = groupTransactions(rows, MAP);
    expect(txns).toHaveLength(2);
    expect(txns[0]).toMatchObject({ type: 'Invoice', num: '1001', name: 'Acme Co' });
    expect(txns[0].lines).toHaveLength(2);
    expect(txns[0].lines[0]).toMatchObject({
      account: 'Accounts Receivable',
      debit: 100,
      credit: 0,
    });
    expect(txns[0].lines[1]).toMatchObject({ account: 'Sales Income', debit: 0, credit: 100 });
  });

  it('groups the header-repeated layout', () => {
    const csv =
      'Date,Transaction Type,Num,Name,Account,Debit,Credit\n' +
      '01/15/2023,Invoice,1001,Acme Co,Accounts Receivable,100.00,\n' +
      '01/15/2023,Invoice,1001,Acme Co,Sales Income,,100.00\n';
    const { rows } = parseCsv(csv);
    const txns = groupTransactions(rows, MAP);
    expect(txns).toHaveLength(1);
    expect(txns[0].lines).toHaveLength(2);
  });

  it('skips total rows and drops zero lines', () => {
    const csv =
      'Date,Transaction Type,Num,Name,Account,Debit,Credit\n' +
      '01/15/2023,Invoice,1001,Acme,Accounts Receivable,100.00,0.00\n' +
      ',,,,Sales Income,,100.00\n' +
      ',,,,TOTAL,100.00,100.00\n';
    const { rows } = parseCsv(csv);
    const txns = groupTransactions(rows, MAP);
    expect(txns).toHaveLength(1);
    expect(txns[0].lines).toHaveLength(2); // total row excluded
  });

  it('normalises a negative debit into a credit', () => {
    const csv =
      'Date,Transaction Type,Num,Name,Account,Debit,Credit\n' +
      '01/15/2023,Journal,1,,Cash,-100.00,\n' +
      ',,,,Equity,100.00,\n';
    const { rows } = parseCsv(csv);
    const txns = groupTransactions(rows, MAP);
    expect(txns[0].lines[0]).toMatchObject({ account: 'Cash', debit: 0, credit: 100 });
  });
});

describe('buildAccountLookup / resolveAccountId', () => {
  const accounts = [
    { id: 'ar', name: 'Accounts Receivable', accountNumber: '1200' },
    { id: 'sales', name: 'Sales Income', accountNumber: null },
    { id: 'gas', name: 'Gas', accountNumber: null },
  ] as Account[];
  const lookup = buildAccountLookup(accounts);

  it('matches by exact name', () => {
    expect(resolveAccountId('Accounts Receivable', lookup)).toBe('ar');
    expect(resolveAccountId('  sales income ', lookup)).toBe('sales');
  });

  it('matches by a leading account number', () => {
    expect(resolveAccountId('1200 Accounts Receivable', lookup)).toBe('ar');
  });

  it('matches a sub-account by its leaf', () => {
    expect(resolveAccountId('Utilities:Gas', lookup)).toBe('gas');
  });

  it('honours an override', () => {
    expect(resolveAccountId('Mystery', lookup, { mystery: 'sales' })).toBe('sales');
  });

  it('returns null when nothing matches', () => {
    expect(resolveAccountId('Nonexistent', lookup)).toBeNull();
  });
});

describe('pickParty', () => {
  const customers = buildPartyLookup([{ id: 'c1', displayName: 'Acme Co' }]);
  const vendors = buildPartyLookup([{ id: 'v1', displayName: 'Bolt Supply' }]);

  it('stamps a customer for an invoice', () => {
    expect(pickParty('Acme Co', 'Invoice', customers, vendors)).toEqual({ customerId: 'c1' });
  });
  it('stamps a vendor for a bill', () => {
    expect(pickParty('Bolt Supply', 'Bill', customers, vendors)).toEqual({ vendorId: 'v1' });
  });
  it('returns empty when the name matches nobody', () => {
    expect(pickParty('Nobody', 'Invoice', customers, vendors)).toEqual({});
  });
});

describe('prepareLedgerEntries', () => {
  const accounts = [
    { id: 'ar', name: 'Accounts Receivable', accountNumber: null },
    { id: 'sales', name: 'Sales Income', accountNumber: null },
  ] as Account[];
  const lookup = buildAccountLookup(accounts);

  const group = (csv: string) => groupTransactions(parseCsv(csv).rows, MAP);
  const header = 'Date,Transaction Type,Num,Name,Account,Debit,Credit\n';

  it('marks a balanced, mapped, 2-line entry ready', () => {
    const txns = group(
      header +
        '01/15/2023,Invoice,1001,Acme,Accounts Receivable,100.00,\n,,,,Sales Income,,100.00\n'
    );
    const [e] = prepareLedgerEntries(txns, lookup);
    expect(e.status).toBe('ready');
    expect(e.totalDebit).toBe(100);
    expect(e.totalCredit).toBe(100);
    expect(e.difference).toBe(0);
  });

  it('flags an unbalanced entry', () => {
    const txns = group(
      header + '01/15/2023,Invoice,1001,Acme,Accounts Receivable,100.00,\n,,,,Sales Income,,90.00\n'
    );
    expect(prepareLedgerEntries(txns, lookup)[0].status).toBe('unbalanced');
  });

  it('flags an entry with an unmapped account', () => {
    const txns = group(
      header +
        '01/15/2023,Invoice,1001,Acme,Accounts Receivable,100.00,\n,,,,Mystery Acct,,100.00\n'
    );
    const [e] = prepareLedgerEntries(txns, lookup);
    expect(e.status).toBe('unmapped');
    expect(e.unmappedAccounts).toEqual(['Mystery Acct']);
  });

  it('flags a single-line entry as too-few-lines', () => {
    const txns = group(header + '01/15/2023,Journal,1,,Accounts Receivable,100.00,\n');
    expect(prepareLedgerEntries(txns, lookup)[0].status).toBe('too-few-lines');
  });

  it('flags a bad date', () => {
    const txns = group(
      header + 'Jan 15,Invoice,1001,Acme,Accounts Receivable,100.00,\n,,,,Sales Income,,100.00\n'
    );
    // "Jan 15" is not a parseable date and also won't start a transaction (date cell
    // is non-empty though), so it groups; date parse fails -> bad-date.
    const prepared = prepareLedgerEntries(txns, lookup);
    expect(prepared[0].status).toBe('bad-date');
  });

  it('gives identical transactions distinct keys (in-file duplicates)', () => {
    const txns = group(
      header +
        '01/15/2023,Invoice,1001,Acme,Accounts Receivable,100.00,\n,,,,Sales Income,,100.00\n' +
        '01/15/2023,Invoice,1001,Acme,Accounts Receivable,100.00,\n,,,,Sales Income,,100.00\n'
    );
    const [a, b] = prepareLedgerEntries(txns, lookup);
    expect(a.key).not.toBe(b.key);
    expect(b.key.endsWith('#1')).toBe(true);
  });

  it('produces a stable key across re-imports of the same data', () => {
    const csv =
      header +
      '01/15/2023,Invoice,1001,Acme,Accounts Receivable,100.00,\n,,,,Sales Income,,100.00\n';
    const k1 = prepareLedgerEntries(group(csv), lookup)[0].key;
    const k2 = prepareLedgerEntries(group(csv), lookup)[0].key;
    expect(k1).toBe(k2);
  });
});

describe('toNewJournalEntryInput', () => {
  const accounts = [
    { id: 'ar', name: 'Accounts Receivable', accountNumber: null },
    { id: 'sales', name: 'Sales Income', accountNumber: null },
  ] as Account[];
  const lookup = buildAccountLookup(accounts);
  const customers = buildPartyLookup([{ id: 'c1', displayName: 'Acme' }]);
  const header = 'Date,Transaction Type,Num,Name,Account,Debit,Credit\n';
  const ready = prepareLedgerEntries(
    groupTransactions(
      parseCsv(
        header +
          '01/15/2023,Invoice,1001,Acme,Accounts Receivable,100.00,\n,,,,Sales Income,,100.00\n'
      ).rows,
      MAP
    ),
    lookup
  )[0];

  it('builds a balanced postable entry tagged source_type import', () => {
    const input = toNewJournalEntryInput(ready, { sourceId: 'sid-1', customers });
    expect(input).not.toBeNull();
    expect(input!.sourceType).toBe('import');
    expect(input!.sourceId).toBe('sid-1');
    expect(input!.entryDate).toBe('2023-01-15');
    expect(input!.lines).toHaveLength(2);
    const totalDebit = input!.lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = input!.lines.reduce((s, l) => s + l.credit, 0);
    expect(totalDebit).toBe(totalCredit);
    expect(input!.lines.every((l) => l.customerId === 'c1')).toBe(true);
  });

  it('returns null for a non-ready entry', () => {
    expect(toNewJournalEntryInput({ ...ready, status: 'unbalanced' })).toBeNull();
  });
});

describe('summarizeEntries', () => {
  const accounts = [
    { id: 'ar', name: 'Accounts Receivable', accountNumber: null },
    { id: 'sales', name: 'Sales Income', accountNumber: null },
  ] as Account[];
  const lookup = buildAccountLookup(accounts);
  const header = 'Date,Transaction Type,Num,Name,Account,Debit,Credit\n';

  it('counts statuses and collects unmapped account names', () => {
    const txns = groupTransactions(
      parseCsv(
        header +
          '01/15/2023,Invoice,1,Acme,Accounts Receivable,100.00,\n,,,,Sales Income,,100.00\n' +
          '01/16/2023,Invoice,2,Acme,Accounts Receivable,50.00,\n,,,,Mystery,,50.00\n'
      ).rows,
      MAP
    );
    const s = summarizeEntries(prepareLedgerEntries(txns, lookup));
    expect(s.total).toBe(2);
    expect(s.ready).toBe(1);
    expect(s.unmapped).toBe(1);
    expect(s.unmappedAccountNames).toEqual(['Mystery']);
  });
});

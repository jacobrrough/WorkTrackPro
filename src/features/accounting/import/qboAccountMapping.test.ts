import { describe, it, expect } from 'vitest';
import type { Account } from '../types';
import {
  classifyQboAccount,
  defaultClassification,
  autoDetectColumns,
  buildAccountRows,
  toNewAccountInput,
  findDuplicate,
} from './qboAccountMapping';

describe('classifyQboAccount', () => {
  const cases: Array<[string, string, string, string]> = [
    // [qboType, expected accountType, expected subtype, expected normalBalance]
    ['Bank', 'asset', 'bank', 'debit'],
    ['Accounts receivable (A/R)', 'asset', 'accounts_receivable', 'debit'],
    ['Other Current Assets', 'asset', 'other_current_asset', 'debit'],
    ['Fixed Assets', 'asset', 'fixed_asset', 'debit'],
    ['Other Assets', 'asset', 'other_asset', 'debit'],
    ['Accounts payable (A/P)', 'liability', 'accounts_payable', 'credit'],
    ['Credit Card', 'liability', 'credit_card', 'credit'],
    ['Other Current Liabilities', 'liability', 'other_current_liability', 'credit'],
    ['Long Term Liabilities', 'liability', 'long_term_liability', 'credit'],
    ['Equity', 'equity', 'equity', 'credit'],
    ['Income', 'income', 'income', 'credit'],
    ['Other Income', 'income', 'other_income', 'credit'],
    ['Cost of Goods Sold', 'expense', 'cost_of_goods_sold', 'debit'],
    ['Expenses', 'expense', 'expense', 'debit'],
    ['Other Expense', 'expense', 'other_expense', 'debit'],
  ];

  it.each(cases)('maps QBO type "%s"', (type, accountType, accountSubtype, normalBalance) => {
    expect(classifyQboAccount(type)).toEqual({ accountType, accountSubtype, normalBalance });
  });

  it('is case- and punctuation-insensitive', () => {
    expect(classifyQboAccount('  bank  ')?.accountSubtype).toBe('bank');
    expect(classifyQboAccount('ACCOUNTS RECEIVABLE')?.accountSubtype).toBe('accounts_receivable');
  });

  it('uses detail type to pin accumulated depreciation (a credit-balance asset)', () => {
    const c = classifyQboAccount('Fixed Assets', 'Accumulated Depreciation');
    expect(c).toEqual({
      accountType: 'asset',
      accountSubtype: 'accumulated_depreciation',
      normalBalance: 'credit',
    });
  });

  it('uses detail type to pin inventory', () => {
    expect(classifyQboAccount('Other Current Assets', 'Inventory')?.accountSubtype).toBe(
      'inventory'
    );
  });

  it('does not confuse Other Income / Other Expense with Income / Expense', () => {
    expect(classifyQboAccount('Other Income')?.accountSubtype).toBe('other_income');
    expect(classifyQboAccount('Other Expense')?.accountSubtype).toBe('other_expense');
  });

  it('returns null for an unrecognised type', () => {
    expect(classifyQboAccount('Wibble')).toBeNull();
    expect(classifyQboAccount('')).toBeNull();
  });
});

describe('defaultClassification', () => {
  it('gives a usable subtype + normal balance per top-level type', () => {
    expect(defaultClassification('asset').normalBalance).toBe('debit');
    expect(defaultClassification('liability').normalBalance).toBe('credit');
    expect(defaultClassification('equity').accountSubtype).toBe('equity');
    expect(defaultClassification('income').normalBalance).toBe('credit');
    expect(defaultClassification('expense').normalBalance).toBe('debit');
  });
});

describe('autoDetectColumns', () => {
  it('maps a standard QBO export, distinguishing "Account #" from "Account"', () => {
    const map = autoDetectColumns(['Account #', 'Account', 'Type', 'Detail Type', 'Description']);
    expect(map).toEqual({
      number: 'Account #',
      name: 'Account',
      type: 'Type',
      detailType: 'Detail Type',
      description: 'Description',
    });
  });

  it('maps the "Name"/"Account Type" variant', () => {
    const map = autoDetectColumns(['Number', 'Name', 'Account Type', 'Balance']);
    expect(map.number).toBe('Number');
    expect(map.name).toBe('Name');
    expect(map.type).toBe('Account Type');
  });

  it('does not grab "Account Type" as the name column', () => {
    const map = autoDetectColumns(['Account Type', 'Account Name']);
    expect(map.type).toBe('Account Type');
    expect(map.name).toBe('Account Name');
  });

  it('omits roles it cannot find', () => {
    const map = autoDetectColumns(['Foo', 'Bar']);
    expect(map.name).toBeUndefined();
    expect(map.type).toBeUndefined();
  });
});

describe('buildAccountRows', () => {
  const map = { number: 'Account #', name: 'Account', type: 'Type', description: 'Description' };

  it('builds a clean importable row', () => {
    const [row] = buildAccountRows(
      [{ 'Account #': '1000', Account: 'Checking', Type: 'Bank', Description: 'Ops account' }],
      map
    );
    expect(row).toMatchObject({
      rowNumber: 2,
      name: 'Checking',
      accountNumber: '1000',
      classification: { accountType: 'asset', accountSubtype: 'bank', normalBalance: 'debit' },
      description: 'Ops account',
      problem: null,
    });
  });

  it('flags a missing name', () => {
    const [row] = buildAccountRows([{ 'Account #': '1', Account: '', Type: 'Bank' }], map);
    expect(row.problem).toBe('Missing account name');
  });

  it('flags an unrecognised type', () => {
    const [row] = buildAccountRows([{ Account: 'Mystery', Type: 'Wibble' }], map);
    expect(row.problem).toBe('Unrecognised type "Wibble"');
    expect(row.classification).toBeNull();
  });

  it('numbers rows from 2 (header is row 1)', () => {
    const rows = buildAccountRows(
      [
        { Account: 'A', Type: 'Bank' },
        { Account: 'B', Type: 'Bank' },
      ],
      map
    );
    expect(rows.map((r) => r.rowNumber)).toEqual([2, 3]);
  });
});

describe('toNewAccountInput', () => {
  it('produces a full create payload from a classified row', () => {
    const [row] = buildAccountRows([{ Account: 'Sales', Type: 'Income' }], {
      name: 'Account',
      type: 'Type',
    });
    expect(toNewAccountInput(row)).toEqual({
      name: 'Sales',
      accountNumber: null,
      accountType: 'income',
      accountSubtype: 'income',
      normalBalance: 'credit',
      description: null,
    });
  });

  it('returns null when unclassified', () => {
    const [row] = buildAccountRows([{ Account: 'X', Type: 'Wibble' }], {
      name: 'Account',
      type: 'Type',
    });
    expect(toNewAccountInput(row)).toBeNull();
  });

  it('honours an explicit classification override', () => {
    const [row] = buildAccountRows([{ Account: 'X', Type: 'Wibble' }], {
      name: 'Account',
      type: 'Type',
    });
    const out = toNewAccountInput(row, defaultClassification('expense'));
    expect(out?.accountType).toBe('expense');
  });
});

describe('findDuplicate', () => {
  const existing = [
    { id: 'a', accountNumber: '1000', name: 'Checking' },
    { id: 'b', accountNumber: null, name: 'Retained Earnings' },
  ] as Account[];

  const rowOf = (over: Partial<{ accountNumber: string | null; name: string }>) =>
    buildAccountRows(
      [{ 'Account #': over.accountNumber ?? '', Account: over.name ?? 'X', Type: 'Bank' }],
      { number: 'Account #', name: 'Account', type: 'Type' }
    )[0];

  it('matches on account number', () => {
    expect(findDuplicate(rowOf({ accountNumber: '1000', name: 'Renamed' }), existing)?.id).toBe(
      'a'
    );
  });

  it('matches on case-insensitive name when no number', () => {
    expect(findDuplicate(rowOf({ name: 'retained earnings' }), existing)?.id).toBe('b');
  });

  it('returns null when neither matches', () => {
    expect(findDuplicate(rowOf({ accountNumber: '9999', name: 'Brand New' }), existing)).toBeNull();
  });
});

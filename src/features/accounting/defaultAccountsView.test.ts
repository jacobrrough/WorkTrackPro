import { describe, it, expect } from 'vitest';
import type { Account, DefaultAccounts } from './types';
import {
  DEFAULT_ACCOUNT_SPECS,
  configuredSummary,
  resolveDefaultAccounts,
  resolvedByGroup,
} from './defaultAccountsView';

/** A minimal Account stub — only the fields the resolver reads need to be real. */
function acc(id: string, accountNumber: string, name: string): Account {
  return {
    id,
    accountNumber,
    name,
    accountType: 'asset',
    accountSubtype: null,
    parentAccountId: null,
    normalBalance: 'debit',
    currency: 'USD',
    isActive: true,
    isSystem: true,
    description: null,
    createdAt: '2026-06-01',
    updatedAt: '2026-06-01',
  };
}

/** An all-null DefaultAccounts, then override the keys a given test cares about. */
function defaults(overrides: Partial<DefaultAccounts> = {}): DefaultAccounts {
  return {
    cash: null,
    undepositedFunds: null,
    accountsReceivable: null,
    inventoryAsset: null,
    accountsPayable: null,
    salesTaxPayable: null,
    salesIncome: null,
    serviceIncome: null,
    cogs: null,
    operatingExpenses: null,
    fixedAsset: null,
    accumulatedDepreciation: null,
    depreciationExpense: null,
    openingBalanceEquity: null,
    uncategorizedIncome: null,
    uncategorizedExpense: null,
    paymentProcessorClearing: null,
    openingBalanceLiabilities: null,
    wagesExpense: null,
    employerPayrollTaxExpense: null,
    payrollClearing: null,
    payrollLiabilities: null,
    ...overrides,
  };
}

describe('DEFAULT_ACCOUNT_SPECS', () => {
  it('lists the four COA-EXPAND structural accounts, foregrounded before core', () => {
    const structural = resolvedByGroup(resolveDefaultAccounts(defaults(), []), 'structural');
    expect(structural.map((s) => s.key)).toEqual([
      'openingBalanceEquity',
      'uncategorizedIncome',
      'uncategorizedExpense',
      'paymentProcessorClearing',
    ]);
    // Each structural row advertises the account number it should resolve to (3050/4900/
    // 6900/1260) so a mis-seed is visible at a glance.
    expect(structural.map((s) => s.expectedNumber)).toEqual(['3050', '4900', '6900', '1260']);

    // The structural specs appear before any core spec in the master list (display order).
    const firstCoreIdx = DEFAULT_ACCOUNT_SPECS.findIndex((s) => s.group === 'core');
    const lastStructuralIdx =
      DEFAULT_ACCOUNT_SPECS.length -
      1 -
      [...DEFAULT_ACCOUNT_SPECS].reverse().findIndex((s) => s.group === 'structural');
    expect(lastStructuralIdx).toBeLessThan(firstCoreIdx);
  });

  it('every spec key is a real DefaultAccounts field (no typo keys)', () => {
    const validKeys = new Set(Object.keys(defaults()));
    for (const spec of DEFAULT_ACCOUNT_SPECS) {
      expect(validKeys.has(spec.key)).toBe(true);
    }
  });
});

describe('resolveDefaultAccounts', () => {
  it('resolves a configured key to its chart-of-accounts account', () => {
    const obe = acc('a-3050', '3050', 'Opening Balance Equity');
    const rows = resolveDefaultAccounts(defaults({ openingBalanceEquity: 'a-3050' }), [obe]);

    const row = rows.find((r) => r.key === 'openingBalanceEquity')!;
    expect(row.accountId).toBe('a-3050');
    expect(row.account).toBe(obe);
    expect(row.configured).toBe(true);
  });

  it('marks an unset key (null id) as not configured', () => {
    const rows = resolveDefaultAccounts(defaults(), []);
    const row = rows.find((r) => r.key === 'paymentProcessorClearing')!;
    expect(row.accountId).toBeNull();
    expect(row.account).toBeNull();
    expect(row.configured).toBe(false);
  });

  it('marks a dangling id (no matching account) as not configured', () => {
    // The mapping points at an id, but no such account exists in the chart — surface it,
    // do not crash. The id is preserved (for an admin to investigate) but configured=false.
    const rows = resolveDefaultAccounts(defaults({ uncategorizedIncome: 'ghost-id' }), []);
    const row = rows.find((r) => r.key === 'uncategorizedIncome')!;
    expect(row.accountId).toBe('ghost-id');
    expect(row.account).toBeNull();
    expect(row.configured).toBe(false);
  });

  it('treats a null/undefined defaults blob as everything unconfigured', () => {
    const a = acc('a-1', '3050', 'Opening Balance Equity');
    for (const blob of [null, undefined]) {
      const rows = resolveDefaultAccounts(blob, [a]);
      expect(rows).toHaveLength(DEFAULT_ACCOUNT_SPECS.length);
      expect(rows.every((r) => !r.configured)).toBe(true);
      expect(rows.every((r) => r.accountId == null)).toBe(true);
    }
  });

  it('resolves the four COA-EXPAND structural keys end-to-end', () => {
    const accounts = [
      acc('id-3050', '3050', 'Opening Balance Equity'),
      acc('id-4900', '4900', 'Uncategorized Income'),
      acc('id-6900', '6900', 'Uncategorized Expense'),
      acc('id-1260', '1260', 'Payment Processor Clearing'),
    ];
    const rows = resolveDefaultAccounts(
      defaults({
        openingBalanceEquity: 'id-3050',
        uncategorizedIncome: 'id-4900',
        uncategorizedExpense: 'id-6900',
        paymentProcessorClearing: 'id-1260',
      }),
      accounts
    );
    const structural = resolvedByGroup(rows, 'structural');
    expect(structural.every((r) => r.configured)).toBe(true);
    expect(structural.map((r) => r.account?.accountNumber)).toEqual([
      '3050',
      '4900',
      '6900',
      '1260',
    ]);
  });
});

describe('configuredSummary', () => {
  it('counts configured rows within a group', () => {
    const rows = resolveDefaultAccounts(
      defaults({ openingBalanceEquity: 'id-3050', uncategorizedIncome: 'id-4900' }),
      [acc('id-3050', '3050', 'OBE'), acc('id-4900', '4900', 'Uncat Income')]
    );
    const s = configuredSummary(rows, 'structural');
    expect(s).toEqual({ configured: 2, total: 4, label: '2 of 4 configured' });
  });

  it('summarizes all rows when no group is given', () => {
    const rows = resolveDefaultAccounts(defaults(), []);
    const s = configuredSummary(rows);
    expect(s.configured).toBe(0);
    expect(s.total).toBe(DEFAULT_ACCOUNT_SPECS.length);
    expect(s.label).toBe(`0 of ${DEFAULT_ACCOUNT_SPECS.length} configured`);
  });
});

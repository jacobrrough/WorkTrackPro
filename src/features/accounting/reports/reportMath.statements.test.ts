import { describe, it, expect } from 'vitest';
import {
  buildAccountLedger,
  buildCashFlowStatement,
  type AccountLedgerMeta,
  type AccountLedgerLineInput,
} from './reportMath';
import type { AccountBalanceRow, CashFlowCategory } from '../types';

// ── buildAccountLedger (#3 GL detail / account register) ──────────────────────
const cashMeta: AccountLedgerMeta = {
  accountId: 'a-1000',
  accountNumber: '1000',
  name: 'Cash',
  normalBalance: 'debit',
};

const ledgerLine = (
  p: Partial<AccountLedgerLineInput> & Pick<AccountLedgerLineInput, 'entryId'>
): AccountLedgerLineInput => ({
  entryId: p.entryId,
  entryNumber: p.entryNumber ?? 1,
  date: p.date ?? '2026-06-01',
  memo: p.memo ?? null,
  debit: p.debit ?? 0,
  credit: p.credit ?? 0,
});

describe('buildAccountLedger', () => {
  it('runs a natural-signed running balance up from the opening balance', () => {
    // openingCents is in CENTS; row debit/credit are in dollars. $100 opening = 10000c.
    const report = buildAccountLedger(cashMeta, 10000, [
      ledgerLine({ entryId: 'e1', debit: 50, credit: 0 }),
      ledgerLine({ entryId: 'e2', debit: 0, credit: 30 }),
    ]);
    // debit-normal: +$50 then -$30 on top of opening $100 → 150 → 120
    expect(report.lines.map((l) => l.balance)).toEqual([150, 120]);
    expect(report.openingBalance).toBe(100);
    expect(report.closingBalance).toBe(120);
    expect(report.totalDebit).toBe(50);
    expect(report.totalCredit).toBe(30);
  });

  it('moves a credit-normal account the opposite way', () => {
    const apMeta: AccountLedgerMeta = {
      accountId: 'l-2000',
      accountNumber: '2000',
      name: 'Accounts Payable',
      normalBalance: 'credit',
    };
    const report = buildAccountLedger(apMeta, 0, [
      ledgerLine({ entryId: 'e1', debit: 0, credit: 200 }), // a credit raises a credit-normal acct
      ledgerLine({ entryId: 'e2', debit: 75, credit: 0 }),
    ]);
    expect(report.lines.map((l) => l.balance)).toEqual([200, 125]);
    expect(report.closingBalance).toBe(125);
  });

  it('is an all-zero register for an account with no postings', () => {
    const report = buildAccountLedger(cashMeta, 0, []);
    expect(report.lines).toEqual([]);
    expect(report.closingBalance).toBe(0);
    expect(report.totalDebit).toBe(0);
    expect(report.totalCredit).toBe(0);
  });
});

// ── buildCashFlowStatement (#5 indirect method) ───────────────────────────────
const balRow = (
  p: Partial<AccountBalanceRow> &
    Pick<AccountBalanceRow, 'accountId' | 'accountType' | 'normalBalance'>
): AccountBalanceRow => ({
  accountId: p.accountId,
  accountNumber: p.accountNumber ?? null,
  name: p.name ?? p.accountId,
  accountType: p.accountType,
  normalBalance: p.normalBalance,
  totalDebit: p.totalDebit ?? 0,
  totalCredit: p.totalCredit ?? 0,
  balance: p.balance ?? (p.totalDebit ?? 0) - (p.totalCredit ?? 0),
});

describe('buildCashFlowStatement', () => {
  it('reconciles net income + working-capital changes to the actual cash delta', () => {
    // Net income 1000 (income credit). AR rose 300 (uses cash); AP rose 200 (provides cash).
    // Cash should therefore net-change 1000 − 300 + 200 = 900.
    const report = buildCashFlowStatement({
      periodRows: [
        balRow({
          accountId: 'inc',
          accountType: 'income',
          normalBalance: 'credit',
          totalCredit: 1000,
        }),
      ],
      openingRows: [
        balRow({ accountId: 'cash', accountType: 'asset', normalBalance: 'debit' }),
        balRow({ accountId: 'ar', accountType: 'asset', normalBalance: 'debit' }),
        balRow({ accountId: 'ap', accountType: 'liability', normalBalance: 'credit' }),
      ],
      closingRows: [
        balRow({
          accountId: 'cash',
          accountType: 'asset',
          normalBalance: 'debit',
          totalDebit: 900,
        }),
        balRow({ accountId: 'ar', accountType: 'asset', normalBalance: 'debit', totalDebit: 300 }),
        balRow({
          accountId: 'ap',
          accountType: 'liability',
          normalBalance: 'credit',
          totalCredit: 200,
        }),
      ],
      categoryByAccountId: new Map<string, CashFlowCategory | null>([
        ['cash', 'cash'],
        ['ar', 'operating'],
        ['ap', 'operating'],
      ]),
      range: { from: '2026-01-01', to: '2026-12-31' },
    });

    expect(report.netIncome).toBe(1000);
    expect(report.netOperating).toBe(900); // 1000 − 300 + 200
    expect(report.netChangeInCash).toBe(900);
    expect(report.cashChange).toBe(900);
    expect(report.difference).toBe(0);
    expect(report.balanced).toBe(true);
  });

  it('classifies an investing outflow and still reconciles', () => {
    const report = buildCashFlowStatement({
      periodRows: [
        balRow({
          accountId: 'inc',
          accountType: 'income',
          normalBalance: 'credit',
          totalCredit: 500,
        }),
      ],
      openingRows: [
        balRow({ accountId: 'cash', accountType: 'asset', normalBalance: 'debit' }),
        balRow({ accountId: 'equip', accountType: 'asset', normalBalance: 'debit' }),
      ],
      // Bought 200 of equipment with cash: equip +200 (Dr); cash net +300 (500 earned − 200 capex).
      closingRows: [
        balRow({
          accountId: 'cash',
          accountType: 'asset',
          normalBalance: 'debit',
          totalDebit: 300,
        }),
        balRow({
          accountId: 'equip',
          accountType: 'asset',
          normalBalance: 'debit',
          totalDebit: 200,
        }),
      ],
      categoryByAccountId: new Map<string, CashFlowCategory | null>([
        ['cash', 'cash'],
        ['equip', 'investing'],
      ]),
      range: {},
    });
    expect(report.netInvesting).toBe(-200);
    expect(report.netOperating).toBe(500);
    expect(report.cashChange).toBe(300);
    expect(report.balanced).toBe(true);
  });

  it('surfaces a null-category non-cash account as an unclassified Operating line', () => {
    const report = buildCashFlowStatement({
      periodRows: [],
      openingRows: [
        balRow({ accountId: 'cash', accountType: 'asset', normalBalance: 'debit' }),
        balRow({ accountId: 'mystery', accountType: 'asset', normalBalance: 'debit' }),
      ],
      closingRows: [
        balRow({ accountId: 'cash', accountType: 'asset', normalBalance: 'debit' }),
        balRow({
          accountId: 'mystery',
          accountType: 'asset',
          normalBalance: 'debit',
          totalDebit: 100,
        }),
      ],
      categoryByAccountId: new Map<string, CashFlowCategory | null>([['cash', 'cash']]),
      range: {},
    });
    const flagged = report.operating.lines.find((l) => l.name.includes('unclassified'));
    expect(flagged).toBeTruthy();
    // A non-cash asset rose 100 with no offsetting cash entry → the statement cannot reconcile.
    expect(report.balanced).toBe(false);
  });
});

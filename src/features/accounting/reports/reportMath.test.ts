import { describe, it, expect } from 'vitest';
import {
  buildAgingReport,
  buildBalanceSheet,
  buildProfitAndLoss,
  buildTrialBalance,
  naturalAmountCents,
  netIncomeCents,
  rowBalanceCents,
  summarizeAging,
} from './reportMath';
import type { AccountBalanceRow, AgingRow } from '../types';

/** Compact factory for an account-balance row (totals in dollars). */
function row(p: Partial<AccountBalanceRow> & Pick<AccountBalanceRow, 'accountType' | 'normalBalance'>): AccountBalanceRow {
  return {
    accountId: p.accountId ?? 'a',
    accountNumber: p.accountNumber ?? null,
    name: p.name ?? 'Account',
    accountType: p.accountType,
    normalBalance: p.normalBalance,
    totalDebit: p.totalDebit ?? 0,
    totalCredit: p.totalCredit ?? 0,
    balance: p.balance ?? (p.totalDebit ?? 0) - (p.totalCredit ?? 0),
  };
}

describe('rowBalanceCents / naturalAmountCents', () => {
  it('signs the balance debit-minus-credit in cents', () => {
    expect(rowBalanceCents({ totalDebit: 100.25, totalCredit: 40.1 })).toBe(6015);
  });

  it('shows a debit-normal account positive when it has a net debit', () => {
    const asset = row({ accountType: 'asset', normalBalance: 'debit', totalDebit: 500, totalCredit: 0 });
    expect(naturalAmountCents(asset)).toBe(50000);
  });

  it('shows a credit-normal account positive when it has a net credit', () => {
    const income = row({ accountType: 'income', normalBalance: 'credit', totalDebit: 0, totalCredit: 250 });
    expect(naturalAmountCents(income)).toBe(25000);
  });

  it('returns a negative natural amount for a contra balance', () => {
    // An asset sitting in a net-credit position (e.g. overdrawn) reads negative.
    const contraAsset = row({ accountType: 'asset', normalBalance: 'debit', totalDebit: 0, totalCredit: 30 });
    expect(naturalAmountCents(contraAsset)).toBe(-3000);
  });
});

describe('buildTrialBalance', () => {
  it('splits each account into one column and reports agreeing grand totals', () => {
    const rows: AccountBalanceRow[] = [
      row({ accountId: 'cash', accountType: 'asset', normalBalance: 'debit', totalDebit: 1085, totalCredit: 0 }),
      row({ accountId: 'ar', accountType: 'asset', normalBalance: 'debit', totalDebit: 0, totalCredit: 0 }), // zero
      row({ accountId: 'income', accountType: 'income', normalBalance: 'credit', totalDebit: 0, totalCredit: 1000 }),
      row({ accountId: 'tax', accountType: 'liability', normalBalance: 'credit', totalDebit: 0, totalCredit: 85 }),
    ];
    const tb = buildTrialBalance(rows, { from: '2026-01-01', to: '2026-06-30' });
    expect(tb.totalDebit).toBe(1085);
    expect(tb.totalCredit).toBe(1085); // 1000 + 85
    expect(tb.difference).toBe(0);
    expect(tb.balanced).toBe(true);
    // zero-balance account is dropped from the listing
    expect(tb.rows.map((r) => r.accountId)).toEqual(['cash', 'income', 'tax']);
    expect(tb.range).toEqual({ from: '2026-01-01', to: '2026-06-30' });
  });

  it('flags an unbalanced ledger', () => {
    const rows: AccountBalanceRow[] = [
      row({ accountType: 'asset', normalBalance: 'debit', totalDebit: 100, totalCredit: 0 }),
      row({ accountType: 'income', normalBalance: 'credit', totalDebit: 0, totalCredit: 90 }),
    ];
    const tb = buildTrialBalance(rows);
    expect(tb.totalDebit).toBe(100);
    expect(tb.totalCredit).toBe(90);
    expect(tb.difference).toBe(10);
    expect(tb.balanced).toBe(false);
  });
});

describe('buildProfitAndLoss', () => {
  it('computes income - expense and ignores balance-sheet accounts', () => {
    const rows: AccountBalanceRow[] = [
      row({ accountId: 'sales', name: 'Sales', accountType: 'income', normalBalance: 'credit', totalCredit: 1000 }),
      row({ accountId: 'svc', name: 'Service', accountType: 'income', normalBalance: 'credit', totalCredit: 250.5 }),
      row({ accountId: 'rent', name: 'Rent', accountType: 'expense', normalBalance: 'debit', totalDebit: 400 }),
      row({ accountId: 'cogs', name: 'COGS', accountType: 'expense', normalBalance: 'debit', totalDebit: 150.25 }),
      // must be ignored by P&L:
      row({ accountId: 'cash', accountType: 'asset', normalBalance: 'debit', totalDebit: 9999 }),
      row({ accountId: 'ap', accountType: 'liability', normalBalance: 'credit', totalCredit: 9999 }),
    ];
    const pl = buildProfitAndLoss(rows);
    expect(pl.totalIncome).toBe(1250.5);
    expect(pl.totalExpense).toBe(550.25);
    expect(pl.netIncome).toBe(700.25);
    expect(pl.income.lines.map((l) => l.name)).toEqual(['Sales', 'Service']);
    expect(pl.expense.subtotal).toBe(550.25);
    // section subtotals echo the totals
    expect(pl.income.subtotal).toBe(1250.5);
  });

  it('returns a negative net income on a loss', () => {
    const rows: AccountBalanceRow[] = [
      row({ accountType: 'income', normalBalance: 'credit', totalCredit: 100 }),
      row({ accountType: 'expense', normalBalance: 'debit', totalDebit: 175 }),
    ];
    expect(buildProfitAndLoss(rows).netIncome).toBe(-75);
  });
});

describe('netIncomeCents', () => {
  it('matches the P&L net income in cents', () => {
    const rows: AccountBalanceRow[] = [
      row({ accountType: 'income', normalBalance: 'credit', totalCredit: 1000 }),
      row({ accountType: 'expense', normalBalance: 'debit', totalDebit: 300 }),
    ];
    expect(netIncomeCents(rows)).toBe(70000);
  });
});

describe('buildBalanceSheet', () => {
  it('balances assets against liabilities + equity with net income rolled in', () => {
    // Books: Cash 1085 (Dr). AP 85 (Cr). Owner equity 300 (Cr). Net income 700.
    // 700 = income 1000 - expense 300. Assets 1085 == Liab 85 + Equity(300 + 700) 1000.
    const rows: AccountBalanceRow[] = [
      row({ accountId: 'cash', name: 'Cash', accountType: 'asset', normalBalance: 'debit', totalDebit: 1085 }),
      row({ accountId: 'ap', name: 'AP', accountType: 'liability', normalBalance: 'credit', totalCredit: 85 }),
      row({ accountId: 'oe', name: 'Owner equity', accountType: 'equity', normalBalance: 'credit', totalCredit: 300 }),
      row({ accountId: 'sales', name: 'Sales', accountType: 'income', normalBalance: 'credit', totalCredit: 1000 }),
      row({ accountId: 'exp', name: 'Expenses', accountType: 'expense', normalBalance: 'debit', totalDebit: 300 }),
    ];
    const bs = buildBalanceSheet(rows, { to: '2026-06-30' });
    expect(bs.totalAssets).toBe(1085);
    expect(bs.totalLiabilities).toBe(85);
    expect(bs.netIncome).toBe(700);
    expect(bs.totalEquity).toBe(1000); // 300 owner + 700 net income
    expect(bs.difference).toBe(0);
    expect(bs.balanced).toBe(true);
    // the rolled-in net income appears as a synthetic equity line
    const ni = bs.equity.lines.find((l) => l.name === 'Net income');
    expect(ni?.amount).toBe(700);
    expect(ni?.accountId).toBe('__net_income__');
  });

  it('omits the net-income line when the period nets to zero', () => {
    const rows: AccountBalanceRow[] = [
      row({ accountType: 'asset', normalBalance: 'debit', totalDebit: 500 }),
      row({ accountType: 'equity', normalBalance: 'credit', totalCredit: 500 }),
    ];
    const bs = buildBalanceSheet(rows);
    expect(bs.netIncome).toBe(0);
    expect(bs.equity.lines.some((l) => l.name === 'Net income')).toBe(false);
    expect(bs.balanced).toBe(true);
  });
});

describe('summarizeAging / buildAgingReport', () => {
  function aging(p: Partial<AgingRow> & Pick<AgingRow, 'bucket' | 'balanceDue'>): AgingRow {
    return {
      documentId: p.documentId ?? 'd',
      documentNumber: p.documentNumber ?? null,
      partyId: p.partyId ?? 'p',
      partyName: p.partyName ?? 'Party',
      documentDate: p.documentDate ?? '2026-01-01',
      dueDate: p.dueDate ?? null,
      total: p.total ?? p.balanceDue,
      amountPaid: p.amountPaid ?? 0,
      balanceDue: p.balanceDue,
      daysOverdue: p.daysOverdue ?? 0,
      bucket: p.bucket,
    };
  }

  it('totals balance-due per bucket and overall', () => {
    const rows: AgingRow[] = [
      aging({ bucket: 'current', balanceDue: 100.5 }),
      aging({ bucket: 'current', balanceDue: 49.5 }),
      aging({ bucket: '31-60', balanceDue: 200 }),
      aging({ bucket: '90+', balanceDue: 33.33 }),
    ];
    const summary = summarizeAging(rows);
    expect(summary.byBucket.current).toBe(150);
    expect(summary.byBucket['1-30']).toBe(0);
    expect(summary.byBucket['31-60']).toBe(200);
    expect(summary.byBucket['90+']).toBe(33.33);
    expect(summary.total).toBe(383.33);
  });

  it('wraps rows + summary and ignores an unknown bucket value', () => {
    const rows: AgingRow[] = [
      aging({ bucket: 'current', balanceDue: 10 }),
      aging({ bucket: 'bogus' as AgingRow['bucket'], balanceDue: 999 }),
    ];
    const report = buildAgingReport(rows);
    expect(report.rows).toHaveLength(2);
    expect(report.summary.total).toBe(10); // bogus bucket excluded from totals
  });
});

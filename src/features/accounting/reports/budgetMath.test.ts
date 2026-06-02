import { describe, it, expect } from 'vitest';
import {
  actualNaturalCents,
  buildBudgetGrid,
  buildBudgetVsActual,
  buildCashFlowForecast,
  type BvaAccount,
  type MonthlyActualInput,
} from './budgetMath';
import { naturalAmountCents } from './reportMath';
import type { Account, BudgetLine, CashFlowItem } from '../types';

/** Compact factory for a chart account (only the fields the budget math reads). */
function acct(p: Partial<Account> & Pick<Account, 'id'>): BvaAccount {
  return {
    id: p.id,
    accountNumber: p.accountNumber ?? null,
    name: p.name ?? `Account ${p.id}`,
    accountType: p.accountType ?? 'expense',
    normalBalance: p.normalBalance ?? 'debit',
  };
}

/** Compact factory for a saved budget cell (dollars). */
function line(
  accountId: string,
  periodMonth: number,
  amount: number
): Pick<BudgetLine, 'accountId' | 'periodMonth' | 'amount'> {
  return { accountId, periodMonth, amount };
}

describe('actualNaturalCents', () => {
  it('signs a debit-normal account debit-minus-credit (expense shown positive)', () => {
    // $300 of expense debits → +30000 cents.
    expect(actualNaturalCents('debit', 300, 0)).toBe(30000);
  });

  it('signs a credit-normal account credit-minus-debit (income shown positive)', () => {
    // $1000 of income credits → +100000 cents.
    expect(actualNaturalCents('credit', 0, 1000)).toBe(100000);
  });

  it('matches reportMath.naturalAmountCents (same basis as the trial balance)', () => {
    // An income account with $1,250.75 of net credits must read identically to the way
    // the trial-balance/P&L builder reads it, so a BvA actual ties to the TB.
    const viaBudget = actualNaturalCents('credit', 0, 1250.75);
    const viaReport = naturalAmountCents({
      accountId: 'i',
      accountNumber: null,
      name: 'Income',
      accountType: 'income',
      normalBalance: 'credit',
      totalDebit: 0,
      totalCredit: 1250.75,
      balance: -1250.75,
    });
    expect(viaBudget).toBe(viaReport);
    expect(viaBudget).toBe(125075);
  });
});

describe('buildBudgetGrid', () => {
  const accounts = [
    acct({
      id: 'inc',
      accountNumber: '4000',
      name: 'Sales',
      accountType: 'income',
      normalBalance: 'credit',
    }),
    acct({
      id: 'exp',
      accountNumber: '6000',
      name: 'Rent',
      accountType: 'expense',
      normalBalance: 'debit',
    }),
    acct({
      id: 'sup',
      accountNumber: '6100',
      name: 'Supplies',
      accountType: 'expense',
      normalBalance: 'debit',
    }),
  ];

  it('fills planned cells into a dense 12-slot row and zero-fills the rest', () => {
    const { rows } = buildBudgetGrid(accounts, [line('exp', 1, 1000), line('exp', 12, 1500)]);
    const rent = rows.find((r) => r.accountId === 'exp')!;
    expect(rent.monthly).toHaveLength(12);
    expect(rent.monthly[0]).toBe(1000); // Jan
    expect(rent.monthly[11]).toBe(1500); // Dec
    expect(rent.monthly[5]).toBe(0); // Jun (blank)
    expect(rent.total).toBe(2500);
  });

  it('keeps an account with no saved lines as an all-zero editable row', () => {
    const { rows } = buildBudgetGrid(accounts, [line('exp', 1, 1000)]);
    const supplies = rows.find((r) => r.accountId === 'sup')!;
    expect(supplies.monthly.every((c) => c === 0)).toBe(true);
    expect(supplies.total).toBe(0);
  });

  it('computes per-month column totals and the grand total in cents-exact dollars', () => {
    const { monthlyTotals, grandTotal } = buildBudgetGrid(accounts, [
      line('exp', 1, 1000.1),
      line('sup', 1, 0.2),
      line('inc', 1, 500),
    ]);
    // Jan column = 1000.10 + 0.20 + 500.00 = 1500.30 (no float drift).
    expect(monthlyTotals[0]).toBe(1500.3);
    expect(grandTotal).toBe(1500.3);
  });

  it('ignores out-of-range months and lines for unknown accounts', () => {
    const { rows, grandTotal } = buildBudgetGrid(accounts, [
      line('exp', 13, 999), // bad month
      line('exp', 0, 999), // bad month
      line('ghost', 1, 999), // unknown account → no row, not counted
    ]);
    expect(rows.find((r) => r.accountId === 'exp')!.total).toBe(0);
    expect(grandTotal).toBe(0);
  });

  it('sums a duplicate (account, month) cell rather than dropping dollars', () => {
    const { rows } = buildBudgetGrid(accounts, [line('exp', 3, 100), line('exp', 3, 50)]);
    expect(rows.find((r) => r.accountId === 'exp')!.monthly[2]).toBe(150);
  });
});

describe('buildBudgetVsActual', () => {
  const accounts: BvaAccount[] = [
    acct({
      id: 'inc',
      accountNumber: '4000',
      name: 'Sales',
      accountType: 'income',
      normalBalance: 'credit',
    }),
    acct({
      id: 'exp',
      accountNumber: '6000',
      name: 'Rent',
      accountType: 'expense',
      normalBalance: 'debit',
    }),
  ];

  it('compares budget vs natural-signed actual and computes variance', () => {
    const budget = [line('inc', 1, 1000), line('exp', 1, 800)];
    // Income posted as a credit (revenue), rent posted as a debit (expense).
    const actuals: MonthlyActualInput[] = [
      { accountId: 'inc', month: 1, debit: 0, credit: 1200 },
      { accountId: 'exp', month: 1, debit: 750, credit: 0 },
    ];
    const { rows, totalBudgetCents, totalActualCents } = buildBudgetVsActual(
      accounts,
      budget,
      actuals
    );

    const income = rows.find((r) => r.accountId === 'inc')!;
    expect(income.budget).toBe(1000);
    expect(income.actual).toBe(1200); // credit shown positive
    expect(income.variance).toBe(200); // actual − budget

    const rent = rows.find((r) => r.accountId === 'exp')!;
    expect(rent.budget).toBe(800);
    expect(rent.actual).toBe(750); // debit shown positive
    expect(rent.variance).toBe(-50);

    expect(totalBudgetCents).toBe(180000); // 1000 + 800
    expect(totalActualCents).toBe(195000); // 1200 + 750
  });

  it('includes an account that has actuals but no budget (and vice versa)', () => {
    const budget = [line('inc', 1, 1000)]; // only income budgeted
    const actuals: MonthlyActualInput[] = [{ accountId: 'exp', month: 2, debit: 300, credit: 0 }]; // only rent actual
    const { rows } = buildBudgetVsActual(accounts, budget, actuals);
    expect(rows).toHaveLength(2);
    const rent = rows.find((r) => r.accountId === 'exp')!;
    expect(rent.budget).toBe(0);
    expect(rent.actual).toBe(300);
    expect(rent.variance).toBe(300);
    expect(rent.actualMonthly[1]).toBe(300); // Feb slot
  });

  it('omits accounts with neither budget nor actual', () => {
    const extra = [
      ...accounts,
      acct({ id: 'idle', accountNumber: '6200', accountType: 'expense' }),
    ];
    const { rows } = buildBudgetVsActual(extra, [line('inc', 1, 100)], []);
    expect(rows.some((r) => r.accountId === 'idle')).toBe(false);
  });

  it('orders rows by account number (same order as the trial balance)', () => {
    const { rows } = buildBudgetVsActual(accounts, [line('exp', 1, 1), line('inc', 1, 1)], []);
    expect(rows.map((r) => r.accountNumber)).toEqual(['4000', '6000']);
  });

  it('ignores budget lines / actuals referencing an unknown account', () => {
    const { rows, totalBudgetCents } = buildBudgetVsActual(
      accounts,
      [line('ghost', 1, 500)],
      [{ accountId: 'ghost', month: 1, debit: 999, credit: 0 }]
    );
    expect(rows).toHaveLength(0);
    expect(totalBudgetCents).toBe(0);
  });

  it('sums multiple posted lines in the same account/month', () => {
    const actuals: MonthlyActualInput[] = [
      { accountId: 'exp', month: 1, debit: 100, credit: 0 },
      { accountId: 'exp', month: 1, debit: 0, credit: 10 }, // a partial credit (e.g. correction)
    ];
    const { rows } = buildBudgetVsActual(accounts, [], actuals);
    // 100 debit − 10 credit = 90 natural (debit-normal).
    expect(rows.find((r) => r.accountId === 'exp')!.actual).toBe(90);
  });
});

describe('buildCashFlowForecast', () => {
  const ar = (id: string, dueDate: string | null, amount: number): CashFlowItem => ({
    documentId: id,
    documentNumber: id,
    partyName: 'Customer',
    dueDate,
    amount,
    direction: 'inflow',
  });
  const ap = (id: string, dueDate: string | null, amount: number): CashFlowItem => ({
    documentId: id,
    documentNumber: id,
    partyName: 'Vendor',
    dueDate,
    amount,
    direction: 'outflow',
  });

  it('buckets inflows/outflows by due month and accumulates a running balance', () => {
    const items = [
      ar('inv-1', '2026-06-15', 1000),
      ar('inv-2', '2026-07-10', 500),
      ap('bill-1', '2026-06-20', 400),
      ap('bill-2', '2026-08-01', 900),
    ];
    const f = buildCashFlowForecast(items, {
      openingBalance: 200,
      startMonth: '2026-06-01',
      months: 3,
    });

    expect(f.openingBalance).toBe(200);
    expect(f.periods).toHaveLength(3);

    const [jun, jul, aug] = f.periods;
    expect(jun.label).toBe('Jun 2026');
    expect(jun.periodStart).toBe('2026-06-01');
    expect(jun.periodEnd).toBe('2026-06-30');
    expect(jun.inflow).toBe(1000);
    expect(jun.outflow).toBe(400);
    expect(jun.net).toBe(600);
    expect(jun.runningBalance).toBe(800); // 200 + 600

    expect(jul.inflow).toBe(500);
    expect(jul.net).toBe(500);
    expect(jul.runningBalance).toBe(1300);

    expect(aug.outflow).toBe(900);
    expect(aug.runningBalance).toBe(400); // 1300 − 900

    expect(f.totalInflow).toBe(1500);
    expect(f.totalOutflow).toBe(1300);
    expect(f.endingBalance).toBe(400);
  });

  it('folds a no-due-date item and anything overdue into the first bucket', () => {
    const items = [
      ar('inv-nodue', null, 300),
      ar('inv-old', '2026-01-05', 250), // before horizon start
    ];
    const f = buildCashFlowForecast(items, { startMonth: '2026-06-01', months: 2 });
    expect(f.periods[0].inflow).toBe(550); // 300 + 250 in Jun
    expect(f.periods[1].inflow).toBe(0);
  });

  it('folds anything due after the horizon into the last bucket', () => {
    const items = [ap('bill-far', '2026-12-31', 1000)];
    const f = buildCashFlowForecast(items, { startMonth: '2026-06-01', months: 3 });
    // Horizon is Jun/Jul/Aug; the Dec bill lands in the last (Aug) bucket.
    expect(f.periods[2].outflow).toBe(1000);
    expect(f.endingBalance).toBe(-1000);
  });

  it('treats item amounts as magnitudes regardless of incoming sign', () => {
    const items = [ap('b', '2026-06-10', -400)]; // negative outflow magnitude
    const f = buildCashFlowForecast(items, { startMonth: '2026-06-01', months: 1 });
    expect(f.periods[0].outflow).toBe(400);
  });

  it('clamps the bucket count to a sane range and defaults to 6', () => {
    expect(buildCashFlowForecast([], { startMonth: '2026-06-01' }).periods).toHaveLength(6);
    expect(buildCashFlowForecast([], { startMonth: '2026-06-01', months: 0 }).periods).toHaveLength(
      6
    );
    expect(
      buildCashFlowForecast([], { startMonth: '2026-06-01', months: 999 }).periods
    ).toHaveLength(36);
  });

  it('handles a December start rolling into the next year', () => {
    const f = buildCashFlowForecast([ar('i', '2027-01-15', 100)], {
      startMonth: '2026-12-01',
      months: 2,
    });
    expect(f.periods[0].label).toBe('Dec 2026');
    expect(f.periods[1].label).toBe('Jan 2027');
    expect(f.periods[1].periodEnd).toBe('2027-01-31');
    expect(f.periods[1].inflow).toBe(100);
  });

  it('produces an all-zero forecast with no items', () => {
    const f = buildCashFlowForecast([], {
      openingBalance: 50,
      startMonth: '2026-06-01',
      months: 2,
    });
    expect(f.totalInflow).toBe(0);
    expect(f.totalOutflow).toBe(0);
    expect(f.endingBalance).toBe(50);
    expect(f.periods.every((p) => p.net === 0)).toBe(true);
  });
});

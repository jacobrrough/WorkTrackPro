import { describe, it, expect } from 'vitest';
import { computeBalance, formatMoney, toCents, validateJournalDraft } from './accountingViewModel';

describe('computeBalance', () => {
  it('balances equal debits and credits', () => {
    const r = computeBalance([
      { debit: 100, credit: 0 },
      { debit: 0, credit: 100 },
    ]);
    expect(r.balanced).toBe(true);
    expect(r.totalDebit).toBe(100);
    expect(r.totalCredit).toBe(100);
    expect(r.difference).toBe(0);
  });

  it('detects an imbalance', () => {
    const r = computeBalance([
      { debit: 100, credit: 0 },
      { debit: 0, credit: 90 },
    ]);
    expect(r.balanced).toBe(false);
    expect(r.difference).toBe(10);
  });

  it('is not balanced when every line is zero', () => {
    expect(computeBalance([{ debit: 0, credit: 0 }]).balanced).toBe(false);
  });

  it('avoids floating-point drift (0.1 + 0.2 = 0.3)', () => {
    const r = computeBalance([
      { debit: 0.1, credit: 0 },
      { debit: 0.2, credit: 0 },
      { debit: 0, credit: 0.3 },
    ]);
    expect(r.balanced).toBe(true);
    expect(r.difference).toBe(0);
  });
});

describe('validateJournalDraft', () => {
  it('requires at least two lines with amounts', () => {
    expect(validateJournalDraft([{ accountId: 'a', debit: 100, credit: 0 }])).toMatch(
      /at least two/i
    );
  });

  it('rejects a line with a negative amount', () => {
    expect(
      validateJournalDraft([
        { accountId: 'a', debit: -100, credit: 0 },
        { accountId: 'b', debit: 0, credit: 100 },
      ])
    ).toMatch(/negative/i);
  });

  it('rejects a line with both a debit and a credit', () => {
    expect(
      validateJournalDraft([
        { accountId: 'a', debit: 50, credit: 50 },
        { accountId: 'b', debit: 0, credit: 50 },
      ])
    ).toMatch(/debit or a credit/i);
  });

  it('requires an account on every line', () => {
    expect(
      validateJournalDraft([
        { accountId: '', debit: 100, credit: 0 },
        { accountId: 'b', debit: 0, credit: 100 },
      ])
    ).toMatch(/account/i);
  });

  it('rejects an unbalanced entry', () => {
    expect(
      validateJournalDraft([
        { accountId: 'a', debit: 100, credit: 0 },
        { accountId: 'b', debit: 0, credit: 90 },
      ])
    ).toMatch(/equal/i);
  });

  it('accepts a balanced two-line entry', () => {
    expect(
      validateJournalDraft([
        { accountId: 'a', debit: 100, credit: 0 },
        { accountId: 'b', debit: 0, credit: 100 },
      ])
    ).toBeNull();
  });
});

describe('money helpers', () => {
  it('formats numbers as USD', () => {
    expect(formatMoney(1234.5)).toBe('$1,234.50');
    expect(formatMoney(0)).toBe('$0.00');
  });

  it('converts to integer cents', () => {
    expect(toCents(1.5)).toBe(150);
    expect(toCents(0.1)).toBe(10);
    expect(toCents(Number.NaN)).toBe(0);
  });
});

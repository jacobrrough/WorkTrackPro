/**
 * Pure helpers for the accounting module: money formatting and double-entry
 * validation. Kept free of React/Supabase so they are trivially unit-testable
 * (see accountingViewModel.test.ts). All balance math is done in integer cents to
 * avoid floating-point drift.
 */
import type { NewJournalLineInput } from './types';

export function formatMoney(amount: number, currency = 'USD'): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(safe);
}

export const toCents = (n: number): number => Math.round((Number.isFinite(n) ? n : 0) * 100);

export interface BalanceResult {
  totalDebit: number;
  totalCredit: number;
  difference: number;
  balanced: boolean;
}

/** Sum debits/credits (in cents) and report whether the entry balances. */
export function computeBalance(lines: { debit: number; credit: number }[]): BalanceResult {
  const debitCents = lines.reduce((s, l) => s + toCents(l.debit), 0);
  const creditCents = lines.reduce((s, l) => s + toCents(l.credit), 0);
  return {
    totalDebit: debitCents / 100,
    totalCredit: creditCents / 100,
    difference: (debitCents - creditCents) / 100,
    balanced: debitCents === creditCents && debitCents > 0,
  };
}

/**
 * Validate a manual journal draft the same way the DB will (>=2 lines, each line a
 * debit XOR a credit, balanced). Returns an error message, or null if valid.
 * Mirrors accounting.guard_journal_entry so the user gets feedback before posting.
 */
export function validateJournalDraft(lines: NewJournalLineInput[]): string | null {
  if (lines.some((l) => toCents(l.debit) < 0 || toCents(l.credit) < 0))
    return 'Debit and credit amounts cannot be negative.';
  const real = lines.filter((l) => toCents(l.debit) > 0 || toCents(l.credit) > 0);
  if (real.length < 2) return 'A journal entry needs at least two lines with amounts.';
  for (const l of real) {
    const d = toCents(l.debit);
    const c = toCents(l.credit);
    if (d > 0 && c > 0) return 'Each line can have a debit or a credit, not both.';
    if (d === 0 && c === 0) return 'Each line needs a debit or a credit amount.';
    if (!l.accountId) return 'Each line needs an account.';
  }
  const bal = computeBalance(real);
  if (!bal.balanced) {
    return `Debits (${formatMoney(bal.totalDebit)}) must equal credits (${formatMoney(bal.totalCredit)}).`;
  }
  return null;
}

import { describe, it, expect } from 'vitest';
import { applyRules, applyRulesToBatch, ruleMatches, validateRule } from './bankRulesEngine';
import type { BankRule, ParsedBankTransaction } from '../../../features/accounting/types';

/**
 * Build a BankRule with sensible defaults for the field under test. Uses key-presence
 * (`in`) rather than `??` for the nullable assignment fields so a test can set an
 * explicit `setAccountId: null` (e.g. a vendor-only rule) without the default
 * clobbering it.
 */
function rule(partial: Partial<BankRule>): BankRule {
  return {
    id: partial.id ?? 'r1',
    bankAccountId: 'bankAccountId' in partial ? (partial.bankAccountId ?? null) : null,
    matchField: partial.matchField ?? 'description',
    matchOp: partial.matchOp ?? 'contains',
    matchValue: partial.matchValue ?? '',
    setAccountId: 'setAccountId' in partial ? (partial.setAccountId ?? null) : 'gl-acct',
    setVendorId: 'setVendorId' in partial ? (partial.setVendorId ?? null) : null,
    priority: partial.priority ?? 0,
    isActive: partial.isActive ?? true,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  };
}

const txn = (
  over: Partial<{
    amount: number;
    description: string | null;
    merchant: string | null;
    bankAccountId: string | null;
  }>
) => ({
  amount: over.amount ?? -10,
  description: over.description ?? null,
  merchant: over.merchant ?? null,
  bankAccountId: over.bankAccountId ?? null,
});

describe('ruleMatches — text fields', () => {
  it('contains is a case-insensitive substring on description', () => {
    const r = rule({ matchField: 'description', matchOp: 'contains', matchValue: 'shell' });
    expect(ruleMatches(r, txn({ description: 'SHELL OIL #42' }))).toBe(true);
    expect(ruleMatches(r, txn({ description: 'Chevron' }))).toBe(false);
  });

  it('equals is a case-insensitive exact match', () => {
    const r = rule({ matchField: 'merchant', matchOp: 'equals', matchValue: 'Acme' });
    expect(ruleMatches(r, txn({ merchant: 'acme' }))).toBe(true);
    expect(ruleMatches(r, txn({ merchant: 'acme corp' }))).toBe(false);
  });

  it('regex matches case-insensitively and never throws on a bad pattern', () => {
    const ok = rule({ matchField: 'description', matchOp: 'regex', matchValue: '^AMZN\\s' });
    expect(ruleMatches(ok, txn({ description: 'AMZN Mktp US' }))).toBe(true);
    const bad = rule({ matchField: 'description', matchOp: 'regex', matchValue: '([' });
    expect(ruleMatches(bad, txn({ description: 'anything' }))).toBe(false);
  });

  it('gt/lt are meaningless on text fields (no match)', () => {
    const r = rule({ matchField: 'description', matchOp: 'gt', matchValue: '5' });
    expect(ruleMatches(r, txn({ description: 'whatever' }))).toBe(false);
  });
});

describe('ruleMatches — amount field (compares magnitude)', () => {
  it('gt compares the absolute dollars so a -120 withdrawal is > 100', () => {
    const r = rule({ matchField: 'amount', matchOp: 'gt', matchValue: '100' });
    expect(ruleMatches(r, txn({ amount: -120 }))).toBe(true);
    expect(ruleMatches(r, txn({ amount: -90 }))).toBe(false);
  });

  it('lt compares the absolute dollars', () => {
    const r = rule({ matchField: 'amount', matchOp: 'lt', matchValue: '20' });
    expect(ruleMatches(r, txn({ amount: -5 }))).toBe(true);
    expect(ruleMatches(r, txn({ amount: 25 }))).toBe(false);
  });

  it('tolerates a "$" in the threshold value', () => {
    const r = rule({ matchField: 'amount', matchOp: 'gt', matchValue: '$100' });
    expect(ruleMatches(r, txn({ amount: 150 }))).toBe(true);
  });

  it('equals matches the formatted magnitude', () => {
    const r = rule({ matchField: 'amount', matchOp: 'equals', matchValue: '42.5' });
    expect(ruleMatches(r, txn({ amount: -42.5 }))).toBe(true);
  });
});

describe('ruleMatches — scope + active', () => {
  it('an account-scoped rule only matches that account', () => {
    const r = rule({ bankAccountId: 'ba-1', matchValue: 'fee' });
    expect(ruleMatches(r, txn({ description: 'monthly fee', bankAccountId: 'ba-1' }))).toBe(true);
    expect(ruleMatches(r, txn({ description: 'monthly fee', bankAccountId: 'ba-2' }))).toBe(false);
  });

  it('a global (null account) rule matches any account', () => {
    const r = rule({ bankAccountId: null, matchValue: 'fee' });
    expect(ruleMatches(r, txn({ description: 'monthly fee', bankAccountId: 'ba-9' }))).toBe(true);
  });

  it('an inactive rule never matches', () => {
    const r = rule({ isActive: false, matchValue: 'fee' });
    expect(ruleMatches(r, txn({ description: 'monthly fee' }))).toBe(false);
  });
});

describe('applyRules — selection', () => {
  it('returns the first matching rule (caller supplies priority order)', () => {
    const rules = [
      rule({ id: 'high', priority: 10, matchValue: 'gas', setAccountId: 'gl-fuel' }),
      rule({ id: 'low', priority: 1, matchValue: 'gas', setAccountId: 'gl-other' }),
    ];
    const m = applyRules(txn({ description: 'SHELL GAS' }), rules);
    expect(m?.ruleId).toBe('high');
    expect(m?.setAccountId).toBe('gl-fuel');
  });

  it('skips a matching rule that sets neither account nor vendor', () => {
    const rules = [
      rule({ id: 'empty', matchValue: 'gas', setAccountId: null, setVendorId: null }),
      rule({ id: 'useful', matchValue: 'gas', setAccountId: 'gl-fuel' }),
    ];
    const m = applyRules(txn({ description: 'GAS STATION' }), rules);
    expect(m?.ruleId).toBe('useful');
  });

  it('returns null when nothing matches', () => {
    const rules = [rule({ matchValue: 'rent' })];
    expect(applyRules(txn({ description: 'groceries' }), rules)).toBeNull();
  });

  it('carries through a vendor-only assignment', () => {
    const rules = [rule({ matchValue: 'acme', setAccountId: null, setVendorId: 'v-7' })];
    const m = applyRules(txn({ description: 'ACME CO' }), rules);
    expect(m).toMatchObject({ setAccountId: null, setVendorId: 'v-7', ruleId: 'r1' });
  });
});

describe('applyRulesToBatch', () => {
  it('returns a parallel array of matches/nulls keyed to the given account', () => {
    const rules = [rule({ bankAccountId: 'ba-1', matchValue: 'fee', setAccountId: 'gl-fee' })];
    const txns: ParsedBankTransaction[] = [
      {
        txnDate: '2026-06-01',
        amount: -3,
        description: 'service fee',
        merchant: null,
        externalId: null,
      },
      {
        txnDate: '2026-06-02',
        amount: -8,
        description: 'groceries',
        merchant: null,
        externalId: null,
      },
    ];
    const out = applyRulesToBatch(txns, rules, 'ba-1');
    expect(out).toHaveLength(2);
    expect(out[0]?.setAccountId).toBe('gl-fee');
    expect(out[1]).toBeNull();
  });
});

describe('validateRule', () => {
  it('accepts a well-formed contains rule', () => {
    expect(
      validateRule({
        matchField: 'description',
        matchOp: 'contains',
        matchValue: 'shell',
        setAccountId: 'gl',
      })
    ).toBeNull();
  });
  it('requires a field, op, value, and an assignment', () => {
    expect(validateRule({})).toMatch(/field/i);
    expect(validateRule({ matchField: 'description' })).toMatch(/match/i);
    expect(validateRule({ matchField: 'description', matchOp: 'contains' })).toMatch(/value/i);
    expect(
      validateRule({ matchField: 'description', matchOp: 'contains', matchValue: 'x' })
    ).toMatch(/account/i);
  });
  it('rejects a non-numeric amount threshold', () => {
    expect(
      validateRule({ matchField: 'amount', matchOp: 'gt', matchValue: 'abc', setAccountId: 'gl' })
    ).toMatch(/numeric/i);
  });
  it('rejects gt/lt on a text field', () => {
    expect(
      validateRule({
        matchField: 'description',
        matchOp: 'gt',
        matchValue: '5',
        setAccountId: 'gl',
      })
    ).toMatch(/amount field/i);
  });
  it('rejects an invalid regex', () => {
    expect(
      validateRule({
        matchField: 'description',
        matchOp: 'regex',
        matchValue: '([',
        setAccountId: 'gl',
      })
    ).toMatch(/regular expression/i);
  });
});

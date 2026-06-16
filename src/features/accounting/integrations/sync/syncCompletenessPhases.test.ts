import { describe, it, expect } from 'vitest';
import { isNoEffectSkip, qboJeSourceKey } from './syncCompletenessPhases';

/**
 * The completeness pass flags a record's mapper "problem" as either a no-effect SKIP
 * (voided / $0 records QuickBooks keeps for its audit trail — they post nothing) or a real
 * FAILURE that needs attention (unmapped account, lines that can't reconcile). This split is
 * what keeps the sync results screen from lumping benign skips into an alarming failure count.
 */
describe('isNoEffectSkip', () => {
  it('classifies voided / $0 records as no-effect skips', () => {
    expect(isNoEffectSkip('Zero-amount purchase')).toBe(true);
    expect(isNoEffectSkip('Zero-amount deposit')).toBe(true);
    expect(isNoEffectSkip('Zero-amount sales receipt')).toBe(true);
    expect(isNoEffectSkip('Fewer than two mappable lines')).toBe(true);
  });

  it('treats real reconciliation / mapping problems as needs-attention (not skips)', () => {
    expect(isNoEffectSkip('Purchase lines cannot be reconciled to the total')).toBe(false);
    expect(isNoEffectSkip('Deposit lines cannot be reconciled to the total')).toBe(false);
    expect(isNoEffectSkip('A journal line references an unmapped account')).toBe(false);
    expect(isNoEffectSkip('Pay-from account is unmapped')).toBe(false);
    expect(isNoEffectSkip('AR default account missing')).toBe(false);
  });
});

describe('qboJeSourceKey', () => {
  it('builds the deterministic per-transaction source key', () => {
    expect(qboJeSourceKey('Purchase', '9616')).toBe('qbo:Purchase:9616');
  });
});

import { describe, it, expect } from 'vitest';
import {
  PRICE_SOURCE_BADGE,
  PRICE_SOURCE_ICONS,
  PRICE_SOURCE_LABELS,
  SEED_EXCEPTION_LABELS,
  formatSignedMoney,
  formatSignedQty,
  isRowReconciled,
  reconciliationFlags,
  signedTone,
} from './inventoryReconcileFormat';
import type { InventoryReconciliationRow } from '../types';

/**
 * Coverage for the reconciliation PRESENTERS (labels, signed formatting, flag derivation).
 * The money arithmetic itself is covered by inventoryReconcileMath.test.ts — these only
 * assert the display logic the screens depend on.
 */

describe('formatSignedMoney', () => {
  it('prepends "+" for a positive amount', () => {
    expect(formatSignedMoney(30)).toBe('+$30.00');
    expect(formatSignedMoney(52.5)).toBe('+$52.50');
  });

  it('uses a minus sign for a negative amount', () => {
    expect(formatSignedMoney(-12.34)).toBe('−$12.34');
  });

  it('reads exactly $0.00 for zero and snaps sub-cent residue to zero', () => {
    expect(formatSignedMoney(0)).toBe('$0.00');
    // 0.004 rounds to 0 cents → a clean tie, not "+$0.00".
    expect(formatSignedMoney(0.004)).toBe('$0.00');
    expect(formatSignedMoney(-0.004)).toBe('$0.00');
  });

  it('coerces a non-finite amount to $0.00', () => {
    expect(formatSignedMoney(Number.NaN)).toBe('$0.00');
  });
});

describe('formatSignedQty', () => {
  it('signs positive/negative and prints zero plainly', () => {
    expect(formatSignedQty(3)).toBe('+3');
    expect(formatSignedQty(-2)).toBe('−2');
    expect(formatSignedQty(0)).toBe('0');
  });

  it('keeps up to three decimals without trailing zeros', () => {
    expect(formatSignedQty(1.5)).toBe('+1.5');
    expect(formatSignedQty(-0.125)).toBe('−0.125');
  });
});

describe('signedTone', () => {
  it('greens a rise, reds a fall, mutes a tie', () => {
    expect(signedTone(10)).toBe('text-emerald-300');
    expect(signedTone(-10)).toBe('text-red-300');
    expect(signedTone(0)).toBe('text-slate-400');
    // sub-cent residue counts as a tie
    expect(signedTone(0.004)).toBe('text-slate-400');
  });
});

describe('source + exception label maps', () => {
  it('labels every price-change source', () => {
    expect(PRICE_SOURCE_LABELS.manual).toBe('Manual edit');
    expect(PRICE_SOURCE_LABELS.bill).toBe('Bill receipt');
    expect(PRICE_SOURCE_LABELS.seed).toBe('Opening seed');
    expect(PRICE_SOURCE_LABELS.reval).toBe('Revaluation');
  });

  it('has an icon + badge class for every source', () => {
    for (const src of ['manual', 'bill', 'seed', 'reval'] as const) {
      expect(PRICE_SOURCE_ICONS[src]).toBeTruthy();
      expect(PRICE_SOURCE_BADGE[src]).toContain('text-');
    }
  });

  it('labels every seed-exception reason', () => {
    expect(SEED_EXCEPTION_LABELS.null_price).toMatch(/null/i);
    expect(SEED_EXCEPTION_LABELS.non_positive_stock).toMatch(/on-hand/i);
    expect(SEED_EXCEPTION_LABELS.unknown).toBeTruthy();
  });
});

/** Build a fully-reconciled row, overriding only the flag fields under test. */
function row(overrides: Partial<InventoryReconciliationRow> = {}): InventoryReconciliationRow {
  return {
    sourceInventoryId: 'inv-1',
    inventoryName: 'Widget',
    unit: 'ea',
    vendor: 'Acme',
    inStock: 10,
    unitPrice: 5,
    opValue: 50,
    qtyOnHand: 10,
    assetValue: 50,
    avgUnitCost: 5,
    qtyVariance: 0,
    valueVariance: 0,
    pendingRevalAmount: 0,
    pendingRevalCount: 0,
    uncosted: false,
    nullPrice: false,
    negativeStock: false,
    qtyMismatch: false,
    ...overrides,
  };
}

describe('reconciliationFlags / isRowReconciled', () => {
  it('returns no flags for a fully-tied row', () => {
    expect(reconciliationFlags(row())).toEqual([]);
    expect(isRowReconciled(row())).toBe(true);
  });

  it('raises a null-price flag first (most severe)', () => {
    const flags = reconciliationFlags(row({ nullPrice: true, uncosted: true }));
    expect(flags[0].key).toBe('nullPrice');
    expect(flags.map((f) => f.key)).toContain('uncosted');
    expect(isRowReconciled(row({ nullPrice: true }))).toBe(false);
  });

  it('flags a quantity mismatch and negative stock', () => {
    const flags = reconciliationFlags(row({ qtyMismatch: true, negativeStock: true }));
    expect(flags.map((f) => f.key)).toEqual(['qtyMismatch', 'negativeStock']);
  });

  it('flags a pending revaluation when count > 0', () => {
    const flags = reconciliationFlags(row({ pendingRevalCount: 1 }));
    expect(flags).toHaveLength(1);
    expect(flags[0].key).toBe('pendingReval');
    expect(isRowReconciled(row({ pendingRevalCount: 1 }))).toBe(false);
  });

  it('orders all flags by severity when several are set', () => {
    const flags = reconciliationFlags(
      row({
        nullPrice: true,
        uncosted: true,
        qtyMismatch: true,
        negativeStock: true,
        pendingRevalCount: 2,
      })
    );
    expect(flags.map((f) => f.key)).toEqual([
      'nullPrice',
      'uncosted',
      'qtyMismatch',
      'negativeStock',
      'pendingReval',
    ]);
  });
});

import { describe, it, expect } from 'vitest';
import {
  centsToDollars,
  computeSeedTotals,
  isReconciled,
  operationalValue,
  reconciliationHeaderTie,
  reconciliationVariance,
  revaluationDelta,
  revaluationDeltaCents,
  seedTotalsFromPreview,
  summarizeRevaluationBatch,
} from './inventoryReconcileMath';
import type {
  InventoryReconciliationRow,
  InventoryRevaluation,
  SeedOpeningInventoryPreviewRow,
} from './types';

/**
 * Report-math coverage for the inventory reconciliation helpers. These mirror the DB
 * arithmetic (migrations 20260616000001–04) so a UI preview equals what the RPC/view
 * produces to the penny. The anchor scenarios reproduce the DB lane's smoke tests:
 *   • manual cost $5 → $8 on on_hand 10 → reval Δ = +$30.00 (Dr 1300 / Cr 1310)
 *   • bill cost $11.50 on on_hand 15 with old basis $8 → reval Δ = +$52.50
 *   • opening seed: 10 @ $5 → Dr 1300 / Cr 3050 $50.00
 */

describe('revaluationDeltaCents / revaluationDelta', () => {
  it('matches the DB reval scenario: 10 units, $5 → $8 = +$30.00', () => {
    expect(revaluationDeltaCents(10, 5, 8)).toBe(3000);
    expect(revaluationDelta(10, 5, 8)).toBe(30);
  });

  it('matches the bill scenario: 15 units, $8 → $11.50 = +$52.50', () => {
    expect(revaluationDeltaCents(15, 8, 11.5)).toBe(5250);
    expect(revaluationDelta(15, 8, 11.5)).toBe(52.5);
  });

  it('is signed: a cost decrease yields a negative delta', () => {
    expect(revaluationDeltaCents(10, 8, 5)).toBe(-3000);
    expect(revaluationDelta(10, 8, 5)).toBe(-30);
  });

  it('is zero when nothing is on hand (no GL movement, any cost change)', () => {
    expect(revaluationDeltaCents(0, 5, 100)).toBe(0);
    expect(revaluationDelta(0, 5, 100)).toBe(0);
  });

  it('is zero when the cost did not change', () => {
    expect(revaluationDeltaCents(123.45, 7, 7)).toBe(0);
  });

  it('rounds the product ONCE (qty × Δcost × 100), matching the RPC, no per-step drift', () => {
    // 3 units × $0.005 delta = $0.015 → rounds to 2¢ (round half away from zero).
    expect(revaluationDeltaCents(3, 1, 1.005)).toBe(2);
    // 0.1 + 0.2 style residue must not accumulate: 7 units × $0.10 = exactly 70¢.
    expect(revaluationDeltaCents(7, 0, 0.1)).toBe(70);
  });

  it('handles fractional quantities (numeric(14,4)) precisely', () => {
    // 2.5 units × ($12.50 − $10.00) = $6.25 → 625¢.
    expect(revaluationDeltaCents(2.5, 10, 12.5)).toBe(625);
  });

  it('treats non-finite inputs as zero per-term (defensive, never NaN)', () => {
    // A non-finite QTY zeroes the whole product.
    expect(revaluationDeltaCents(Number.NaN, 5, 8)).toBe(0);
    // A non-finite COST is treated as $0: old=∞→$0, so 10 × ($8 − $0) = $80.00 = 8000¢.
    // The point is the result is finite and defined, never NaN.
    expect(revaluationDeltaCents(10, Number.POSITIVE_INFINITY, 8)).toBe(8000);
    expect(Number.isFinite(revaluationDeltaCents(10, Number.NaN, Number.NaN))).toBe(true);
  });
});

describe('summarizeRevaluationBatch', () => {
  const row = (
    onHandQty: number,
    oldCost: number,
    newCost: number
  ): Pick<InventoryRevaluation, 'onHandQty' | 'oldCost' | 'newCost'> => ({
    onHandQty,
    oldCost,
    newCost,
  });

  it('nets a single increasing row to a Dr-1300/Cr-1310 movement', () => {
    const s = summarizeRevaluationBatch([row(10, 5, 8)]);
    expect(s.netCents).toBe(3000);
    expect(s.netAmount).toBe(30);
    expect(s.postAmount).toBe(30);
    expect(s.direction).toBe('increase');
    expect(s.count).toBe(1);
  });

  it('nets a single decreasing row to a Dr-1310/Cr-1300 movement', () => {
    const s = summarizeRevaluationBatch([row(10, 8, 5)]);
    expect(s.netCents).toBe(-3000);
    expect(s.direction).toBe('decrease');
    expect(s.postAmount).toBe(30); // magnitude posts on both sides
  });

  it('nets opposing rows by SIGNED cents sum (the JE direction is the net)', () => {
    // +$30 (10@$5→$8) and −$10 (10@$3→$2) → net +$20 increase.
    const s = summarizeRevaluationBatch([row(10, 5, 8), row(10, 3, 2)]);
    expect(s.netCents).toBe(2000);
    expect(s.netAmount).toBe(20);
    expect(s.direction).toBe('increase');
    expect(s.count).toBe(2);
  });

  it('reports direction "none" and a zero post when the batch nets to zero (no JE)', () => {
    // +$30 and −$30 cancel: the DB posts no JE but still closes the rows.
    const s = summarizeRevaluationBatch([row(10, 5, 8), row(10, 8, 5)]);
    expect(s.netCents).toBe(0);
    expect(s.direction).toBe('none');
    expect(s.postAmount).toBe(0);
  });

  it('is empty-safe (no rows → net zero, direction none)', () => {
    const s = summarizeRevaluationBatch([]);
    expect(s).toEqual({
      netCents: 0,
      netAmount: 0,
      postAmount: 0,
      direction: 'none',
      count: 0,
    });
  });

  it('PROPERTY: postAmount always equals |netAmount| (the JE is balanced by construction)', () => {
    const cases = [
      [row(10, 5, 8)],
      [row(3, 9, 1), row(100, 0.01, 0.02)],
      [row(2.5, 10, 12.5), row(7, 0, 0.1), row(0, 5, 99)],
    ];
    for (const rows of cases) {
      const s = summarizeRevaluationBatch(rows);
      expect(s.postAmount).toBe(Math.abs(s.netAmount));
      // And the cents net is exactly the sum of per-row deltas (no drift).
      const expected = rows.reduce(
        (acc, r) => acc + revaluationDeltaCents(r.onHandQty, r.oldCost, r.newCost),
        0
      );
      expect(s.netCents).toBe(expected);
    }
  });
});

describe('computeSeedTotals / seedTotalsFromPreview', () => {
  it('matches the DB opening seed: 10 @ $5 → $50.00 (one item)', () => {
    const t = computeSeedTotals([{ inStock: 10, unitCost: 5 }]);
    expect(t.totalCents).toBe(5000);
    expect(t.totalValue).toBe(50);
    expect(t.totalQty).toBe(10);
    expect(t.itemCount).toBe(1);
  });

  it('rounds each row to cents then sums (matches the seeder accumulation)', () => {
    // 3 @ $0.005 = $0.015 → 2¢; 3 @ $0.005 = 2¢; sum = 4¢ (per-row rounding, like the DB).
    const t = computeSeedTotals([
      { inStock: 3, unitCost: 0.005 },
      { inStock: 3, unitCost: 0.005 },
    ]);
    expect(t.totalCents).toBe(4);
    expect(t.totalValue).toBe(0.04);
  });

  it('sums multiple items and quantities', () => {
    const t = computeSeedTotals([
      { inStock: 20, unitCost: 10 }, // $200.00
      { inStock: 20, unitCost: 12.5 }, // $250.00
    ]);
    expect(t.totalValue).toBe(450);
    expect(t.totalQty).toBe(40);
    expect(t.itemCount).toBe(2);
  });

  it('is empty-safe (no eligible rows → zero opening JE)', () => {
    expect(computeSeedTotals([])).toEqual({
      totalCents: 0,
      totalValue: 0,
      totalQty: 0,
      itemCount: 0,
    });
  });

  it('seedTotalsFromPreview re-derives the same totals from preview rows', () => {
    const preview: SeedOpeningInventoryPreviewRow[] = [
      { sourceInventoryId: 'a', name: 'A', inStock: 20, unitCost: 10, extended: 200 },
      { sourceInventoryId: 'b', name: 'B', inStock: 20, unitCost: 12.5, extended: 250 },
    ];
    const t = seedTotalsFromPreview(preview);
    expect(t.totalValue).toBe(450);
    expect(t.itemCount).toBe(2);
  });
});

describe('operationalValue', () => {
  it('is in_stock × price (price IS the unit cost)', () => {
    expect(operationalValue(10, 5)).toBe(50);
    expect(operationalValue(15, 11.5)).toBe(172.5);
  });

  it('is 0 when the price is null (uncosted operationally)', () => {
    expect(operationalValue(10, null)).toBe(0);
  });

  it('can be negative when stock is negative (allowed by design)', () => {
    expect(operationalValue(-3, 4)).toBe(-12);
  });
});

describe('reconciliationVariance', () => {
  it('ties to zero when operational and accounting agree', () => {
    const v = reconciliationVariance({ inStock: 10, unitPrice: 5, qtyOnHand: 10, assetValue: 50 });
    expect(v.opValue).toBe(50);
    expect(v.qtyVariance).toBe(0);
    expect(v.valueVariance).toBe(0);
    expect(isReconciled(asRow(v))).toBe(true);
  });

  it('surfaces a value variance when the accounting basis lags a cost rise', () => {
    // Operational already at $8 (op_value $80) but the layer is still carried at $5 ($50).
    const v = reconciliationVariance({ inStock: 10, unitPrice: 8, qtyOnHand: 10, assetValue: 50 });
    expect(v.opValue).toBe(80);
    expect(v.qtyVariance).toBe(0);
    expect(v.valueVariance).toBe(30); // the pending reval magnitude
    expect(isReconciled(asRow(v))).toBe(false);
  });

  it('surfaces a quantity variance (operational vs FIFO on-hand)', () => {
    const v = reconciliationVariance({ inStock: 7, unitPrice: 5, qtyOnHand: 10, assetValue: 50 });
    expect(v.qtyVariance).toBe(-3);
    expect(v.valueVariance).toBe(-15); // $35 op − $50 asset
    expect(isReconciled(asRow(v))).toBe(false);
  });

  it('treats a null price as op_value 0 (the row is also null_price-flagged in the view)', () => {
    const v = reconciliationVariance({
      inStock: 10,
      unitPrice: null,
      qtyOnHand: 0,
      assetValue: 0,
    });
    expect(v.opValue).toBe(0);
    expect(v.valueVariance).toBe(0);
    expect(v.qtyVariance).toBe(10);
  });

  it('differences in cents so a tie is exactly 0.00 (no float residue)', () => {
    // 3 × $0.10 = $0.30 op; asset $0.30 → exact zero, not 4e-17.
    const v = reconciliationVariance({
      inStock: 3,
      unitPrice: 0.1,
      qtyOnHand: 3,
      assetValue: 0.3,
    });
    expect(v.valueVariance).toBe(0);
  });
});

describe('reconciliationHeaderTie', () => {
  const r = (
    assetValue: number,
    opValue: number,
    pendingRevalAmount: number
  ): Pick<InventoryReconciliationRow, 'assetValue' | 'opValue' | 'pendingRevalAmount'> => ({
    assetValue,
    opValue,
    pendingRevalAmount,
  });

  it('ties asset subledger to GL 1300 (variance 0 when posted)', () => {
    const h = reconciliationHeaderTie([r(50, 50, 0), r(250, 250, 0)], 300);
    expect(h.totalAssetValue).toBe(300);
    expect(h.totalOpValue).toBe(300);
    expect(h.gl1300Balance).toBe(300);
    expect(h.assetValueVsGlVariance).toBe(0);
  });

  it('shows a variance when the subledger diverges from the GL', () => {
    // Asset subledger $300 but GL still $250 (a reval not yet posted to the GL).
    const h = reconciliationHeaderTie([r(300, 330, 30)], 250);
    expect(h.totalAssetValue).toBe(300);
    expect(h.totalPendingReval).toBe(30);
    expect(h.assetValueVsGlVariance).toBe(50);
  });

  it('rolls up op-value and pending-reval across rows', () => {
    const h = reconciliationHeaderTie([r(10, 12.5, 2.5), r(20, 20, 0)], 30);
    expect(h.totalOpValue).toBe(32.5);
    expect(h.totalPendingReval).toBe(2.5);
    expect(h.assetValueVsGlVariance).toBe(0);
  });

  it('is empty-safe', () => {
    expect(reconciliationHeaderTie([], 0)).toEqual({
      totalAssetValue: 0,
      totalOpValue: 0,
      totalPendingReval: 0,
      gl1300Balance: 0,
      assetValueVsGlVariance: 0,
    });
  });
});

describe('centsToDollars', () => {
  it('rounds cents to a 2dp dollar amount', () => {
    expect(centsToDollars(5250)).toBe(52.5);
    expect(centsToDollars(-3000)).toBe(-30);
    expect(centsToDollars(0)).toBe(0);
  });
});

/** Build a minimal reconciliation row from a variance result for isReconciled(). */
function asRow(v: {
  qtyVariance: number;
  valueVariance: number;
}): Pick<InventoryReconciliationRow, 'qtyVariance' | 'valueVariance'> {
  return { qtyVariance: v.qtyVariance, valueVariance: v.valueVariance };
}

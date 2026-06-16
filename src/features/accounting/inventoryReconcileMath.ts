/**
 * Pure math for Inventory ↔ Accounting reconciliation & cost sync. No React, no
 * Supabase — trivially unit-testable (see inventoryReconcileMath.test.ts).
 *
 * These helpers are the JS analogs of the arithmetic the DB performs, so the UI can
 * preview a gated revaluation's GL movement, an opening-seed total, and per-item /
 * header reconciliation variances WITHOUT a database round-trip — and so that math is
 * covered by fast unit tests. The DB remains authoritative for the actual postings
 * (migrations 20260616000001–04); this module exists for preview + coverage.
 *
 * MONEY MATH (G6): public.inventory.price IS the per-unit COST (a VERIFIED FACT) and is
 * plain `numeric` in the DB; accounting costs are numeric(14,4). All money aggregation
 * runs in INTEGER CENTS here so nothing drifts on floating-point error — exactly as the
 * DB does it:
 *   • reval Δ:        round(on_hand_qty × (new_cost − old_cost) × 100)   [migration 2]
 *   • seed extended:  round(in_stock × price × 100)                       [migration 4]
 *   • op_value:       round(in_stock × price, 2)                          [migration 4]
 */
import type {
  InventoryReconciliationHeader,
  InventoryReconciliationRow,
  InventoryRevaluation,
  SeedOpeningInventoryPreviewRow,
} from './types';

/** Coerce to a finite number (0 otherwise). */
const fin = (n: number): number => (Number.isFinite(n) ? n : 0);

/** Round a dollar amount to integer cents. Matches the DB's `round(x * 100)`. */
const toCents = (n: number): number => Math.round(fin(n) * 100);

/**
 * Per-unit costs are numeric(14,4) on the accounting side, so scale to integer
 * ten-thousandths-of-a-dollar to difference them EXACTLY — binary floats cannot hold
 * e.g. 1.005, so `1.005 - 1` is 0.00499…, which would drop a half-cent the DB's exact
 * numeric arithmetic keeps. Differencing the scaled integers fixes that (same discipline
 * as inventoryFifo.ts's COST_SCALE).
 */
const COST_SCALE = 10_000;
const toCost4 = (n: number): number => Math.round(fin(n) * COST_SCALE);

/** Convert integer cents back to a 2dp dollar amount. */
export const centsToDollars = (cents: number): number => Math.round(cents) / 100;

/**
 * Extended value (qty × per-unit cost) in INTEGER CENTS, with the cost taken at
 * numeric(14,4) precision so a sub-cent unit cost is not lost to float error. Mirrors the
 * DB's `round(qty × cost × 100)`: cost in ten-thousandths × qty ÷ 100 → cents, rounded
 * once. Used for the opening-seed extended value and the operational value.
 */
const extendedValueCents = (qty: number, unitCost: number): number =>
  Math.round((fin(qty) * toCost4(unitCost)) / 100);

/**
 * The GL movement (in INTEGER CENTS) for revaluing `onHandQty` units from `oldCost` to
 * `newCost` per unit. Signed: positive = cost rose (asset basis goes UP, Dr 1300 / Cr
 * 1310); negative = cost fell (Dr 1310 / Cr 1300); zero = no GL movement (e.g. nothing
 * on hand). Mirrors the DB poster exactly:
 *   round(on_hand_qty × (new_cost − old_cost) × 100)
 * The cost delta is differenced at numeric(14,4) precision first (integer ten-thousandths)
 * so a sub-cent move is not lost to floating-point error, then the qty-weighted product is
 * rounded ONCE to cents — landing on the same cent the RPC posts.
 */
export function revaluationDeltaCents(onHandQty: number, oldCost: number, newCost: number): number {
  // (newCost − oldCost) in exact ten-thousandths; × qty; ÷ 100 to convert
  // ten-thousandths-of-a-dollar × units → cents, rounded once.
  const deltaCost4 = toCost4(newCost) - toCost4(oldCost);
  return Math.round((fin(onHandQty) * deltaCost4) / 100);
}

/** Convenience: the signed revaluation delta in dollars (2dp), from cents. */
export function revaluationDelta(onHandQty: number, oldCost: number, newCost: number): number {
  return centsToDollars(revaluationDeltaCents(onHandQty, oldCost, newCost));
}

/** The net direction of a batch of revaluation deltas (in cents) decides the JE sides. */
export type RevaluationDirection = 'increase' | 'decrease' | 'none';

/** Summary of a gated revaluation batch's net GL movement (preview of the post). */
export interface RevaluationBatchSummary {
  /** Signed net movement across the batch, in integer cents. */
  netCents: number;
  /** Signed net movement in dollars (2dp). */
  netAmount: number;
  /** |netAmount| — the magnitude that posts on BOTH sides of the balanced JE. */
  postAmount: number;
  /**
   * Which side of GL 1300 moves: 'increase' (Dr 1300 / Cr 1310), 'decrease'
   * (Dr 1310 / Cr 1300), or 'none' (net zero → no JE posts, rows still close).
   */
  direction: RevaluationDirection;
  /** Count of rows contributing to the batch. */
  count: number;
}

/**
 * Preview the single balanced JE a gated revaluation batch will post. Accumulates the
 * SIGNED per-row delta in integer cents (recomputing from each row's qty + costs, exactly
 * as accounting.post_inventory_revaluation does), then reports the net magnitude and
 * direction. A net of zero cents posts NO journal entry (the cost VALUE already synced on
 * the item/operational side); the magnitude is what books on each side otherwise, so the
 * previewed entry is balanced by construction.
 *
 * Pass the still-PENDING rows you intend to post; non-pending rows should be filtered out
 * by the caller (the DB skips them anyway).
 */
export function summarizeRevaluationBatch(
  rows: Pick<InventoryRevaluation, 'onHandQty' | 'oldCost' | 'newCost'>[]
): RevaluationBatchSummary {
  let netCents = 0;
  for (const r of rows) {
    netCents += revaluationDeltaCents(r.onHandQty, r.oldCost, r.newCost);
  }
  const direction: RevaluationDirection =
    netCents > 0 ? 'increase' : netCents < 0 ? 'decrease' : 'none';
  return {
    netCents,
    netAmount: centsToDollars(netCents),
    postAmount: centsToDollars(Math.abs(netCents)),
    direction,
    count: rows.length,
  };
}

/** A minimal stock row for the opening-seed total (in_stock × unit cost). */
export interface SeedTotalInput {
  /** Operational on-hand units to seed. Non-positive rows are excluded by the caller. */
  inStock: number;
  /** Per-unit opening cost (public.inventory.price). Null rows are excluded by the caller. */
  unitCost: number;
}

/** Totals for the opening-balance seed (the opening JE amount + roll-ups). */
export interface SeedTotals {
  /** Σ(in_stock × unit_cost) in integer cents — the Dr 1300 / Cr 3050 amount. */
  totalCents: number;
  /** The same total in dollars (2dp). */
  totalValue: number;
  /** Σ in_stock across the rows. */
  totalQty: number;
  /** Number of rows included. */
  itemCount: number;
}

/**
 * Sum the opening-balance seed across eligible stock rows. Each row's extended value is
 * `round(in_stock × unit_cost × 100)` cents (rounded per row, then summed), mirroring the
 * seeder's accumulation so the previewed opening total equals the JE the RPC will post to
 * the penny. The caller passes only ELIGIBLE rows (in_stock > 0, price not null, no
 * existing layer); this function does no eligibility filtering itself.
 */
export function computeSeedTotals(rows: SeedTotalInput[]): SeedTotals {
  let totalCents = 0;
  let totalQty = 0;
  for (const r of rows) {
    totalCents += extendedValueCents(r.inStock, r.unitCost);
    totalQty += fin(r.inStock);
  }
  return {
    totalCents,
    totalValue: centsToDollars(totalCents),
    totalQty,
    itemCount: rows.length,
  };
}

/** Re-derive the opening-seed totals from a result's `preview` rows (UI cross-check). */
export function seedTotalsFromPreview(preview: SeedOpeningInventoryPreviewRow[]): SeedTotals {
  return computeSeedTotals(preview.map((p) => ({ inStock: p.inStock, unitCost: p.unitCost })));
}

/** The operational value of a stock row = in_stock × price (price IS the unit cost), 2dp. */
export function operationalValue(inStock: number, unitPrice: number | null): number {
  if (unitPrice == null) return 0;
  return centsToDollars(extendedValueCents(inStock, unitPrice));
}

/** Per-item reconciliation variances (the JS analog of v_inventory_reconciliation). */
export interface ReconciliationVariance {
  /** Operational value = in_stock × price, in dollars (2dp). */
  opValue: number;
  /** Quantity variance = operational in_stock − accounting qty_on_hand. */
  qtyVariance: number;
  /** Value variance = op_value − accounting asset_value, in dollars (2dp). */
  valueVariance: number;
}

/**
 * Compute the reconciliation variances for one stock item, exactly as the DB view does:
 *   op_value       = round(in_stock × price, 2)        (0 when price is null)
 *   qty_variance   = in_stock − qty_on_hand
 *   value_variance = op_value − asset_value
 * All money is differenced in integer cents so a tie reads exactly 0.00, never a
 * floating-point residue.
 */
export function reconciliationVariance(params: {
  inStock: number;
  unitPrice: number | null;
  qtyOnHand: number;
  assetValue: number;
}): ReconciliationVariance {
  const opCents =
    params.unitPrice == null ? 0 : extendedValueCents(params.inStock, params.unitPrice);
  const assetCents = toCents(params.assetValue);
  return {
    opValue: centsToDollars(opCents),
    qtyVariance: fin(params.inStock) - fin(params.qtyOnHand),
    valueVariance: centsToDollars(opCents - assetCents),
  };
}

/**
 * The header tie between the FIFO asset subledger and GL 1300:
 *   assetValueVsGlVariance = Σ asset_value − gl_1300_balance
 * computed in integer cents (so a clean tie is exactly 0.00). Mirrors
 * v_inventory_reconciliation_header. The op-value and pending-reval roll-ups are summed
 * the same way for the header card.
 */
export function reconciliationHeaderTie(
  rows: Pick<InventoryReconciliationRow, 'assetValue' | 'opValue' | 'pendingRevalAmount'>[],
  gl1300Balance: number
): InventoryReconciliationHeader {
  let assetCents = 0;
  let opCents = 0;
  let pendingCents = 0;
  for (const r of rows) {
    assetCents += toCents(r.assetValue);
    opCents += toCents(r.opValue);
    pendingCents += toCents(r.pendingRevalAmount);
  }
  const glCents = toCents(gl1300Balance);
  return {
    totalAssetValue: centsToDollars(assetCents),
    totalOpValue: centsToDollars(opCents),
    totalPendingReval: centsToDollars(pendingCents),
    gl1300Balance: centsToDollars(glCents),
    assetValueVsGlVariance: centsToDollars(assetCents - glCents),
  };
}

/** True when an item's subledger ties to its operational stock (no qty/value variance). */
export function isReconciled(
  row: Pick<InventoryReconciliationRow, 'qtyVariance' | 'valueVariance'>
): boolean {
  return toCents(row.valueVariance) === 0 && fin(row.qtyVariance) === 0;
}

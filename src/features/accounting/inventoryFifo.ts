/**
 * Pure FIFO inventory-consumption math (B3). No React, no Supabase — trivially
 * unit-testable (see inventoryFifo.test.ts).
 *
 * This is the JS analog of the FIFO depletion loop inside the DB RPC
 * accounting.consume_job_cogs: given a requested quantity and a set of OPEN cost
 * layers ordered oldest-received-first, draw from each layer until the request is
 * satisfied (or the layers run dry), accumulating extended cost in INTEGER CENTS so
 * no floating-point drift accrues across layers (G6) — exactly as the RPC does with
 * `round(qty * unit_cost * 100)`.
 *
 * The DB is the source of truth for the actual postings; this helper exists so the
 * UI can preview a job's FIFO COGS (and any uncosted shortfall) and so the costing
 * logic is covered by fast unit tests independent of a database round-trip.
 */
import type { FifoConsumeResult, FifoDraw, FifoLayerInput } from './types';
import { toCents } from './accountingViewModel';

/**
 * The smallest representable fractional unit. Quantities are numeric(14,4) in the DB,
 * so we deplete in ten-thousandths of a unit to keep the running remainder an integer
 * and avoid 0.1 + 0.2 style residue. (Costs are still accumulated in cents.)
 */
const QTY_SCALE = 10_000;

/** Scale a unit quantity to integer ten-thousandths, matching numeric(14,4). */
const toUnits = (qty: number): number => Math.round((Number.isFinite(qty) ? qty : 0) * QTY_SCALE);

/** Scale integer ten-thousandths back to a unit quantity. */
const fromUnits = (units: number): number => units / QTY_SCALE;

/**
 * FIFO-consume `requestedQty` units across `layers` (which MUST already be ordered
 * oldest-received-first — the caller / DB query owns that ordering). Returns the qty
 * actually costed, any uncosted shortfall, the total extended cost in integer cents,
 * and the per-layer draws.
 *
 * Mirrors the RPC precisely:
 *   • each layer contributes `min(need, qty_remaining)` units,
 *   • its cost is `round(take * unit_cost * 100)` cents (rounded per layer, then summed),
 *   • depletion stops when the request is met or the open layers are exhausted,
 *   • a remaining `need` is reported as `qtyShort` (no phantom cost is invented — the
 *     RPC books nothing for the shortfall either).
 *
 * Pure: never mutates `layers`. A non-positive request or empty layer set yields a
 * zero-cost result (with the full request as the shortfall when positive).
 */
export function consumeFifo(requestedQty: number, layers: FifoLayerInput[]): FifoConsumeResult {
  const draws: FifoDraw[] = [];
  let need = toUnits(requestedQty);
  if (need <= 0) {
    return { qtyCosted: 0, qtyShort: 0, costCents: 0, draws };
  }

  let costCents = 0;
  for (const layer of layers) {
    if (need <= 0) break;
    const available = toUnits(layer.qtyRemaining);
    if (available <= 0) continue; // skip drained/invalid layers (defensive)

    const takeUnits = Math.min(need, available);
    // Per-layer extended cost in cents, rounded exactly as the RPC does. toCents puts
    // unit_cost in cents; × the drawn quantity gives extended cents. round(qty * costCents)
    // == round(qty * unit_cost * 100), matching accounting.consume_job_cogs.
    const layerCostCents = Math.round(fromUnits(takeUnits) * toCents(layer.unitCost));
    costCents += layerCostCents;
    draws.push({ layerId: layer.id, qtyTaken: fromUnits(takeUnits), costCents: layerCostCents });
    need -= takeUnits;
  }

  return {
    qtyCosted: fromUnits(toUnits(requestedQty) - Math.max(need, 0)),
    qtyShort: fromUnits(Math.max(need, 0)),
    costCents,
    draws,
  };
}

/** Dollar scale for 4-decimal-place money, matching unit_cost's numeric(14,4). */
const COST_SCALE = 10_000;

/** Scale a 4dp dollar figure to integer ten-thousandths-of-a-dollar. */
const toCost4 = (amount: number): number =>
  Math.round((Number.isFinite(amount) ? amount : 0) * COST_SCALE);

/**
 * Convenience: the weighted-average unit cost (in dollars, 4dp) of a set of open
 * layers — Σ(qtyRemaining × unitCost) ÷ Σ qtyRemaining. Mirrors
 * v_inventory_valuation.avg_unit_cost (round(asset_value / qty_on_hand, 4)) for a
 * client-side preview without another query.
 *
 * Computed against the 4dp dollar scale (NOT cents) because unit_cost is numeric(14,4):
 * the average must preserve sub-cent precision the way the DB column does. Returns 0
 * when there is nothing on hand.
 */
export function weightedAverageUnitCost(layers: FifoLayerInput[]): number {
  let qtyUnits = 0; // ten-thousandths of a unit
  let value4 = 0; // ten-thousandths of a dollar (asset value)
  for (const layer of layers) {
    const units = toUnits(layer.qtyRemaining);
    if (units <= 0) continue;
    qtyUnits += units;
    // qty (units) × unit_cost (4dp dollars) → asset value in 4dp dollars.
    value4 += Math.round(fromUnits(units) * toCost4(layer.unitCost));
  }
  if (qtyUnits <= 0) return 0;
  // (value4 / 10000) dollars ÷ (qtyUnits / 10000) units → 4dp dollars-per-unit.
  const avgDollarsPerUnit = value4 / COST_SCALE / fromUnits(qtyUnits);
  return Math.round(avgDollarsPerUnit * COST_SCALE) / COST_SCALE;
}

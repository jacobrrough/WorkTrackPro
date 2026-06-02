import { describe, it, expect } from 'vitest';
import { consumeFifo, weightedAverageUnitCost } from './inventoryFifo';
import type { FifoLayerInput } from './types';

/** The DB smoke-test scenario: an older 20@$10 layer then a newer 20@$12.50 layer. */
const LAYERS: FifoLayerInput[] = [
  { id: 'A', qtyRemaining: 20, unitCost: 10 }, // oldest
  { id: 'B', qtyRemaining: 20, unitCost: 12.5 }, // newest
];

describe('consumeFifo', () => {
  it('depletes oldest-first and matches the DB scenario (consume 30 → $325.00)', () => {
    const r = consumeFifo(30, LAYERS);
    // 20 @ $10 = $200 + 10 @ $12.50 = $125 → $325.00 == 32500 cents.
    expect(r.costCents).toBe(32500);
    expect(r.qtyCosted).toBe(30);
    expect(r.qtyShort).toBe(0);
    expect(r.draws).toEqual([
      { layerId: 'A', qtyTaken: 20, costCents: 20000 },
      { layerId: 'B', qtyTaken: 10, costCents: 12500 },
    ]);
  });

  it('does not mutate the input layers', () => {
    const copy = LAYERS.map((l) => ({ ...l }));
    consumeFifo(30, LAYERS);
    expect(LAYERS).toEqual(copy);
  });

  it('draws entirely from the first layer when it covers the request', () => {
    const r = consumeFifo(15, LAYERS);
    expect(r.costCents).toBe(15000); // 15 @ $10
    expect(r.qtyCosted).toBe(15);
    expect(r.qtyShort).toBe(0);
    expect(r.draws).toEqual([{ layerId: 'A', qtyTaken: 15, costCents: 15000 }]);
  });

  it('consumes an exact layer boundary without touching the next layer', () => {
    const r = consumeFifo(20, LAYERS);
    expect(r.costCents).toBe(20000);
    expect(r.draws).toHaveLength(1);
    expect(r.draws[0]).toEqual({ layerId: 'A', qtyTaken: 20, costCents: 20000 });
  });

  it('reports an uncosted shortfall when layers cannot cover the request', () => {
    const r = consumeFifo(50, LAYERS); // only 40 on hand
    // 20 @ $10 + 20 @ $12.50 = $200 + $250 = $450 == 45000 cents; 10 short.
    expect(r.costCents).toBe(45000);
    expect(r.qtyCosted).toBe(40);
    expect(r.qtyShort).toBe(10);
    expect(r.draws).toHaveLength(2);
  });

  it('returns the whole request as shortfall when there are no open layers', () => {
    const r = consumeFifo(5, []);
    expect(r).toEqual({ qtyCosted: 0, qtyShort: 5, costCents: 0, draws: [] });
  });

  it('returns a zero result for a non-positive request', () => {
    expect(consumeFifo(0, LAYERS)).toEqual({ qtyCosted: 0, qtyShort: 0, costCents: 0, draws: [] });
    expect(consumeFifo(-3, LAYERS)).toEqual({ qtyCosted: 0, qtyShort: 0, costCents: 0, draws: [] });
  });

  it('skips drained / zero-remaining layers without spending them', () => {
    const layers: FifoLayerInput[] = [
      { id: 'drained', qtyRemaining: 0, unitCost: 99 },
      { id: 'live', qtyRemaining: 5, unitCost: 4 },
    ];
    const r = consumeFifo(3, layers);
    expect(r.costCents).toBe(1200); // 3 @ $4
    expect(r.draws).toEqual([{ layerId: 'live', qtyTaken: 3, costCents: 1200 }]);
  });

  it('handles fractional quantities and cost in exact cents (no float drift)', () => {
    // 0.1 + 0.2 style residue must not appear: 3 draws of 0.1 @ $0.10 each.
    const layers: FifoLayerInput[] = [
      { id: 'a', qtyRemaining: 0.1, unitCost: 0.1 },
      { id: 'b', qtyRemaining: 0.1, unitCost: 0.1 },
      { id: 'c', qtyRemaining: 0.1, unitCost: 0.1 },
    ];
    const r = consumeFifo(0.3, layers);
    // Each layer: round(0.1 * 10) = round(1) = 1 cent → 3 cents total.
    expect(r.costCents).toBe(3);
    expect(r.qtyCosted).toBeCloseTo(0.3, 10);
    expect(r.qtyShort).toBe(0);
  });

  it('rounds each layer cost independently (matching the per-layer DB rounding)', () => {
    // unit_cost $0.005 → 0.5 cents; 1 unit per layer rounds to 1 cent each (banker-free round-half-up).
    const layers: FifoLayerInput[] = [
      { id: 'x', qtyRemaining: 1, unitCost: 0.005 },
      { id: 'y', qtyRemaining: 1, unitCost: 0.005 },
    ];
    const r = consumeFifo(2, layers);
    // round(1 * 0.5) = round(0.5) = 1 (Math.round rounds .5 up); two layers → 2 cents.
    expect(r.costCents).toBe(2);
  });
});

describe('weightedAverageUnitCost', () => {
  it('computes the weighted average across open layers', () => {
    // (20×$10 + 20×$12.50) / 40 = $450 / 40 = $11.25.
    expect(weightedAverageUnitCost(LAYERS)).toBe(11.25);
  });

  it('returns 0 when nothing is on hand', () => {
    expect(weightedAverageUnitCost([])).toBe(0);
    expect(weightedAverageUnitCost([{ id: 'z', qtyRemaining: 0, unitCost: 7 }])).toBe(0);
  });

  it('matches a single-layer unit cost exactly', () => {
    expect(weightedAverageUnitCost([{ id: 's', qtyRemaining: 8, unitCost: 3.3333 }])).toBeCloseTo(
      3.3333,
      4
    );
  });
});

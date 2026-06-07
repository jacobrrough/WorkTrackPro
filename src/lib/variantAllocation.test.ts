import { describe, expect, it } from 'vitest';
import { buildPartVariantDefaults } from './variantAllocation';
import type { Part } from '@/core/types';

describe('buildPartVariantDefaults', () => {
  const part: Part = {
    id: 'part-1',
    partNumber: 'PN-100',
    name: 'Panel Set',
    rev: '01',
    laborHours: 6,
    requiresCNC: true,
    cncTimeHours: 2,
    requires3DPrint: true,
    printer3DTimeHours: 4,
    setComposition: { '-01': 1, '-02': 2 },
    variants: [
      { id: 'v1', partId: 'part-1', variantSuffix: '-01', laborHours: 2 },
      { id: 'v2', partId: 'part-1', variantSuffix: '-02' },
    ],
  };

  it('returns per-unit defaults and totals from part + dash quantities', () => {
    const result = buildPartVariantDefaults(part, { '-01': 2, '-02': 4 });

    expect(result.laborPerUnit['-01']).toBe(2);
    expect(result.laborPerUnit['-02']).toBe(2);
    expect(result.machinePerUnit['-01']).toEqual({
      cncHoursPerUnit: 2 / 3,
      printer3DHoursPerUnit: 4 / 3,
    });
    expect(result.machinePerUnit['-02']).toEqual({
      cncHoursPerUnit: 2 / 3,
      printer3DHoursPerUnit: 4 / 3,
    });

    expect(result.totals.laborHours).toBe(12);
    expect(result.totals.cncHours).toBe(4);
    expect(result.totals.printer3DHours).toBe(8);
  });

  it('uses each variant.laborHours per unit even when part.laborHours disagrees (quote parity)', () => {
    // Regression: the job card must match the quote calculator, which is variant-first.
    // Here part.laborHours (set-level, 9.5) is inconsistent with the variants' own per-unit
    // labor (1.37 each). The job must follow the variants, not distribute part.laborHours.
    const inconsistentPart: Part = {
      id: 'part-2',
      partNumber: 'SK-02P-0129',
      name: 'Intersecting Plug',
      rev: 'A',
      laborHours: 9.5,
      setComposition: { '-01': 1, '-02': 1, '-03': 1, '-04': 1 },
      variants: [
        { id: 'v1', partId: 'part-2', variantSuffix: '-01', laborHours: 1.37 },
        { id: 'v2', partId: 'part-2', variantSuffix: '-02', laborHours: 1.37 },
        { id: 'v3', partId: 'part-2', variantSuffix: '-03', laborHours: 1.38 },
        { id: 'v4', partId: 'part-2', variantSuffix: '-04', laborHours: 1.38 },
      ],
    };

    const result = buildPartVariantDefaults(inconsistentPart, {
      '-01': 4,
      '-02': 4,
      '-03': 4,
      '-04': 4,
    });

    // Per-unit follows variant.laborHours, NOT part.laborHours / setTotalUnits (9.5 / 4 = 2.375).
    expect(result.laborPerUnit['-01']).toBe(1.37);
    expect(result.laborPerUnit['-03']).toBe(1.38);
    // Total = sum(variant.laborHours x ordered qty), matching the quote, not 9.5-derived 37.92.
    expect(result.totals.laborHours).toBeCloseTo(22, 5);
  });

  it('does not inflate per-unit labor for variants whose set quantity is greater than one', () => {
    // Regression: the old getPartDerivedDefaultsForJob override stored a variant-GROUP total
    // (setLabor x qtyInSet / totalUnits) as a PER-UNIT value, which was then multiplied by the
    // ordered quantity again -> double-count whenever setComposition qty > 1.
    const part3: Part = {
      id: 'part-3',
      partNumber: 'PN-300',
      name: 'Set with qty>1',
      rev: '01',
      laborHours: 12,
      setComposition: { '-01': 1, '-02': 3 },
      variants: [
        { id: 'v1', partId: 'part-3', variantSuffix: '-01' },
        { id: 'v2', partId: 'part-3', variantSuffix: '-02' },
      ],
    };

    const result = buildPartVariantDefaults(part3, { '-01': 2, '-02': 6 });

    // setTotalUnits = 4, so genuine per-unit = 12 / 4 = 3 for every variant (no qtyInSet factor).
    expect(result.laborPerUnit['-01']).toBe(3);
    expect(result.laborPerUnit['-02']).toBe(3);
    // Total = 3 x 2 + 3 x 6 = 24 (not double-counted to 48).
    expect(result.totals.laborHours).toBe(24);
  });

  it('keeps variant.laborHours per unit when set quantity is greater than one (combined case)', () => {
    // Regression for the exact production bug: a variant that BOTH defines its own labor AND
    // appears more than once in the set. The old override looped over every variant and
    // overwrote its per-unit labor with setLabor x qtyInSet / totalUnits, double-inflating it.
    const part: Part = {
      id: 'part-4',
      partNumber: 'PN-400',
      name: 'Variant labor + qty>1',
      rev: '01',
      laborHours: 9.5,
      setComposition: { '-01': 1, '-02': 3 },
      variants: [
        { id: 'v1', partId: 'part-4', variantSuffix: '-01', laborHours: 1.37 },
        { id: 'v2', partId: 'part-4', variantSuffix: '-02', laborHours: 2.0 },
      ],
    };

    const result = buildPartVariantDefaults(part, { '-01': 4, '-02': 12 });

    // Each variant keeps its own per-unit labor; -02 is NOT inflated by qtyInSet=3.
    expect(result.laborPerUnit['-01']).toBe(1.37);
    expect(result.laborPerUnit['-02']).toBe(2.0);
    // Total = 1.37 x 4 + 2.0 x 12 = 29.48 (old bug would have given 9.5-distributed garbage).
    expect(result.totals.laborHours).toBeCloseTo(29.48, 5);
  });

  it('distributes part-level CNC/3D per unit without qtyInSet double-counting', () => {
    // Machine equivalent of the labor double-count guard: per-unit machine hours come from
    // part.cncTimeHours / setTotalUnits, never re-multiplied by the in-set quantity.
    const part: Part = {
      id: 'part-5',
      partNumber: 'PN-500',
      name: 'Machine qty>1',
      rev: '01',
      requiresCNC: true,
      cncTimeHours: 12,
      requires3DPrint: true,
      printer3DTimeHours: 8,
      setComposition: { '-01': 1, '-02': 3 },
      variants: [
        { id: 'v1', partId: 'part-5', variantSuffix: '-01' },
        { id: 'v2', partId: 'part-5', variantSuffix: '-02' },
      ],
    };

    const result = buildPartVariantDefaults(part, { '-01': 2, '-02': 6 });

    // setTotalUnits = 4: per-unit CNC = 12/4 = 3, per-unit 3D = 8/4 = 2 for every variant.
    expect(result.machinePerUnit['-01']).toEqual({ cncHoursPerUnit: 3, printer3DHoursPerUnit: 2 });
    expect(result.machinePerUnit['-02']).toEqual({ cncHoursPerUnit: 3, printer3DHoursPerUnit: 2 });
    expect(result.totals.cncHours).toBe(24); // 3 x 2 + 3 x 6
    expect(result.totals.printer3DHours).toBe(16); // 2 x 2 + 2 x 6
  });

  it('lets a variant define its own CNC while the other inherits the part distribution', () => {
    // A variant that defines its own CNC (cncTimeHours) wins; a variant that defines none
    // inherits the part-level CNC distributed per unit.
    const part: Part = {
      id: 'part-6',
      partNumber: 'PN-600',
      name: 'Variant CNC override',
      rev: '01',
      requiresCNC: true,
      cncTimeHours: 12,
      setComposition: { '-01': 1, '-02': 1 },
      variants: [
        { id: 'v1', partId: 'part-6', variantSuffix: '-01', requiresCNC: true, cncTimeHours: 5 },
        { id: 'v2', partId: 'part-6', variantSuffix: '-02' },
      ],
    };

    const result = buildPartVariantDefaults(part, { '-01': 2, '-02': 2 });

    // -01 uses its own CNC (5/unit); -02 inherits part CNC: 12 / setTotalUnits(2) = 6/unit.
    expect(result.machinePerUnit['-01']?.cncHoursPerUnit).toBe(5);
    expect(result.machinePerUnit['-02']?.cncHoursPerUnit).toBe(6);
  });

  it('emits zero machine hours when neither part nor variant requires CNC/3D', () => {
    // The requiresCNC / requires3DPrint gate: no machine requirement anywhere => 0 per unit,
    // even if stray time values are present, so non-machined variants are never charged.
    const part: Part = {
      id: 'part-7',
      partNumber: 'PN-700',
      name: 'No machine required',
      rev: '01',
      laborHours: 4,
      requiresCNC: false,
      requires3DPrint: false,
      setComposition: { '-01': 1, '-02': 1 },
      variants: [
        { id: 'v1', partId: 'part-7', variantSuffix: '-01' },
        { id: 'v2', partId: 'part-7', variantSuffix: '-02' },
      ],
    };

    const result = buildPartVariantDefaults(part, { '-01': 2, '-02': 2 });

    expect(result.machinePerUnit['-01']).toEqual({ cncHoursPerUnit: 0, printer3DHoursPerUnit: 0 });
    expect(result.machinePerUnit['-02']).toEqual({ cncHoursPerUnit: 0, printer3DHoursPerUnit: 0 });
    expect(result.totals.cncHours).toBe(0);
    expect(result.totals.printer3DHours).toBe(0);
  });
});

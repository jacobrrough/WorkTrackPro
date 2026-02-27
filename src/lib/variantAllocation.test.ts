import { describe, expect, it } from 'vitest';
import { buildPartVariantDefaults } from './variantAllocation';
import type { Part } from '@/core/types';

describe('buildPartVariantDefaults', () => {
  const part: Part = {
    id: 'part-1',
    partNumber: 'PN-100',
    name: 'Panel Set',
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
});

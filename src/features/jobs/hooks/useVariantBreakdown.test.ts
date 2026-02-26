import { describe, expect, it } from 'vitest';
import { buildPersistedVariantBreakdowns } from './variantBreakdownUtils';

describe('buildPersistedVariantBreakdowns', () => {
  it('maps computed allocation entries into persisted labor/machine breakdown objects', () => {
    const entries = [
      {
        suffix: '-01',
        qty: 4,
        laborHoursPerUnit: 1.5,
        laborHoursTotal: 6,
        cncHoursPerUnit: 0.25,
        cncHoursTotal: 1,
        printer3DHoursPerUnit: 0.5,
        printer3DHoursTotal: 2,
      },
    ];

    const { persistedLaborBreakdown, persistedMachineBreakdown } =
      buildPersistedVariantBreakdowns(entries);

    expect(persistedLaborBreakdown['-01']).toEqual({
      qty: 4,
      hoursPerUnit: 1.5,
      totalHours: 6,
    });
    expect(persistedMachineBreakdown['-01']).toEqual({
      qty: 4,
      cncHoursPerUnit: 0.25,
      cncHoursTotal: 1,
      printer3DHoursPerUnit: 0.5,
      printer3DHoursTotal: 2,
    });
  });
});

import { describe, expect, it } from 'vitest';
import type { InventoryItem, Part, PartMaterial } from '@/core/types';
import { buildSyntheticPartUpdates, type SyntheticUpdateOptions } from './syntheticPartPrice';

// Unit prices chosen so 0.25 sheet = $22.50 and 0.5 yd = $2.88 (the reported part's line
// our-costs), giving $25.38 our / $57.11 customer materials — matches SK-F35-1184.
const INVENTORY: InventoryItem[] = [
  { id: 'inv-poly', name: '2" WHITE POLYETH', price: 90 } as InventoryItem,
  { id: 'inv-herc', name: 'Red Herc 18OZ', price: 5.76 } as InventoryItem,
];

const MATERIALS: PartMaterial[] = [
  { id: 'm1', inventoryId: 'inv-poly', quantityPerUnit: 0.25, unit: 'SHEET', usageType: 'per_set' },
  { id: 'm2', inventoryId: 'inv-herc', quantityPerUnit: 0.5, unit: 'yards', usageType: 'per_set' },
];

/** Forward total from the same inputs the helper uses, for a given labor-hours value. */
function forwardTotal(laborHours: number): number {
  const materialsCustomer = (0.25 * 90 + 0.5 * 5.76) * 2.25;
  return Number((materialsCustomer + laborHours * 175 + 1.25 * 150).toFixed(2));
}

function makePart(overrides: Partial<Part> = {}): Part {
  return {
    id: 'p1',
    partNumber: 'SK-F35-1184',
    name: 'DAS TUNNEL COVER',
    rev: '--',
    laborHours: 5.25,
    requiresCNC: true,
    cncTimeHours: 1.25,
    requires3DPrint: false,
    materials: MATERIALS,
    pricePerSet: 873.53, // intentionally stale, like the reported bug
    ...overrides,
  } as Part;
}

const OPTS: SyntheticUpdateOptions = {
  canViewFinancials: true,
  inventoryLoaded: true,
  settingsReady: true,
  inventoryItems: INVENTORY,
  laborRate: 175,
  cncRate: 150,
  printer3DRate: 100,
};

const FORWARD = forwardTotal(5.25);

describe('buildSyntheticPartUpdates', () => {
  it('resyncs the stale stored price to forward math on a labor change', () => {
    const partUpdates = buildSyntheticPartUpdates(
      { laborHours: 5.25 },
      makePart({ laborHours: 4 }), // base has old labor; update bumps it to 5.25
      OPTS
    );
    expect(partUpdates.laborHours).toBe(5.25);
    expect(partUpdates.pricePerSet).toBe(FORWARD);
    // Reproduces the reported bug: stale $873.53 heals to ~$1163.34 forward.
    expect(FORWARD).toBeGreaterThan(1163);
    expect(FORWARD).toBeLessThan(1164);
  });

  it('honors a manually typed price verbatim without forward math', () => {
    const partUpdates = buildSyntheticPartUpdates({ pricePerVariant: 999.99 }, makePart(), OPTS);
    expect(partUpdates.pricePerSet).toBe(999.99);
  });

  it('drops an unchanged field so a tab-through is a no-op (no write, no resync)', () => {
    const partUpdates = buildSyntheticPartUpdates(
      { requiresCNC: true }, // already true on the base part
      makePart(),
      OPTS
    );
    expect(partUpdates).toEqual({});
  });

  it('records the cost change but writes no price when inventory has not loaded', () => {
    const partUpdates = buildSyntheticPartUpdates({ laborHours: 6 }, makePart(), {
      ...OPTS,
      inventoryLoaded: false,
    });
    expect(partUpdates.laborHours).toBe(6);
    expect(partUpdates.pricePerSet).toBeUndefined();
  });

  it('still resyncs with inventory unloaded when the part has no materials', () => {
    const partUpdates = buildSyntheticPartUpdates(
      { laborHours: 2 },
      makePart({ materials: [], pricePerSet: 0 }),
      { ...OPTS, inventoryLoaded: false }
    );
    expect(partUpdates.pricePerSet).toBe(Number((2 * 175 + 1.25 * 150).toFixed(2)));
  });

  it('writes no price while org-settings rates are still hydrating', () => {
    const partUpdates = buildSyntheticPartUpdates({ laborHours: 6 }, makePart(), {
      ...OPTS,
      settingsReady: false,
    });
    expect(partUpdates.pricePerSet).toBeUndefined();
  });

  it('never writes a $0 total over an existing stored price', () => {
    const partUpdates = buildSyntheticPartUpdates(
      { laborHours: 0 },
      makePart({ materials: [], requiresCNC: false, cncTimeHours: 0, pricePerSet: 500 }),
      OPTS
    );
    expect(partUpdates.laborHours).toBe(0);
    expect(partUpdates.pricePerSet).toBeUndefined(); // 500 preserved
  });

  it('skips a no-op price write when forward equals the stored price', () => {
    const partUpdates = buildSyntheticPartUpdates(
      { laborHours: 5.25 },
      makePart({ laborHours: 4, pricePerSet: FORWARD }), // already in sync
      OPTS
    );
    expect(partUpdates.laborHours).toBe(5.25);
    expect(partUpdates.pricePerSet).toBeUndefined();
  });

  it('writes no price for a non-financial user but still records the cost change', () => {
    const partUpdates = buildSyntheticPartUpdates({ laborHours: 7 }, makePart({ laborHours: 4 }), {
      ...OPTS,
      canViewFinancials: false,
    });
    expect(partUpdates.laborHours).toBe(7);
    expect(partUpdates.pricePerSet).toBeUndefined();
  });

  it('lets an explicit "Use auto" clear a manual price down to $0 on a zero-cost part', () => {
    // hasCostChange would keep the $0 guard, but an explicit price-clear is the admin
    // dropping their manual override and must be honored.
    const partUpdates = buildSyntheticPartUpdates(
      { pricePerVariant: undefined },
      makePart({
        laborHours: 0,
        materials: [],
        requiresCNC: false,
        cncTimeHours: 0,
        pricePerSet: 500,
      }),
      OPTS
    );
    expect(partUpdates.pricePerSet).toBe(0);
  });

  it('resyncs on "Use auto" (price cleared) even with no cost field change', () => {
    const partUpdates = buildSyntheticPartUpdates(
      { pricePerVariant: undefined },
      makePart({ laborHours: 4, pricePerSet: 1 }),
      OPTS
    );
    expect(partUpdates.pricePerSet).toBe(forwardTotal(4));
  });
});

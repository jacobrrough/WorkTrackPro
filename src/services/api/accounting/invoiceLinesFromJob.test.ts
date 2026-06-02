import { describe, it, expect } from 'vitest';
import type { InventoryItem, Job, Part } from '../../../core/types';
import { calculatePartQuote } from '../../../lib/partsCalculations';
import { buildInvoiceLinesFromJob, setsForPart } from './invoiceLinesFromJob';

const makeInventory = (id: string, price: number): InventoryItem =>
  ({
    id,
    name: `INV-${id}`,
    category: 'material',
    inStock: 100,
    available: 100,
    disposed: 0,
    onOrder: 0,
    unit: 'ea',
    price,
  }) as InventoryItem;

const SETTINGS = { laborRate: 175, cncRate: 150, printer3DRate: 100 };

function makePart(): Part {
  return {
    id: 'part-1',
    partNumber: 'P-100',
    name: 'Bracket',
    rev: '--',
    laborHours: 1,
    requiresCNC: false,
    requires3DPrint: false,
    materials: [
      { id: 'm-1', inventoryId: 'inv-1', quantityPerUnit: 2, unit: 'ea', usageType: 'per_set' },
    ],
    variants: [],
    setComposition: {},
  } as unknown as Part;
}

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    jobCode: 4242,
    name: 'Bracket run',
    active: true,
    status: 'inProgress',
    boardType: 'shopFloor',
    attachments: [],
    attachmentCount: 0,
    comments: [],
    commentCount: 0,
    inventoryItems: [],
    assignedUsers: [],
    isRush: false,
    workers: [],
    partNumber: 'P-100',
    dashQuantities: { '01': 3 },
    ...overrides,
  } as Job;
}

describe('setsForPart', () => {
  it('uses summed dash quantities when there is no set composition', () => {
    const part = makePart();
    expect(setsForPart(part, { '01': 3 })).toBe(3);
  });

  it('computes complete sets from a set composition', () => {
    const part = { ...makePart(), setComposition: { '-01': 2, '-02': 1 } } as Part;
    // 6 of -01 (need 2/set => 3 sets) and 4 of -02 (need 1/set => 4 sets) => min = 3
    expect(setsForPart(part, { '01': 6, '02': 4 })).toBe(3);
  });

  it('falls back to 1 when a part is linked but no quantities are present', () => {
    expect(setsForPart(makePart(), {})).toBe(1);
  });
});

describe('buildInvoiceLinesFromJob', () => {
  const inventory = [makeInventory('inv-1', 5)];

  it('produces one line whose total equals calculatePartQuote (the on-screen quote)', () => {
    const part = makePart();
    const job = makeJob({ dashQuantities: { '01': 3 } });

    // The on-screen quote for 3 sets at the same rates:
    const expected = calculatePartQuote(part, 3, inventory, {
      laborRate: SETTINGS.laborRate,
      cncRate: SETTINGS.cncRate,
      printer3DRate: SETTINGS.printer3DRate,
      overrideLaborHours: part.laborHours,
    });
    expect(expected).not.toBeNull();

    const lines = buildInvoiceLinesFromJob({
      job,
      parts: [part],
      inventory,
      settings: SETTINGS,
      incomeAccountId: 'acc-sales',
      taxCodeId: 'tax-1',
    });

    expect(lines).toHaveLength(1);
    expect(lines[0].lineTotal).toBeCloseTo(Math.round((expected!.total ?? 0) * 100) / 100, 2);
    expect(lines[0].quantity).toBe(3);
    expect(lines[0].jobId).toBe('job-1');
    expect(lines[0].incomeAccountId).toBe('acc-sales');
    expect(lines[0].taxCodeId).toBe('tax-1');
    // unitPrice * quantity reconstructs the total (within rounding)
    expect((lines[0].unitPrice ?? 0) * (lines[0].quantity ?? 0)).toBeCloseTo(
      lines[0].lineTotal!,
      1
    );
  });

  it("anchors to a part's stored pricePerSet (manualSetPrice), matching the calculator", () => {
    const part = { ...makePart(), pricePerSet: 9300 } as Part;
    const job = makeJob({ dashQuantities: { '01': 1 } });

    const expected = calculatePartQuote(part, 1, inventory, {
      laborRate: SETTINGS.laborRate,
      cncRate: SETTINGS.cncRate,
      printer3DRate: SETTINGS.printer3DRate,
      manualSetPrice: 9300,
    });
    const lines = buildInvoiceLinesFromJob({ job, parts: [part], inventory, settings: SETTINGS });

    expect(lines).toHaveLength(1);
    expect(lines[0].lineTotal).toBeCloseTo(expected!.total, 2);
    expect(lines[0].lineTotal).toBeCloseTo(9300, 2);
  });

  it('emits one line per linked part for a multi-part job', () => {
    const partA = makePart();
    const partB = { ...makePart(), id: 'part-2', partNumber: 'P-200', name: 'Plate' } as Part;
    const job = makeJob({
      partNumber: undefined,
      dashQuantities: undefined,
      parts: [
        { partId: 'part-1', partNumber: 'P-100', dashQuantities: { '01': 1 } },
        { partId: 'part-2', partNumber: 'P-200', dashQuantities: { '01': 2 } },
      ],
    });
    const lines = buildInvoiceLinesFromJob({
      job,
      parts: [partA, partB],
      inventory,
      settings: SETTINGS,
    });
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.jobId)).toEqual(['job-1', 'job-1']);
  });

  it('falls back to the job inventory BOM when no part can be quoted', () => {
    const job = makeJob({
      partNumber: undefined,
      dashQuantities: undefined,
      parts: [],
      inventoryItems: [{ id: 'ji-1', inventoryId: 'inv-1', quantity: 4, unit: 'ea' }],
    });
    const lines = buildInvoiceLinesFromJob({
      job,
      parts: [],
      inventory,
      settings: { ...SETTINGS, materialMultiplier: 2 },
    });
    expect(lines).toHaveLength(1);
    // 4 * $5 * 2 = $40
    expect(lines[0].lineTotal).toBeCloseTo(40, 2);
    expect(lines[0].jobId).toBe('job-1');
  });

  it('returns no lines when there is nothing to invoice', () => {
    const job = makeJob({
      partNumber: undefined,
      dashQuantities: undefined,
      parts: [],
      inventoryItems: [],
    });
    expect(buildInvoiceLinesFromJob({ job, parts: [], inventory, settings: SETTINGS })).toEqual([]);
  });
});

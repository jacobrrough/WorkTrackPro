import { describe, it, expect } from 'vitest';
import type { InventoryItem, Job, Part } from '../../../core/types';
import { calculatePartQuote } from '../../../lib/partsCalculations';
import { buildInvoiceLinesFromJob, setsForPart, jobPartLinks } from './invoiceLinesFromJob';

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

  it('normalizes composition suffixes regardless of dash form (01/02, -1)', () => {
    // The real on-screen shape keys setComposition as bare/zero-padded suffixes ('01').
    // Normalization must match these to the zero-padded dash keys (-01, -02) instead of
    // collapsing to the summed dash quantity (which would over-bill 10 "sets").
    const padded = { ...makePart(), setComposition: { '01': 2, '02': 1 } } as Part;
    expect(setsForPart(padded, { '01': 6, '02': 4 })).toBe(3);

    // Single-dash, single-digit suffix ('-1') resolves to the same -01 dash key.
    const singleDash = { ...makePart(), setComposition: { '-1': 2 } } as Part;
    expect(setsForPart(singleDash, { '01': 6 })).toBe(3);
  });

  it('invoices a single set when a composition is declared but no complete set exists', () => {
    // Need 2 of -01 per set but only 1 on the job: 0 complete sets. Must NOT sum every
    // dash quantity (which would inflate the unit/set count); fall back to 1.
    const part = { ...makePart(), setComposition: { '01': 2 } } as Part;
    expect(setsForPart(part, { '01': 1, '02': 99 })).toBe(1);
  });

  it('falls back to 1 when a part is linked but no quantities are present', () => {
    expect(setsForPart(makePart(), {})).toBe(1);
  });
});

describe('jobPartLinks', () => {
  it('returns the multi-part list when present', () => {
    const job = makeJob({
      partNumber: undefined,
      dashQuantities: undefined,
      parts: [
        { partId: 'part-1', partNumber: 'P-100', dashQuantities: { '01': 1 } },
        { partId: 'part-2', partNumber: 'P-200', dashQuantities: { '01': 2 } },
      ],
    });
    expect(jobPartLinks(job)).toEqual([
      { partId: 'part-1', partNumber: 'P-100', dashQuantities: { '01': 1 } },
      { partId: 'part-2', partNumber: 'P-200', dashQuantities: { '01': 2 } },
    ]);
  });

  it('falls back to the primary part (number + dash quantities) when there is no list', () => {
    const job = makeJob({ partNumber: 'P-100', dashQuantities: { '01': 3 }, parts: undefined });
    expect(jobPartLinks(job)).toEqual([
      { partId: undefined, partNumber: 'P-100', dashQuantities: { '01': 3 } },
    ]);
  });

  it('returns no links when the job has neither a parts list nor a part number', () => {
    const job = makeJob({ partNumber: undefined, dashQuantities: undefined, parts: undefined });
    expect(jobPartLinks(job)).toEqual([]);
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
    // The line LINKS the resolved part (resolved here by part number) so the document is synced.
    expect(lines[0].partId).toBe('part-1');
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
    // Each line links its own part.
    expect(lines.map((l) => l.partId)).toEqual(['part-1', 'part-2']);
  });

  it('resolves a part whose number differs only by case (job carries a lowercase number)', () => {
    const part = makePart(); // partNumber 'P-100'
    const job = makeJob({ partNumber: 'p-100', dashQuantities: { '01': 1 } });
    const lines = buildInvoiceLinesFromJob({ job, parts: [part], inventory, settings: SETTINGS });
    expect(lines).toHaveLength(1);
    expect(lines[0].partId).toBe('part-1');
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
    // A BOM fallback line links no part (there is none to link).
    expect(lines[0].partId == null).toBe(true);
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

  describe('quoted price snapshot', () => {
    it('bills the saved snapshot, not the live re-quote, when quotedPrice is present', () => {
      const part = makePart();
      const job = makeJob({ dashQuantities: { '01': 3 }, quotedPrice: 1234.56 });

      const lines = buildInvoiceLinesFromJob({ job, parts: [part], inventory, settings: SETTINGS });

      expect(lines).toHaveLength(1);
      // The part stays linked even on the snapshot path.
      expect(lines[0].partId).toBe('part-1');
      // The line total equals the snapshot exactly, regardless of what the part re-quotes to.
      expect(lines[0].lineTotal).toBeCloseTo(1234.56, 2);
      // unitPrice * quantity still reconstructs the (snapshot) total within rounding.
      expect((lines[0].unitPrice ?? 0) * (lines[0].quantity ?? 0)).toBeCloseTo(
        lines[0].lineTotal!,
        1
      );
    });

    it('does NOT change the invoice line total when the part is edited after the snapshot', () => {
      const job = makeJob({ dashQuantities: { '01': 3 }, quotedPrice: 1234.56 });

      // Original part used at quote time.
      const original = makePart();
      const before = buildInvoiceLinesFromJob({
        job,
        parts: [original],
        inventory,
        settings: SETTINGS,
      });

      // Simulate editing the part AFTER the job was created: bump labor + add materials so
      // a live re-quote would be materially different/higher.
      const editedPart = {
        ...makePart(),
        laborHours: 99,
        pricePerSet: 50000,
        materials: [
          {
            id: 'm-1',
            inventoryId: 'inv-1',
            quantityPerUnit: 200,
            unit: 'ea',
            usageType: 'per_set',
          },
        ],
      } as unknown as Part;
      const after = buildInvoiceLinesFromJob({
        job,
        parts: [editedPart],
        inventory,
        settings: SETTINGS,
      });

      // Snapshot wins both times: the edit does not move the invoice total.
      expect(before[0].lineTotal).toBeCloseTo(1234.56, 2);
      expect(after[0].lineTotal).toBeCloseTo(1234.56, 2);
      expect(after[0].lineTotal).toBeCloseTo(before[0].lineTotal!, 2);

      // Sanity: a re-quote of the edited part really would differ (so the test is meaningful) —
      // i.e. without the snapshot the total would have moved.
      const noSnapshot = buildInvoiceLinesFromJob({
        job: { ...job, quotedPrice: undefined },
        parts: [editedPart],
        inventory,
        settings: SETTINGS,
      });
      expect(noSnapshot[0].lineTotal).not.toBeCloseTo(1234.56, 2);
    });

    it('falls back to the live re-quote when no snapshot is present (older jobs)', () => {
      const part = makePart();
      const job = makeJob({ dashQuantities: { '01': 3 } }); // no quotedPrice

      const expected = calculatePartQuote(part, 3, inventory, {
        laborRate: SETTINGS.laborRate,
        cncRate: SETTINGS.cncRate,
        printer3DRate: SETTINGS.printer3DRate,
        overrideLaborHours: part.laborHours,
      });

      const lines = buildInvoiceLinesFromJob({ job, parts: [part], inventory, settings: SETTINGS });
      expect(lines).toHaveLength(1);
      expect(lines[0].lineTotal).toBeCloseTo(Math.round((expected!.total ?? 0) * 100) / 100, 2);
    });

    it('ignores a non-finite or non-positive snapshot and re-quotes', () => {
      const part = makePart();
      const expected = calculatePartQuote(part, 3, inventory, {
        laborRate: SETTINGS.laborRate,
        cncRate: SETTINGS.cncRate,
        printer3DRate: SETTINGS.printer3DRate,
        overrideLaborHours: part.laborHours,
      });
      const expectedTotal = Math.round((expected!.total ?? 0) * 100) / 100;

      for (const bad of [0, -10, Number.NaN]) {
        const job = makeJob({ dashQuantities: { '01': 3 }, quotedPrice: bad });
        const lines = buildInvoiceLinesFromJob({
          job,
          parts: [part],
          inventory,
          settings: SETTINGS,
        });
        expect(lines[0].lineTotal).toBeCloseTo(expectedTotal, 2);
      }
    });

    it('splits a multi-part snapshot across lines so the invoice sum equals the snapshot', () => {
      const partA = makePart();
      const partB = { ...makePart(), id: 'part-2', partNumber: 'P-200', name: 'Plate' } as Part;
      const job = makeJob({
        partNumber: undefined,
        dashQuantities: undefined,
        quotedPrice: 1000,
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
      const sum = lines.reduce((s, l) => s + (l.lineTotal ?? 0), 0);
      expect(sum).toBeCloseTo(1000, 2);
    });
  });
});

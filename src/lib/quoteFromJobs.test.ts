import { describe, it, expect } from 'vitest';
import type { Job, Shift, InventoryItem } from '@/core/types';
import { buildQuoteFromJobs } from './quoteFromJobs';

const mockJob = (overrides: Partial<Job> = {}): Job => ({
  id: 'job-1',
  jobCode: 1000,
  name: 'Widget',
  active: true,
  status: 'toBeQuoted',
  boardType: 'shopFloor',
  attachments: [],
  attachmentCount: 0,
  comments: [],
  commentCount: 0,
  inventoryItems: [],
  assignedUsers: [],
  isRush: false,
  workers: [],
  ...overrides,
});

// A completed 8h shift (no breaks) → 8 logged hours.
const completedShift = (job: string, hours: number, id = `s-${job}`): Shift => {
  const start = new Date('2026-01-01T08:00:00Z').getTime();
  return {
    id,
    user: 'u1',
    job,
    clockInTime: new Date(start).toISOString(),
    clockOutTime: new Date(start + hours * 3600000).toISOString(),
    lunchMinutesUsed: 0,
  };
};

// A pending shift (no clock-out) → contributes 0.
const pendingShift = (job: string, id = `p-${job}`): Shift => ({
  id,
  user: 'u1',
  job,
  clockInTime: new Date('2026-01-01T08:00:00Z').toISOString(),
});

const cncBreakdown = (cncHoursTotal: number): Job['machineBreakdownByVariant'] => ({
  '-01': {
    qty: 1,
    cncHoursPerUnit: cncHoursTotal,
    cncHoursTotal,
    printer3DHoursPerUnit: 0,
    printer3DHoursTotal: 0,
  },
});

const invLines = (lines: Array<{ inv: string; qty: number; unit?: string }>): Job['expand'] => ({
  job_inventory_via_job: lines.map((l, i) => ({
    id: `ji-${i}`,
    inventory: l.inv,
    quantity: l.qty,
    unit: l.unit ?? 'units',
  })),
});

const inventory: InventoryItem[] = [
  {
    id: 'inv-A',
    name: 'Aluminum',
    category: 'rawMaterial',
    inStock: 0,
    available: 0,
    disposed: 0,
    onOrder: 0,
    price: 5,
    unit: 'sheet',
  },
  {
    id: 'inv-B',
    name: 'Bolt',
    category: 'hardware',
    inStock: 0,
    available: 0,
    disposed: 0,
    onOrder: 0,
    price: 1,
    unit: 'each',
  },
];

describe('buildQuoteFromJobs', () => {
  it('returns all zeros and no contributors when every job is empty', () => {
    const jobs = [mockJob({ id: 'a' }), mockJob({ id: 'b' })];
    const result = buildQuoteFromJobs(jobs, [pendingShift('a'), pendingShift('b')], inventory);

    expect(result.laborHours).toBe(0);
    expect(result.cncHours).toBe(0);
    expect(result.materials).toEqual([]);
    expect(result.matchedCount).toBe(2);
    expect(result.contributedCount).toBe(0);
    expect(result.referenceJobIds).toEqual([]);
  });

  it('excludes no-history jobs from the labor average (the core fix)', () => {
    // One job logged 10h, two matched jobs logged nothing.
    const jobs = [mockJob({ id: 'a' }), mockJob({ id: 'b' }), mockJob({ id: 'c' })];
    const shifts = [completedShift('a', 10), pendingShift('b')];
    const result = buildQuoteFromJobs(jobs, shifts, inventory);

    // Old behavior would be 10/3 ≈ 3.33; fixed behavior averages only the costed job.
    expect(result.laborHours).toBe(10);
    expect(result.laborContributorCount).toBe(1);
    expect(result.matchedCount).toBe(3);
    expect(result.contributedCount).toBe(1);
    expect(result.referenceJobIds).toEqual(['a']);
  });

  it('averages labor only over jobs that logged labor', () => {
    const jobs = [mockJob({ id: 'a' }), mockJob({ id: 'b' }), mockJob({ id: 'c' })];
    const shifts = [completedShift('a', 8), completedShift('b', 4)]; // c has none
    const result = buildQuoteFromJobs(jobs, shifts, inventory);

    expect(result.laborHours).toBe(6); // (8 + 4) / 2, not / 3
    expect(result.laborContributorCount).toBe(2);
  });

  it('averages CNC only over jobs with CNC time (CNC-only job)', () => {
    const jobs = [
      mockJob({ id: 'a', machineBreakdownByVariant: cncBreakdown(6) }),
      mockJob({ id: 'b' }), // no CNC, no labor → fully empty
    ];
    const result = buildQuoteFromJobs(jobs, [], inventory);

    expect(result.cncHours).toBe(6); // 6 / 1, not 6 / 2
    expect(result.cncContributorCount).toBe(1);
    expect(result.laborHours).toBe(0);
    expect(result.contributedCount).toBe(1);
    expect(result.referenceJobIds).toEqual(['a']);
  });

  it('treats labor-only and CNC-only jobs as independent contributors', () => {
    const jobs = [
      mockJob({ id: 'labor', machineBreakdownByVariant: cncBreakdown(0) }),
      mockJob({ id: 'cnc', machineBreakdownByVariant: cncBreakdown(5) }),
    ];
    const shifts = [completedShift('labor', 9)];
    const result = buildQuoteFromJobs(jobs, shifts, inventory);

    expect(result.laborHours).toBe(9); // only the labor job
    expect(result.cncHours).toBe(5); // only the cnc job
    expect(result.laborContributorCount).toBe(1);
    expect(result.cncContributorCount).toBe(1);
    expect(result.contributedCount).toBe(2);
    expect(result.referenceJobIds.sort()).toEqual(['cnc', 'labor']);
  });

  it('averages a material over jobs that consumed inventory, treating non-users as true zeros', () => {
    // Bolt used in 1 of 2 inventory-consuming jobs at qty 100 → expected per-job ≈ 50.
    const jobs = [
      mockJob({
        id: 'a',
        expand: invLines([
          { inv: 'inv-A', qty: 10 },
          { inv: 'inv-B', qty: 100 },
        ]),
      }),
      mockJob({ id: 'b', expand: invLines([{ inv: 'inv-A', qty: 20 }]) }),
    ];
    const result = buildQuoteFromJobs(jobs, [], inventory);

    const al = result.materials.find((m) => m.inventoryId === 'inv-A')!;
    const bolt = result.materials.find((m) => m.inventoryId === 'inv-B')!;
    expect(al.quantity).toBe(15); // (10 + 20) / 2
    expect(bolt.quantity).toBe(50); // 100 / 2 (non-user counted as zero, not dropped)
    expect(al.unitCost).toBe(5);
    expect(result.materialContributorCount).toBe(2);
  });

  it('does not let an inventory-less job dilute the material average', () => {
    const jobs = [
      mockJob({ id: 'a', expand: invLines([{ inv: 'inv-A', qty: 30 }]) }),
      mockJob({ id: 'b' }), // no inventory at all
    ];
    const result = buildQuoteFromJobs(jobs, [], inventory);

    const al = result.materials.find((m) => m.inventoryId === 'inv-A')!;
    expect(al.quantity).toBe(30); // 30 / 1, not 30 / 2
    expect(result.materialContributorCount).toBe(1);
  });

  it('ignores inventory lines that do not resolve to a known item', () => {
    const jobs = [mockJob({ id: 'a', expand: invLines([{ inv: 'inv-MISSING', qty: 99 }]) })];
    const result = buildQuoteFromJobs(jobs, [], inventory);

    expect(result.materials).toEqual([]);
    expect(result.materialContributorCount).toBe(0);
    expect(result.contributedCount).toBe(0);
  });

  it('handles a single fully-costed job across all three components', () => {
    const jobs = [
      mockJob({
        id: 'a',
        machineBreakdownByVariant: cncBreakdown(3),
        expand: invLines([{ inv: 'inv-A', qty: 4 }]),
      }),
    ];
    const result = buildQuoteFromJobs(jobs, [completedShift('a', 12)], inventory);

    expect(result.laborHours).toBe(12);
    expect(result.cncHours).toBe(3);
    expect(result.materials[0].quantity).toBe(4);
    expect(result.contributedCount).toBe(1);
    expect(result.matchedCount).toBe(1);
  });

  it('does not let a zero-quantity line make a job a material contributor', () => {
    // Job a has a real material; job b has only a zero-qty placeholder line.
    const jobs = [
      mockJob({ id: 'a', expand: invLines([{ inv: 'inv-A', qty: 30 }]) }),
      mockJob({ id: 'b', expand: invLines([{ inv: 'inv-B', qty: 0 }]) }),
    ];
    const result = buildQuoteFromJobs(jobs, [], inventory);

    const al = result.materials.find((m) => m.inventoryId === 'inv-A')!;
    expect(al.quantity).toBe(30); // divided by 1, not 2
    expect(result.materials.find((m) => m.inventoryId === 'inv-B')).toBeUndefined();
    expect(result.materialContributorCount).toBe(1);
    expect(result.contributedCount).toBe(1);
    expect(result.referenceJobIds).toEqual(['a']);
  });

  it('ignores negative and non-numeric material quantities', () => {
    const jobs = [
      mockJob({ id: 'a', expand: invLines([{ inv: 'inv-A', qty: -5 }]) }),
      mockJob({
        id: 'b',
        // Untyped runtime data can deliver a non-number; it must not poison the sum.
        expand: {
          job_inventory_via_job: [
            { id: 'x', inventory: 'inv-A', quantity: 'oops', unit: 'sheet' } as never,
          ],
        },
      }),
    ];
    const result = buildQuoteFromJobs(jobs, [], inventory);

    expect(result.materials).toEqual([]);
    expect(result.materialContributorCount).toBe(0);
  });

  it('counts a job appearing twice in the matched set only once', () => {
    const job = mockJob({ id: 'dup', expand: invLines([{ inv: 'inv-A', qty: 10 }]) });
    const result = buildQuoteFromJobs([job, job], [completedShift('dup', 8)], inventory);

    expect(result.matchedCount).toBe(1);
    expect(result.laborHours).toBe(8); // not 16/2 or 8/2 — counted once
    expect(result.materials[0].quantity).toBe(10); // not 20/1
    expect(result.referenceJobIds).toEqual(['dup']);
  });

  it('sums repeated lines of the same item within one job, then averages', () => {
    const jobs = [
      mockJob({
        id: 'a',
        expand: invLines([
          { inv: 'inv-A', qty: 4 },
          { inv: 'inv-A', qty: 6 },
        ]),
      }),
    ];
    const result = buildQuoteFromJobs(jobs, [], inventory);

    expect(result.materials).toHaveLength(1);
    expect(result.materials[0].quantity).toBe(10); // 4 + 6 over 1 contributor
  });

  it('reads inventory from the job_inventory fallback expand key', () => {
    const jobs = [
      mockJob({
        id: 'a',
        expand: { job_inventory: [{ id: 'x', inventory: 'inv-A', quantity: 7, unit: 'sheet' }] },
      }),
    ];
    const result = buildQuoteFromJobs(jobs, [], inventory);

    expect(result.materials[0].quantity).toBe(7);
    expect(result.materialContributorCount).toBe(1);
  });
});

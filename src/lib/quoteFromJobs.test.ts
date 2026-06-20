import { describe, it, expect } from 'vitest';
import type { Job, JobStatus, Shift, InventoryItem } from '@/core/types';
import { buildQuoteFromJobs, QUOTE_REFERENCE_STATUSES } from './quoteFromJobs';

// Default to a completed build so the math-focused tests exercise eligible jobs.
// Status-filter behavior is covered by its own block below.
const mockJob = (overrides: Partial<Job> = {}): Job => ({
  id: 'job-1',
  jobCode: 1000,
  name: 'Widget',
  active: true,
  status: 'finished',
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
    category: 'material',
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
    expect(result.contributorCount).toBe(0);
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
    expect(result.contributorCount).toBe(1);
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
    expect(result.contributorCount).toBe(1);
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
    expect(result.contributorCount).toBe(2);
    expect(result.referenceJobIds.sort()).toEqual(['cnc', 'labor']);
  });

  it('averages each material only over the jobs that used that item', () => {
    // Aluminum used in both jobs; Bolt used in only one. Each item is divided by its own
    // consumer count, so a one-job item reflects that job's quantity, not half of it.
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
    expect(al.quantity).toBe(15); // (10 + 20) / 2 jobs that used aluminum
    expect(bolt.quantity).toBe(100); // 100 / 1 job that used bolts, not / 2
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
    expect(result.contributorCount).toBe(0);
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
    expect(result.contributorCount).toBe(1);
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
    expect(result.contributorCount).toBe(1);
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

  it('excludes a job whose only shift has a malformed timestamp (NaN labor)', () => {
    // A completed-but-corrupt shift yields NaN hours; the finiteness guard must drop it
    // rather than poison the average. Job b is the good one.
    const badShift: Shift = {
      id: 'bad',
      user: 'u1',
      job: 'a',
      clockInTime: new Date('2026-01-01T08:00:00Z').toISOString(),
      clockOutTime: 'not-a-real-date',
      lunchMinutesUsed: 0,
    };
    const jobs = [mockJob({ id: 'a' }), mockJob({ id: 'b' })];
    const result = buildQuoteFromJobs(jobs, [badShift, completedShift('b', 8)], inventory);

    expect(result.laborHours).toBe(8); // only job b, not NaN
    expect(Number.isFinite(result.laborHours)).toBe(true);
    expect(result.laborContributorCount).toBe(1);
    expect(result.referenceJobIds).toEqual(['b']);
  });

  it('excludes in-progress jobs so their partial actuals do not dilute the average', () => {
    // Same logged labor on both, but only the finished build is eligible to quote from.
    const jobs = [
      mockJob({ id: 'done', status: 'finished' }),
      mockJob({ id: 'wip', status: 'inProgress' }),
    ];
    const shifts = [completedShift('done', 12), completedShift('wip', 2)];
    const result = buildQuoteFromJobs(jobs, shifts, inventory);

    expect(result.laborHours).toBe(12); // wip's half-built 2h is excluded, not averaged in
    expect(result.matchedCount).toBe(2);
    expect(result.eligibleCount).toBe(1);
    expect(result.laborContributorCount).toBe(1);
    expect(result.referenceJobIds).toEqual(['done']);
  });

  it('treats every completed-build status as eligible', () => {
    const jobs = [
      mockJob({ id: 'finished', status: 'finished' }),
      mockJob({ id: 'delivered', status: 'delivered' }),
      mockJob({ id: 'waiting', status: 'waitingForPayment' }),
      mockJob({ id: 'projectCompleted', status: 'projectCompleted' }),
      mockJob({ id: 'paid', status: 'paid' }),
    ];
    const result = buildQuoteFromJobs(jobs, [], inventory);

    expect(result.eligibleCount).toBe(5);
  });

  it('excludes quote-stage and on-hold jobs from the basis', () => {
    const jobs = [
      mockJob({ id: 'quoted', status: 'quoted' }),
      mockJob({ id: 'toBeQuoted', status: 'toBeQuoted' }),
      mockJob({ id: 'rfq', status: 'rfqReceived' }),
      mockJob({ id: 'hold', status: 'onHold' }),
      mockJob({ id: 'qc', status: 'qualityControl' }),
    ];
    const result = buildQuoteFromJobs(jobs, [completedShift('quoted', 9)], inventory);

    expect(result.matchedCount).toBe(5);
    expect(result.eligibleCount).toBe(0);
    expect(result.laborHours).toBe(0);
    expect(result.contributorCount).toBe(0);
    expect(result.referenceJobIds).toEqual([]);
  });

  // Exhaustiveness guard: forces a conscious decision when a JobStatus is added/renamed,
  // so QUOTE_REFERENCE_STATUSES can't silently drift out of sync with the enum.
  it('classifies every JobStatus as either eligible or excluded', () => {
    const allStatuses: JobStatus[] = [
      'pending',
      'rush',
      'inProgress',
      'qualityControl',
      'finished',
      'delivered',
      'onHold',
      'toBeQuoted',
      'quoted',
      'rfqReceived',
      'rfqSent',
      'pod',
      'waitingForPayment',
      'projectCompleted',
      'paid',
    ];
    const eligible = allStatuses.filter((s) => QUOTE_REFERENCE_STATUSES.has(s));
    expect(eligible.sort()).toEqual(
      ['delivered', 'finished', 'paid', 'projectCompleted', 'waitingForPayment'].sort()
    );
  });
});

describe('buildQuoteFromJobs input hardening', () => {
  it('keeps a non-numeric inventory price out of the cost basis instead of returning NaN', () => {
    const badInventory: InventoryItem[] = [
      { ...inventory[0], id: 'inv-bad', price: 'oops' as unknown as number },
    ];
    const jobs = [mockJob({ id: 'a', expand: invLines([{ inv: 'inv-bad', qty: 4 }]) })];
    const result = buildQuoteFromJobs(jobs, [], badInventory);

    expect(result.materials).toHaveLength(1);
    expect(result.materials[0].unitCost).toBe(0); // coerced to 0, not NaN
    expect(Number.isFinite(result.materials[0].quantity)).toBe(true);
  });

  it('drops jobs with a missing id so they cannot collapse into one consumer', () => {
    // Two distinct id-less rows that both consume the same item must not be treated as one
    // job (which would halve the denominator and double the averaged quantity).
    const jobs = [
      mockJob({ id: '' as unknown as string, expand: invLines([{ inv: 'inv-A', qty: 10 }]) }),
      mockJob({ id: '' as unknown as string, expand: invLines([{ inv: 'inv-A', qty: 10 }]) }),
    ];
    const result = buildQuoteFromJobs(jobs, [], inventory);

    expect(result.matchedCount).toBe(0);
    expect(result.materials).toEqual([]);
    expect(result.referenceJobIds).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import type { Job } from '@/core/types';
import { buildInitialLines } from './buildInitialLines';

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    jobCode: 136,
    name: 'SEAL CART TARP',
    active: true,
    status: 'In Progress',
    boardType: 'production',
    attachments: [],
    attachmentCount: 0,
    comments: [],
    commentCount: 0,
    inventoryItems: [],
    assignedUsers: [],
    isRush: false,
    workers: [],
    ...overrides,
  } as Job;
}

describe('buildInitialLines', () => {
  it('falls back to job.qty for a single job.parts part without variants', () => {
    const job = makeJob({
      qty: '5',
      parts: [{ partId: 'p1', partNumber: 'SK-02M-0106', dashQuantities: {} }],
    });
    const lines = buildInitialLines(job, {});
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      partNumber: 'SK-02M-0106',
      ordered: 5,
      remaining: 5,
      quantity: 5,
    });
  });

  it('subtracts already-delivered units and never goes below zero', () => {
    const job = makeJob({
      qty: '5',
      parts: [{ partId: 'p1', partNumber: 'SK-02M-0106', dashQuantities: {} }],
    });
    const partial = buildInitialLines(job, { 'SK-02M-0106|': 2 });
    expect(partial[0]).toMatchObject({ ordered: 5, remaining: 3, quantity: 3 });

    const over = buildInitialLines(job, { 'SK-02M-0106|': 9 });
    expect(over[0]).toMatchObject({ ordered: 5, remaining: 0, quantity: 0 });
  });

  it('does not apply the job.qty fallback when the job has multiple parts', () => {
    const job = makeJob({
      qty: '5',
      parts: [
        { partId: 'p1', partNumber: 'SK-A', dashQuantities: {} },
        { partId: 'p2', partNumber: 'SK-B', dashQuantities: {} },
      ],
    });
    const lines = buildInitialLines(job, {});
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line.ordered).toBe(0);
      expect(line.quantity).toBe(0);
    }
  });

  it('keeps using dashQuantities when the part has variants', () => {
    const job = makeJob({
      qty: '99',
      parts: [{ partId: 'p1', partNumber: 'SK-F35-1184', dashQuantities: { '01': 3, '02': 1 } }],
    });
    const lines = buildInitialLines(job, {});
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ variantSuffix: '01', ordered: 3, quantity: 3 });
    expect(lines[1]).toMatchObject({ variantSuffix: '02', ordered: 1, quantity: 1 });
  });

  it('treats a missing/garbage job.qty as zero ordered', () => {
    const job = makeJob({
      qty: undefined,
      parts: [{ partId: 'p1', partNumber: 'SK-02M-0106', dashQuantities: {} }],
    });
    const lines = buildInitialLines(job, {});
    expect(lines[0]).toMatchObject({ ordered: 0, remaining: 0, quantity: 0 });

    const garbage = buildInitialLines(makeJob({ ...job, qty: 'abc' }), {});
    expect(garbage[0]).toMatchObject({ ordered: 0, remaining: 0, quantity: 0 });
  });

  it('clamps a negative job.qty to zero instead of showing "Ordered -5"', () => {
    const job = makeJob({
      qty: '-5',
      parts: [{ partId: 'p1', partNumber: 'SK-02M-0106', dashQuantities: {} }],
    });
    const lines = buildInitialLines(job, {});
    expect(lines[0]).toMatchObject({ ordered: 0, remaining: 0, quantity: 0 });
  });

  it('returns copies of the existing delivery line items when editing', () => {
    const job = makeJob({ qty: '5' });
    const existing = {
      id: 'd1',
      jobId: 'job-1',
      deliveryNumber: 1,
      deliveredAt: '2026-06-04',
      lineItems: [
        { description: 'SK-02M-0106', partNumber: 'SK-02M-0106', quantity: 1, unit: 'units' },
      ],
    } as unknown as Parameters<typeof buildInitialLines>[2];
    const lines = buildInitialLines(job, {}, existing);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ partNumber: 'SK-02M-0106', quantity: 1 });
    expect(lines[0]).not.toBe(existing!.lineItems[0]); // copy, not the same reference
  });

  it('falls back to a single job-name line when the job has no parts at all', () => {
    const job = makeJob({ qty: '3' });
    const lines = buildInitialLines(job, {});
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      description: 'SEAL CART TARP',
      ordered: 3,
      remaining: 3,
      quantity: 3,
    });
  });

  it('legacy job.partNumber path still falls back to job.qty (unchanged behavior)', () => {
    const job = makeJob({ qty: '4', partNumber: 'SK-OLD-0001' });
    const lines = buildInitialLines(job, {});
    expect(lines[0]).toMatchObject({
      partNumber: 'SK-OLD-0001',
      ordered: 4,
      remaining: 4,
      quantity: 4,
    });
  });

  it('uses the part name (not the part number) as the description when supplied', () => {
    const names = { 'SK-02M-0106': 'SEAL CART TARP' };

    // single job.parts part, no variants
    const single = makeJob({
      qty: '5',
      parts: [{ partId: 'p1', partNumber: 'SK-02M-0106', dashQuantities: {} }],
    });
    expect(buildInitialLines(single, {}, undefined, names)[0]).toMatchObject({
      partNumber: 'SK-02M-0106',
      description: 'SEAL CART TARP',
    });

    // variant lines reuse the part name; the suffix stays in partNumber/variantSuffix
    const withVariants = makeJob({
      parts: [{ partId: 'p1', partNumber: 'SK-02M-0106', dashQuantities: { '01': 2 } }],
    });
    expect(buildInitialLines(withVariants, {}, undefined, names)[0]).toMatchObject({
      partNumber: 'SK-02M-0106',
      variantSuffix: '01',
      description: 'SEAL CART TARP',
    });

    // legacy job.partNumber path
    const legacy = makeJob({ qty: '4', partNumber: 'SK-02M-0106' });
    expect(buildInitialLines(legacy, {}, undefined, names)[0]).toMatchObject({
      description: 'SEAL CART TARP',
    });
  });

  it('falls back to the part number when no name is supplied or the name is blank', () => {
    const job = makeJob({
      qty: '5',
      parts: [{ partId: 'p1', partNumber: 'SK-02M-0106', dashQuantities: {} }],
    });
    expect(buildInitialLines(job, {})[0].description).toBe('SK-02M-0106');
    expect(buildInitialLines(job, {}, undefined, { 'SK-02M-0106': '   ' })[0].description).toBe(
      'SK-02M-0106'
    );
  });
});

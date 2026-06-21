import { describe, it, expect } from 'vitest';
import type { Job, Shift } from '@/core/types';
import {
  findSimilarJobs,
  calculateJobHoursFromShifts,
  getPlannedLaborHours,
  getLaborSuggestion,
} from './laborSuggestion';

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

describe('findSimilarJobs', () => {
  it('returns [] for an empty or whitespace search term', () => {
    const jobs = [mockJob({ id: 'a' })];
    expect(findSimilarJobs('', jobs)).toEqual([]);
    expect(findSimilarJobs('   ', jobs)).toEqual([]);
  });

  it('matches on the raw job name, case-insensitively', () => {
    const jobs = [
      mockJob({ id: 'a', name: 'Aluminum Bracket' }),
      mockJob({ id: 'b', name: 'Steel Plate' }),
    ];
    const result = findSimilarJobs('bracket', jobs);
    expect(result.map((j) => j.id)).toEqual(['a']);
  });

  it('matches on the description', () => {
    const jobs = [
      mockJob({ id: 'a', name: 'Part A', description: 'anodized housing' }),
      mockJob({ id: 'b', name: 'Part B', description: 'raw blank' }),
    ];
    expect(findSimilarJobs('anodized', jobs).map((j) => j.id)).toEqual(['a']);
  });

  it('matches on jobCode (the field the Quotes copy used to drop)', () => {
    const jobs = [mockJob({ id: 'a', jobCode: 4321 }), mockJob({ id: 'b', jobCode: 9999 })];
    expect(findSimilarJobs('4321', jobs).map((j) => j.id)).toEqual(['a']);
  });

  it('matches on the convention display name (part number / EST#)', () => {
    // getJobDisplayName surfaces "SK-100 EST # 55" for this job; a part-number search finds it.
    const jobs = [
      mockJob({ id: 'a', name: 'unrelated', partNumber: 'SK-100', estNumber: '55' }),
      mockJob({ id: 'b', name: 'other', partNumber: 'XX-200' }),
    ];
    expect(findSimilarJobs('sk-100', jobs).map((j) => j.id)).toEqual(['a']);
  });

  it('matches if any single word in the term hits', () => {
    const jobs = [
      mockJob({ id: 'a', name: 'titanium flange' }),
      mockJob({ id: 'b', name: 'copper bus' }),
    ];
    // "flange" matches job a even though "missing" matches nothing.
    expect(findSimilarJobs('missing flange', jobs).map((j) => j.id)).toEqual(['a']);
  });

  it('caps results at 10', () => {
    const jobs = Array.from({ length: 15 }, (_, i) =>
      mockJob({ id: `j-${i}`, name: `Widget ${i}` })
    );
    expect(findSimilarJobs('widget', jobs)).toHaveLength(10);
  });
});

// A completed shift of `hours` length (no breaks).
const shift = (job: string, hours: number, id = `s-${job}`): Shift => {
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

describe('calculateJobHoursFromShifts', () => {
  it('sums multiple completed shifts for the same job', () => {
    const shifts = [shift('a', 8, 's1'), shift('a', 4, 's2')];
    expect(calculateJobHoursFromShifts('a', shifts)).toBe(12);
  });

  it('ignores shifts belonging to other jobs', () => {
    const shifts = [shift('a', 8), shift('b', 5)];
    expect(calculateJobHoursFromShifts('a', shifts)).toBe(8);
  });

  it('ignores shifts that have not been clocked out', () => {
    const pending: Shift = {
      id: 'p',
      user: 'u1',
      job: 'a',
      clockInTime: new Date('2026-01-01T08:00:00Z').toISOString(),
    };
    expect(calculateJobHoursFromShifts('a', [pending, shift('a', 6)])).toBe(6);
  });

  it('skips a corrupt-timestamp shift but keeps the valid ones for the same job', () => {
    const bad: Shift = {
      id: 'bad',
      user: 'u1',
      job: 'a',
      clockInTime: new Date('2026-01-01T08:00:00Z').toISOString(),
      clockOutTime: 'not-a-real-date',
      lunchMinutesUsed: 0,
    };
    const total = calculateJobHoursFromShifts('a', [shift('a', 8), bad]);
    expect(total).toBe(8); // not NaN, not 0
    expect(Number.isFinite(total)).toBe(true);
  });
});

describe('getPlannedLaborHours', () => {
  it('uses job.laborHours when set and positive', () => {
    expect(getPlannedLaborHours(mockJob({ laborHours: 12 }))).toBe(12);
  });

  it('falls through to the variant breakdown when laborHours is 0', () => {
    const job = mockJob({
      laborHours: 0,
      laborBreakdownByVariant: {
        '-01': { totalHours: 3 },
        '-02': { totalHours: 5 },
      } as unknown as Job['laborBreakdownByVariant'],
    });
    expect(getPlannedLaborHours(job)).toBe(8); // 3 + 5, proving the >0 guard isn't truthiness
  });

  it('returns 0 for a missing or non-object breakdown', () => {
    expect(getPlannedLaborHours(mockJob({ laborHours: 0 }))).toBe(0);
  });

  it('treats a non-numeric totalHours as 0', () => {
    const job = mockJob({
      laborHours: 0,
      laborBreakdownByVariant: {
        '-01': { totalHours: 'oops' },
        '-02': { totalHours: 4 },
      } as unknown as Job['laborBreakdownByVariant'],
    });
    expect(getPlannedLaborHours(job)).toBe(4);
  });
});

describe('getLaborSuggestion', () => {
  it('returns 0 when no similar jobs match', () => {
    expect(getLaborSuggestion('nothing', [mockJob({ name: 'Widget' })], [])).toBe(0);
  });

  it('prefers planned laborHours over recorded shift hours', () => {
    const jobs = [mockJob({ id: 'a', name: 'Widget', laborHours: 10 })];
    // A 4h shift exists, but planned 10 wins.
    expect(getLaborSuggestion('widget', jobs, [shift('a', 4)])).toBe(10);
  });

  it('falls back to recorded shift hours when planned is 0', () => {
    const jobs = [mockJob({ id: 'a', name: 'Widget', laborHours: 0 })];
    expect(getLaborSuggestion('widget', jobs, [shift('a', 6)])).toBe(6);
  });

  it('averages planned and shift-derived hours across matched jobs', () => {
    const jobs = [
      mockJob({ id: 'a', name: 'Widget', laborHours: 10 }),
      mockJob({ id: 'b', name: 'Widget', laborHours: 0 }),
    ];
    // a → planned 10, b → shift 6; average (10 + 6) / 2 = 8.
    expect(getLaborSuggestion('widget', jobs, [shift('b', 6)])).toBe(8);
  });

  it('returns 0 when matched jobs have neither planned nor shift hours', () => {
    const jobs = [mockJob({ id: 'a', name: 'Widget', laborHours: 0 })];
    expect(getLaborSuggestion('widget', jobs, [])).toBe(0);
  });

  it('rounds the average to one decimal place', () => {
    const jobs = [
      mockJob({ id: 'a', name: 'Widget', laborHours: 8 }),
      mockJob({ id: 'b', name: 'Widget', laborHours: 8 }),
      mockJob({ id: 'c', name: 'Widget', laborHours: 9 }),
    ];
    // (8 + 8 + 9) / 3 = 8.333… → 8.3
    expect(getLaborSuggestion('widget', jobs, [])).toBe(8.3);
  });
});

import { describe, it, expect } from 'vitest';
import type { Job } from '@/core/types';
import { findSimilarJobs } from './laborSuggestion';

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

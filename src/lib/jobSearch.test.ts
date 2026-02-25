import { describe, it, expect } from 'vitest';
import type { Job } from '@/core/types';
import { matchesJobSearch } from './jobSearch';

const mockJob = (overrides: Partial<Job> = {}): Job => ({
  id: 'job-1',
  jobCode: 1201,
  po: 'PO-555',
  name: 'Seat Base Assembly',
  description: 'Black trim and foam',
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
  ...overrides,
});

describe('matchesJobSearch', () => {
  it('returns true when query is empty', () => {
    expect(matchesJobSearch(mockJob(), '')).toBe(true);
    expect(matchesJobSearch(mockJob(), '   ')).toBe(true);
  });

  it('matches across key fields used in dashboard search', () => {
    const job = mockJob({
      binLocation: 'B12a',
      estNumber: 'EST-77',
      status: 'qualityControl',
    });

    expect(matchesJobSearch(job, '1201')).toBe(true);
    expect(matchesJobSearch(job, 'po-555')).toBe(true);
    expect(matchesJobSearch(job, 'trim')).toBe(true);
    expect(matchesJobSearch(job, 'b12a')).toBe(true);
    expect(matchesJobSearch(job, 'est-77')).toBe(true);
    expect(matchesJobSearch(job, 'qualitycontrol')).toBe(true);
  });

  it('returns false when no searchable fields match', () => {
    expect(matchesJobSearch(mockJob(), 'does-not-exist')).toBe(false);
  });
});

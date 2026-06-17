import { describe, it, expect } from 'vitest';
import {
  PROJECT_HOURS_RATE,
  payFromHours,
  parseHoursInput,
  computeProjectTotals,
  countEntriesByProject,
  deleteProjectMessage,
  buildExportRows,
} from './projectHours';
import type { ProjectHourEntry, ProjectHours } from '@/core/types';

function entry(partial: Partial<ProjectHourEntry>): ProjectHourEntry {
  return {
    id: partial.id ?? 'e1',
    projectId: partial.projectId ?? 'p1',
    entryDate: partial.entryDate ?? '2026-06-16',
    hours: partial.hours ?? 1,
    rate: partial.rate ?? PROJECT_HOURS_RATE,
    note: partial.note,
    createdBy: partial.createdBy,
    createdAt: partial.createdAt,
  };
}

describe('PROJECT_HOURS_RATE', () => {
  it('is the agreed $19/hr', () => {
    expect(PROJECT_HOURS_RATE).toBe(19);
  });
});

describe('payFromHours', () => {
  it('computes the documented example', () => {
    expect(payFromHours(3.5)).toBe(66.5);
  });

  it('avoids float drift and rounds to cents', () => {
    expect(payFromHours(0.1)).toBe(1.9);
    expect(payFromHours(0.33)).toBe(6.27);
    expect(payFromHours(1)).toBe(19);
    expect(payFromHours(100.5)).toBe(1909.5);
  });

  it('uses the constant rate by default', () => {
    expect(payFromHours(1)).toBe(PROJECT_HOURS_RATE);
  });

  it('honours a snapshotted per-entry rate', () => {
    expect(payFromHours(2, 25)).toBe(50);
  });

  it('returns 0 for non-positive or non-finite input', () => {
    expect(payFromHours(0)).toBe(0);
    expect(payFromHours(-5)).toBe(0);
    expect(payFromHours(NaN)).toBe(0);
    expect(payFromHours(Infinity)).toBe(0);
  });
});

describe('parseHoursInput', () => {
  it('accepts and rounds valid input to cents', () => {
    expect(parseHoursInput('3.5')).toEqual({ valid: true, hours: 3.5 });
    expect(parseHoursInput(' 2 ')).toEqual({ valid: true, hours: 2 });
    expect(parseHoursInput('1.239')).toEqual({ valid: true, hours: 1.24 });
    expect(parseHoursInput('24')).toEqual({ valid: true, hours: 24 });
  });

  it('rejects sub-cent input that would round to 0 (the silent-insert bug)', () => {
    expect(parseHoursInput('0.001')).toEqual({ valid: false, hours: 0 });
    expect(parseHoursInput('0')).toEqual({ valid: false, hours: 0 });
  });

  it('rejects out-of-range, negative, and non-numeric input', () => {
    expect(parseHoursInput('24.01')).toEqual({ valid: false, hours: 0 });
    expect(parseHoursInput('-1')).toEqual({ valid: false, hours: 0 });
    expect(parseHoursInput('')).toEqual({ valid: false, hours: 0 });
    expect(parseHoursInput('NaN')).toEqual({ valid: false, hours: 0 });
  });

  it('parses leading-numeric junk like the input element does', () => {
    // Number.parseFloat('12abc') === 12; this documents the accepted behavior.
    expect(parseHoursInput('12abc')).toEqual({ valid: true, hours: 12 });
  });

  it('round-trips a stored entry value through String() unchanged (edit-path seam)', () => {
    expect(parseHoursInput(String(0.25))).toEqual({ valid: true, hours: 0.25 });
    expect(parseHoursInput(String(19.5))).toEqual({ valid: true, hours: 19.5 });
  });
});

describe('countEntriesByProject', () => {
  it('returns an empty map for no entries', () => {
    expect(countEntriesByProject([]).size).toBe(0);
  });

  it('counts entries per project id', () => {
    const counts = countEntriesByProject([
      entry({ id: 'a', projectId: 'p1' }),
      entry({ id: 'b', projectId: 'p1' }),
      entry({ id: 'c', projectId: 'p2' }),
    ]);
    expect(counts.get('p1')).toBe(2);
    expect(counts.get('p2')).toBe(1);
    expect(counts.get('p3')).toBeUndefined();
  });
});

describe('deleteProjectMessage', () => {
  it('omits the count when there are no entries', () => {
    expect(deleteProjectMessage('Hours Tracker', 0)).toBe(
      'Permanently delete "Hours Tracker"? This cannot be undone.'
    );
  });

  it('uses the singular noun for exactly one entry', () => {
    expect(deleteProjectMessage('X', 1)).toContain('its 1 logged entry?');
  });

  it('uses the plural noun and the archive hint for many entries', () => {
    const msg = deleteProjectMessage('X', 12);
    expect(msg).toContain('its 12 logged entries?');
    expect(msg).toContain('use Archive instead');
  });
});

describe('computeProjectTotals', () => {
  it('returns zeros for an empty set', () => {
    expect(computeProjectTotals([])).toEqual({ totalHours: 0, totalPay: 0 });
  });

  it('sums a single entry', () => {
    expect(computeProjectTotals([entry({ hours: 2 })])).toEqual({ totalHours: 2, totalPay: 38 });
  });

  it('sums multiple entries without float drift', () => {
    const totals = computeProjectTotals([
      entry({ id: 'a', hours: 0.1 }),
      entry({ id: 'b', hours: 0.2 }),
      entry({ id: 'c', hours: 0.3 }),
    ]);
    expect(totals.totalHours).toBe(0.6);
    expect(totals.totalPay).toBe(11.4);
  });

  it('skips invalid entries', () => {
    const totals = computeProjectTotals([
      entry({ id: 'a', hours: 1 }),
      entry({ id: 'b', hours: 0 }),
    ]);
    expect(totals).toEqual({ totalHours: 1, totalPay: 19 });
  });
});

describe('buildExportRows', () => {
  const projects: ProjectHours[] = [
    { id: 'p1', name: 'Hours Tracker', status: 'active' },
    { id: 'p2', name: 'Inventory Fix', status: 'finished' },
  ];

  it('produces one row per entry with reconciling pay', () => {
    const rows = buildExportRows(projects, [
      entry({ id: 'a', projectId: 'p1', hours: 3.5, note: 'design' }),
      entry({ id: 'b', projectId: 'p2', hours: 2 }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      Project: 'Hours Tracker',
      Hours: 3.5,
      Pay: '66.50',
      Note: 'design',
    });
    expect(rows[1]).toMatchObject({ Project: 'Inventory Fix', Hours: 2, Pay: '38.00', Note: '' });
  });

  it('labels entries for unknown projects', () => {
    const rows = buildExportRows(projects, [entry({ projectId: 'gone' })]);
    expect(rows[0].Project).toBe('(unknown)');
  });

  it('returns an empty array for no entries', () => {
    expect(buildExportRows(projects, [])).toEqual([]);
  });
});

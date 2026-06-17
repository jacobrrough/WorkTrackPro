import { describe, it, expect } from 'vitest';
import {
  PROJECT_HOURS_RATE,
  payFromHours,
  parseHoursInput,
  computeProjectTotals,
  deleteProjectMessage,
  isEntryPaid,
  owedEntryIds,
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
    paidAt: partial.paidAt,
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
    expect(computeProjectTotals([])).toEqual({
      totalHours: 0,
      totalPay: 0,
      owedHours: 0,
      owedPay: 0,
      paidHours: 0,
      paidPay: 0,
    });
  });

  it('counts an unpaid entry as owed', () => {
    expect(computeProjectTotals([entry({ hours: 2 })])).toEqual({
      totalHours: 2,
      totalPay: 38,
      owedHours: 2,
      owedPay: 38,
      paidHours: 0,
      paidPay: 0,
    });
  });

  it('splits owed vs paid by paidAt', () => {
    const totals = computeProjectTotals([
      entry({ id: 'a', hours: 2 }), // owed
      entry({ id: 'b', hours: 1, paidAt: '2026-06-17T00:00:00Z' }), // paid
    ]);
    expect(totals).toEqual({
      totalHours: 3,
      totalPay: 57,
      owedHours: 2,
      owedPay: 38,
      paidHours: 1,
      paidPay: 19,
    });
  });

  it('counts a fully-settled set as paid with zero owed', () => {
    const totals = computeProjectTotals([
      entry({ id: 'a', hours: 2, paidAt: '2026-06-17T00:00:00Z' }),
      entry({ id: 'b', hours: 1, paidAt: '2026-06-17T00:00:00Z' }),
    ]);
    expect(totals).toEqual({
      totalHours: 3,
      totalPay: 57,
      owedHours: 0,
      owedPay: 0,
      paidHours: 3,
      paidPay: 57,
    });
  });

  it('owed + paid always reconciles to total (no rounding leak)', () => {
    const totals = computeProjectTotals([
      entry({ id: 'a', hours: 0.33 }),
      entry({ id: 'b', hours: 0.33, paidAt: '2026-06-17T00:00:00Z' }),
      entry({ id: 'c', hours: 0.1 }),
    ]);
    expect(totals.owedPay + totals.paidPay).toBe(totals.totalPay);
    expect(totals.owedHours + totals.paidHours).toBe(totals.totalHours);
  });

  it('sums multiple entries without float drift', () => {
    const totals = computeProjectTotals([
      entry({ id: 'a', hours: 0.1 }),
      entry({ id: 'b', hours: 0.2 }),
      entry({ id: 'c', hours: 0.3 }),
    ]);
    expect(totals.totalHours).toBe(0.6);
    expect(totals.totalPay).toBe(11.4);
    expect(totals.owedPay).toBe(11.4);
  });

  it('skips invalid entries', () => {
    const totals = computeProjectTotals([
      entry({ id: 'a', hours: 1 }),
      entry({ id: 'b', hours: 0 }),
    ]);
    expect(totals.totalHours).toBe(1);
    expect(totals.owedPay).toBe(19);
  });
});

describe('isEntryPaid', () => {
  it('treats null/undefined paidAt as unpaid and any timestamp as paid', () => {
    expect(isEntryPaid(entry({ paidAt: undefined }))).toBe(false);
    expect(isEntryPaid(entry({ paidAt: null as unknown as undefined }))).toBe(false);
    expect(isEntryPaid(entry({ paidAt: '2026-06-17T00:00:00Z' }))).toBe(true);
  });
});

describe('owedEntryIds', () => {
  it('returns only unpaid, positive-hour entry ids', () => {
    expect(
      owedEntryIds([
        entry({ id: 'a', hours: 2 }), // owed
        entry({ id: 'b', hours: 1, paidAt: '2026-06-17T00:00:00Z' }), // paid
        entry({ id: 'c', hours: 0 }), // invalid
      ])
    ).toEqual(['a']);
  });

  it('returns an empty array when nothing is owed', () => {
    expect(owedEntryIds([entry({ id: 'a', paidAt: '2026-06-17T00:00:00Z' })])).toEqual([]);
  });
});

describe('buildExportRows', () => {
  const projects: ProjectHours[] = [
    { id: 'p1', name: 'Hours Tracker', status: 'active' },
    { id: 'p2', name: 'Inventory Fix', status: 'finished' },
  ];

  it('emits Status and Paid columns from paidAt (date only)', () => {
    const rows = buildExportRows(projects, [
      entry({ id: 'a', projectId: 'p1', hours: 1 }),
      entry({ id: 'b', projectId: 'p1', hours: 1, paidAt: '2026-06-17T14:30:00Z' }),
    ]);
    expect(rows[0]).toMatchObject({ Status: 'Owed', Paid: '' });
    expect(rows[1]).toMatchObject({ Status: 'Paid', Paid: '2026-06-17' });
  });

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

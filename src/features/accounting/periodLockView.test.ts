import { describe, it, expect } from 'vitest';
import {
  confirmCloseMessage,
  isLockChange,
  lockStatusSummary,
  todayIsoLocal,
  validateProposedCloseDate,
} from './periodLockView';

const CLOSED = '2026-01-31';

describe('todayIsoLocal', () => {
  it('formats the LOCAL date parts as YYYY-MM-DD (no UTC shift)', () => {
    // 2026-03-04 in local time → "2026-03-04" regardless of the runner's timezone,
    // because it reads getFullYear/getMonth/getDate (local), not toISOString (UTC).
    const d = new Date(2026, 2, 4, 1, 30, 0); // month is 0-based: 2 = March
    expect(todayIsoLocal(d)).toBe('2026-03-04');
  });

  it('zero-pads single-digit months and days', () => {
    expect(todayIsoLocal(new Date(2026, 0, 9, 23, 59))).toBe('2026-01-09');
  });
});

describe('validateProposedCloseDate', () => {
  it('accepts a bare YYYY-MM-DD and returns it normalized', () => {
    expect(validateProposedCloseDate('2026-01-31')).toEqual({ date: '2026-01-31', error: null });
  });

  it('normalizes a stray timestamp to the bare date', () => {
    expect(validateProposedCloseDate('2026-01-31T00:00:00Z')).toEqual({
      date: '2026-01-31',
      error: null,
    });
  });

  it('rejects an empty or malformed date with a user-facing message', () => {
    expect(validateProposedCloseDate('').date).toBeNull();
    expect(validateProposedCloseDate('').error).toMatch(/valid date/i);
    expect(validateProposedCloseDate('garbage').date).toBeNull();
    expect(validateProposedCloseDate(null).date).toBeNull();
  });
});

describe('lockStatusSummary', () => {
  it('describes the open state when there is no lock', () => {
    expect(lockStatusSummary(null)).toMatch(/open/i);
    expect(lockStatusSummary('')).toMatch(/open/i);
  });

  it('names the close date and the on-or-before rule when locked', () => {
    const s = lockStatusSummary(CLOSED);
    expect(s).toContain(CLOSED);
    expect(s).toMatch(/on or before/i);
  });
});

describe('confirmCloseMessage', () => {
  it('explains that posting/voiding on or before the new date is blocked (the lock semantics)', () => {
    const msg = confirmCloseMessage('2026-02-28', null);
    expect(msg).toContain('2026-02-28');
    expect(msg).toMatch(/on or before/i);
    expect(msg).toMatch(/post(ed)?|posted or voided/i);
  });

  it('warns when MOVING the lock earlier that the unfrozen gap becomes editable again', () => {
    // current = CLOSED (2026-01-31), moving earlier to 2026-01-15.
    const msg = confirmCloseMessage('2026-01-15', CLOSED);
    expect(msg).toContain('2026-01-15');
    expect(msg).toContain(CLOSED);
    expect(msg).toMatch(/editable again/i);
  });

  it('does NOT add the move-earlier warning when moving the lock later', () => {
    const msg = confirmCloseMessage('2026-03-31', CLOSED);
    expect(msg).not.toMatch(/editable again/i);
  });

  it('describes re-opening (clearing) the books when next date is null and a lock exists', () => {
    const msg = confirmCloseMessage(null, CLOSED);
    expect(msg).toMatch(/re-open/i);
    expect(msg).toContain(CLOSED);
  });

  it('handles re-open when nothing is currently locked', () => {
    const msg = confirmCloseMessage(null, null);
    expect(msg).toMatch(/re-open/i);
  });
});

describe('isLockChange', () => {
  it('is false for a no-op (same date, or open→open)', () => {
    expect(isLockChange(CLOSED, CLOSED)).toBe(false);
    expect(isLockChange(null, null)).toBe(false);
    expect(isLockChange(null, '')).toBe(false);
  });

  it('is true when setting, clearing, or moving the lock', () => {
    expect(isLockChange(CLOSED, null)).toBe(true); // set
    expect(isLockChange(null, CLOSED)).toBe(true); // clear
    expect(isLockChange('2026-02-28', CLOSED)).toBe(true); // move
  });

  it('compares only the normalized date part (timestamp vs bare date is no change)', () => {
    expect(isLockChange('2026-01-31T00:00:00Z', CLOSED)).toBe(false);
  });
});

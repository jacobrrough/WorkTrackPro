import { describe, it, expect } from 'vitest';
import {
  addInterval,
  advanceSchedule,
  isDue,
  isOnOrAfter,
  isOnOrBefore,
  nextRunDate,
  parseISODate,
  toISODate,
  todayISO,
  type Schedule,
} from './recurrence';

describe('parseISODate / toISODate', () => {
  it('round-trips an ISO date through UTC midnight', () => {
    const d = parseISODate('2026-03-15');
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(2); // March = 2
    expect(d.getUTCDate()).toBe(15);
    expect(toISODate(d)).toBe('2026-03-15');
  });

  it('returns an invalid date for a malformed string', () => {
    expect(Number.isNaN(parseISODate('not-a-date').getTime())).toBe(true);
  });

  it('todayISO formats the given clock as a UTC date', () => {
    // Pick an instant that is the same calendar day in UTC.
    const now = new Date(Date.UTC(2026, 5, 1, 12, 0, 0));
    expect(todayISO(now)).toBe('2026-06-01');
  });
});

describe('addInterval', () => {
  it('adds days for daily', () => {
    expect(addInterval('2026-01-01', 'daily', 1)).toBe('2026-01-02');
    expect(addInterval('2026-01-01', 'daily', 10)).toBe('2026-01-11');
  });

  it('adds weeks for weekly', () => {
    expect(addInterval('2026-01-01', 'weekly', 1)).toBe('2026-01-08');
    expect(addInterval('2026-01-01', 'weekly', 2)).toBe('2026-01-15');
  });

  it('adds months for monthly and rolls the year over', () => {
    expect(addInterval('2026-01-15', 'monthly', 1)).toBe('2026-02-15');
    expect(addInterval('2026-12-15', 'monthly', 1)).toBe('2027-01-15');
  });

  it('clamps the day to the target month length (Jan 31 + 1mo → Feb 28)', () => {
    expect(addInterval('2026-01-31', 'monthly', 1)).toBe('2026-02-28');
    // 2028 is a leap year → Feb 29.
    expect(addInterval('2028-01-31', 'monthly', 1)).toBe('2028-02-29');
  });

  it('adds 3 months for quarterly and 12 for yearly', () => {
    expect(addInterval('2026-01-15', 'quarterly', 1)).toBe('2026-04-15');
    expect(addInterval('2026-01-15', 'yearly', 1)).toBe('2027-01-15');
  });

  it('respects intervalCount as a multiplier for calendar frequencies', () => {
    expect(addInterval('2026-01-15', 'monthly', 2)).toBe('2026-03-15');
    expect(addInterval('2026-01-15', 'quarterly', 2)).toBe('2026-07-15');
  });

  it('pins to dayOfMonth when supplied (clamped to month length)', () => {
    // Anchor to the 1st regardless of source day.
    expect(addInterval('2026-01-15', 'monthly', 1, 1)).toBe('2026-02-01');
    // Anchor to the 31st → clamps to Feb 28.
    expect(addInterval('2026-01-15', 'monthly', 1, 31)).toBe('2026-02-28');
  });

  it('treats intervalCount < 1 as 1', () => {
    expect(addInterval('2026-01-01', 'daily', 0)).toBe('2026-01-02');
    expect(addInterval('2026-01-01', 'daily', -5)).toBe('2026-01-02');
  });

  it('returns the input unchanged for a bad date', () => {
    expect(addInterval('garbage', 'daily', 1)).toBe('garbage');
  });
});

describe('isOnOrBefore / isOnOrAfter', () => {
  it('compares dates inclusively', () => {
    expect(isOnOrBefore('2026-01-01', '2026-01-02')).toBe(true);
    expect(isOnOrBefore('2026-01-02', '2026-01-02')).toBe(true);
    expect(isOnOrBefore('2026-01-03', '2026-01-02')).toBe(false);
    expect(isOnOrAfter('2026-01-03', '2026-01-02')).toBe(true);
    expect(isOnOrAfter('2026-01-02', '2026-01-02')).toBe(true);
    expect(isOnOrAfter('2026-01-01', '2026-01-02')).toBe(false);
  });

  it('is false when either date is invalid', () => {
    expect(isOnOrBefore('bad', '2026-01-02')).toBe(false);
    expect(isOnOrAfter('2026-01-02', 'bad')).toBe(false);
  });
});

describe('isDue', () => {
  const base: Schedule = {
    frequency: 'monthly',
    intervalCount: 1,
    startDate: '2026-01-01',
    endDate: null,
    nextRunDate: '2026-06-01',
    dayOfMonth: 1,
    active: true,
  };

  it('is due when next_run_date is on/before the as-of date', () => {
    expect(isDue(base, '2026-06-01')).toBe(true); // equal → due (inclusive)
    expect(isDue(base, '2026-07-15')).toBe(true);
  });

  it('is not due before next_run_date', () => {
    expect(isDue(base, '2026-05-31')).toBe(false);
  });

  it('is not due when inactive', () => {
    expect(isDue({ ...base, active: false }, '2026-07-01')).toBe(false);
  });

  it('is not due once next_run_date passes end_date', () => {
    expect(isDue({ ...base, endDate: '2026-05-01' }, '2026-07-01')).toBe(false);
  });

  it('is due when next_run_date equals end_date (inclusive end)', () => {
    expect(isDue({ ...base, endDate: '2026-06-01' }, '2026-06-01')).toBe(true);
  });
});

describe('nextRunDate', () => {
  it('advances one step from the cursor', () => {
    const s: Schedule = {
      frequency: 'weekly',
      intervalCount: 2,
      startDate: '2026-01-01',
      nextRunDate: '2026-01-01',
    };
    expect(nextRunDate(s)).toBe('2026-01-15');
  });
});

describe('advanceSchedule', () => {
  it('moves the cursor forward by one period (open-ended)', () => {
    const s: Schedule = {
      frequency: 'monthly',
      intervalCount: 1,
      startDate: '2026-01-01',
      endDate: null,
      nextRunDate: '2026-06-01',
      dayOfMonth: 1,
    };
    const adv = advanceSchedule(s);
    expect(adv.ranDate).toBe('2026-06-01');
    expect(adv.nextRunDate).toBe('2026-07-01');
    expect(adv.ended).toBe(false);
  });

  it('ends the template when the next step would pass end_date', () => {
    const s: Schedule = {
      frequency: 'monthly',
      intervalCount: 1,
      startDate: '2026-01-01',
      endDate: '2026-06-15',
      nextRunDate: '2026-06-01',
      dayOfMonth: 1,
    };
    const adv = advanceSchedule(s);
    expect(adv.ranDate).toBe('2026-06-01');
    expect(adv.nextRunDate).toBeNull();
    expect(adv.ended).toBe(true);
  });

  it('does not end when the next step lands exactly on end_date (inclusive)', () => {
    const s: Schedule = {
      frequency: 'monthly',
      intervalCount: 1,
      startDate: '2026-01-01',
      endDate: '2026-07-01',
      nextRunDate: '2026-06-01',
      dayOfMonth: 1,
    };
    const adv = advanceSchedule(s);
    expect(adv.nextRunDate).toBe('2026-07-01');
    expect(adv.ended).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import {
  minutesToHourCents,
  shiftWorkedMinutes,
  deriveHoursFromShifts,
  hourlyGrossCents,
  salaryGrossCents,
  hourCentsToHours,
  type ShiftRecord,
} from './payrollHours';

/** Build a shift from in/out ISO times (+ optional lunch window). */
function shift(
  id: string,
  inIso: string | null,
  outIso: string | null,
  lunchStart?: string | null,
  lunchEnd?: string | null
): ShiftRecord {
  return {
    id,
    clockInTime: inIso,
    clockOutTime: outIso,
    lunchStartTime: lunchStart,
    lunchEndTime: lunchEnd,
  };
}

describe('minutesToHourCents', () => {
  it('converts minutes to hundredths of an hour (round half up)', () => {
    expect(minutesToHourCents(60)).toBe(100); // 1.00 h
    expect(minutesToHourCents(90)).toBe(150); // 1.50 h
    expect(minutesToHourCents(30)).toBe(50); // 0.50 h
    expect(minutesToHourCents(10)).toBe(17); // 0.1667 h → 17
  });
  it('returns 0 for non-positive minutes', () => {
    expect(minutesToHourCents(0)).toBe(0);
    expect(minutesToHourCents(-5)).toBe(0);
  });
});

describe('shiftWorkedMinutes', () => {
  it('computes elapsed minutes between clock-in and clock-out', () => {
    expect(shiftWorkedMinutes(shift('s1', '2026-06-01T08:00:00Z', '2026-06-01T16:00:00Z'))).toBe(
      480
    );
  });
  it('subtracts the unpaid lunch window', () => {
    expect(
      shiftWorkedMinutes(
        shift(
          's1',
          '2026-06-01T08:00:00Z',
          '2026-06-01T16:00:00Z',
          '2026-06-01T12:00:00Z',
          '2026-06-01T12:30:00Z'
        )
      )
    ).toBe(450); // 8h − 30m
  });
  it('returns 0 for an open shift (no clock-out)', () => {
    expect(shiftWorkedMinutes(shift('s1', '2026-06-01T08:00:00Z', null))).toBe(0);
  });
  it('returns 0 when clock-out precedes clock-in', () => {
    expect(shiftWorkedMinutes(shift('s1', '2026-06-01T16:00:00Z', '2026-06-01T08:00:00Z'))).toBe(0);
  });
  it('ignores a malformed lunch window', () => {
    expect(
      shiftWorkedMinutes(
        shift('s1', '2026-06-01T08:00:00Z', '2026-06-01T16:00:00Z', 'not-a-date', null)
      )
    ).toBe(480);
  });
});

describe('deriveHoursFromShifts (weekly-40 model)', () => {
  it('sums shifts and splits weekly OT over 40 hours', () => {
    // Five 9-hour shifts = 45h; 40 regular, 5 OT (weekly rule).
    const shifts = [1, 2, 3, 4, 5].map((d) =>
      shift(`s${d}`, `2026-06-0${d}T08:00:00Z`, `2026-06-0${d}T17:00:00Z`)
    );
    const h = deriveHoursFromShifts(shifts);
    expect(h.totalHourCents).toBe(4500);
    expect(h.regularHourCents).toBe(4000);
    expect(h.overtimeHourCents).toBe(500);
    expect(h.regularHourCents + h.overtimeHourCents).toBe(h.totalHourCents);
    expect(h.sourceShiftIds).toHaveLength(5);
  });

  it('all-regular when under 40 hours', () => {
    const shifts = [1, 2, 3, 4].map((d) =>
      shift(`s${d}`, `2026-06-0${d}T08:00:00Z`, `2026-06-0${d}T16:00:00Z`)
    ); // four 8h = 32h
    const h = deriveHoursFromShifts(shifts);
    expect(h.regularHourCents).toBe(3200);
    expect(h.overtimeHourCents).toBe(0);
  });

  it('applies daily OT when a daily threshold is given (CA hook)', () => {
    // One 10-hour shift with a daily threshold of 8 → 8 regular + 2 daily-OT (well under 40 weekly).
    const h = deriveHoursFromShifts([shift('s1', '2026-06-01T08:00:00Z', '2026-06-01T18:00:00Z')], {
      dailyOtThresholdHours: 8,
    });
    expect(h.regularHourCents).toBe(800);
    expect(h.overtimeHourCents).toBe(200);
  });

  it('skips open shifts and warns', () => {
    const h = deriveHoursFromShifts([
      shift('s1', '2026-06-01T08:00:00Z', '2026-06-01T16:00:00Z'),
      shift('open0001', '2026-06-02T08:00:00Z', null),
    ]);
    expect(h.regularHourCents).toBe(800);
    expect(h.sourceShiftIds).toEqual(['s1']);
    expect(h.warnings.some((w) => w.includes('open'))).toBe(true);
  });

  it('returns zeros for no shifts', () => {
    const h = deriveHoursFromShifts([]);
    expect(h.totalHourCents).toBe(0);
    expect(h.regularHourCents).toBe(0);
    expect(h.overtimeHourCents).toBe(0);
  });
});

describe('hourlyGrossCents', () => {
  it('pays regular at the rate and OT at 1.5x', () => {
    // 40h regular + 5h OT at $30/h (3000 cents):
    // regular = 40 * 3000 = 120,000; OT = 5 * 3000 * 1.5 = 22,500 → 142,500.
    const gross = hourlyGrossCents({ regularHourCents: 4000, overtimeHourCents: 500 }, 3000);
    expect(gross).toBe(142500);
  });
  it('handles partial hours with cent rounding', () => {
    // 1.50 h at $20.005/h? Use integer cents: 1.5h * 2001 cents = 3001.5 → round to 3002.
    const gross = hourlyGrossCents({ regularHourCents: 150, overtimeHourCents: 0 }, 2001);
    expect(gross).toBe(3002);
  });
  it('supports a custom OT multiplier (double time)', () => {
    const gross = hourlyGrossCents({ regularHourCents: 0, overtimeHourCents: 100 }, 3000, 2.0);
    expect(gross).toBe(6000); // 1h * 3000 * 2.0
  });
});

describe('salaryGrossCents', () => {
  it('divides annual salary into per-period cents (round half up)', () => {
    // $52,000/yr = 5,200,000 cents over 26 biweekly periods = 200,000 exactly.
    expect(salaryGrossCents(5200000, 26)).toBe(200000);
    // $50,000/yr = 5,000,000 over 26 = 192,307.69 → 192,308.
    expect(salaryGrossCents(5000000, 26)).toBe(192308);
  });
  it('returns 0 for non-positive periods', () => {
    expect(salaryGrossCents(5200000, 0)).toBe(0);
  });
});

describe('hourCentsToHours', () => {
  it('formats hour-cents as a decimal hour count', () => {
    expect(hourCentsToHours(4500)).toBe(45);
    expect(hourCentsToHours(150)).toBe(1.5);
  });
});

import type { Shift } from '@/core/types';
import { durationMs } from '@/lib/timeUtils';

export const MAX_BREAK_MINUTES = 60;
const MAX_BREAK_MS = MAX_BREAK_MINUTES * 60 * 1000;

function parseIsoMs(value?: string): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

/**
 * Returns completed break time in ms.
 * Uses persisted lunch_minutes_used when available (including 0), and falls back to legacy
 * single-window lunch_start_time/lunch_end_time for backward compatibility.
 * Coerces lunchMinutesUsed from string (e.g. from API) so break time is never lost.
 */
export function getLoggedBreakMs(
  shift: Pick<Shift, 'lunchMinutesUsed' | 'lunchStartTime' | 'lunchEndTime'>
): number {
  const raw = shift.lunchMinutesUsed;
  const num =
    typeof raw === 'number' && Number.isFinite(raw)
      ? raw
      : typeof raw === 'string'
        ? Number(raw)
        : NaN;
  if (Number.isFinite(num) && num >= 0) {
    return Math.max(0, num) * 60 * 1000;
  }

  const legacyStartMs = parseIsoMs(shift.lunchStartTime);
  const legacyEndMs = parseIsoMs(shift.lunchEndTime);
  if (legacyStartMs == null || legacyEndMs == null) return 0;

  return Math.max(0, legacyEndMs - legacyStartMs);
}

export function getCurrentBreakMs(shift: Pick<Shift, 'lunchStartTime' | 'lunchEndTime'>): number {
  if (!shift.lunchStartTime || shift.lunchEndTime) return 0;
  const startMs = parseIsoMs(shift.lunchStartTime);
  if (startMs == null) return 0;
  return Math.max(0, Date.now() - startMs);
}

export function getTotalBreakMs(
  shift: Pick<Shift, 'lunchMinutesUsed' | 'lunchStartTime' | 'lunchEndTime'>
): number {
  return Math.max(0, getLoggedBreakMs(shift) + getCurrentBreakMs(shift));
}

export function getBreakAllowanceUsedMs(
  shift: Pick<Shift, 'lunchMinutesUsed' | 'lunchStartTime' | 'lunchEndTime'>
): number {
  return Math.min(MAX_BREAK_MS, getTotalBreakMs(shift));
}

export function getRemainingBreakMs(
  shift: Pick<Shift, 'lunchMinutesUsed' | 'lunchStartTime' | 'lunchEndTime'>
): number {
  return Math.max(0, MAX_BREAK_MS - getBreakAllowanceUsedMs(shift));
}

/** Round break duration to whole minutes (rounds so actual time used is tracked). */
export function toBreakMinutes(totalBreakMs: number): number {
  return Math.max(0, Math.round(totalBreakMs / 60000));
}

export function getWorkedShiftMs(
  shift: Pick<
    Shift,
    'clockInTime' | 'clockOutTime' | 'lunchMinutesUsed' | 'lunchStartTime' | 'lunchEndTime'
  >
): number {
  return Math.max(0, durationMs(shift.clockInTime, shift.clockOutTime) - getTotalBreakMs(shift));
}

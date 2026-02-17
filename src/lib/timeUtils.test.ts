import { describe, it, expect } from 'vitest';
import {
  durationMs,
  formatDurationHMS,
  formatDurationHours,
  formatDurationShort,
} from './timeUtils';

describe('durationMs', () => {
  it('calculates duration for completed shift', () => {
    const clockIn = '2024-01-01T10:00:00Z';
    const clockOut = '2024-01-01T12:30:00Z';
    const ms = durationMs(clockIn, clockOut);
    expect(ms).toBe(2.5 * 60 * 60 * 1000); // 2.5 hours
  });

  it('calculates duration for active shift (no clockOut)', () => {
    const clockIn = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
    const ms = durationMs(clockIn, null);
    expect(ms).toBeCloseTo(3600000, -3); // ~1 hour, allow 1 second tolerance
  });

  it('handles zero duration', () => {
    const now = new Date().toISOString();
    const ms = durationMs(now, now);
    expect(ms).toBe(0);
  });
});

describe('formatDurationHMS', () => {
  it('formats duration as HH:MM:SS', () => {
    expect(formatDurationHMS(3661000)).toBe('01:01:01'); // 1h 1m 1s
    expect(formatDurationHMS(90000)).toBe('00:01:30'); // 1m 30s
    expect(formatDurationHMS(0)).toBe('00:00:00');
  });
});

describe('formatDurationHours', () => {
  it('formats duration as decimal hours', () => {
    expect(formatDurationHours(3600000)).toBe('1.0h'); // 1 hour
    expect(formatDurationHours(5400000)).toBe('1.5h'); // 1.5 hours
    expect(formatDurationHours(900000)).toBe('0.3h'); // 15 minutes
  });
});

describe('formatDurationShort', () => {
  it('formats short duration', () => {
    expect(formatDurationShort(3600000)).toBe('1h 0m'); // 1 hour
    expect(formatDurationShort(5400000)).toBe('1h 30m'); // 1.5 hours
    expect(formatDurationShort(1800000)).toBe('30m'); // 30 minutes
    expect(formatDurationShort(60000)).toBe('1m'); // 1 minute
  });
});

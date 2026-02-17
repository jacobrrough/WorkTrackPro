/**
 * Centralized time/duration utilities for shifts and reporting.
 * Use these instead of duplicating logic in Dashboard, JobDetail, TimeReports.
 */

/**
 * Duration in milliseconds between clock-in and clock-out (or now if still active).
 */
export function durationMs(clockIn: string, clockOut?: string | null): number {
  const start = new Date(clockIn).getTime();
  const end = clockOut ? new Date(clockOut).getTime() : Date.now();
  return end - start;
}

/**
 * Format duration as HH:MM:SS (e.g. for live timer).
 */
export function formatDurationHMS(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return [h, m, s].map((n) => n.toString().padStart(2, '0')).join(':');
}

/**
 * Format duration as decimal hours (e.g. "2.5h" for reports).
 */
export function formatDurationHours(ms: number): string {
  const hours = ms / 3600000;
  return hours.toFixed(1) + 'h';
}

/**
 * Short display for active shift (e.g. "2h 15m").
 */
export function formatDurationShort(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

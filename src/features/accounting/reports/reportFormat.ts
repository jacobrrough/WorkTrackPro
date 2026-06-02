import { formatMoney } from '../accountingViewModel';
import type { DateRange } from '../types';

/**
 * Shared, framework-free formatting helpers for the A3 reports. Used by both the
 * on-screen tables and the PDF/CSV exporters so a figure reads identically in every
 * surface. Money is already in dollars by the time it reaches here (reportMath did
 * the cents work); these only format for display.
 */

/** Format a dollar amount, rendering a negative as parenthesized accounting style. */
export function formatAccounting(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  if (safe < 0) return `(${formatMoney(-safe)})`;
  return formatMoney(safe);
}

/** Human label for a report's date range (for headers and file metadata). */
export function describeRange(range: DateRange | undefined): string {
  const from = range?.from ?? null;
  const to = range?.to ?? null;
  if (!from && !to) return 'All time';
  if (from && to) return `${from} to ${to}`;
  if (from) return `From ${from}`;
  return `Through ${to}`;
}

/** Human label for a point-in-time report (aging is "as of" today). */
export function asOfToday(): string {
  return `As of ${new Date().toISOString().slice(0, 10)}`;
}

/** A filesystem-safe slug fragment for an export filename. */
export function rangeSlug(range: DateRange | undefined): string {
  const from = range?.from ?? null;
  const to = range?.to ?? null;
  if (!from && !to) return 'all-time';
  if (from && to) return `${from}_to_${to}`;
  if (from) return `from-${from}`;
  return `through-${to}`;
}

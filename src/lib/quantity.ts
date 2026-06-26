// Shared rounding + display helpers for stock quantities and money. Quantities come from float
// math (allocations, set ratios, price splits) so they accumulate artifacts like
// 1.4000000000000001; round to 2 decimals (cents) as the app's standard precision.

/** Round to 2 decimals (cents) — the app's standard precision for money and stock quantities. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Format a stock/allocation quantity for display: round to 2 decimals and let String() drop any
 * trailing zeros (1.7→"1.7", 1.4000000000000001→"1.4", 0.72→"0.72", 8→"8"). The `=== 0` collapses
 * negative zero (a tiny negative delta rounds to -0, which String() would render as "-0"); the
 * non-finite guard keeps a bad upstream value from rendering literal "NaN"/"Infinity" to the user.
 */
export function formatStockDisplay(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = round2(value);
  return String(rounded === 0 ? 0 : rounded);
}

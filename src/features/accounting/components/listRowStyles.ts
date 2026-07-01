/**
 * Shared row styling for the accounting module's flex-row LISTS (invoice/bill lists, bank
 * rules, payment/email history) — the surfaces that are NOT <table>/LedgerTable. Centralizing
 * the container, row, and header classes gives them the same roomier, QuickBooks-like spacing
 * everywhere at once. Compose LIST_ROW with each row's own column spans, and keep right-aligned
 * `tabular-nums` money cells inside the row.
 */

/** Bordered, rounded list container with row dividers. */
export const LIST_CONTAINER =
  'divide-y divide-line overflow-hidden rounded-2xl border border-line';

/** An interactive list row: roomy padding + a clear hover. */
export const LIST_ROW =
  'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-overlay/[0.04]';

/** Column-header strip above a list (hidden on narrow screens; align its spans to the row). */
export const LIST_HEADER =
  'hidden items-center gap-3 px-4 pb-1.5 text-xs font-semibold uppercase tracking-wide text-subtle sm:flex';

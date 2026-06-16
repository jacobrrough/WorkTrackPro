import { formatMoney } from '../accountingViewModel';
import type {
  InventoryPriceChangeSource,
  InventoryReconciliationRow,
  SeedOpeningInventoryExceptionReason,
} from '../types';

/**
 * Pure presenters shared by the Inventory ↔ Accounting reconciliation screens. No React,
 * no Supabase — trivially unit-testable (see inventoryReconcileFormat.test.ts). All money
 * math lives in inventoryReconcileMath.ts (integer cents, G6); these only format/label.
 *
 * The money/qty/cost formatters are re-exported from the B3 inventoryFormat module so the
 * reconciliation screens import every inventory presenter from one place.
 */
export { formatMoney };
export { formatQty, formatUnitCost, formatEventDate } from './inventoryFormat';

/**
 * A SIGNED money string for a variance/delta: a positive amount gets a leading "+", zero
 * reads "$0.00", a negative amount keeps its own minus from the currency formatter. Used
 * for value variances and revaluation deltas where the direction matters at a glance. Sub-
 * cent residue is snapped to zero so a clean tie never prints "+$0.00".
 */
export function formatSignedMoney(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  // Snap sub-cent noise to zero so a tie reads exactly "$0.00".
  const cents = Math.round(safe * 100);
  if (cents === 0) return formatMoney(0);
  const formatted = formatMoney(Math.abs(cents) / 100);
  return cents > 0 ? `+${formatted}` : `−${formatted}`;
}

/** A signed quantity string ("+3", "−2", "0") for a qty variance. */
export function formatSignedQty(qty: number): string {
  const safe = Number.isFinite(qty) ? qty : 0;
  if (safe === 0) return '0';
  const abs = Number(Math.abs(safe).toFixed(3)).toLocaleString('en-US', {
    maximumFractionDigits: 3,
  });
  return safe > 0 ? `+${abs}` : `−${abs}`;
}

/**
 * Tailwind text tone for a signed money/qty figure: green when it rose, red when it fell,
 * muted slate when it ties. Lets a variance/delta cell color itself by direction.
 */
export function signedTone(amount: number): string {
  const cents = Math.round((Number.isFinite(amount) ? amount : 0) * 100);
  if (cents > 0) return 'text-emerald-300';
  if (cents < 0) return 'text-red-300';
  return 'text-slate-400';
}

/** Human label for a price-change source (the price-history feed). */
export const PRICE_SOURCE_LABELS: Record<InventoryPriceChangeSource, string> = {
  manual: 'Manual edit',
  bill: 'Bill receipt',
  seed: 'Opening seed',
  reval: 'Revaluation',
};

/** Material-symbol icon name per price-change source. */
export const PRICE_SOURCE_ICONS: Record<InventoryPriceChangeSource, string> = {
  manual: 'edit',
  bill: 'request_quote',
  seed: 'flag',
  reval: 'sync_alt',
};

/** A small color chip class per price-change source (matches the dark theme badges). */
export const PRICE_SOURCE_BADGE: Record<InventoryPriceChangeSource, string> = {
  manual: 'bg-slate-500/15 text-slate-300',
  bill: 'bg-sky-500/15 text-sky-300',
  seed: 'bg-violet-500/15 text-violet-300',
  reval: 'bg-amber-500/15 text-amber-300',
};

/** Human label for why a stock row was excluded from the opening seed. */
export const SEED_EXCEPTION_LABELS: Record<SeedOpeningInventoryExceptionReason, string> = {
  null_price: 'No unit cost (price is null)',
  non_positive_stock: 'No positive on-hand quantity',
  unknown: 'Not eligible',
};

/** The exception flags raised on a reconciliation row, as short labelled chips. */
export interface ReconciliationFlag {
  key: 'uncosted' | 'nullPrice' | 'negativeStock' | 'qtyMismatch' | 'pendingReval';
  label: string;
  /** Tailwind chip classes (bg + text). */
  className: string;
}

/**
 * Derive the ordered list of attention flags for one reconciliation row. A row with no
 * flags is fully reconciled and returns []. Order is by severity: a missing cost/layer
 * first, then a quantity discrepancy, then negative stock, then a queued (pending)
 * revaluation. Pure — the view just renders the chips.
 */
export function reconciliationFlags(
  row: Pick<
    InventoryReconciliationRow,
    'uncosted' | 'nullPrice' | 'negativeStock' | 'qtyMismatch' | 'pendingRevalCount'
  >
): ReconciliationFlag[] {
  const flags: ReconciliationFlag[] = [];
  if (row.nullPrice) {
    flags.push({
      key: 'nullPrice',
      label: 'No unit cost',
      className: 'bg-red-500/15 text-red-300',
    });
  }
  if (row.uncosted) {
    flags.push({
      key: 'uncosted',
      label: 'Uncosted',
      className: 'bg-amber-500/20 text-amber-300',
    });
  }
  if (row.qtyMismatch) {
    flags.push({
      key: 'qtyMismatch',
      label: 'Qty mismatch',
      className: 'bg-orange-500/15 text-orange-300',
    });
  }
  if (row.negativeStock) {
    flags.push({
      key: 'negativeStock',
      label: 'Negative stock',
      className: 'bg-rose-500/15 text-rose-300',
    });
  }
  if (row.pendingRevalCount > 0) {
    flags.push({
      key: 'pendingReval',
      label: 'Pending reval',
      className: 'bg-sky-500/15 text-sky-300',
    });
  }
  return flags;
}

/** True when a reconciliation row has no attention flags (operational ties to accounting). */
export function isRowReconciled(
  row: Pick<
    InventoryReconciliationRow,
    'uncosted' | 'nullPrice' | 'negativeStock' | 'qtyMismatch' | 'pendingRevalCount'
  >
): boolean {
  return reconciliationFlags(row).length === 0;
}

/** Today as `YYYY-MM-DD` for the opening-balance as-of default. */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

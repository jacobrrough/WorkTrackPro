import { useInventoryPriceHistory } from '../hooks/useAccountingQueries';
import {
  formatEventDate,
  formatSignedMoney,
  formatUnitCost,
  PRICE_SOURCE_BADGE,
  PRICE_SOURCE_ICONS,
  PRICE_SOURCE_LABELS,
  signedTone,
} from './inventoryReconcileFormat';
import type { InventoryPriceHistoryEntry } from '../types';

/**
 * The per-unit COST change history for one stock item (public.inventory_price_history,
 * migration 20260616000003) — the "price history view on the inventory/item detail" the
 * module calls for. Read-only: the log is written only by the DB trigger (manual edit, bill
 * receipt, opening seed, or a revaluation post). Reuses the per-item price-history query
 * hook; renders its own loading/empty/error states so it can drop into any detail screen.
 */

/** A small source chip ("Bill receipt", "Manual edit", …) with its icon. */
function SourceChip({ entry }: { entry: InventoryPriceHistoryEntry }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${PRICE_SOURCE_BADGE[entry.source]}`}
    >
      <span className="material-symbols-outlined text-sm">{PRICE_SOURCE_ICONS[entry.source]}</span>
      {PRICE_SOURCE_LABELS[entry.source]}
    </span>
  );
}

/** Render a price (or "—" when null, e.g. the very first cost or a clear-to-null). */
function priceOrDash(price: number | null): string {
  return price == null ? '—' : formatUnitCost(price);
}

export function PriceHistoryFeed({ inventoryId }: { inventoryId: string | undefined }) {
  const { data: entries = [], isPending, isError } = useInventoryPriceHistory(inventoryId);

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-bold uppercase tracking-wide text-slate-400">
        Cost-change history
      </h2>

      {isPending && <p className="text-sm text-slate-400">Loading cost history…</p>}
      {isError && (
        <p className="text-sm text-red-400">Could not load this item&apos;s cost history.</p>
      )}

      {!isPending && !isError && entries.length === 0 && (
        <p className="rounded-sm border border-white/10 bg-card-dark px-3 py-3 text-sm text-slate-400">
          No recorded cost changes yet. Edits to the unit cost, bill receipts at a different cost,
          the opening seed, and posted revaluations all appear here.
        </p>
      )}

      {!isPending && !isError && entries.length > 0 && (
        <div className="divide-y divide-white/5 rounded-sm border border-white/10 bg-card-dark">
          {entries.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <SourceChip entry={e} />
                  <span className="truncate text-xs text-slate-500">
                    {formatEventDate(e.createdAt)}
                  </span>
                </div>
                {e.reason && <p className="mt-0.5 truncate text-xs text-slate-500">{e.reason}</p>}
              </div>
              <div className="shrink-0 text-right">
                <p className="font-mono text-sm tabular-nums text-slate-200">
                  <span className="text-slate-500">{priceOrDash(e.oldPrice)}</span>
                  <span className="mx-1 text-slate-600">→</span>
                  {priceOrDash(e.newPrice)}
                </p>
                <p className={`font-mono text-xs tabular-nums ${signedTone(e.changeAmount)}`}>
                  {formatSignedMoney(e.changeAmount)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

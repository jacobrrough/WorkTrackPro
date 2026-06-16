import { LedgerTable } from '../components/LedgerTable';
import {
  formatMoney,
  formatQty,
  formatUnitCost,
  SEED_EXCEPTION_LABELS,
} from './inventoryReconcileFormat';
import type { SeedOpeningInventoryExceptionRow, SeedOpeningInventoryPreviewRow } from '../types';

/**
 * Shared, read-only tables for the opening-balance seeder preview. Used by the seed drawer
 * on the reconciliation screen. Pure presentation — no hooks, no money math (the totals are
 * computed in inventoryReconcileMath and shown by the caller).
 */

/** The per-item rows that WILL seed (qty × unit cost = extended opening value). */
export function SeedPreviewTable({ rows }: { rows: SeedOpeningInventoryPreviewRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">
        Items to seed · {rows.length}
      </h3>
      <LedgerTable
        density="compact"
        columns={[
          { label: 'Item' },
          { label: 'On hand', align: 'right' },
          { label: 'Unit cost', align: 'right' },
          { label: 'Extended', align: 'right' },
        ]}
      >
        {rows.map((r) => (
          <tr key={r.sourceInventoryId} className="border-t border-white/5">
            <td className="text-white">{r.name || 'Unnamed item'}</td>
            <td className="text-right font-mono tabular-nums text-slate-300">
              {formatQty(r.inStock)}
            </td>
            <td className="text-right font-mono tabular-nums text-slate-400">
              {formatUnitCost(r.unitCost)}
            </td>
            <td className="text-right font-mono tabular-nums text-slate-200">
              {formatMoney(r.extended)}
            </td>
          </tr>
        ))}
      </LedgerTable>
    </section>
  );
}

/** The per-item rows that CANNOT seed, with the reason (null price / non-positive stock). */
export function SeedExceptionsPanel({ rows }: { rows: SeedOpeningInventoryExceptionRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-bold uppercase tracking-wide text-amber-300">
        Excluded · {rows.length}
      </h3>
      <p className="text-[11px] text-slate-500">
        These rows are reported but not seeded. Give an item a unit cost (and positive on-hand
        stock) to include it.
      </p>
      <LedgerTable
        density="compact"
        columns={[
          { label: 'Item' },
          { label: 'On hand', align: 'right' },
          { label: 'Cost', align: 'right' },
          { label: 'Reason' },
        ]}
      >
        {rows.map((r) => (
          <tr key={r.sourceInventoryId} className="border-t border-white/5">
            <td className="text-slate-300">{r.name || 'Unnamed item'}</td>
            <td className="text-right font-mono tabular-nums text-slate-400">
              {r.inStock == null ? '—' : formatQty(r.inStock)}
            </td>
            <td className="text-right font-mono tabular-nums text-slate-400">
              {r.price == null ? '—' : formatMoney(r.price)}
            </td>
            <td className="text-amber-300">{SEED_EXCEPTION_LABELS[r.reason]}</td>
          </tr>
        ))}
      </LedgerTable>
    </section>
  );
}

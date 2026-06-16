import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { AccountingShell } from '../components/AccountingShell';
import { TaxDisclaimer } from '../components/TaxDisclaimer';
import { useInventoryValuation } from '../hooks/useAccountingQueries';
import { INVENTORY_BASE, INVENTORY_RECONCILE_BASE } from '../constants';
import { formatMoney, formatQty, formatUnitCost, totalInventoryValuation } from './inventoryFormat';
import type { InventoryValuationRow } from '../types';

/**
 * B3 — Inventory valuation report. A read-only, per-stock-item view sourced from
 * `accounting.v_inventory_valuation` (no money moves on this surface). For each stock
 * item it shows units on hand, the weighted-average unit cost of the OPEN FIFO layers,
 * the FIFO asset value (which ties to GL 1300 Inventory Asset), and lifetime COGS booked
 * from consumption events. Rows drill into the per-item detail; a header action jumps to
 * the COGS work list where consumption is actually posted.
 *
 * This is financial output, so it carries the CPA/EA disclaimer (G9). All footer sums are
 * computed in integer cents (totalInventoryValuation) so the asset-value total ties to the
 * ledger to the penny.
 */

/** Right-aligned, tabular money cell; matches the report / job-costing tables. */
function MoneyCell({
  amount,
  strong = false,
  muted = false,
}: {
  amount: number;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <td
      className={`px-3 py-2 text-right font-mono tabular-nums ${
        strong ? 'font-bold text-white' : muted ? 'text-slate-400' : 'text-slate-200'
      }`}
    >
      {formatMoney(amount)}
    </td>
  );
}

/** One labeled figure in the summary strip. */
function SummaryStat({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'accent';
}) {
  return (
    <div className="rounded-sm border border-white/10 bg-card-dark p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={`mt-1 font-mono text-lg font-bold tabular-nums ${
          tone === 'accent' ? 'text-primary' : 'text-white'
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

export default function InventoryValuationView() {
  const navigate = useNavigate();
  const { data: rows = [], isPending, isError } = useInventoryValuation();
  const totals = useMemo(() => totalInventoryValuation(rows), [rows]);

  const openItem = (row: InventoryValuationRow) =>
    navigate(`${INVENTORY_BASE}/items/${row.sourceInventoryId}`);

  return (
    <AccountingShell
      active="inventory"
      title="Inventory valuation"
      actions={
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            icon="balance"
            onClick={() => navigate(INVENTORY_RECONCILE_BASE)}
          >
            Reconcile
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon="checklist"
            onClick={() => navigate(`${INVENTORY_BASE}/cogs`)}
          >
            COGS work list
          </Button>
        </div>
      }
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        <TaxDisclaimer />

        <p className="text-sm text-slate-400">
          FIFO valuation per stock item. Asset value is the sum of each open cost layer&apos;s
          remaining quantity × its unit cost, and ties to the Inventory Asset account (1300).
          Average unit cost is the weighted average of those open layers; lifetime COGS is the cost
          relieved to Cost of Goods Sold (5000) as jobs consumed stock.
        </p>

        {isPending && <p className="text-slate-400">Loading inventory valuation…</p>}
        {isError && (
          <p className="text-red-400">
            Could not load inventory valuation. Confirm the accounting schema is exposed and you
            have an accounting role.
          </p>
        )}

        {!isPending && !isError && rows.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 rounded-sm border border-dashed border-white/15 px-6 py-16 text-center">
            <span className="material-symbols-outlined text-4xl text-slate-500">inventory_2</span>
            <p className="text-lg font-bold text-white">No inventory on the books yet</p>
            <p className="max-w-md text-sm text-slate-400">
              Valuation appears here once a stock item is received on a posted bill (which seeds a
              FIFO cost layer) or consumed by a job (which relieves cost to COGS). Receive inventory
              through a bill to start building cost layers.
            </p>
            <Button
              size="sm"
              variant="ghost"
              icon="request_quote"
              onClick={() => navigate('/app/accounting/bills')}
            >
              Go to bills
            </Button>
          </div>
        )}

        {!isPending && !isError && rows.length > 0 && (
          <>
            {/* Summary strip — asset value ties to GL 1300 */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <SummaryStat
                label="Asset value"
                value={formatMoney(totals.assetValue)}
                hint="Ties to GL 1300"
                tone="accent"
              />
              <SummaryStat label="On hand" value={formatQty(totals.qtyOnHand)} hint="total units" />
              <SummaryStat
                label="Items"
                value={String(totals.itemCount)}
                hint={totals.itemCount === 1 ? 'stock item' : 'stock items'}
              />
              <SummaryStat
                label="Lifetime COGS"
                value={formatMoney(totals.cogsTotal)}
                hint="relieved to 5000"
              />
            </div>

            <div className="overflow-x-auto rounded-sm border border-white/10">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-white/5 text-slate-400">
                    <th className="px-3 py-2 text-left font-semibold">Item</th>
                    <th className="px-3 py-2 text-right font-semibold">On hand</th>
                    <th className="px-3 py-2 text-right font-semibold">Avg cost</th>
                    <th className="px-3 py-2 text-right font-semibold">Asset value</th>
                    <th className="px-3 py-2 text-right font-semibold">Lifetime COGS</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.sourceInventoryId}
                      onClick={() => openItem(row)}
                      className="cursor-pointer border-t border-white/5 hover:bg-white/5"
                    >
                      <td className="px-3 py-2">
                        <span className="block truncate font-medium text-white">
                          {row.inventoryName || 'Unnamed item'}
                        </span>
                        <span className="block text-xs text-slate-500">
                          {formatQty(row.qtyReceivedTotal)} received ·{' '}
                          {formatQty(row.qtyConsumedTotal)} consumed
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-200">
                        {formatQty(row.qtyOnHand)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-400">
                        {row.qtyOnHand > 0 ? formatUnitCost(row.avgUnitCost) : '—'}
                      </td>
                      <MoneyCell amount={row.assetValue} />
                      <MoneyCell amount={row.cogsTotal} muted />
                    </tr>
                  ))}
                  {/* Grand totals — asset value ties to GL 1300 */}
                  <tr className="border-t border-white/10 bg-white/5">
                    <td className="px-3 py-2 font-bold text-white">
                      {totals.itemCount} {totals.itemCount === 1 ? 'item' : 'items'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-bold tabular-nums text-white">
                      {formatQty(totals.qtyOnHand)}
                    </td>
                    <td className="px-3 py-2" />
                    <MoneyCell amount={totals.assetValue} strong />
                    <MoneyCell amount={totals.cogsTotal} strong />
                  </tr>
                </tbody>
              </table>
            </div>

            <p className="text-xs leading-relaxed text-slate-500">
              <span className="font-semibold text-slate-400">How these are figured:</span> Asset
              value and average cost reflect only OPEN FIFO layers (remaining quantity &gt; 0). An
              item shows a dash for average cost when nothing is on hand. Lifetime
              received/consumed/COGS are cumulative across all layers and consumption events. Tap a
              row to see the item&apos;s detail.
            </p>
          </>
        )}
      </div>
    </AccountingShell>
  );
}

import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { AccountingShell } from '../components/AccountingShell';
import { TaxDisclaimer } from '../components/TaxDisclaimer';
import { useInventoryValuationItem } from '../hooks/useAccountingQueries';
import { INVENTORY_BASE } from '../constants';
import { formatMoney, formatQty, formatUnitCost } from './inventoryFormat';

/**
 * B3 — per-stock-item inventory valuation detail. Read-only drill-down from the
 * valuation report into one item's `accounting.v_inventory_valuation` row
 * (useInventoryValuationItem). Surfaces the FIFO asset value (ties to GL 1300), the
 * weighted-average open-layer unit cost, and the lifetime received / consumed / COGS
 * figures. No money moves here — consumption is posted from the COGS work list.
 *
 * Financial output → carries the CPA/EA disclaimer (G9).
 */

/** One labeled figure. `tone` accents the asset value (the GL-tying figure). */
function StatCard({
  label,
  children,
  hint,
  tone = 'default',
}: {
  label: string;
  children: ReactNode;
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
        {children}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

/** A read-only "fact" row in the breakdown list. */
function FactRow({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2">
      <span className="text-sm text-slate-400">{label}</span>
      <span
        className={`font-mono text-sm tabular-nums ${muted ? 'text-slate-400' : 'text-slate-200'}`}
      >
        {value}
      </span>
    </div>
  );
}

export default function InventoryValuationItemView() {
  const { sourceInventoryId } = useParams<{ sourceInventoryId: string }>();
  const navigate = useNavigate();
  const { data: row, isPending, isError } = useInventoryValuationItem(sourceInventoryId);

  return (
    <AccountingShell
      active="inventory"
      title={row ? row.inventoryName || 'Stock item' : 'Inventory item'}
      actions={
        <Button
          size="sm"
          variant="ghost"
          icon="arrow_back"
          onClick={() => navigate(INVENTORY_BASE)}
        >
          Valuation
        </Button>
      }
    >
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <TaxDisclaimer />

        {isPending && <p className="text-slate-400">Loading item valuation…</p>}
        {isError && <p className="text-red-400">Could not load this item&apos;s valuation.</p>}

        {!isPending && !isError && !row && (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <span className="material-symbols-outlined text-4xl text-slate-500">inventory_2</span>
            <p className="text-slate-400">
              No valuation found for this item. It may have never been received on a posted bill or
              consumed by a job.
            </p>
            <Button
              size="sm"
              variant="ghost"
              icon="arrow_back"
              onClick={() => navigate(INVENTORY_BASE)}
            >
              Back to valuation
            </Button>
          </div>
        )}

        {row && (
          <>
            {/* Headline figures */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <StatCard label="Asset value" hint="Ties to GL 1300" tone="accent">
                {formatMoney(row.assetValue)}
              </StatCard>
              <StatCard label="On hand" hint="open units">
                {formatQty(row.qtyOnHand)}
              </StatCard>
              <StatCard label="Avg unit cost" hint="open layers">
                {row.qtyOnHand > 0 ? formatUnitCost(row.avgUnitCost) : '—'}
              </StatCard>
            </div>

            {/* Lifetime breakdown */}
            <section>
              <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-400">
                Lifetime activity
              </h2>
              <div className="divide-y divide-white/5 rounded-sm border border-white/10 bg-card-dark">
                <FactRow label="Units received (all layers)" value={formatQty(row.qtyReceivedTotal)} />
                <FactRow label="Units consumed (all jobs)" value={formatQty(row.qtyConsumedTotal)} />
                <FactRow label="Units on hand" value={formatQty(row.qtyOnHand)} />
                <FactRow
                  label="COGS relieved to 5000"
                  value={formatMoney(row.cogsTotal)}
                  muted
                />
                <FactRow label="FIFO asset value (1300)" value={formatMoney(row.assetValue)} />
              </div>
            </section>

            <p className="text-xs leading-relaxed text-slate-500">
              Asset value and average cost reflect only OPEN FIFO layers (remaining quantity &gt; 0).
              Receiving this item on a posted bill adds a cost layer; a job consuming it relieves cost
              oldest-layer-first to Cost of Goods Sold. Post a consuming job&apos;s COGS from the work
              list.
            </p>

            <div className="flex justify-end">
              <Button
                size="sm"
                variant="secondary"
                icon="checklist"
                onClick={() => navigate(`${INVENTORY_BASE}/cogs`)}
              >
                COGS work list
              </Button>
            </div>
          </>
        )}
      </div>
    </AccountingShell>
  );
}

import type { ReactNode } from 'react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { AccountingShell } from '../components/AccountingShell';
import { TaxDisclaimer } from '../components/TaxDisclaimer';
import {
  useInventoryReconciliationItem,
  usePendingInventoryRevaluations,
} from '../hooks/useAccountingQueries';
import { usePostInventoryRevaluation } from '../hooks/useAccountingMutations';
import { ACCOUNTING_BASE, INVENTORY_BASE, INVENTORY_RECONCILE_BASE } from '../constants';
import { PriceHistoryFeed } from './PriceHistoryFeed';
import {
  formatMoney,
  formatQty,
  formatSignedMoney,
  formatSignedQty,
  formatUnitCost,
  reconciliationFlags,
  signedTone,
} from './inventoryReconcileFormat';
import type { InventoryReconciliationRow, InventoryRevaluation } from '../types';

/**
 * Per-stock-item reconciliation detail (drill-down from the reconciliation grid). Shows the
 * operational ↔ accounting variance for ONE item (accounting.v_inventory_reconciliation),
 * any queued gated revaluation with a one-click post, and the per-unit COST change history
 * (public.inventory_price_history). Money moves only through the revaluation RPC the
 * mutation hook wraps (a balanced JE). Financial output → carries the CPA/EA disclaimer (G9).
 */

/** One labeled figure. `tone` accents/colors the value. */
function StatCard({
  label,
  children,
  hint,
  tone = 'default',
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  tone?: 'default' | 'accent' | 'good' | 'bad';
}) {
  const valueTone =
    tone === 'accent'
      ? 'text-primary'
      : tone === 'good'
        ? 'text-emerald-300'
        : tone === 'bad'
          ? 'text-red-300'
          : 'text-white';
  return (
    <div className="rounded-sm border border-white/10 bg-card-dark p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 font-mono text-lg font-bold tabular-nums ${valueTone}`}>{children}</p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

/** A read-only fact row in the breakdown list. */
function FactRow({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
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

/**
 * The item's pending gated revaluation (if any) with a one-click post of just this row's
 * batch. Posts the balanced JE (Dr/Cr 1300 ↔ 1310) via the RPC the mutation hook wraps.
 */
function ItemPendingRevaluation({ sourceInventoryId }: { sourceInventoryId: string }) {
  const { data: pending = [], isPending } = usePendingInventoryRevaluations(sourceInventoryId);
  const post = usePostInventoryRevaluation();
  const [result, setResult] = useState<{ posted: boolean; error?: string } | null>(null);

  if (isPending || pending.length === 0) return null;

  const reval: InventoryRevaluation = pending[0];
  const ids = pending.map((r) => r.id);

  const submit = async () => {
    setResult(null);
    const res = await post.mutateAsync(ids);
    setResult(res);
  };

  return (
    <section className="flex flex-col gap-2 rounded-sm border border-sky-500/30 bg-sky-500/5 p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wide text-sky-300">
          Pending revaluation
        </h2>
        <Button size="sm" icon="post_add" onClick={submit} disabled={post.isPending}>
          {post.isPending ? 'Posting…' : 'Post revaluation'}
        </Button>
      </div>
      <p className="text-xs text-slate-400">
        The unit cost changed from {formatMoney(reval.oldCost)} to {formatMoney(reval.newCost)} on{' '}
        {formatQty(reval.onHandQty)} on-hand. The cost value is already in sync; posting books the
        gated GL movement of{' '}
        <span className={`font-mono font-semibold ${signedTone(reval.deltaAmount)}`}>
          {formatSignedMoney(reval.deltaAmount)}
        </span>{' '}
        in one balanced entry.
      </p>
      {result && (
        <div
          className={`rounded-sm border px-3 py-2 text-xs ${
            result.error
              ? 'border-red-500/30 bg-red-500/10 text-red-300'
              : 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300'
          }`}
          role="status"
        >
          {result.error
            ? result.error
            : 'Revaluation posted. The open cost layers were re-marked to the current cost.'}
        </div>
      )}
    </section>
  );
}

export default function InventoryReconciliationItemView() {
  const { sourceInventoryId } = useParams<{ sourceInventoryId: string }>();
  const navigate = useNavigate();
  const { data: row, isPending, isError } = useInventoryReconciliationItem(sourceInventoryId);

  return (
    <AccountingShell
      active="inventory"
      title={row ? row.inventoryName || 'Stock item' : 'Reconciliation item'}
      actions={
        <Button
          size="sm"
          variant="ghost"
          icon="arrow_back"
          onClick={() => navigate(INVENTORY_RECONCILE_BASE)}
        >
          Reconciliation
        </Button>
      }
    >
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <TaxDisclaimer />

        {isPending && <p className="text-slate-400">Loading item reconciliation…</p>}
        {isError && <p className="text-red-400">Could not load this item&apos;s reconciliation.</p>}

        {!isPending && !isError && !row && (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <span className="material-symbols-outlined text-4xl text-slate-500">inventory_2</span>
            <p className="text-slate-400">
              No reconciliation row for this item. It may not exist operationally and have no
              accounting cost layer.
            </p>
            <Button
              size="sm"
              variant="ghost"
              icon="arrow_back"
              onClick={() => navigate(INVENTORY_RECONCILE_BASE)}
            >
              Back to reconciliation
            </Button>
          </div>
        )}

        {row && <ItemDetail row={row} />}
      </div>
    </AccountingShell>
  );
}

/** The loaded detail body (split out so the hooks above stay unconditional). */
function ItemDetail({ row }: { row: InventoryReconciliationRow }) {
  const navigate = useNavigate();
  const flags = reconciliationFlags(row);
  const qtyTied = row.qtyVariance === 0;
  const valueTied = Math.round(row.valueVariance * 100) === 0;

  return (
    <>
      {/* Attention flags */}
      {flags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {flags.map((f) => (
            <span
              key={f.key}
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${f.className}`}
            >
              {f.label}
            </span>
          ))}
        </div>
      ) : (
        <span className="w-fit rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-300">
          Reconciled — operational ties to accounting
        </span>
      )}

      {/* Headline variances */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <StatCard label="Quantity Δ" hint="op − accounting" tone={qtyTied ? 'good' : 'bad'}>
          {formatSignedQty(row.qtyVariance)}
        </StatCard>
        <StatCard label="Value Δ" hint="op − asset value" tone={valueTied ? 'good' : 'bad'}>
          {formatSignedMoney(row.valueVariance)}
        </StatCard>
        <StatCard
          label="Pending reval"
          hint={row.pendingRevalCount > 0 ? 'queued GL move' : 'none queued'}
          tone={row.pendingRevalCount > 0 ? 'accent' : 'default'}
        >
          {row.pendingRevalCount > 0 ? formatSignedMoney(row.pendingRevalAmount) : '—'}
        </StatCard>
      </div>

      {/* Pending revaluation (one-click post) */}
      <ItemPendingRevaluation sourceInventoryId={row.sourceInventoryId} />

      {/* Operational vs accounting breakdown */}
      <section>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-400">
          Operational vs. accounting
        </h2>
        <div className="divide-y divide-white/5 rounded-sm border border-white/10 bg-card-dark">
          <FactRow label="Operational on-hand (in stock)" value={formatQty(row.inStock)} />
          <FactRow
            label="Operational unit cost (price)"
            value={row.unitPrice == null ? '—' : formatUnitCost(row.unitPrice)}
          />
          <FactRow
            label="Operational value (in-stock × cost)"
            value={row.unitPrice == null ? '—' : formatMoney(row.opValue)}
          />
          <FactRow label="Accounting on-hand (FIFO layers)" value={formatQty(row.qtyOnHand)} />
          <FactRow
            label="Accounting avg unit cost"
            value={row.qtyOnHand > 0 ? formatUnitCost(row.avgUnitCost) : '—'}
          />
          <FactRow label="Asset value (ties to GL 1300)" value={formatMoney(row.assetValue)} />
        </div>
        {row.vendor && (
          <p className="mt-2 text-xs text-slate-500">
            Vendor: <span className="text-slate-400">{row.vendor}</span>
            {row.unit ? ` · Unit: ${row.unit}` : ''}
          </p>
        )}
      </section>

      {/* Per-unit cost-change history */}
      <PriceHistoryFeed inventoryId={row.sourceInventoryId} />

      {/* Cross-links */}
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          size="sm"
          variant="ghost"
          icon="inventory_2"
          onClick={() => navigate(`${INVENTORY_BASE}/items/${row.sourceInventoryId}`)}
        >
          Valuation detail
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon="open_in_new"
          iconPosition="right"
          onClick={() => navigate(`${ACCOUNTING_BASE}/journal`)}
        >
          View journal
        </Button>
      </div>
    </>
  );
}

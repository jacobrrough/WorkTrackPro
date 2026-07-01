import React from 'react';
import type { InventoryItem, Job, ViewState } from '@/core/types';
import { useInventoryCategories } from '@/features/inventory/useInventoryCategories';
import { shouldShowInventoryDetailPrice } from '@/lib/priceVisibility';
import { isAllocationActiveStatus, isConsumedStatus } from '@/lib/inventoryCalculations';
import { formatStockDisplay } from '@/lib/quantity';
import { StockTargetInput } from '@/features/inventory/StockTargetInput';
import { computeStock } from '@/features/inventory/inventoryViewModel';

interface InventoryDetailOverviewProps {
  item: InventoryItem;
  allocated: number;
  available: number;
  isAdmin: boolean;
  jobs: Job[];
  onNavigate: (view: ViewState, id?: string) => void;
  onOpenAllocate: () => void;
  onSetStock: (target: number) => Promise<void>;
  onMarkOrdered?: (itemId: string, quantity: number) => Promise<boolean>;
  onReceiveOrder?: (itemId: string, quantity: number) => Promise<boolean>;
  showAddToOrder: boolean;
  setShowAddToOrder: (v: boolean) => void;
  addToOrderQty: number;
  setAddToOrderQty: (v: number) => void;
  showReceiveOrder: boolean;
  setShowReceiveOrder: (v: boolean) => void;
  receiveOrderQty: number;
  setReceiveOrderQty: (v: number) => void;
  onConfirmAddToOrder: () => Promise<void>;
  onConfirmReceiveOrder: () => Promise<void>;
  showToast: (message: string, type: 'success' | 'error' | 'warning') => void;
  onScanBarcode?: () => void;
}

export function InventoryDetailOverview({
  item,
  allocated,
  available,
  isAdmin,
  jobs,
  onNavigate,
  onOpenAllocate,
  onSetStock,
  onMarkOrdered,
  onReceiveOrder,
  showAddToOrder,
  setShowAddToOrder,
  addToOrderQty,
  setAddToOrderQty,
  showReceiveOrder,
  setShowReceiveOrder,
  receiveOrderQty,
  setReceiveOrderQty,
  onConfirmAddToOrder,
  onConfirmReceiveOrder,
  onScanBarcode,
}: InventoryDetailOverviewProps) {
  const { getLabel: getCategoryLabel } = useInventoryCategories();
  // Staged stock count: null = not editing, otherwise the target absolute in-stock value the
  // user is dialing in via the text box or the +/- nudges. Nothing is written until Confirm.
  const [stockTarget, setStockTarget] = React.useState<number | null>(null);
  const [isSavingStock, setIsSavingStock] = React.useState(false);
  const displayTarget = stockTarget ?? item.inStock;
  const stockDelta = displayTarget - item.inStock;
  const isStagingStock = stockTarget !== null && stockDelta !== 0;

  // Floor at 0 so a manual recount can't drive stock negative; consuming into negative goes
  // through the job flows. Collapse back to null when the target lands on the current count so
  // a no-op edit doesn't leave the Confirm bar (or a stale number) lingering.
  const applyTarget = (value: number) => {
    // Empty/invalid input reverts to the current count rather than coercing to 0, so clearing
    // the box and confirming can't silently zero the item.
    if (!Number.isFinite(value)) {
      setStockTarget(null);
      return;
    }
    const clamped = Math.max(0, value);
    setStockTarget(clamped === item.inStock ? null : clamped);
  };
  // Functional updater so rapid +/- taps accumulate off the latest staged value rather than a
  // stale closure read.
  const nudgeTarget = (step: number) =>
    setStockTarget((prev) => {
      const clamped = Math.max(0, (prev ?? item.inStock) + step);
      return clamped === item.inStock ? null : clamped;
    });

  const confirmStock = async () => {
    if (isSavingStock) return; // a write is already in flight — avoid a double-apply
    if (stockTarget === null) return;
    setIsSavingStock(true);
    try {
      // Authoritative absolute set: persist exactly the value the user dialed in, so a stale
      // displayed count can't silently turn "set to N" into the wrong total.
      await onSetStock(displayTarget);
      setStockTarget(null);
    } finally {
      // On failure keep the staged target so the user can retry rather than losing the count.
      setIsSavingStock(false);
    }
  };

  const minStock = item.reorderPoint ?? 0;
  const minStockPercent = minStock > 0 ? Math.min(200, (available / minStock) * 100) : 100;

  // Reorder warning — driven straight off the canonical computeStock so this banner cannot
  // disagree with the Needs Reorder list or show a different shortfall number. The resolved
  // `available`/`allocated` scalars are the same inputs the list feeds into computeStock, so we
  // pass them through trivial accessors. Gating on `needsReorder` (after-orders) means an item
  // fully covered by an incoming order won't alarm here either.
  const stock = computeStock(
    item,
    () => available,
    () => allocated
  );
  const belowReorderPoint = stock.belowThresholdAfterOrders;
  const shortForJobs = stock.shortForJobs;
  const sku = (item.barcode || item.id.slice(0, 8)).toUpperCase();
  const reorderCostEstimate =
    shouldShowInventoryDetailPrice(item, isAdmin) && minStock > 0
      ? minStock * (item.price ?? 0)
      : null;
  const linkedJobs = React.useMemo(() => {
    const entries: Array<{ job: Job; quantity: number; jobInventoryId: string }> = [];
    for (const job of jobs) {
      if (!isAllocationActiveStatus(job.status)) continue;
      for (const ji of job.inventoryItems ?? []) {
        if (ji.inventoryId === item.id) {
          entries.push({ job, quantity: ji.quantity, jobInventoryId: ji.id });
        }
      }
    }
    return entries;
  }, [jobs, item.id]);

  const consumedJobs = React.useMemo(() => {
    const entries: Array<{ job: Job; quantity: number; jobInventoryId: string }> = [];
    for (const job of jobs) {
      if (!isConsumedStatus(job.status)) continue;
      for (const ji of job.inventoryItems ?? []) {
        if (ji.inventoryId === item.id) {
          entries.push({ job, quantity: ji.quantity, jobInventoryId: ji.id });
        }
      }
    }
    return entries;
  }, [jobs, item.id]);

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-line bg-card-dark p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted">SKU</p>
            <p className="font-mono text-sm text-white">{sku}</p>
          </div>
          <div className="text-right">
            <p className="text-xs font-bold uppercase tracking-wide text-muted">In Stock</p>
            <p className="text-3xl font-bold text-white">{formatStockDisplay(item.inStock)}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-full border border-line bg-overlay/5 px-2.5 py-1 text-xs font-bold text-white">
            {getCategoryLabel(item.category)}
          </span>
          {item.vendor && (
            <span className="rounded-full border border-line bg-overlay/5 px-2.5 py-1 text-xs font-bold text-white">
              {item.vendor}
            </span>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => nudgeTarget(-1)}
            className="flex size-11 items-center justify-center rounded-lg border border-line text-white"
            aria-label="Decrease stock"
          >
            <span className="material-symbols-outlined">remove</span>
          </button>
          <StockTargetInput
            value={displayTarget}
            onChangeNumber={applyTarget}
            className="w-20 rounded-lg border border-line bg-overlay/5 px-2 py-2 text-center text-white"
            ariaLabel="Set stock count"
          />
          <button
            type="button"
            onClick={() => nudgeTarget(1)}
            className="flex size-11 items-center justify-center rounded-lg border border-line text-white"
            aria-label="Increase stock"
          >
            <span className="material-symbols-outlined">add</span>
          </button>
          <button
            type="button"
            onClick={onOpenAllocate}
            className="min-h-[44px] rounded-2xl border border-primary/30 bg-primary/10 px-3 text-sm font-bold text-primary"
          >
            Allocate to job
          </button>
        </div>
        {isStagingStock && (
          <div
            className="mt-3 flex items-center justify-between gap-2 rounded-2xl border border-primary/40 bg-primary/10 px-3 py-2"
            aria-live="polite"
          >
            <span className="text-sm font-medium text-primary">
              {formatStockDisplay(item.inStock)} → {formatStockDisplay(displayTarget)}{' '}
              <span className="text-xs text-muted">
                ({stockDelta > 0 ? '+' : ''}
                {formatStockDisplay(stockDelta)})
              </span>
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isSavingStock}
                onClick={() => setStockTarget(null)}
                className="min-h-[44px] rounded-lg border border-line-strong px-3 text-xs font-bold text-muted disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSavingStock}
                onClick={() => void confirmStock()}
                className="min-h-[44px] rounded-lg bg-primary px-4 text-xs font-bold text-on-accent disabled:opacity-50"
              >
                {isSavingStock ? 'Saving…' : 'Confirm'}
              </button>
            </div>
          </div>
        )}
      </div>

      {item.description && (
        <div className="rounded-lg bg-card-dark p-3">
          <h2 className="mb-2 text-sm font-bold text-white">Description</h2>
          <p className="text-sm leading-relaxed text-muted">{item.description}</p>
        </div>
      )}

      <div className="rounded-lg bg-card-dark p-3">
        <h2 className="mb-4 text-lg font-bold text-white">Stock Overview</h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-overlay/5 p-3">
            <p className="text-sm text-muted">In Stock</p>
            <p className="text-2xl font-bold text-white">{formatStockDisplay(item.inStock)}</p>
          </div>
          <div className="rounded-lg bg-overlay/5 p-3">
            <p className="text-sm text-muted">Available</p>
            <p className="text-2xl font-bold text-green-400">{formatStockDisplay(available)}</p>
          </div>
          <div className="rounded-lg bg-overlay/5 p-3">
            <p className="text-sm text-muted">Allocated (needed for jobs)</p>
            <p className="text-2xl font-bold text-yellow-400">{formatStockDisplay(allocated)}</p>
            <p className="text-xs text-subtle">PO&apos;d / in-production jobs only</p>
          </div>
          <div className="rounded-lg bg-overlay/5 p-3">
            <p className="text-sm text-muted">On Order</p>
            <p className="text-2xl font-bold text-blue-400">
              {formatStockDisplay(item.onOrder || 0)}
            </p>
          </div>
        </div>

        {(onMarkOrdered || onReceiveOrder) && (
          <div className="mt-4 flex flex-wrap gap-2">
            {onMarkOrdered && (
              <button
                type="button"
                onClick={() => setShowAddToOrder(true)}
                className="min-h-[44px] rounded-2xl border border-primary/30 bg-primary/10 px-3 text-sm font-bold text-primary"
              >
                <span className="material-symbols-outlined mr-1 align-middle text-lg">
                  pending_actions
                </span>
                Add to order
              </button>
            )}
            {onReceiveOrder && (
              <button
                type="button"
                onClick={() => {
                  setReceiveOrderQty(item.onOrder ?? 0);
                  setShowReceiveOrder(true);
                }}
                className="min-h-[44px] rounded-2xl border border-green-500/30 bg-green-500/10 px-3 text-sm font-bold text-green-400"
              >
                <span className="material-symbols-outlined mr-1 align-middle text-lg">
                  local_shipping
                </span>
                Receive order
              </button>
            )}
          </div>
        )}

        {showAddToOrder && onMarkOrdered && (
          <div className="mt-4 rounded-2xl border border-line bg-overlay/5 p-3">
            <p className="mb-2 text-sm font-bold text-muted">Add to order ({item.unit})</p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="number"
                min={0}
                step={1}
                value={addToOrderQty}
                onChange={(e) => setAddToOrderQty(Math.max(0, parseFloat(e.target.value) || 0))}
                className="w-24 rounded-lg border border-line bg-overlay/5 px-3 py-2 text-white"
              />
              <button
                type="button"
                onClick={onConfirmAddToOrder}
                className="min-h-[44px] rounded-lg bg-primary px-3 text-sm font-bold text-on-accent"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddToOrder(false);
                  setAddToOrderQty(0);
                }}
                className="min-h-[44px] rounded-lg border border-line-strong px-3 text-sm text-muted"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {showReceiveOrder && onReceiveOrder && (
          <div className="mt-4 rounded-2xl border border-line bg-overlay/5 p-3">
            <p className="mb-2 text-sm font-bold text-muted">Receive order ({item.unit})</p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="number"
                min={0}
                max={item.onOrder ?? 0}
                step={1}
                value={receiveOrderQty}
                onChange={(e) =>
                  setReceiveOrderQty(
                    Math.max(0, Math.min(item.onOrder ?? 0, parseFloat(e.target.value) || 0))
                  )
                }
                className="w-24 rounded-lg border border-line bg-overlay/5 px-3 py-2 text-white"
              />
              <span className="text-xs text-subtle">
                max {formatStockDisplay(item.onOrder ?? 0)}
              </span>
              <button
                type="button"
                onClick={onConfirmReceiveOrder}
                className="min-h-[44px] rounded-lg bg-green-600 px-3 text-sm font-bold text-white"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowReceiveOrder(false);
                  setReceiveOrderQty(0);
                }}
                className="min-h-[44px] rounded-lg border border-line-strong px-3 text-sm text-muted"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {minStock > 0 && (
          <div className="mt-4 rounded-2xl border border-line bg-overlay/5 p-3">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="font-bold text-muted">Min Stock Coverage</span>
              <span className="text-muted">
                {formatStockDisplay(available)} / {minStock}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-overlay/10">
              <div
                className={`h-full ${available <= 0 ? 'bg-red-500' : available < minStock ? 'bg-yellow-500' : 'bg-green-500'}`}
                style={{ width: `${Math.max(5, Math.min(minStockPercent, 100))}%` }}
              />
            </div>
          </div>
        )}

        {stock.needsReorder ? (
          <div className="mt-4 space-y-1 rounded-2xl border border-red-500/30 bg-red-500/10 p-3">
            <p className="font-bold text-red-400">
              {belowReorderPoint && shortForJobs
                ? '⚠️ Below reorder point & short for jobs'
                : belowReorderPoint
                  ? '⚠️ Below reorder point'
                  : shortForJobs
                    ? '⚠️ Short for jobs'
                    : '⚠️ Out of stock'}
            </p>
            {belowReorderPoint && (
              <p className="text-sm font-bold text-red-300">
                Available ({formatStockDisplay(available)}) is at or below reorder point (
                {item.reorderPoint}).
              </p>
            )}
            {shortForJobs && (
              <p className="text-sm text-red-300">
                {formatStockDisplay(allocated)} {item.unit} needed to complete all jobs (committed
                to PO&apos;d / in-production jobs).
              </p>
            )}
            {stock.outOfStock && !shortForJobs && !belowReorderPoint && (
              <p className="text-sm text-red-300">
                Out of stock with nothing on order — reorder to restock.
              </p>
            )}
            {stock.shortfall > 0 && (
              <p className="text-sm font-bold text-red-300">
                Order at least {formatStockDisplay(stock.shortfall)} {item.unit} to restock.
              </p>
            )}
          </div>
        ) : null}
      </div>

      <div className="space-y-3 rounded-lg bg-card-dark p-3">
        <h2 className="mb-4 text-lg font-bold text-white">Location & Barcode</h2>
        {item.barcode && (
          <div className="flex justify-between border-b border-line pb-2">
            <p className="text-sm text-muted">Barcode</p>
            <p className="font-mono text-sm text-white">{item.barcode}</p>
          </div>
        )}
        {item.binLocation && (
          <div className="flex justify-between border-b border-line pb-2">
            <p className="text-sm text-muted">Bin Location</p>
            <p className="font-bold text-white">{item.binLocation}</p>
          </div>
        )}
        <div className="flex justify-between border-b border-line pb-2">
          <p className="text-sm text-muted">Unit</p>
          <p className="font-bold text-white">{item.unit}</p>
        </div>
        {isAdmin && onScanBarcode && (
          <button
            type="button"
            onClick={onScanBarcode}
            className="min-h-[44px] rounded-2xl border border-primary/30 bg-primary/10 px-3 text-sm font-bold text-primary"
          >
            Scan Barcode
          </button>
        )}
      </div>

      <div className="space-y-3 rounded-lg bg-card-dark p-3">
        <h2 className="mb-4 text-lg font-bold text-white">Supplier & Pricing</h2>
        {item.vendor && (
          <div className="flex justify-between border-b border-line pb-2">
            <p className="text-sm text-muted">Vendor</p>
            <p className="text-white">{item.vendor}</p>
          </div>
        )}
        {shouldShowInventoryDetailPrice(item, isAdmin) && (
          <div className="flex justify-between border-b border-line pb-2">
            <p className="text-sm text-muted">Unit Price</p>
            <p className="font-bold text-white">
              ${(item.price ?? 0).toFixed(2)} / {item.unit}
            </p>
          </div>
        )}
        {reorderCostEstimate != null && (
          <div className="flex justify-between border-b border-line pb-2">
            <p className="text-sm text-muted">Reorder Cost Estimate</p>
            <p className="font-bold text-white">${reorderCostEstimate.toFixed(2)}</p>
          </div>
        )}
        <div className="flex justify-between">
          <p className="text-sm text-muted">Reorder Point</p>
          <p
            className={`font-bold ${item.reorderPoint != null && item.reorderPoint > 0 && available <= item.reorderPoint ? 'text-orange-400' : 'text-white'}`}
          >
            {item.reorderPoint != null ? item.reorderPoint : 'Not set'}
          </p>
        </div>
      </div>

      <div className="rounded-lg bg-card-dark p-3">
        <h2 className="mb-3 text-lg font-bold text-white">Linked Jobs</h2>
        {linkedJobs.length === 0 ? (
          <p className="text-sm text-muted">No active job allocations for this part.</p>
        ) : (
          <div className="space-y-2">
            {linkedJobs.map(({ job, quantity, jobInventoryId }) => (
              <button
                type="button"
                key={jobInventoryId}
                onClick={() => onNavigate('job-detail', job.id)}
                className="flex w-full items-center justify-between rounded-lg border border-line bg-overlay/5 px-3 py-2 text-left hover:bg-overlay/10"
              >
                <div>
                  <p className="font-bold text-white">Job #{job.jobCode}</p>
                  <p className="text-xs text-muted">{job.name}</p>
                </div>
                <p className="text-sm font-bold text-yellow-300">
                  {formatStockDisplay(quantity)} {item.unit}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>

      {consumedJobs.length > 0 && (
        <div className="rounded-lg bg-card-dark p-3">
          <h2 className="mb-3 text-lg font-bold text-white">Consumed Jobs</h2>
          <p className="mb-2 text-xs text-subtle">
            Stock has already been deducted for these jobs.
          </p>
          <div className="space-y-2">
            {consumedJobs.map(({ job, quantity, jobInventoryId }) => (
              <button
                type="button"
                key={jobInventoryId}
                onClick={() => onNavigate('job-detail', job.id)}
                className="flex w-full items-center justify-between rounded-lg border border-line bg-overlay/5 px-3 py-2 text-left hover:bg-overlay/10"
              >
                <div>
                  <p className="font-bold text-white">Job #{job.jobCode}</p>
                  <p className="text-xs text-muted">
                    {job.name} <span className="ml-1 capitalize text-subtle">({job.status})</span>
                  </p>
                </div>
                <p className="text-sm font-bold text-muted">
                  {formatStockDisplay(quantity)} {item.unit}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

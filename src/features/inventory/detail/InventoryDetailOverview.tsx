import React from 'react';
import type { InventoryItem, Job, ViewState } from '@/core/types';
import { getCategoryDisplayName } from '@/core/types';
import { shouldShowInventoryDetailPrice } from '@/lib/priceVisibility';
import { isAllocationActiveStatus } from '@/lib/inventoryCalculations';

export function formatStockDisplay(value: number): string {
  if (Number.isInteger(value)) return String(value);
  const rounded = Math.round(value * 100) / 100;
  return rounded.toFixed(rounded % 1 === 0 ? 0 : 2);
}

interface InventoryDetailOverviewProps {
  item: InventoryItem;
  allocated: number;
  available: number;
  isAdmin: boolean;
  jobs: Job[];
  onNavigate: (view: ViewState, id?: string) => void;
  onOpenAllocate: () => void;
  onQuickAdjust: (delta: number) => Promise<void>;
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
  onQuickAdjust,
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
  showToast,
  onScanBarcode,
}: InventoryDetailOverviewProps) {
  const minStock = item.reorderPoint ?? 0;
  const minStockPercent = minStock > 0 ? Math.min(200, (available / minStock) * 100) : 100;
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

  return (
    <div className="space-y-3">
      <div className="rounded-sm border border-white/10 bg-card-dark p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">SKU</p>
            <p className="font-mono text-sm text-white">{sku}</p>
          </div>
          <div className="text-right">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">In Stock</p>
            <p className="text-3xl font-bold text-white">{item.inStock}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-bold text-slate-200">
            {getCategoryDisplayName(item.category)}
          </span>
          {item.vendor && (
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-bold text-slate-200">
              {item.vendor}
            </span>
          )}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => onQuickAdjust(-1)}
            className="flex size-11 items-center justify-center rounded-sm border border-white/10 text-white"
            aria-label="Decrease stock"
          >
            <span className="material-symbols-outlined">remove</span>
          </button>
          <button
            type="button"
            onClick={() => onQuickAdjust(1)}
            className="flex size-11 items-center justify-center rounded-sm border border-white/10 text-white"
            aria-label="Increase stock"
          >
            <span className="material-symbols-outlined">add</span>
          </button>
          <button
            type="button"
            onClick={onOpenAllocate}
            className="min-h-[44px] rounded-sm border border-primary/30 bg-primary/10 px-3 text-sm font-bold text-primary"
          >
            Allocate to job
          </button>
        </div>
      </div>

      {item.description && (
        <div className="rounded-sm bg-card-dark p-3">
          <h2 className="mb-2 text-sm font-bold text-white">Description</h2>
          <p className="text-sm leading-relaxed text-slate-300">{item.description}</p>
        </div>
      )}

      <div className="rounded-sm bg-card-dark p-3">
        <h2 className="mb-4 text-lg font-bold text-white">Stock Overview</h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-sm bg-white/5 p-3">
            <p className="text-sm text-slate-400">In Stock</p>
            <p className="text-2xl font-bold text-white">{formatStockDisplay(item.inStock)}</p>
          </div>
          <div className="rounded-sm bg-white/5 p-3">
            <p className="text-sm text-slate-400">Available</p>
            <p className="text-2xl font-bold text-green-400">{formatStockDisplay(available)}</p>
          </div>
          <div className="rounded-sm bg-white/5 p-3">
            <p className="text-sm text-slate-400">Allocated (needed for jobs)</p>
            <p className="text-2xl font-bold text-yellow-400">{formatStockDisplay(allocated)}</p>
            <p className="text-xs text-slate-500">PO&apos;d / in-production jobs only</p>
          </div>
          <div className="rounded-sm bg-white/5 p-3">
            <p className="text-sm text-slate-400">On Order</p>
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
                className="min-h-[44px] rounded-sm border border-primary/30 bg-primary/10 px-3 text-sm font-bold text-primary"
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
                className="min-h-[44px] rounded-sm border border-green-500/30 bg-green-500/10 px-3 text-sm font-bold text-green-400"
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
          <div className="mt-4 rounded-sm border border-white/10 bg-white/5 p-3">
            <p className="mb-2 text-sm font-bold text-slate-300">Add to order ({item.unit})</p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="number"
                min={0}
                step={1}
                value={addToOrderQty}
                onChange={(e) => setAddToOrderQty(Math.max(0, parseFloat(e.target.value) || 0))}
                className="w-24 rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-white"
              />
              <button
                type="button"
                onClick={onConfirmAddToOrder}
                className="min-h-[44px] rounded-sm bg-primary px-3 text-sm font-bold text-white"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddToOrder(false);
                  setAddToOrderQty(0);
                }}
                className="min-h-[44px] rounded-sm border border-white/20 px-3 text-sm text-slate-300"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {showReceiveOrder && onReceiveOrder && (
          <div className="mt-4 rounded-sm border border-white/10 bg-white/5 p-3">
            <p className="mb-2 text-sm font-bold text-slate-300">Receive order ({item.unit})</p>
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
                className="w-24 rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-white"
              />
              <span className="text-xs text-slate-500">
                max {formatStockDisplay(item.onOrder ?? 0)}
              </span>
              <button
                type="button"
                onClick={onConfirmReceiveOrder}
                className="min-h-[44px] rounded-sm bg-green-600 px-3 text-sm font-bold text-white"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowReceiveOrder(false);
                  setReceiveOrderQty(0);
                }}
                className="min-h-[44px] rounded-sm border border-white/20 px-3 text-sm text-slate-300"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {minStock > 0 && (
          <div className="mt-4 rounded-sm border border-white/10 bg-white/5 p-3">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="font-bold text-slate-300">Min Stock Coverage</span>
              <span className="text-slate-400">
                {formatStockDisplay(available)} / {minStock}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className={`h-full ${available <= 0 ? 'bg-red-500' : available < minStock ? 'bg-yellow-500' : 'bg-green-500'}`}
                style={{ width: `${Math.max(5, Math.min(minStockPercent, 100))}%` }}
              />
            </div>
          </div>
        )}

        {(item.reorderPoint != null && item.reorderPoint > 0 && available <= item.reorderPoint) ||
        (allocated > 0 && available < allocated) ? (
          <div className="mt-4 space-y-1 rounded-sm border border-red-500/30 bg-red-500/10 p-3">
            <p className="font-bold text-red-400">
              {item.reorderPoint != null &&
              item.reorderPoint > 0 &&
              available <= item.reorderPoint &&
              allocated > 0 &&
              available < allocated
                ? '⚠️ Below reorder point & short for jobs'
                : item.reorderPoint != null &&
                    item.reorderPoint > 0 &&
                    available <= item.reorderPoint
                  ? '⚠️ Below reorder point'
                  : '⚠️ Short for jobs'}
            </p>
            {item.reorderPoint != null &&
              item.reorderPoint > 0 &&
              available <= item.reorderPoint && (
                <p className="text-sm font-bold text-red-300">
                  Available ({formatStockDisplay(available)}) is at or below reorder point (
                  {item.reorderPoint}).
                </p>
              )}
            {allocated > 0 && available < allocated && (
              <p className="text-sm text-red-300">
                {formatStockDisplay(allocated)} {item.unit} needed to complete all jobs (committed
                to PO&apos;d / in-production jobs). Short by{' '}
                {formatStockDisplay(allocated - available)} {item.unit} — order at least this much
                to fulfill current jobs.
              </p>
            )}
          </div>
        ) : null}
      </div>

      <div className="space-y-3 rounded-sm bg-card-dark p-3">
        <h2 className="mb-4 text-lg font-bold text-white">Location & Barcode</h2>
        {item.barcode && (
          <div className="flex justify-between border-b border-white/10 pb-2">
            <p className="text-sm text-slate-400">Barcode</p>
            <p className="font-mono text-sm text-white">{item.barcode}</p>
          </div>
        )}
        {item.binLocation && (
          <div className="flex justify-between border-b border-white/10 pb-2">
            <p className="text-sm text-slate-400">Bin Location</p>
            <p className="font-bold text-white">{item.binLocation}</p>
          </div>
        )}
        <div className="flex justify-between border-b border-white/10 pb-2">
          <p className="text-sm text-slate-400">Unit</p>
          <p className="font-bold text-white">{item.unit}</p>
        </div>
        {isAdmin && onScanBarcode && (
          <button
            type="button"
            onClick={onScanBarcode}
            className="min-h-[44px] rounded-sm border border-primary/30 bg-primary/10 px-3 text-sm font-bold text-primary"
          >
            Scan Barcode
          </button>
        )}
      </div>

      <div className="space-y-3 rounded-sm bg-card-dark p-3">
        <h2 className="mb-4 text-lg font-bold text-white">Supplier & Pricing</h2>
        {item.vendor && (
          <div className="flex justify-between border-b border-white/10 pb-2">
            <p className="text-sm text-slate-400">Vendor</p>
            <p className="text-white">{item.vendor}</p>
          </div>
        )}
        {shouldShowInventoryDetailPrice(item, isAdmin) && (
          <div className="flex justify-between border-b border-white/10 pb-2">
            <p className="text-sm text-slate-400">Unit Price</p>
            <p className="font-bold text-white">
              ${(item.price ?? 0).toFixed(2)} / {item.unit}
            </p>
          </div>
        )}
        {reorderCostEstimate != null && (
          <div className="flex justify-between border-b border-white/10 pb-2">
            <p className="text-sm text-slate-400">Reorder Cost Estimate</p>
            <p className="font-bold text-white">${reorderCostEstimate.toFixed(2)}</p>
          </div>
        )}
        <div className="flex justify-between">
          <p className="text-sm text-slate-400">Reorder Point</p>
          <p
            className={`font-bold ${item.reorderPoint != null && item.reorderPoint > 0 && available <= item.reorderPoint ? 'text-orange-400' : 'text-white'}`}
          >
            {item.reorderPoint != null ? item.reorderPoint : 'Not set'}
          </p>
        </div>
      </div>

      <div className="rounded-sm bg-card-dark p-3">
        <h2 className="mb-3 text-lg font-bold text-white">Linked Jobs</h2>
        {linkedJobs.length === 0 ? (
          <p className="text-sm text-slate-400">No active job allocations for this part.</p>
        ) : (
          <div className="space-y-2">
            {linkedJobs.map(({ job, quantity, jobInventoryId }) => (
              <button
                type="button"
                key={jobInventoryId}
                onClick={() => onNavigate('job-detail', job.id)}
                className="flex w-full items-center justify-between rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-left hover:bg-white/10"
              >
                <div>
                  <p className="font-bold text-white">Job #{job.jobCode}</p>
                  <p className="text-xs text-slate-400">{job.name}</p>
                </div>
                <p className="text-sm font-bold text-yellow-300">
                  {quantity} {item.unit}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

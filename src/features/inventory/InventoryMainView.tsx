import React, { useMemo, useState } from 'react';
import type { InventoryCategory, InventoryItem, Job } from '@/core/types';
import { getCategoryDisplayName } from '@/core/types';
import { useToast } from '@/Toast';
import AllocateToJobModal from './AllocateToJobModal';
import {
  InventoryFilters,
  InventoryTab,
  computeStock,
  getSku,
  getSuppliers,
  groupByBin,
  matchesFilters,
} from './inventoryViewModel';

interface InventoryMainViewProps {
  inventory: InventoryItem[];
  jobs: Job[];
  isAdmin: boolean;
  onBack: () => void;
  filters: InventoryFilters;
  onFiltersChange: (patch: Partial<InventoryFilters>) => void;
  onAddItem: () => void;
  onOpenDetail: (itemId: string) => void;
  onQuickAdjust: (item: InventoryItem, delta: number) => Promise<void>;
  onAllocateToJob: (
    jobId: string,
    inventoryId: string,
    quantity: number,
    notes?: string
  ) => Promise<boolean>;
  calculateAvailable: (item: InventoryItem) => number;
  calculateAllocated: (inventoryId: string) => number;
}

const CATEGORY_OPTIONS: Array<InventoryCategory | 'all'> = [
  'all',
  'material',
  'foam',
  'trimCord',
  'printing3d',
  'chemicals',
  'hardware',
  'miscSupplies',
];

export default function InventoryMainView({
  inventory,
  jobs,
  isAdmin,
  onBack,
  filters,
  onFiltersChange,
  onAddItem,
  onOpenDetail,
  onQuickAdjust,
  onAllocateToJob,
  calculateAvailable,
  calculateAllocated,
}: InventoryMainViewProps) {
  const { showToast } = useToast();
  const [tab, setTab] = useState<InventoryTab>('allParts');
  const [allocatingItem, setAllocatingItem] = useState<InventoryItem | null>(null);

  const suppliers = useMemo(() => getSuppliers(inventory), [inventory]);
  const baseFiltered = useMemo(
    () =>
      inventory
        .filter((item) => matchesFilters(item, filters))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [filters, inventory]
  );

  const tabFiltered = useMemo(() => {
    if (tab === 'allParts') return baseFiltered;
    if (tab === 'needsReordering') {
      return baseFiltered.filter(
        (item) => computeStock(item, calculateAvailable, calculateAllocated).needsReorder
      );
    }
    if (tab === 'lowStock') {
      return baseFiltered.filter((item) => {
        const stock = computeStock(item, calculateAvailable, calculateAllocated);
        return stock.lowStock || stock.available <= 0;
      });
    }
    return baseFiltered;
  }, [baseFiltered, calculateAllocated, calculateAvailable, tab]);

  const bins = useMemo(() => groupByBin(baseFiltered), [baseFiltered]);
  const summary = useMemo(() => {
    let needsReorder = 0;
    let lowStock = 0;
    for (const item of baseFiltered) {
      const stock = computeStock(item, calculateAvailable, calculateAllocated);
      if (stock.needsReorder) needsReorder += 1;
      if (stock.lowStock || stock.available <= 0) lowStock += 1;
    }
    return { total: baseFiltered.length, needsReorder, lowStock };
  }, [baseFiltered, calculateAllocated, calculateAvailable]);

  const handleQuickAdjust = async (item: InventoryItem, delta: number) => {
    if (!isAdmin) {
      showToast('Only admins can adjust stock', 'error');
      return;
    }
    const next = Math.max(0, item.inStock + delta);
    await onQuickAdjust(item, next - item.inStock);
  };

  const exportCsv = () => {
    const rows = tabFiltered.map((item) => {
      const stock = computeStock(item, calculateAvailable, calculateAllocated);
      return [
        `"${item.name.replace(/"/g, '""')}"`,
        `"${getSku(item)}"`,
        `"${item.category}"`,
        `"${item.vendor ?? ''}"`,
        `"${item.binLocation ?? ''}"`,
        item.inStock,
        stock.allocated,
        stock.available,
        item.reorderPoint ?? '',
      ].join(',');
    });
    const csv = [
      'name,sku,category,supplier,bin,in_stock,allocated,available,min_stock',
      ...rows,
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'inventory-export.csv';
    link.click();
    URL.revokeObjectURL(url);
    showToast('Inventory exported to CSV', 'success');
  };

  const renderRow = (item: InventoryItem) => {
    const stock = computeStock(item, calculateAvailable, calculateAllocated);
    const availColor =
      stock.available <= 0 ? 'text-red-400' : stock.lowStock ? 'text-yellow-400' : 'text-green-400';
    return (
      <div key={item.id} className="rounded-sm border border-white/10 bg-card-dark p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-bold text-white">{item.name}</p>
            <p className="text-xs text-slate-400">SKU: {getSku(item)}</p>
          </div>
          {stock.needsReorder && (
            <span className="rounded-sm border border-red-500/40 bg-red-500/20 px-2 py-1 text-xs font-bold text-red-300">
              Min Stock
            </span>
          )}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
          <div>
            <p className="text-xs text-slate-500">In Stock</p>
            <p className="font-bold text-white">{item.inStock}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Allocated</p>
            <p className="font-bold text-yellow-300">{stock.allocated}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Available</p>
            <p className={`font-bold ${availColor}`}>{stock.available}</p>
          </div>
        </div>
        <div className="mt-2 text-xs text-slate-400">
          Bin: {item.binLocation || 'Unassigned'} • {getCategoryDisplayName(item.category)}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onOpenDetail(item.id)}
            className="min-h-[44px] rounded-sm border border-white/10 px-3 text-xs font-bold text-white"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => onOpenDetail(item.id)}
            className="min-h-[44px] rounded-sm border border-white/10 px-3 text-xs font-bold text-white"
          >
            View History
          </button>
          <button
            type="button"
            onClick={() => setAllocatingItem(item)}
            className="min-h-[44px] rounded-sm border border-primary/30 bg-primary/10 px-3 text-xs font-bold text-primary"
          >
            Allocate To Job
          </button>
          {isAdmin && (
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={() => handleQuickAdjust(item, -1)}
                className="flex size-11 items-center justify-center rounded-sm border border-white/10 text-white"
                aria-label={`Decrease stock for ${item.name}`}
              >
                <span className="material-symbols-outlined">remove</span>
              </button>
              <button
                type="button"
                onClick={() => handleQuickAdjust(item, 1)}
                className="flex size-11 items-center justify-center rounded-sm border border-white/10 text-white"
                aria-label={`Increase stock for ${item.name}`}
              >
                <span className="material-symbols-outlined">add</span>
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col bg-background-dark">
      <div className="sticky top-0 z-20 border-b border-white/10 bg-background-dark px-3 py-3">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onBack}
              className="flex size-10 items-center justify-center rounded-sm border border-white/10 text-white hover:bg-white/10"
              aria-label="Back to dashboard"
            >
              <span className="material-symbols-outlined">arrow_back</span>
            </button>
            <h1 className="text-xl font-bold text-white">Parts Inventory</h1>
          </div>
          <button
            type="button"
            onClick={exportCsv}
            className="min-h-[44px] rounded-sm border border-white/10 px-3 text-xs font-bold text-white"
          >
            Export CSV
          </button>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <button
            type="button"
            onClick={() => setTab('allParts')}
            className={`min-h-[44px] rounded-sm text-xs font-bold ${tab === 'allParts' ? 'bg-primary text-white' : 'bg-white/5 text-slate-300'}`}
          >
            All Parts
          </button>
          <button
            type="button"
            onClick={() => setTab('needsReordering')}
            className={`min-h-[44px] rounded-sm text-xs font-bold ${tab === 'needsReordering' ? 'bg-primary text-white' : 'bg-white/5 text-slate-300'}`}
          >
            Needs Reordering
          </button>
          <button
            type="button"
            onClick={() => setTab('lowStock')}
            className={`min-h-[44px] rounded-sm text-xs font-bold ${tab === 'lowStock' ? 'bg-primary text-white' : 'bg-white/5 text-slate-300'}`}
          >
            Low Stock
          </button>
          <button
            type="button"
            onClick={() => setTab('byBin')}
            className={`min-h-[44px] rounded-sm text-xs font-bold ${tab === 'byBin' ? 'bg-primary text-white' : 'bg-white/5 text-slate-300'}`}
          >
            By Bin Location
          </button>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <input
            type="search"
            value={filters.search}
            onChange={(event) => onFiltersChange({ search: event.target.value })}
            placeholder="Search name, SKU, bin, category"
            className="min-h-[44px] rounded-sm border border-white/10 bg-white/5 px-3 text-white sm:col-span-2"
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={filters.category}
              onChange={(event) =>
                onFiltersChange({ category: event.target.value as InventoryCategory | 'all' })
              }
              className="min-h-[44px] rounded-sm border border-white/10 bg-white/5 px-2 text-white"
            >
              {CATEGORY_OPTIONS.map((cat) => (
                <option key={cat} value={cat}>
                  {cat === 'all' ? 'All Categories' : getCategoryDisplayName(cat)}
                </option>
              ))}
            </select>
            <select
              value={filters.supplier}
              onChange={(event) => onFiltersChange({ supplier: event.target.value })}
              className="min-h-[44px] rounded-sm border border-white/10 bg-white/5 px-2 text-white"
            >
              <option value="all">All Suppliers</option>
              {suppliers.map((supplier) => (
                <option key={supplier} value={supplier}>
                  {supplier}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-xs sm:text-sm">
          <div className="rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-slate-200">
            <p className="text-slate-400">Parts</p>
            <p className="font-bold text-white">{summary.total}</p>
          </div>
          <div className="rounded-sm border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-yellow-200">
            <p className="text-yellow-300/80">Needs Reorder</p>
            <p className="font-bold">{summary.needsReorder}</p>
          </div>
          <div className="rounded-sm border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-200">
            <p className="text-red-300/80">Low/Critical</p>
            <p className="font-bold">{summary.lowStock}</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 pb-28">
        {tab === 'byBin' ? (
          <div className="space-y-3">
            {bins.map((group) => (
              <details
                key={group.bin}
                open
                className="rounded-sm border border-white/10 bg-white/5"
              >
                <summary className="cursor-pointer px-3 py-2 text-sm font-bold text-white">
                  {group.bin} ({group.items.length})
                </summary>
                <div className="space-y-2 p-2">{group.items.map(renderRow)}</div>
              </details>
            ))}
          </div>
        ) : (
          <>
            <div className="hidden overflow-hidden rounded-sm border border-white/10 lg:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-white/5 text-slate-300">
                  <tr>
                    <th className="px-3 py-2">Name / SKU</th>
                    <th className="px-3 py-2">In Stock</th>
                    <th className="px-3 py-2">Allocated</th>
                    <th className="px-3 py-2">Available</th>
                    <th className="px-3 py-2">Bin</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tabFiltered.map((item) => {
                    const stock = computeStock(item, calculateAvailable, calculateAllocated);
                    return (
                      <tr key={item.id} className="border-t border-white/10">
                        <td className="px-3 py-2">
                          <p className="font-bold text-white">{item.name}</p>
                          <div className="flex items-center gap-2">
                            <p className="text-xs text-slate-400">{getSku(item)}</p>
                            {stock.needsReorder && (
                              <span className="rounded-sm border border-red-500/40 bg-red-500/20 px-1.5 py-0.5 text-[10px] font-bold text-red-300">
                                Min Stock
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-white">{item.inStock}</td>
                        <td className="px-3 py-2 text-yellow-300">{stock.allocated}</td>
                        <td
                          className={`px-3 py-2 ${stock.available <= 0 ? 'text-red-400' : stock.lowStock ? 'text-yellow-400' : 'text-green-400'}`}
                        >
                          {stock.available}
                        </td>
                        <td className="px-3 py-2 text-slate-300">
                          {item.binLocation || 'Unassigned'}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap items-center gap-1">
                            <button
                              type="button"
                              onClick={() => onOpenDetail(item.id)}
                              className="rounded-sm border border-white/10 px-2 py-1 text-xs text-white"
                            >
                              View
                            </button>
                            <button
                              type="button"
                              onClick={() => onOpenDetail(item.id)}
                              className="rounded-sm border border-white/10 px-2 py-1 text-xs text-white"
                            >
                              History
                            </button>
                            <button
                              type="button"
                              onClick={() => setAllocatingItem(item)}
                              className="rounded-sm border border-primary/30 bg-primary/10 px-2 py-1 text-xs text-primary"
                            >
                              Allocate
                            </button>
                            {isAdmin && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleQuickAdjust(item, -1)}
                                  className="flex size-8 items-center justify-center rounded-sm border border-white/10 text-white"
                                  aria-label={`Decrease stock for ${item.name}`}
                                >
                                  <span className="material-symbols-outlined text-base">
                                    remove
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleQuickAdjust(item, 1)}
                                  className="flex size-8 items-center justify-center rounded-sm border border-white/10 text-white"
                                  aria-label={`Increase stock for ${item.name}`}
                                >
                                  <span className="material-symbols-outlined text-base">add</span>
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="space-y-2 lg:hidden">{tabFiltered.map(renderRow)}</div>
          </>
        )}
      </div>

      {isAdmin && (
        <button
          type="button"
          onClick={onAddItem}
          className="safe-area-pb fixed bottom-4 right-4 z-20 flex min-h-[52px] items-center gap-2 rounded-full bg-primary px-5 font-bold text-white shadow-lg"
        >
          <span className="material-symbols-outlined">add</span>
          Add Part
        </button>
      )}

      {allocatingItem && (
        <AllocateToJobModal
          item={allocatingItem}
          jobs={jobs}
          maxAvailable={
            computeStock(allocatingItem, calculateAvailable, calculateAllocated).available
          }
          onClose={() => setAllocatingItem(null)}
          onAllocate={(jobId, quantity, notes) =>
            onAllocateToJob(jobId, allocatingItem.id, quantity, notes)
          }
        />
      )}
    </div>
  );
}

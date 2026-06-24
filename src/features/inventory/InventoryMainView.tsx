import { useMemo, useState } from 'react';
import { useScrollRestore } from '@/hooks/useScrollRestore';
import type { InventoryItem } from '@/core/types';
import { useInventoryCategories } from './useInventoryCategories';
import { useToast } from '@/Toast';
import { useNavigation } from '@/contexts/NavigationContext';
import { EmptyState } from '@/components/EmptyState';
import { LoadingSpinner } from '@/Loading';

import {
  InventoryFilters,
  InventoryTab,
  categoryIcon,
  computeStock,
  getSku,
  getSuppliers,
  groupByBin,
  matchesFilters,
  stockStatePill,
} from './inventoryViewModel';

interface InventoryMainViewProps {
  inventory: InventoryItem[];
  /** True while the initial inventory fetch is in flight (first load, nothing cached). */
  isLoading?: boolean;
  onBack: () => void;
  filters: InventoryFilters;
  onFiltersChange: (patch: Partial<InventoryFilters>) => void;
  onAddItem: () => void;
  onOpenDetail: (itemId: string) => void;
  calculateAvailable: (item: InventoryItem) => number;
  calculateAllocated: (inventoryId: string) => number;
}

const TABS: Array<{ key: InventoryTab; label: string }> = [
  { key: 'allParts', label: 'All Parts' },
  { key: 'needsReordering', label: 'Needs Reorder' },
  { key: 'lowStock', label: 'Low Stock' },
  { key: 'byBin', label: 'By Bin' },
];

export default function InventoryMainView({
  inventory,
  isLoading = false,
  onBack,
  filters,
  onFiltersChange,
  onAddItem,
  onOpenDetail,
  calculateAvailable,
  calculateAllocated,
}: InventoryMainViewProps) {
  const { showToast } = useToast();
  const { state: navState, updateState } = useNavigation();
  const { ref: scrollRef, onScroll: handleScroll } = useScrollRestore('inventory-list');
  const { options: categoryOptions } = useInventoryCategories();

  const [tab, setTabState] = useState<InventoryTab>(
    () => (navState.inventoryTab as InventoryTab) || 'allParts'
  );
  const setTab = (t: InventoryTab) => {
    setTabState(t);
    updateState({ inventoryTab: t });
  };

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
        (item) =>
          computeStock(item, calculateAvailable, calculateAllocated).needsReorder &&
          (item.onOrder ?? 0) <= 0
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
      if (stock.needsReorder && (item.onOrder ?? 0) <= 0) needsReorder += 1;
      if (stock.lowStock || stock.available <= 0) lowStock += 1;
    }
    return { total: baseFiltered.length, needsReorder, lowStock };
  }, [baseFiltered, calculateAllocated, calculateAvailable]);

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

  // Option C row: thumbnail (or category icon), name + SKU/bin, the In / Allocated / Available
  // figures as chips, a status pill, and a chevron. The whole row opens the detail page (where
  // stock adjust / allocate / order / receive live). flex-wrap lets the chips drop to a second
  // line on narrow phones while staying inline on desktop.
  const renderRow = (item: InventoryItem) => {
    const stock = computeStock(item, calculateAvailable, calculateAllocated);
    const pill = stockStatePill(stock);
    const availColor =
      stock.available <= 0 ? 'text-red-300' : stock.lowStock ? 'text-yellow-300' : 'text-green-300';
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => onOpenDetail(item.id)}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-sm border border-white/10 bg-card-dark p-2.5 text-left hover:border-primary/40"
      >
        {item.hasImage && item.imageUrl ? (
          <img
            src={item.imageUrl}
            alt=""
            className="size-11 shrink-0 rounded-sm object-cover"
            loading="lazy"
          />
        ) : (
          <span className="flex size-11 shrink-0 items-center justify-center rounded-sm bg-primary/15 text-primary">
            <span className="material-symbols-outlined">{categoryIcon(item.category)}</span>
          </span>
        )}
        <div className="min-w-0 flex-1 basis-44">
          <p className="truncate font-bold text-white">{item.name}</p>
          <p className="truncate text-xs text-muted">
            SKU: {getSku(item)} · {item.binLocation || 'Unassigned'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="min-w-[3.25rem] rounded-sm bg-white/5 px-2 py-1 text-center">
            <span className="block text-[10px] text-subtle">In</span>
            <span className="block text-xs font-bold text-white">{item.inStock}</span>
          </div>
          <div className="min-w-[3.25rem] rounded-sm bg-white/5 px-2 py-1 text-center">
            <span className="block text-[10px] text-subtle">Alloc</span>
            <span className="block text-xs font-bold text-yellow-300">{stock.allocated}</span>
          </div>
          <div className="min-w-[3.25rem] rounded-sm bg-white/5 px-2 py-1 text-center">
            <span className="block text-[10px] text-subtle">Avail</span>
            <span className={`block text-xs font-bold ${availColor}`}>{stock.available}</span>
          </div>
        </div>
        <span
          className={`shrink-0 rounded-sm border px-1.5 py-0.5 text-[10px] font-bold ${pill.className}`}
        >
          {pill.label}
        </span>
        <span className="material-symbols-outlined shrink-0 text-subtle">chevron_right</span>
      </button>
    );
  };

  return (
    <div className="flex h-full flex-col bg-background-dark">
      <div className="sticky top-0 z-20 border-b border-white/10 bg-background-dark px-3 py-3">
        {summary.lowStock > 0 && (
          <div className="mb-3 flex items-center justify-between gap-2 rounded-sm border border-amber-500/50 bg-amber-500/20 px-3 py-2 text-amber-200">
            <span className="text-sm font-medium">
              {summary.lowStock} item{summary.lowStock !== 1 ? 's' : ''} below reorder threshold.
            </span>
            <button
              type="button"
              onClick={() => setTab('lowStock')}
              className="rounded border border-amber-400/50 px-2 py-1 text-xs font-bold text-amber-200 hover:bg-amber-500/30"
            >
              View
            </button>
          </div>
        )}
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
          <div className="flex gap-2">
            <button
              type="button"
              onClick={exportCsv}
              className="min-h-[44px] rounded-sm border border-white/10 px-3 text-xs font-bold text-white"
            >
              Export CSV
            </button>
          </div>
        </div>

        <div className="no-scrollbar mb-3 flex gap-2 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`min-h-[40px] shrink-0 whitespace-nowrap rounded-sm px-4 text-xs font-bold ${
                tab === t.key ? 'bg-primary text-on-accent' : 'bg-white/5 text-muted'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          <input
            type="search"
            value={filters.search}
            onChange={(event) => onFiltersChange({ search: event.target.value })}
            placeholder="Search name, SKU, bin, category"
            className="min-h-[44px] w-full rounded-sm border border-white/10 bg-white/5 px-3 text-white"
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <select
              value={filters.category}
              onChange={(event) => onFiltersChange({ category: event.target.value })}
              className="min-h-[44px] w-full rounded-sm border border-white/10 bg-white/5 px-3 text-sm text-white"
            >
              <option value="all">All Categories</option>
              {categoryOptions.map((cat) => (
                <option key={cat.key} value={cat.key}>
                  {cat.label}
                </option>
              ))}
            </select>
            <select
              value={filters.supplier}
              onChange={(event) => onFiltersChange({ supplier: event.target.value })}
              className="min-h-[44px] w-full rounded-sm border border-white/10 bg-white/5 px-3 text-sm text-white"
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

        <div className="mt-3 grid grid-cols-3 gap-2 text-xs sm:text-sm">
          <div className="rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-white">
            <p className="text-muted">Parts</p>
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

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="content-above-nav flex-1 overflow-y-auto p-3"
      >
        {isLoading && inventory.length === 0 ? (
          <div className="flex justify-center py-16" role="status" aria-live="polite">
            <LoadingSpinner text="Loading inventory…" />
          </div>
        ) : inventory.length === 0 ? (
          <EmptyState
            icon="inventory_2"
            title="No inventory items yet"
            hint="Add your first part to start tracking stock, allocations, and reorder levels."
          />
        ) : tabFiltered.length === 0 && tab !== 'byBin' ? (
          <EmptyState
            icon="search_off"
            title="No matching items"
            hint="No parts match the current filters. Try a different search, category, or tab."
          />
        ) : tab === 'byBin' ? (
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
          <div className="space-y-2">{tabFiltered.map(renderRow)}</div>
        )}
      </div>

      <button
        type="button"
        onClick={onAddItem}
        className="safe-area-pb fixed bottom-20 right-4 z-[45] flex min-h-[52px] items-center gap-2 rounded-full bg-primary px-5 font-bold text-on-accent shadow-lg"
      >
        <span className="material-symbols-outlined">add</span>
        Add Part
      </button>
    </div>
  );
}

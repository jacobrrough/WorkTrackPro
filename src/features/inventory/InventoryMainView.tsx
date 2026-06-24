import { useEffect, useMemo, useState } from 'react';
import { useScrollRestore } from '@/hooks/useScrollRestore';
import type { InventoryCategory, InventoryItem, Job } from '@/core/types';
import { getCategoryDisplayName } from '@/core/types';
import { useToast } from '@/Toast';
import { useNavigation } from '@/contexts/NavigationContext';
import { EmptyState } from '@/components/EmptyState';
import { LoadingSpinner } from '@/Loading';
import AllocateToJobModal from './AllocateToJobModal';
import { StockTargetInput } from './StockTargetInput';

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
  jobs: Job[];
  isAdmin: boolean;
  /** True while the initial inventory fetch is in flight (first load, nothing cached). */
  isLoading?: boolean;
  onBack: () => void;
  filters: InventoryFilters;
  onFiltersChange: (patch: Partial<InventoryFilters>) => void;
  onAddItem: () => void;
  onOpenDetail: (itemId: string) => void;
  onSetStock: (item: InventoryItem, target: number) => Promise<void>;
  onMarkOrdered?: (itemId: string, quantity: number) => Promise<boolean>;
  onReceiveOrder?: (itemId: string, quantity: number) => Promise<boolean>;
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
  isLoading = false,
  onBack,
  filters,
  onFiltersChange,
  onAddItem,
  onOpenDetail,
  onSetStock,
  onMarkOrdered,
  onReceiveOrder,
  onAllocateToJob,
  calculateAvailable,
  calculateAllocated,
}: InventoryMainViewProps) {
  const { showToast } = useToast();
  const { state: navState, updateState } = useNavigation();
  const { ref: scrollRef, onScroll: handleScroll } = useScrollRestore('inventory-list');

  const [tab, setTabState] = useState<InventoryTab>(
    () => (navState.inventoryTab as InventoryTab) || 'allParts'
  );
  const setTab = (t: InventoryTab) => {
    setTabState(t);
    updateState({ inventoryTab: t });
  };
  const [allocatingItem, setAllocatingItem] = useState<InventoryItem | null>(null);
  const [orderModalItem, setOrderModalItem] = useState<InventoryItem | null>(null);
  const [orderModalMode, setOrderModalMode] = useState<'add' | 'receive' | null>(null);
  const [orderModalQty, setOrderModalQty] = useState(0);
  const [rowMenuItemId, setRowMenuItemId] = useState<string | null>(null);
  // Staged absolute stock counts keyed by item id — the value the user is setting the row to.
  // Tapping +/- or typing in the box changes this pending target only; nothing is written until
  // the row's Confirm is pressed, so an accidental tap is harmless. Stored as the absolute target
  // (not a delta) so a background refresh of the underlying stock can't drift what gets committed.
  const [pendingTargets, setPendingTargets] = useState<Record<string, number>>({});
  // Item ids with a commit currently in flight — used to disable Confirm and block double-submit.
  const [committingIds, setCommittingIds] = useState<Set<string>>(new Set());
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

  // Set the row's staged target to an absolute value (clamped at 0 so a recount can't drive
  // stock negative). A target equal to current stock clears the staged change so a no-op edit
  // doesn't leave a Confirm bar lingering.
  const setAdjustTarget = (item: InventoryItem, target: number) => {
    setPendingTargets((prev) => {
      // Empty/invalid input (NaN) reverts to the current count rather than coercing to 0 —
      // otherwise clearing the box and confirming would zero the item. A target equal to the
      // current stock also clears the staged change so a no-op edit leaves no Confirm bar.
      const clamped = Math.max(0, target);
      if (!Number.isFinite(target) || clamped === item.inStock) {
        if (!(item.id in prev)) return prev;
        const next = { ...prev };
        delete next[item.id];
        return next;
      }
      return { ...prev, [item.id]: clamped };
    });
  };

  // Nudge the row's staged target by `step` (+1 / -1) off whatever it currently is (the staged
  // value if editing, otherwise current stock).
  const stageAdjust = (item: InventoryItem, step: number) => {
    setPendingTargets((prev) => {
      const clamped = Math.max(0, (prev[item.id] ?? item.inStock) + step);
      if (clamped === item.inStock) {
        if (!(item.id in prev)) return prev;
        const next = { ...prev };
        delete next[item.id];
        return next;
      }
      return { ...prev, [item.id]: clamped };
    });
  };

  const cancelAdjust = (itemId: string) => {
    setPendingTargets((prev) => {
      if (!(itemId in prev)) return prev;
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  };

  const commitAdjust = async (item: InventoryItem) => {
    const target = pendingTargets[item.id];
    if (target === undefined || target === item.inStock) {
      cancelAdjust(item.id);
      return;
    }
    if (committingIds.has(item.id)) return; // a write is already in flight for this row
    setCommittingIds((prev) => new Set(prev).add(item.id));
    try {
      // Absolute set — the staged number IS the new stock count.
      await onSetStock(item, target);
      // Only clear the staged change once the write has actually succeeded, so a failed
      // request doesn't silently discard the user's pending input.
      cancelAdjust(item.id);
    } catch {
      showToast('Failed to update stock — your change was kept so you can retry', 'error');
    } finally {
      setCommittingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  // Drop staged targets for items that no longer exist (e.g. deleted) so they don't linger.
  useEffect(() => {
    setPendingTargets((prev) => {
      const ids = new Set(inventory.map((i) => i.id));
      let changed = false;
      const next: Record<string, number> = {};
      for (const [id, d] of Object.entries(prev)) {
        if (ids.has(id)) next[id] = d;
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [inventory]);

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

  const closeRowMenu = () => setRowMenuItemId(null);

  // Clean, hub-style row: thumbnail (or category icon), name + SKU, stock + status pill, chevron.
  // The whole row opens the detail page, where stock adjust / allocate / order / receive and the
  // photo live; quick +/- for the field lives on the hub's Stock In/Out scan flow.
  const renderRow = (item: InventoryItem) => {
    const stock = computeStock(item, calculateAvailable, calculateAllocated);
    const pill = stockStatePill(stock);
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => onOpenDetail(item.id)}
        className="flex w-full items-center gap-3 rounded-sm border border-white/10 bg-card-dark p-2.5 text-left hover:border-primary/40"
      >
        {item.hasImage && item.imageUrl ? (
          <img
            src={item.imageUrl}
            alt=""
            className="size-12 shrink-0 rounded-sm object-cover"
            loading="lazy"
          />
        ) : (
          <span className="flex size-12 shrink-0 items-center justify-center rounded-sm bg-primary/15 text-primary">
            <span className="material-symbols-outlined">{categoryIcon(item.category)}</span>
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold text-white">{item.name}</p>
          <p className="truncate text-xs text-muted">SKU: {getSku(item)}</p>
          <p className="truncate text-xs text-subtle">
            {item.binLocation || 'Unassigned'} • Avail {stock.available}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-bold text-white">
            {item.inStock} <span className="text-xs font-normal text-muted">{item.unit}</span>
          </p>
          <span
            className={`mt-0.5 inline-block rounded-sm border px-1.5 py-0.5 text-[10px] font-bold ${pill.className}`}
          >
            {pill.label}
          </span>
        </div>
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
          {(
            [
              { key: 'allParts', label: 'All Parts' },
              { key: 'needsReordering', label: 'Needs Reorder' },
              { key: 'lowStock', label: 'Low Stock' },
              { key: 'byBin', label: 'By Bin' },
            ] as Array<{ key: InventoryTab; label: string }>
          ).map((t) => (
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
              onChange={(event) =>
                onFiltersChange({ category: event.target.value as InventoryCategory | 'all' })
              }
              className="min-h-[44px] w-full rounded-sm border border-white/10 bg-white/5 px-3 text-sm text-white"
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

        <div className="grid grid-cols-3 gap-2 text-xs sm:text-sm">
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
          <>
            <div className="hidden overflow-hidden rounded-sm border border-white/10 lg:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-white/5 text-muted">
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
                    const isStaging = item.id in pendingTargets;
                    const isCommitting = committingIds.has(item.id);
                    const projectedStock = pendingTargets[item.id] ?? item.inStock;
                    return (
                      <tr key={item.id} className="border-t border-white/10">
                        <td className="px-3 py-2">
                          <p className="font-bold text-white">{item.name}</p>
                          <div className="flex items-center gap-2">
                            <p className="text-xs text-muted">{getSku(item)}</p>
                            {stock.needsReorder && (
                              <span className="rounded-sm border border-red-500/40 bg-red-500/20 px-1.5 py-0.5 text-[10px] font-bold text-red-300">
                                Min Stock
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          {isStaging ? (
                            <span className="font-bold text-primary">
                              {item.inStock} → {projectedStock}
                            </span>
                          ) : (
                            <span className="text-white">{item.inStock}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-yellow-300">{stock.allocated}</td>
                        <td
                          className={`px-3 py-2 ${stock.available <= 0 ? 'text-red-400' : stock.lowStock ? 'text-yellow-400' : 'text-green-400'}`}
                        >
                          {stock.available}
                        </td>
                        <td className="px-3 py-2 text-muted">{item.binLocation || 'Unassigned'}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => onOpenDetail(item.id)}
                              className="min-h-[36px] rounded-sm border border-primary/40 bg-primary/20 px-3 text-xs font-bold text-primary"
                            >
                              View
                            </button>
                            <div className="relative">
                              <button
                                type="button"
                                onClick={() =>
                                  setRowMenuItemId(rowMenuItemId === item.id ? null : item.id)
                                }
                                className="flex size-9 items-center justify-center rounded-sm border border-white/10 text-white"
                                aria-label="More actions"
                              >
                                <span className="material-symbols-outlined text-lg">more_vert</span>
                              </button>
                              {rowMenuItemId === item.id && (
                                <>
                                  <div
                                    className="fixed inset-0 z-10"
                                    aria-hidden
                                    onClick={closeRowMenu}
                                  />
                                  <div className="absolute right-0 top-full z-20 mt-1 min-w-[140px] rounded-sm border border-white/10 bg-card-dark py-1 shadow-lg">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setAllocatingItem(item);
                                        closeRowMenu();
                                      }}
                                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-primary"
                                    >
                                      <span className="material-symbols-outlined">assignment</span>
                                      Allocate
                                    </button>
                                    {onMarkOrdered && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setOrderModalItem(item);
                                          setOrderModalMode('add');
                                          setOrderModalQty(0);
                                          closeRowMenu();
                                        }}
                                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-white"
                                      >
                                        <span className="material-symbols-outlined">
                                          pending_actions
                                        </span>
                                        On order
                                      </button>
                                    )}
                                    {onReceiveOrder && (item.onOrder ?? 0) > 0 && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setOrderModalItem(item);
                                          setOrderModalMode('receive');
                                          setOrderModalQty(item.onOrder ?? 0);
                                          closeRowMenu();
                                        }}
                                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-green-400"
                                      >
                                        <span className="material-symbols-outlined">
                                          local_shipping
                                        </span>
                                        Receive
                                      </button>
                                    )}
                                  </div>
                                </>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => stageAdjust(item, -1)}
                              className="flex size-9 items-center justify-center rounded-sm border border-white/10 text-white"
                              aria-label={`Decrease stock for ${item.name}`}
                            >
                              <span className="material-symbols-outlined text-base">remove</span>
                            </button>
                            <StockTargetInput
                              value={projectedStock}
                              onChangeNumber={(n) => setAdjustTarget(item, n)}
                              className="h-9 w-14 rounded-sm border border-white/10 bg-white/5 px-1 text-center text-white"
                              ariaLabel={`Set stock for ${item.name}`}
                            />
                            <button
                              type="button"
                              onClick={() => stageAdjust(item, 1)}
                              className="flex size-9 items-center justify-center rounded-sm border border-white/10 text-white"
                              aria-label={`Increase stock for ${item.name}`}
                            >
                              <span className="material-symbols-outlined text-base">add</span>
                            </button>
                            {isStaging && (
                              <>
                                <button
                                  type="button"
                                  disabled={isCommitting}
                                  onClick={() => cancelAdjust(item.id)}
                                  className="min-h-[36px] rounded-sm border border-white/20 px-2 text-xs font-bold text-muted disabled:opacity-50"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  disabled={isCommitting}
                                  onClick={() => void commitAdjust(item)}
                                  className="min-h-[36px] rounded-sm bg-primary px-3 text-xs font-bold text-on-accent disabled:opacity-50"
                                >
                                  {isCommitting ? 'Saving…' : 'Confirm'}
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

      {
        <button
          type="button"
          onClick={onAddItem}
          className="safe-area-pb fixed bottom-20 right-4 z-[45] flex min-h-[52px] items-center gap-2 rounded-full bg-primary px-5 font-bold text-on-accent shadow-lg"
        >
          <span className="material-symbols-outlined">add</span>
          Add Part
        </button>
      }

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

      {orderModalItem && orderModalMode && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-sm border border-white/10 bg-card-dark p-4 shadow-xl">
            <h3 className="mb-3 text-lg font-bold text-white">
              {orderModalMode === 'add' ? 'Add to order' : 'Receive order'}
            </h3>
            <p className="mb-2 text-sm text-muted">{orderModalItem.name}</p>
            <div className="mb-4 flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={orderModalMode === 'receive' ? (orderModalItem.onOrder ?? 0) : undefined}
                step="1"
                value={orderModalQty}
                onChange={(e) => {
                  const v = parseFloat(e.target.value) || 0;
                  if (orderModalMode === 'receive') {
                    setOrderModalQty(Math.max(0, Math.min(orderModalItem.onOrder ?? 0, v)));
                  } else {
                    setOrderModalQty(Math.max(0, v));
                  }
                }}
                className="w-24 rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-white"
              />
              <span className="text-sm text-subtle">{orderModalItem.unit}</span>
              {orderModalMode === 'receive' && (
                <span className="text-xs text-subtle">max {orderModalItem.onOrder ?? 0}</span>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={async () => {
                  if (orderModalQty <= 0) {
                    showToast('Enter a quantity greater than 0', 'warning');
                    return;
                  }
                  const mode = orderModalMode;
                  const cb = mode === 'add' ? onMarkOrdered : onReceiveOrder;
                  const ok = cb ? await cb(orderModalItem.id, orderModalQty) : false;
                  setOrderModalItem(null);
                  setOrderModalMode(null);
                  setOrderModalQty(0);
                  if (ok) {
                    showToast(mode === 'add' ? 'Added to order' : 'Order received', 'success');
                  } else {
                    showToast(
                      mode === 'add' ? 'Failed to add to order' : 'Failed to receive order',
                      'error'
                    );
                  }
                }}
                className="min-h-[44px] flex-1 rounded-sm bg-primary px-3 font-bold text-on-accent"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => {
                  setOrderModalItem(null);
                  setOrderModalMode(null);
                  setOrderModalQty(0);
                }}
                className="min-h-[44px] rounded-sm border border-white/20 px-3 font-bold text-muted"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

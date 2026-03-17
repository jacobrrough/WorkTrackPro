import React, { useMemo, useRef, useState, useEffect } from 'react';
import type { InventoryCategory, InventoryItem, Job } from '@/core/types';
import { getCategoryDisplayName } from '@/core/types';
import { useToast } from '@/Toast';
import { useNavigation } from '@/contexts/NavigationContext';
import AllocateToJobModal from './AllocateToJobModal';

const INVENTORY_LIST_SCROLL_KEY = 'inventory-list';
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
  onCreateItem?: (data: Partial<InventoryItem>) => Promise<InventoryItem | null>;
  onReloadInventory?: () => Promise<void>;
  onOpenDetail: (itemId: string) => void;
  onKanbanView?: () => void;
  onQuickAdjust: (item: InventoryItem, delta: number) => Promise<void>;
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
  isAdmin,
  onBack,
  filters,
  onFiltersChange,
  onAddItem,
  onCreateItem,
  onReloadInventory,
  onOpenDetail,
  onKanbanView,
  onQuickAdjust,
  onMarkOrdered,
  onReceiveOrder,
  onAllocateToJob,
  calculateAvailable,
  calculateAllocated,
}: InventoryMainViewProps) {
  const { showToast } = useToast();
  const { state: navState, updateState } = useNavigation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollPositionsRef = useRef(navState.scrollPositions);
  scrollPositionsRef.current = navState.scrollPositions;

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
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickAddName, setQuickAddName] = useState('');
  const [quickAddCategory, setQuickAddCategory] = useState<InventoryCategory>('material');
  const [quickAddStock, setQuickAddStock] = useState(0);
  const [quickAddUnit, setQuickAddUnit] = useState('');
  const [quickAddSaving, setQuickAddSaving] = useState(false);

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

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const saved = scrollPositionsRef.current[INVENTORY_LIST_SCROLL_KEY] ?? 0;
    el.scrollTop = saved;
  }, []);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const next = el.scrollTop;
    if ((scrollPositionsRef.current[INVENTORY_LIST_SCROLL_KEY] ?? 0) === next) return;
    updateState({
      scrollPositions: {
        ...scrollPositionsRef.current,
        [INVENTORY_LIST_SCROLL_KEY]: next,
      },
    });
  };

  const handleQuickAdjust = async (item: InventoryItem, delta: number) => {
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

  const closeRowMenu = () => setRowMenuItemId(null);

  const renderRow = (item: InventoryItem) => {
    const stock = computeStock(item, calculateAvailable, calculateAllocated);
    const availColor =
      stock.available <= 0 ? 'text-red-400' : stock.lowStock ? 'text-yellow-400' : 'text-green-400';
    const menuOpen = rowMenuItemId === item.id;
    return (
      <div key={item.id} className="rounded-sm border border-white/10 bg-card-dark p-3">
        <button
          type="button"
          onClick={() => onOpenDetail(item.id)}
          className="w-full text-left focus:outline-none focus:ring-0"
        >
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
        </button>
        <div className="mt-3 flex items-center justify-end gap-2">
          <div className="relative">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setRowMenuItemId(menuOpen ? null : item.id);
              }}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-sm border border-white/10 text-white"
              aria-label="More actions"
            >
              <span className="material-symbols-outlined">more_vert</span>
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" aria-hidden onClick={closeRowMenu} />
                <div className="absolute right-0 top-full z-20 mt-1 min-w-[160px] rounded-sm border border-white/10 bg-card-dark py-1 shadow-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setAllocatingItem(item);
                      closeRowMenu();
                    }}
                    className="flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-left text-sm text-primary"
                  >
                    <span className="material-symbols-outlined text-lg">assignment</span>
                    Allocate to job
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
                      className="flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-200"
                    >
                      <span className="material-symbols-outlined text-lg">pending_actions</span>
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
                      className="flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-left text-sm text-green-400"
                    >
                      <span className="material-symbols-outlined text-lg">local_shipping</span>
                      Receive
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleQuickAdjust(item, -1);
            }}
            className="flex size-11 items-center justify-center rounded-sm border border-white/10 text-white"
            aria-label={`Decrease stock for ${item.name}`}
          >
            <span className="material-symbols-outlined">remove</span>
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleQuickAdjust(item, 1);
            }}
            className="flex size-11 items-center justify-center rounded-sm border border-white/10 text-white"
            aria-label={`Increase stock for ${item.name}`}
          >
            <span className="material-symbols-outlined">add</span>
          </button>
        </div>
      </div>
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
            {onKanbanView && (
              <button
                type="button"
                onClick={onKanbanView}
                className="min-h-[44px] rounded-sm border border-white/20 bg-white/5 px-3 text-xs font-bold text-slate-300"
              >
                Kanban
              </button>
            )}
            {onCreateItem && (
              <button
                type="button"
                onClick={() => setShowQuickAdd(true)}
                className="min-h-[44px] rounded-sm border border-primary/40 bg-primary/20 px-3 text-xs font-bold text-primary"
              >
                Quick add
              </button>
            )}
            <button
              type="button"
              onClick={exportCsv}
              className="min-h-[44px] rounded-sm border border-white/10 px-3 text-xs font-bold text-white"
            >
              Export CSV
            </button>
          </div>
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

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="content-above-nav flex-1 overflow-y-auto p-3"
      >
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
                                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-slate-200"
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
                              onClick={() => handleQuickAdjust(item, -1)}
                              className="flex size-9 items-center justify-center rounded-sm border border-white/10 text-white"
                              aria-label={`Decrease stock for ${item.name}`}
                            >
                              <span className="material-symbols-outlined text-base">remove</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleQuickAdjust(item, 1)}
                              className="flex size-9 items-center justify-center rounded-sm border border-white/10 text-white"
                              aria-label={`Increase stock for ${item.name}`}
                            >
                              <span className="material-symbols-outlined text-base">add</span>
                            </button>
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
          className="safe-area-pb fixed bottom-4 right-4 z-20 flex min-h-[52px] items-center gap-2 rounded-full bg-primary px-5 font-bold text-white shadow-lg"
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

      {showQuickAdd && onCreateItem && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-sm border border-white/10 bg-card-dark p-4 shadow-xl">
            <h3 className="mb-3 text-lg font-bold text-white">Quick add part</h3>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">Name *</label>
                <input
                  type="text"
                  value={quickAddName}
                  onChange={(e) => setQuickAddName(e.target.value)}
                  placeholder="Part name"
                  className="min-h-[44px] w-full rounded-sm border border-white/10 bg-white/5 px-3 text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">Category</label>
                <select
                  value={quickAddCategory}
                  onChange={(e) => setQuickAddCategory(e.target.value as InventoryCategory)}
                  className="min-h-[44px] w-full rounded-sm border border-white/10 bg-white/5 px-3 text-white"
                >
                  {CATEGORY_OPTIONS.filter((c) => c !== 'all').map((cat) => (
                    <option key={cat} value={cat}>
                      {getCategoryDisplayName(cat)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-400">
                    Initial stock
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={quickAddStock}
                    onChange={(e) => setQuickAddStock(Math.max(0, parseFloat(e.target.value) || 0))}
                    className="min-h-[44px] w-full rounded-sm border border-white/10 bg-white/5 px-3 text-white"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-400">Unit *</label>
                  <input
                    type="text"
                    value={quickAddUnit}
                    onChange={(e) => setQuickAddUnit(e.target.value)}
                    placeholder="ea, ft, lbs"
                    className="min-h-[44px] w-full rounded-sm border border-white/10 bg-white/5 px-3 text-white"
                  />
                </div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={quickAddSaving || !quickAddName.trim() || !quickAddUnit.trim()}
                onClick={async () => {
                  if (!quickAddName.trim() || !quickAddUnit.trim()) {
                    showToast('Name and unit are required', 'warning');
                    return;
                  }
                  setQuickAddSaving(true);
                  try {
                    const created = await onCreateItem({
                      name: quickAddName.trim(),
                      category: quickAddCategory,
                      inStock: quickAddStock,
                      unit: quickAddUnit.trim(),
                    });
                    if (created) {
                      showToast('Part added', 'success');
                      setShowQuickAdd(false);
                      setQuickAddName('');
                      setQuickAddCategory('material');
                      setQuickAddStock(0);
                      setQuickAddUnit('');
                    } else {
                      showToast('Failed to add part', 'error');
                    }
                  } finally {
                    setQuickAddSaving(false);
                  }
                }}
                className="min-h-[44px] flex-1 rounded-sm bg-primary px-3 font-bold text-white disabled:opacity-50"
              >
                {quickAddSaving ? 'Creating...' : 'Create'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowQuickAdd(false);
                  onAddItem();
                }}
                className="min-h-[44px] rounded-sm border border-white/20 px-3 text-sm font-bold text-slate-300"
              >
                Full form
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowQuickAdd(false);
                  setQuickAddName('');
                  setQuickAddCategory('material');
                  setQuickAddStock(0);
                  setQuickAddUnit('');
                }}
                className="min-h-[44px] rounded-sm border border-white/20 px-3 font-bold text-slate-300"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {orderModalItem && orderModalMode && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-sm border border-white/10 bg-card-dark p-4 shadow-xl">
            <h3 className="mb-3 text-lg font-bold text-white">
              {orderModalMode === 'add' ? 'Add to order' : 'Receive order'}
            </h3>
            <p className="mb-2 text-sm text-slate-400">{orderModalItem.name}</p>
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
              <span className="text-sm text-slate-500">{orderModalItem.unit}</span>
              {orderModalMode === 'receive' && (
                <span className="text-xs text-slate-500">max {orderModalItem.onOrder ?? 0}</span>
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
                className="min-h-[44px] flex-1 rounded-sm bg-primary px-3 font-bold text-white"
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
                className="min-h-[44px] rounded-sm border border-white/20 px-3 font-bold text-slate-300"
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

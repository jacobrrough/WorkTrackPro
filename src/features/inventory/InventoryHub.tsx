import { useMemo, useState } from 'react';
import type { InventoryItem } from '@/core/types';
import { EmptyState } from '@/components/EmptyState';
import { LoadingSpinner } from '@/Loading';
import StockAdjustFlow, { type StockAdjustFlowMode } from './StockAdjustFlow';
import {
  categoryIcon,
  computeHubSummary,
  computeStock,
  getSku,
  pickFallbackItems,
  pickRecentItems,
  type InventoryTab,
} from './inventoryViewModel';

interface InventoryHubProps {
  inventory: InventoryItem[];
  isLoading?: boolean;
  calculateAvailable: (item: InventoryItem) => number;
  calculateAllocated: (inventoryId: string) => number;
  onUpdateStock: (id: string, inStock: number, reason?: string) => Promise<void>;
  onAddItem: () => void;
  onViewAll: (tab?: InventoryTab) => void;
  onOpenDetail: (itemId: string) => void;
  onBack: () => void;
  recentIds: string[];
}

const TILE_BASE =
  'flex min-h-[7.25rem] w-full touch-manipulation flex-col items-start gap-3 rounded-sm border p-3 text-left transition-colors active:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

export default function InventoryHub({
  inventory,
  isLoading = false,
  calculateAvailable,
  calculateAllocated,
  onUpdateStock,
  onAddItem,
  onViewAll,
  onOpenDetail,
  onBack,
  recentIds,
}: InventoryHubProps) {
  const [flow, setFlow] = useState<StockAdjustFlowMode | null>(null);

  const summary = useMemo(
    () => computeHubSummary(inventory, calculateAvailable, calculateAllocated),
    [inventory, calculateAvailable, calculateAllocated]
  );

  const recentItems = useMemo(() => {
    const recent = pickRecentItems(inventory, recentIds, 5);
    return recent.length
      ? recent
      : pickFallbackItems(inventory, calculateAvailable, calculateAllocated, 5);
  }, [inventory, recentIds, calculateAvailable, calculateAllocated]);

  const tiles = [
    {
      key: 'add',
      title: 'Add Part',
      subtitle: 'New item',
      icon: 'add_box',
      iconClassName: 'text-primary',
      cardClassName: 'border-primary/30 bg-gradient-to-br from-primary/20 to-purple-600/20',
      onClick: onAddItem,
    },
    {
      key: 'in',
      title: 'Stock In',
      subtitle: 'Add quantity',
      icon: 'add_circle',
      iconClassName: 'text-green-400',
      cardClassName: 'border-green-500/30 bg-gradient-to-br from-green-600/20 to-emerald-600/20',
      onClick: () => setFlow('in'),
    },
    {
      key: 'out',
      title: 'Stock Out',
      subtitle: 'Remove quantity',
      icon: 'remove_circle',
      iconClassName: 'text-amber-400',
      cardClassName: 'border-amber-500/30 bg-gradient-to-br from-amber-600/20 to-orange-600/20',
      onClick: () => setFlow('out'),
    },
    {
      key: 'low',
      title: 'Low Stock',
      subtitle: summary.lowStock > 0 ? `${summary.lowStock} need attention` : 'All good',
      icon: 'warning',
      iconClassName: 'text-red-400',
      cardClassName: 'border-red-500/30 bg-gradient-to-br from-red-600/20 to-rose-600/20',
      onClick: () => onViewAll('lowStock'),
      badge: summary.lowStock,
    },
  ];

  const stats: Array<{
    key: InventoryTab | 'total';
    label: string;
    value: number;
    className: string;
  }> = [
    {
      key: 'total',
      label: 'Total Parts',
      value: summary.total,
      className: 'border-white/10 bg-white/5 text-white',
    },
    {
      key: 'allParts',
      label: 'In Stock',
      value: summary.inStock,
      className: 'border-green-500/30 bg-green-500/10 text-green-200',
    },
    {
      key: 'lowStock',
      label: 'Low / Critical',
      value: summary.lowStock,
      className: 'border-red-500/30 bg-red-500/10 text-red-200',
    },
    {
      key: 'needsReordering',
      label: 'Needs Reorder',
      value: summary.needsReorder,
      className: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-200',
    },
  ];

  const renderRecentRow = (item: InventoryItem) => {
    const stock = computeStock(item, calculateAvailable, calculateAllocated);
    const pill =
      stock.available <= 0
        ? { label: 'Out', className: 'border-red-500/40 bg-red-500/15 text-red-300' }
        : stock.lowStock
          ? { label: 'Low', className: 'border-yellow-500/40 bg-yellow-500/15 text-yellow-300' }
          : { label: 'In stock', className: 'border-green-500/40 bg-green-500/15 text-green-300' };
    return (
      <li key={item.id}>
        <button
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
      </li>
    );
  };

  return (
    <div className="flex h-full flex-col bg-background-dark">
      <header className="safe-area-top sticky top-0 z-20 border-b border-white/10 bg-background-dark px-3 py-3">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="flex size-10 items-center justify-center rounded-sm border border-white/10 text-white hover:bg-white/10"
            aria-label="Back to dashboard"
          >
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-white">Inventory</h1>
            <p className="text-xs text-muted">Manage your stock</p>
          </div>
          <button
            type="button"
            onClick={() => onViewAll()}
            className="flex min-h-[40px] items-center gap-1.5 rounded-sm border border-white/10 px-3 text-xs font-bold text-white hover:bg-white/10"
          >
            <span className="material-symbols-outlined text-base">format_list_bulleted</span>
            All parts
          </button>
        </div>
      </header>

      <div className="content-above-nav flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-5 px-3 py-4">
          {/* Quick Scan banner */}
          <button
            type="button"
            onClick={() => setFlow('lookup')}
            className="relative w-full overflow-hidden rounded-sm bg-gradient-to-br from-primary to-purple-700 p-4 text-left shadow-lg transition-transform active:scale-[0.99]"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1">
                <h2 className="text-lg font-bold text-on-accent">Quick Scan</h2>
                <p className="mt-1 max-w-[16rem] text-sm text-on-accent/80">
                  Scan a part&apos;s barcode or QR code to look it up or adjust stock.
                </p>
                <span className="mt-3 inline-flex items-center gap-2 rounded-sm bg-pure-white/20 px-4 py-2 text-sm font-bold text-on-accent backdrop-blur">
                  <span className="material-symbols-outlined">qr_code_scanner</span>
                  Scan Item
                </span>
              </div>
              <span className="material-symbols-outlined text-7xl text-on-accent/25" aria-hidden>
                barcode_scanner
              </span>
            </div>
          </button>

          {/* Quick-action tiles */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {tiles.map((tile) => (
              <button
                key={tile.key}
                type="button"
                onClick={tile.onClick}
                className={`${TILE_BASE} ${tile.cardClassName}`}
              >
                <span className="flex w-full items-start justify-between">
                  <span className={`material-symbols-outlined text-3xl ${tile.iconClassName}`}>
                    {tile.icon}
                  </span>
                  {tile.badge != null && tile.badge > 0 && (
                    <span className="rounded-sm bg-red-500/80 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      {tile.badge}
                    </span>
                  )}
                </span>
                <span>
                  <span className="block font-bold text-white">{tile.title}</span>
                  <span className="block text-[10px] font-bold uppercase tracking-widest text-white/50">
                    {tile.subtitle}
                  </span>
                </span>
              </button>
            ))}
          </div>

          {/* Overview */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-wider text-muted">Overview</h3>
              <button
                type="button"
                onClick={() => onViewAll()}
                className="text-xs font-bold text-primary"
              >
                View all
              </button>
            </div>
            <div className="no-scrollbar flex gap-3 overflow-x-auto pb-1 md:grid md:grid-cols-4 md:overflow-visible">
              {stats.map((stat) => (
                <button
                  key={stat.key}
                  type="button"
                  onClick={() => onViewAll(stat.key === 'total' ? undefined : stat.key)}
                  className={`min-w-[7.5rem] shrink-0 rounded-sm border px-3 py-3 text-left md:min-w-0 ${stat.className}`}
                >
                  <p className="text-xs opacity-80">{stat.label}</p>
                  <p className="text-2xl font-bold">{stat.value}</p>
                </button>
              ))}
            </div>
          </section>

          {/* Recent items */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-wider text-muted">
                Recent Items
              </h3>
              <button
                type="button"
                onClick={() => onViewAll()}
                className="text-xs font-bold text-primary"
              >
                View all
              </button>
            </div>
            {isLoading && inventory.length === 0 ? (
              <div className="flex justify-center py-12" role="status" aria-live="polite">
                <LoadingSpinner text="Loading inventory…" />
              </div>
            ) : inventory.length === 0 ? (
              <EmptyState
                icon="inventory_2"
                title="No inventory items yet"
                hint="Tap Add Part to start tracking stock, allocations, and reorder levels."
              />
            ) : (
              <ul className="space-y-2">{recentItems.map(renderRecentRow)}</ul>
            )}
          </section>
        </div>
      </div>

      {flow && (
        <StockAdjustFlow
          mode={flow}
          inventory={inventory}
          onUpdateStock={onUpdateStock}
          onOpenDetail={onOpenDetail}
          onClose={() => setFlow(null)}
          calculateAvailable={calculateAvailable}
        />
      )}
    </div>
  );
}

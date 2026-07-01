import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { InventoryItem } from '@/core/types';
import { inventoryHistoryService } from '@/services/api/inventoryHistory';
import { EmptyState } from '@/components/EmptyState';
import { ScrollablePage } from '@/components/ScrollablePage';
import { LoadingSpinner } from '@/Loading';
import { type StockAdjustFlowMode } from './StockAdjustFlow';
import { ShortBadge } from './ShortBadge';
import {
  categoryIcon,
  computeHubSummary,
  computeStock,
  getSku,
  pickFallbackItems,
  stockStatePill,
  type InventoryTab,
} from './inventoryViewModel';

interface InventoryHubProps {
  inventory: InventoryItem[];
  isLoading?: boolean;
  calculateAvailable: (item: InventoryItem) => number;
  calculateAllocated: (inventoryId: string) => number;
  onAddItem: () => void;
  onViewAll: (tab?: InventoryTab) => void;
  onOpenFlow: (mode: StockAdjustFlowMode) => void;
  onOpenDetail: (itemId: string) => void;
  onBack: () => void;
}

// Matches the dashboard quick-action tiles: neutral surface + states from the
// shared kit. The per-tile accent lives only on the icon badge (see badgeClassName),
// where the green/amber/red carries real meaning (in / out / low stock).
const TILE_BASE =
  'app-quick-card touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-app';

// Generous ceiling on the Recent Items candidates we prepare. The number actually shown
// is fit to the available viewport height at runtime (see the layout effect below) so the
// hub never scrolls — this is just an upper bound. The viewed-id history that feeds it is
// capped in Inventory.tsx.
const RECENT_ITEMS_POOL = 30;

export default function InventoryHub({
  inventory,
  isLoading = false,
  calculateAvailable,
  calculateAllocated,
  onAddItem,
  onViewAll,
  onOpenFlow,
  onOpenDetail,
  onBack,
}: InventoryHubProps) {
  const summary = useMemo(
    () => computeHubSummary(inventory, calculateAvailable, calculateAllocated),
    [inventory, calculateAvailable, calculateAllocated]
  );

  // Recent stock activity: the items most recently added to or deducted from — manual stock
  // in/out, received orders, and job allocations. allocated_to_job logs changeAmount 0 (it moves
  // "available", not "in stock"), so we filter by action, not amount. order_placed is excluded:
  // ordering isn't an add/deduct until it's received.
  const { data: recentHistory = [] } = useQuery({
    queryKey: ['inventory-history-recent'],
    queryFn: () => inventoryHistoryService.getAllHistory(80),
    staleTime: 60 * 1000,
  });

  const recentItems = useMemo(() => {
    const byId = new Map(inventory.map((i) => [i.id, i]));
    const seen = new Set<string>();
    const items: InventoryItem[] = [];
    for (const h of recentHistory) {
      if (h.action === 'order_placed' || seen.has(h.inventoryId)) continue;
      seen.add(h.inventoryId);
      const item = byId.get(h.inventoryId);
      if (item) items.push(item);
      if (items.length >= RECENT_ITEMS_POOL) break;
    }
    // Before any stock activity exists, fall back to the most-actionable items so the section
    // isn't empty.
    return items.length
      ? items
      : pickFallbackItems(inventory, calculateAvailable, calculateAllocated, RECENT_ITEMS_POOL);
  }, [recentHistory, inventory, calculateAvailable, calculateAllocated]);

  // Auto-fit the Recent Items list to whatever space is left below the tiles/overview so
  // the hub never scrolls on any device: measure one row + gap against the distance to the
  // viewport bottom and show only as many rows as fit. Recomputes on viewport resize
  // (rotation, split-screen, window resize). useLayoutEffect runs pre-paint so there's no
  // flash of an over-long list.
  const viewportRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [recentCapacity, setRecentCapacity] = useState(RECENT_ITEMS_POOL);
  const visibleRecent = recentItems.slice(0, recentCapacity);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const list = listRef.current;
    if (!viewport || !list) return;
    const measure = () => {
      const row = list.querySelector('li');
      if (!row) return;
      const rowH = row.getBoundingClientRect().height;
      if (rowH <= 0) return;
      const GAP = 8; // ul's space-y-2
      const INNER_PAD_BOTTOM = 16; // inner content py-4 bottom
      // The scroller reserves a large padding-bottom (content-above-nav, ~5.5rem) so the
      // list clears the fixed bottom nav; read it live since it's safe-area dependent.
      const scrollerPadBottom = parseFloat(getComputedStyle(viewport).paddingBottom) || 0;
      // List top offset from the scroller's content top (add scrollTop so a stray scroll
      // position doesn't skew the measurement).
      const listTop =
        list.getBoundingClientRect().top -
        viewport.getBoundingClientRect().top +
        viewport.scrollTop;
      const available = viewport.clientHeight - listTop - INNER_PAD_BOTTOM - scrollerPadBottom;
      const fit = Math.max(1, Math.floor((available + GAP) / (rowH + GAP)));
      setRecentCapacity((prev) => (prev === fit ? prev : fit));
    };
    // First pass runs synchronously (pre-paint) so there's no flash of an over-long list.
    measure();
    // Re-measures are deferred to the next frame: mutating layout synchronously inside a
    // ResizeObserver callback logs "ResizeObserver loop completed…" and can oscillate, and the
    // rAF also lets a row settle (e.g. a lazy image finishing load) before we read its height.
    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(viewport); // available space: rotation, split-screen, mobile keyboard
    ro.observe(list); // row reflow: a lazy image loading taller than first measured
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [recentItems.length]);

  const tiles = [
    {
      key: 'add',
      title: 'Add Part',
      icon: 'add_box',
      badgeClassName: 'bg-primary/15 text-primary',
      onClick: onAddItem,
    },
    {
      key: 'in',
      title: 'Stock In',
      icon: 'add_circle',
      badgeClassName: 'bg-green-500/15 text-green-400',
      onClick: () => onOpenFlow('in'),
    },
    {
      key: 'out',
      title: 'Stock Out',
      icon: 'remove_circle',
      badgeClassName: 'bg-amber-500/15 text-amber-400',
      onClick: () => onOpenFlow('out'),
    },
    {
      key: 'low',
      title: 'Low Stock',
      icon: 'warning',
      badgeClassName: 'bg-red-500/15 text-red-400',
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
      className: 'border-line bg-overlay/5 text-white',
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
    const pill = stockStatePill(stock);
    return (
      <li key={item.id}>
        <button
          type="button"
          onClick={() => onOpenDetail(item.id)}
          className="flex w-full items-center gap-3 rounded-2xl border border-line bg-card-dark p-2.5 text-left hover:border-primary/40"
        >
          {item.hasImage && item.imageUrl ? (
            <img
              src={item.imageUrl}
              alt=""
              className="size-12 shrink-0 rounded-lg object-cover"
              loading="lazy"
            />
          ) : (
            <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
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
              className={`mt-0.5 inline-block rounded-full border px-1.5 py-0.5 text-[10px] font-bold ${pill.className}`}
            >
              {pill.label}
            </span>
            <ShortBadge shortfall={stock.shortfall} className="ml-1 mt-0.5 inline-block" />
          </div>
          <span className="material-symbols-outlined shrink-0 text-subtle">chevron_right</span>
        </button>
      </li>
    );
  };

  return (
    <div className="flex h-full flex-col bg-background-dark">
      <header className="safe-area-top sticky top-0 z-20 border-b border-line bg-background-dark px-3 py-3">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="app-icon-btn border border-line text-white"
            aria-label="Back to dashboard"
          >
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <div className="flex-1">
            <h1 className="app-section-title text-white">Inventory</h1>
            <p className="text-xs text-muted">Manage your stock</p>
          </div>
          <button
            type="button"
            onClick={() => onViewAll()}
            className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-bold text-white hover:bg-overlay/10"
          >
            <span className="material-symbols-outlined text-base">format_list_bulleted</span>
            All parts
          </button>
        </div>
      </header>

      <ScrollablePage ref={viewportRef}>
        <div className="mx-auto w-full max-w-3xl space-y-5 px-3 py-4">
          {/* Quick-action tiles */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {tiles.map((tile) => (
              <button
                key={tile.key}
                type="button"
                onClick={tile.onClick}
                className={TILE_BASE}
              >
                <span
                  className={`flex size-10 shrink-0 items-center justify-center rounded-2xl ${tile.badgeClassName}`}
                >
                  <span className="material-symbols-outlined text-2xl">{tile.icon}</span>
                </span>
                <span className="flex-1 text-sm font-bold text-white">{tile.title}</span>
                {tile.badge != null && tile.badge > 0 && (
                  <span className="rounded-full bg-red-500/80 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    {tile.badge}
                  </span>
                )}
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
                  className={`min-w-[7.5rem] shrink-0 rounded-2xl border px-3 py-3 text-left md:min-w-0 ${stat.className}`}
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
                Recently Changed
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
              <ul ref={listRef} className="space-y-2">
                {visibleRecent.map(renderRecentRow)}
              </ul>
            )}
          </section>
        </div>
      </ScrollablePage>
    </div>
  );
}

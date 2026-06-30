import type { InventoryItem } from '@/core/types';

export type InventoryTab = 'allParts' | 'needsReordering' | 'lowStock' | 'byBin';

export interface InventoryFilters {
  search: string;
  /** A category key (built-in or custom), or 'all' for no category filter. */
  category: string | 'all';
  supplier: string;
}

export interface StockComputed {
  allocated: number;
  available: number;
  needsReorder: boolean;
  lowStock: boolean;
  /**
   * Units you'd still need to order to clear the reorder condition — i.e. enough to get back to
   * the reorder point AND cover current job demand, net of what's already on order. 0 when the
   * item doesn't need reordering. Lets a row show *how short* it is, not just that it's short.
   */
  shortfall: number;
  /** Still at/below the reorder point even after outstanding orders land. A reason for needsReorder. */
  belowThresholdAfterOrders: boolean;
  /** Jobs reserve more than inStock + onOrder — short for current demand. A reason for needsReorder. */
  shortForJobs: boolean;
  /** Out of stock with nothing on order (no reorder point / demand needed). A reason for needsReorder. */
  outOfStock: boolean;
}

export function getSuppliers(items: InventoryItem[]): string[] {
  const set = new Set<string>();
  for (const item of items) {
    const vendor = item.vendor?.trim();
    if (vendor) set.add(vendor);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export function getSku(item: InventoryItem): string {
  return item.barcode?.trim() || item.id.slice(0, 8).toUpperCase();
}

/**
 * Derive an item's stock status. The two computed signal families are:
 *   - "now"          → current shelf state (drives the Low pill / banner)
 *   - "after orders" → projected once everything on order lands (drives needsReorder), so a real
 *                      shortage stays flagged until an inbound order actually closes the gap
 * over the two axes {below reorder threshold, short for job demand}, plus a standalone out-of-stock
 * reason. INVARIANT: `calculateAvailable(item)` MUST equal `max(0, item.inStock - allocated)` —
 * the demand math reads `item.inStock` directly, so a caller passing an `available` decoupled from
 * inStock would make the two halves disagree. All real callers go through useInventoryAllocation,
 * which guarantees this; keep it that way.
 */
export function computeStock(
  item: InventoryItem,
  calculateAvailable: (it: InventoryItem) => number,
  calculateAllocated: (inventoryId: string) => number
): StockComputed {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const allocated = calculateAllocated(item.id);
  const available = calculateAvailable(item);
  const reorderPoint = item.reorderPoint ?? 0;
  // on_order is clamped to >= 0 at the DB (adjust RPC), so this is always a non-negative qty.
  const onOrder = item.onOrder ?? 0;

  // Signals are {now, after-orders} × {below threshold, short for demand}, plus outOfStock:
  //   below*  — available (after orders) at/under the reorder point
  //   short*  — allocated exceeds what we physically have (inStock), after orders
  // "now" variants feed lowStock (current shelf); "after orders" variants feed needsReorder.
  const belowThreshold = reorderPoint > 0 && available <= reorderPoint;
  // Jobs reserve more than we physically have in stock — a genuine shortage even with no
  // threshold configured. inStock (not the 0-clamped `available`) is used so this still fires
  // when stock has been driven negative to show a deficit.
  const shortForDemand = allocated > item.inStock;

  // Projected signals (what's still true once everything on order arrives). Reordering is only
  // "handled" when the incoming order actually closes the gap — a token under-order shouldn't
  // make a real shortage disappear from the list.
  const belowThresholdAfterOrders = reorderPoint > 0 && available + onOrder <= reorderPoint;
  const shortAfterOrders = allocated > item.inStock + onOrder;
  // Out of stock with nothing on the way: nothing available AND no incoming order (onOrder is
  // >= 0, so this is `available <= 0 && onOrder == 0`). Catches an item sitting at zero that has
  // no reorder point and no current job demand — the owner still needs to know it's out and
  // restock it. An item that's out but already on order is considered handled, so it won't nag.
  // Rounded so float residue in `available` (fractional-unit subtraction) can't leave a hair of
  // phantom stock that under-flags a physically-out item.
  const outOfStock = round2(available + onOrder) <= 0;

  // How much you'd need to order now to clear the condition: the larger of the threshold gap
  // and the demand gap, both net of what's already on order. Rounded to avoid float noise.
  const thresholdDeficit = reorderPoint > 0 ? reorderPoint - (available + onOrder) : 0;
  const demandDeficit = allocated - (item.inStock + onOrder);
  const shortfall = Math.max(0, round2(Math.max(thresholdDeficit, demandDeficit)));

  return {
    allocated,
    available,
    // "Needs reorder" is the actionable signal: even accounting for what's already on order, we'd
    // still be below the reorder point, short for current job demand, or flat out of stock.
    needsReorder: belowThresholdAfterOrders || shortAfterOrders || outOfStock,
    // "Low stock" reflects the current shelf state (drives the Low pill / banner), regardless
    // of incoming orders.
    lowStock: belowThreshold || shortForDemand,
    shortfall,
    belowThresholdAfterOrders,
    shortForJobs: shortAfterOrders,
    outOfStock,
  };
}

export function matchesFilters(item: InventoryItem, filters: InventoryFilters): boolean {
  if (filters.category !== 'all' && item.category !== filters.category) return false;
  if (filters.supplier !== 'all' && (item.vendor || '') !== filters.supplier) return false;

  const q = filters.search.trim().toLowerCase();
  if (!q) return true;
  const bag = [
    item.name,
    item.description || '',
    item.barcode || '',
    item.binLocation || '',
    item.vendor || '',
    item.category,
  ]
    .join(' ')
    .toLowerCase();
  return bag.includes(q);
}

export interface BinGroup {
  bin: string;
  items: InventoryItem[];
}

export function groupByBin(items: InventoryItem[]): BinGroup[] {
  const bins = new Map<string, InventoryItem[]>();
  for (const item of items) {
    const key = item.binLocation?.trim() || 'Unassigned';
    const group = bins.get(key) ?? [];
    group.push(item);
    bins.set(key, group);
  }
  return Array.from(bins.entries())
    .map(([bin, groupedItems]) => ({
      bin,
      items: groupedItems.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.bin.localeCompare(b.bin));
}

export interface BinLetterGroup {
  /**
   * Leading letter of the bin (e.g. "C" for C1a, C3b). Bins with no location group under
   * "Unassigned"; bins not starting with a letter fall under "#".
   */
  letter: string;
  bins: BinGroup[];
  itemCount: number;
}

// Roll the flat bin list up under its first letter so "By Bin" can show a compact
// alphabetical index (C ▸ C1a, C3b …) that the user expands one letter at a time.
export function groupBinsByLetter(bins: BinGroup[]): BinLetterGroup[] {
  const letters = new Map<string, BinGroup[]>();
  for (const group of bins) {
    // Keep the synthetic "Unassigned" bucket in its own group rather than folding it under
    // "U" alongside genuine U-prefixed bins.
    let letter: string;
    if (group.bin === 'Unassigned') {
      letter = 'Unassigned';
    } else {
      const first = group.bin.charAt(0).toUpperCase();
      letter = /[A-Z]/.test(first) ? first : '#';
    }
    const arr = letters.get(letter) ?? [];
    arr.push(group);
    letters.set(letter, arr);
  }
  return Array.from(letters.entries())
    .map(([letter, groupedBins]) => ({
      letter,
      bins: groupedBins.sort((a, b) => a.bin.localeCompare(b.bin)),
      itemCount: groupedBins.reduce((sum, g) => sum + g.items.length, 0),
    }))
    .sort((a, b) => a.letter.localeCompare(b.letter));
}

export interface HubSummary {
  total: number;
  inStock: number;
  lowStock: number;
  needsReorder: number;
}

/**
 * Overview counts for the inventory hub. Mirrors the summary logic in InventoryMainView so the
 * hub and the list agree: "needs reorder" is the actionable signal from computeStock (below
 * threshold with nothing on order, or short for demand beyond what's on order); "low stock"
 * covers below-threshold OR fully out.
 */
export function computeHubSummary(
  items: InventoryItem[],
  calculateAvailable: (it: InventoryItem) => number,
  calculateAllocated: (inventoryId: string) => number
): HubSummary {
  let inStock = 0;
  let lowStock = 0;
  let needsReorder = 0;
  for (const item of items) {
    const stock = computeStock(item, calculateAvailable, calculateAllocated);
    if (stock.needsReorder) needsReorder += 1;
    if (stock.lowStock || stock.available <= 0) lowStock += 1;
    if (stock.available > 0) inStock += 1;
  }
  return { total: items.length, inStock, lowStock, needsReorder };
}

/**
 * Fallback list when there are no recently-viewed items yet: most-actionable first
 * (low/out-of-stock), then alphabetical. Keeps the "Recent Items" section from ever being empty.
 */
export function pickFallbackItems(
  items: InventoryItem[],
  calculateAvailable: (it: InventoryItem) => number,
  calculateAllocated: (inventoryId: string) => number,
  limit = 5
): InventoryItem[] {
  return [...items]
    .sort((a, b) => {
      const sa = computeStock(a, calculateAvailable, calculateAllocated);
      const sb = computeStock(b, calculateAvailable, calculateAllocated);
      const aLow = sa.lowStock || sa.available <= 0 ? 0 : 1;
      const bLow = sb.lowStock || sb.available <= 0 ? 0 : 1;
      if (aLow !== bLow) return aLow - bLow;
      return a.name.localeCompare(b.name);
    })
    .slice(0, limit);
}

export interface StockStatePill {
  label: string;
  className: string;
}

/**
 * Stock-state pill (label + Tailwind classes) shared by the hub and the All Parts list so a row
 * reads the same in both: Out (red) / Low (yellow) / In stock (green).
 */
export function stockStatePill(stock: StockComputed): StockStatePill {
  if (stock.available <= 0) {
    return { label: 'Out', className: 'border-red-500/40 bg-red-500/15 text-red-300' };
  }
  if (stock.lowStock) {
    return { label: 'Low', className: 'border-yellow-500/40 bg-yellow-500/15 text-yellow-300' };
  }
  return { label: 'In stock', className: 'border-green-500/40 bg-green-500/15 text-green-300' };
}

/** Material Symbols icon name for an inventory category (thumbnail fallback when no image).
 *  Accepts any category key — built-in or admin-defined custom — and falls back for unknown ones. */
export function categoryIcon(category: string): string {
  switch (category) {
    case 'material':
      return 'category';
    case 'foam':
      return 'layers';
    case 'trimCord':
      return 'linear_scale';
    case 'printing3d':
      return 'view_in_ar';
    case 'chemicals':
      return 'science';
    case 'hardware':
      return 'build';
    case 'tool':
      return 'handyman';
    case 'miscSupplies':
      return 'inventory_2';
    default:
      return 'inventory_2';
  }
}

import type { InventoryCategory, InventoryItem } from '@/core/types';

export type InventoryTab = 'allParts' | 'needsReordering' | 'lowStock' | 'byBin';

export interface InventoryFilters {
  search: string;
  category: InventoryCategory | 'all';
  supplier: string;
}

export interface StockComputed {
  allocated: number;
  available: number;
  needsReorder: boolean;
  lowStock: boolean;
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

export function computeStock(
  item: InventoryItem,
  calculateAvailable: (it: InventoryItem) => number,
  calculateAllocated: (inventoryId: string) => number
): StockComputed {
  const allocated = calculateAllocated(item.id);
  const available = calculateAvailable(item);
  const reorderPoint = item.reorderPoint ?? 0;
  return {
    allocated,
    available,
    needsReorder: reorderPoint > 0 && available < reorderPoint,
    lowStock: reorderPoint > 0 && available <= reorderPoint,
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

export function groupByBin(items: InventoryItem[]): Array<{ bin: string; items: InventoryItem[] }> {
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

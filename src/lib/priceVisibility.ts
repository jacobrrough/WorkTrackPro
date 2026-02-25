import type { InventoryItem } from '@/core/types';

export function shouldShowInventoryKanbanPrice(item: InventoryItem, isAdmin: boolean): boolean {
  return Boolean(isAdmin && item.price && (!item.reorderPoint || item.reorderPoint === 0));
}

export function shouldShowInventoryDetailPrice(item: InventoryItem, isAdmin: boolean): boolean {
  return Boolean(isAdmin && item.price);
}

export function stripInventoryFinancials(
  items: InventoryItem[],
  isAdmin: boolean
): InventoryItem[] {
  if (isAdmin) return items;
  return items.map((item) => ({ ...item, price: undefined }));
}

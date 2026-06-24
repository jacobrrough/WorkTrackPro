import type { InventoryItem, User } from '@/core/types';

/** Display name for a holder id, falling back through name → email → "Unknown". */
export function holderName(users: User[], holderId?: string): string {
  if (!holderId) return 'Unknown';
  const u = users.find((x) => x.id === holderId);
  return u?.name || u?.email || 'Unknown';
}

/** Human-readable custody status for a tool (inventory item): "Available" or "Out to {name}". */
export function toolStatusText(item: InventoryItem, users: User[]): string {
  return item.currentHolderId ? `Out to ${holderName(users, item.currentHolderId)}` : 'Available';
}

import type { Tool, User } from '@/core/types';

/** Display name for a holder id, falling back through name → email → "Unknown". */
export function holderName(users: User[], holderId?: string): string {
  if (!holderId) return 'Unknown';
  const u = users.find((x) => x.id === holderId);
  return u?.name || u?.email || 'Unknown';
}

/** Human-readable custody status, e.g. "Available", "Out to Jane", "Retired". */
export function toolStatusText(tool: Tool, users: User[]): string {
  if (tool.status === 'retired') return 'Retired';
  if (tool.status === 'out') return `Out to ${holderName(users, tool.currentHolderId)}`;
  return 'Available';
}

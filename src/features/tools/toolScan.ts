import type { InventoryItem } from '@/core/types';

/**
 * Resolve a scanned code to a tool. Tools are inventory items in the 'tool' category, so the
 * scanned value is the item's **barcode** (matched case-insensitively); a bare item id also
 * resolves as a fallback. Returns null when nothing matches. Pass an already tool-filtered list.
 */
export function resolveToolByScan(payload: string, tools: InventoryItem[]): InventoryItem | null {
  const raw = (payload ?? '').trim();
  if (!raw) return null;
  const token = raw.toLowerCase();
  return (
    tools.find((t) => {
      const bc = (t.barcode ?? '').trim();
      return bc !== '' && bc.toLowerCase() === token;
    }) ??
    tools.find((t) => t.id.toLowerCase() === token) ??
    null
  );
}

/** Normalize a bin payload the same way `tool_put_away` does: strip `BIN:`, trim, uppercase. */
export function normalizeBin(payload: string): string {
  return (payload ?? '').replace(/^BIN:/i, '').trim().toUpperCase();
}

/** Whether a scanned bin matches a tool's home bin (case-insensitive, `BIN:`-prefix tolerant). */
export function binsMatch(scanned: string, homeBin: string): boolean {
  const a = normalizeBin(scanned);
  return a.length > 0 && a === normalizeBin(homeBin);
}

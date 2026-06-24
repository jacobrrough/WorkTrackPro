import type { Tool } from '@/core/types';

/** Strip an optional `TOOL:` prefix and surrounding whitespace from a scanned payload. */
export function normalizeToolScan(payload: string): string {
  return (payload ?? '').replace(/^TOOL:/i, '').trim();
}

/** True when the payload carries the `TOOL:` prefix (lets the global scanner route tool scans). */
export function isToolScanPayload(payload: string): boolean {
  return /^TOOL:/i.test((payload ?? '').trim());
}

/**
 * Resolve a scanned QR payload to a tool. The QR should encode the tool's number (optionally
 * `TOOL:`-prefixed); a bare tool id (uuid) also resolves as a fallback. Number matching is
 * case-insensitive. Returns null when nothing matches.
 */
export function resolveToolByScan(payload: string, tools: Tool[]): Tool | null {
  const raw = (payload ?? '').trim();
  if (!raw) return null;
  const token = normalizeToolScan(raw).toLowerCase();
  if (!token) return null;
  return (
    tools.find((t) => t.toolNumber.trim().toLowerCase() === token) ??
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

/**
 * Shared column auto-detection helpers. A "taker" claims each header for at most
 * one role (first match wins, in the order the caller asks), so ambiguous headers
 * resolve deterministically. Every guess is overridable in the UI.
 */
export interface HeaderCol {
  raw: string;
  /** lowercased, non-alphanumerics stripped: "Account #" -> "account". */
  n: string;
  lower: string;
}

/** Lowercase + strip every non-alphanumeric. */
export function normHeader(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function columnTaker(headers: string[]) {
  const map: Record<string, string | undefined> = {};
  const used = new Set<string>();
  const cols: HeaderCol[] = headers.map((h) => ({
    raw: h,
    n: normHeader(h),
    lower: h.toLowerCase(),
  }));

  /** Claim the first unused header matching `pred` for `role` (no-op if already set). */
  const take = (role: string, pred: (c: HeaderCol) => boolean) => {
    if (map[role]) return;
    const m = cols.find((c) => !used.has(c.raw) && pred(c));
    if (m) {
      map[role] = m.raw;
      used.add(m.raw);
    }
  };

  /** Convenience: claim by exact normalized-name membership. */
  const takeExact = (role: string, names: string[]) => take(role, (c) => names.includes(c.n));

  return { map, take, takeExact };
}

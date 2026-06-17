/**
 * String-based date-range filtering for date-only values (YYYY-MM-DD).
 *
 * Distinct from TimeReports' window math, which compares full timestamps against Date
 * objects. Bare dates must NOT be parsed with `new Date("2026-06-16")` — that yields UTC
 * midnight, which in a negative-offset timezone is the previous local day, mis-bucketing
 * entries near day/week/month boundaries. Here everything is local-component-derived and
 * compared lexicographically as YYYY-MM-DD strings.
 */

export type DateRangePreset = 'today' | 'week' | 'month' | 'all';

/** Local YYYY-MM-DD key for a Date (uses local calendar components, never UTC). */
export function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Today's local YYYY-MM-DD — safe default for add-entry forms. */
export function todayKey(now: Date = new Date()): string {
  return dateKey(now);
}

export interface DateRangeWindow {
  /** Inclusive start key, or null for 'all'. */
  startKey: string | null;
  /** Exclusive end key, or null for 'all'. */
  endKeyExclusive: string | null;
  label: string;
}

/**
 * Build inclusive-start / exclusive-end local date keys for a preset. Week starts Monday,
 * matching the existing Time Reports convention.
 */
export function dateRangeKeys(range: DateRangePreset, now: Date = new Date()): DateRangeWindow {
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const addDays = (base: Date, n: number): Date => {
    const d = new Date(base);
    d.setDate(d.getDate() + n);
    return d;
  };

  switch (range) {
    case 'today': {
      return {
        startKey: dateKey(startOfDay),
        endKeyExclusive: dateKey(addDays(startOfDay, 1)),
        label: 'Today',
      };
    }
    case 'week': {
      const dow = startOfDay.getDay(); // 0=Sun..6=Sat
      const diffToMonday = (dow + 6) % 7;
      const weekStart = addDays(startOfDay, -diffToMonday);
      return {
        startKey: dateKey(weekStart),
        endKeyExclusive: dateKey(addDays(weekStart, 7)),
        label: 'This week',
      };
    }
    case 'month': {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return {
        startKey: dateKey(monthStart),
        endKeyExclusive: dateKey(nextMonth),
        label: 'This month',
      };
    }
    case 'all':
    default:
      return { startKey: null, endKeyExclusive: null, label: 'All time' };
  }
}

/** Filter items by a YYYY-MM-DD field against a preset window (lexicographic compare). */
export function filterByDateRange<T>(
  items: T[],
  getDate: (item: T) => string,
  range: DateRangePreset,
  now: Date = new Date()
): T[] {
  const { startKey, endKeyExclusive } = dateRangeKeys(range, now);
  if (startKey === null || endKeyExclusive === null) return items;
  return items.filter((item) => {
    const key = getDate(item);
    return key >= startKey && key < endKeyExclusive;
  });
}

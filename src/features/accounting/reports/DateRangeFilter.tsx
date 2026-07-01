import { useMemo } from 'react';
import type { DateRange } from '../types';

const inputClass =
  'rounded-lg border border-line bg-background-dark px-2 py-1.5 text-sm text-white focus:border-primary focus:outline-none';

/** A named preset range, resolved relative to "today" when applied. */
interface Preset {
  key: string;
  label: string;
  /** Compute the range for this preset given today's date. */
  resolve: (today: Date) => DateRange;
}

/** Format a Date as a `YYYY-MM-DD` string using its LOCAL calendar fields. */
function toLocalIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

function iso(d: Date): string {
  return toLocalIso(d);
}

/**
 * Period presets for the statement reports. "All time" is an empty range (both
 * bounds null) so the service takes its fast all-time path. The fiscal year here is
 * the calendar year — a configurable fiscal-year start is a later enhancement.
 */
const PRESETS: Preset[] = [
  { key: 'all', label: 'All time', resolve: () => ({ from: null, to: null }) },
  {
    key: 'this-month',
    label: 'This month',
    resolve: (t) => ({
      from: iso(new Date(t.getFullYear(), t.getMonth(), 1)),
      to: iso(new Date(t.getFullYear(), t.getMonth() + 1, 0)),
    }),
  },
  {
    key: 'this-quarter',
    label: 'This quarter',
    resolve: (t) => {
      const q = Math.floor(t.getMonth() / 3);
      return {
        from: iso(new Date(t.getFullYear(), q * 3, 1)),
        to: iso(new Date(t.getFullYear(), q * 3 + 3, 0)),
      };
    },
  },
  {
    key: 'ytd',
    label: 'Year to date',
    resolve: (t) => ({ from: iso(new Date(t.getFullYear(), 0, 1)), to: iso(t) }),
  },
  {
    key: 'this-year',
    label: 'This year',
    resolve: (t) => ({
      from: iso(new Date(t.getFullYear(), 0, 1)),
      to: iso(new Date(t.getFullYear(), 11, 31)),
    }),
  },
];

/** Match the current range to a preset key (for highlighting), else 'custom'. */
function activePresetKey(range: DateRange, today: Date): string {
  for (const p of PRESETS) {
    const r = p.resolve(today);
    if ((r.from ?? null) === (range.from ?? null) && (r.to ?? null) === (range.to ?? null)) {
      return p.key;
    }
  }
  return 'custom';
}

interface DateRangeFilterProps {
  /** Current range. An empty range ({} or null bounds) means "all time". */
  value: DateRange;
  onChange: (range: DateRange) => void;
  /**
   * Balance-sheet style: only the period END matters (balances are cumulative as
   * of that date). When true the "from" input is hidden and presets collapse to
   * an as-of date. P&L / Trial Balance use the full from–to window (default).
   */
  asOfOnly?: boolean;
}

/**
 * Date-range filter shared by the period reports. Offers quick presets plus
 * explicit from/to date inputs. Dates are ISO `YYYY-MM-DD`; clearing both bounds
 * is "all time". Pure presentation — the parent owns the range and refetches.
 */
export function DateRangeFilter({ value, onChange, asOfOnly = false }: DateRangeFilterProps) {
  const today = useMemo(() => new Date(), []);
  const active = activePresetKey(value, today);

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-line bg-card-dark p-3">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick date ranges">
        {PRESETS.map((p) => {
          const isActive = p.key === active;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => onChange(p.resolve(today))}
              aria-pressed={isActive}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                isActive
                  ? 'bg-primary text-on-accent'
                  : 'bg-white/5 text-muted hover:bg-white/10 hover:text-white'
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {!asOfOnly && (
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            From
            <input
              type="date"
              aria-label="Start date"
              className={inputClass}
              value={value.from ?? ''}
              max={value.to ?? undefined}
              onChange={(e) => onChange({ ...value, from: e.target.value || null })}
            />
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
          {asOfOnly ? 'As of' : 'To'}
          <input
            type="date"
            aria-label={asOfOnly ? 'As-of date' : 'End date'}
            className={inputClass}
            value={value.to ?? ''}
            min={asOfOnly ? undefined : (value.from ?? undefined)}
            onChange={(e) => onChange({ ...value, to: e.target.value || null })}
          />
        </label>
        {(value.from || value.to) && (
          <button
            type="button"
            onClick={() => onChange({ from: null, to: null })}
            className="text-xs font-semibold text-muted underline-offset-2 hover:text-white hover:underline"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

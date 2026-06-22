import { useState } from 'react';
import { NO_VARIANT_KEY } from '@/lib/cncDeduction';

export interface UnitProgressAccordionProps {
  title: string;
  /** Small caption under the title. */
  subtitle?: string;
  /** Ordered variant keys (normalized, no leading dash). */
  variantKeys: string[];
  /** Total units per variant key. */
  unitCounts: Record<string, number>;
  /** Currently-completed count per variant key. */
  doneCounts: Record<string, number>;
  /** Apply a +/- change to a variant's count. Returns when persisted (so spinners can clear). */
  onAdjust: (variantKey: string, delta: number) => void | Promise<void>;
  /** Disable all steppers (e.g. a write is in flight or user lacks permission). */
  disabled?: boolean;
  defaultOpen?: boolean;
  /** Accent color classes for the done badge (e.g. amber for CNC, green for units done). */
  accent?: 'amber' | 'green';
}

const labelFor = (key: string): string => (key === NO_VARIANT_KEY ? 'Units' : `-${key}`);

const sum = (m: Record<string, number>, keys: string[]): number =>
  keys.reduce((a, k) => a + (Number(m[k]) || 0), 0);

export function UnitProgressAccordion({
  title,
  subtitle,
  variantKeys,
  unitCounts,
  doneCounts,
  onAdjust,
  disabled,
  defaultOpen,
  accent = 'green',
}: UnitProgressAccordionProps) {
  const [open, setOpen] = useState(!!defaultOpen);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  if (variantKeys.length === 0) return null;

  const totalUnits = sum(unitCounts, variantKeys);
  const totalDone = sum(doneCounts, variantKeys);
  const allDone = totalUnits > 0 && totalDone >= totalUnits;

  const accentDone =
    accent === 'amber' ? 'text-amber-200 bg-amber-500/20' : 'text-green-200 bg-green-500/20';

  const adjust = async (key: string, delta: number) => {
    if (disabled || busyKey) return;
    setBusyKey(key);
    try {
      await onAdjust(key, delta);
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="mb-3 overflow-hidden rounded-sm border border-primary/30 bg-primary/10">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
        aria-expanded={open}
      >
        <div className="min-w-0">
          <p className="text-sm font-bold text-white">{title}</p>
          {subtitle && <p className="text-[11px] text-slate-400">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${accentDone}`}>
            {totalDone}/{totalUnits} {allDone ? '✓' : ''}
          </span>
          <span className="material-symbols-outlined text-base text-slate-300">
            {open ? 'expand_less' : 'expand_more'}
          </span>
        </div>
      </button>

      {open && (
        <div className="space-y-1.5 border-t border-white/10 p-2.5">
          {variantKeys.map((key) => {
            const total = unitCounts[key] ?? 0;
            const done = Math.min(doneCounts[key] ?? 0, total);
            const busy = busyKey === key;
            return (
              <div
                key={key}
                className="flex items-center justify-between gap-2 rounded-sm bg-white/5 px-2.5 py-1.5"
              >
                <span className="font-mono text-sm font-bold text-white">{labelFor(key)}</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label={`Decrease ${labelFor(key)}`}
                    disabled={disabled || busy || done <= 0}
                    onClick={() => adjust(key, -1)}
                    className="flex size-9 items-center justify-center rounded-sm border border-white/15 text-white disabled:opacity-30"
                  >
                    <span className="material-symbols-outlined text-lg">remove</span>
                  </button>
                  <span className="min-w-[3.5rem] text-center text-sm font-bold tabular-nums text-white">
                    {done} / {total}
                  </span>
                  <button
                    type="button"
                    aria-label={`Increase ${labelFor(key)}`}
                    disabled={disabled || busy || done >= total}
                    onClick={() => adjust(key, 1)}
                    className="flex size-9 items-center justify-center rounded-sm border border-primary/40 bg-primary/15 text-primary disabled:opacity-30"
                  >
                    <span className="material-symbols-outlined text-lg">add</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

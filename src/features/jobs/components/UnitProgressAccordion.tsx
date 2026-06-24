import { useEffect, useState } from 'react';
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

/**
 * One variant row: −/+ steppers plus an editable number box for setting the completed count
 * directly (so finishing e.g. 8 at once doesn't need 8 taps). The box commits a single delta
 * (target − current) through the same onAdjust path as the steppers, so the parent's
 * per-unit deduction/concurrency logic is unchanged.
 */
function VariantRow({
  label,
  total,
  done,
  disabled,
  busy,
  onAdjust,
}: {
  label: string;
  total: number;
  done: number;
  disabled?: boolean;
  busy: boolean;
  onAdjust: (delta: number) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState(String(done));

  // Re-seed the box whenever the persisted count changes (a save here, or elsewhere).
  useEffect(() => setDraft(String(done)), [done]);

  const commit = () => {
    // A blank/whitespace box is "no change", NOT zero — Number('') is 0, which would commit
    // a delta of -done and silently wipe the completed count. Revert to the persisted value.
    if (draft.trim() === '') {
      setDraft(String(done));
      return;
    }
    const parsed = Math.round(Number(draft));
    if (!Number.isFinite(parsed)) {
      setDraft(String(done));
      return;
    }
    const clamped = Math.max(0, Math.min(total, parsed));
    if (clamped === done) {
      setDraft(String(done)); // normalize out-of-range typing (e.g. "99" capped to total)
      return;
    }
    onAdjust(clamped - done);
  };

  return (
    <div className="flex items-center justify-between gap-2 rounded-sm bg-white/5 px-2.5 py-1.5">
      <span className="font-mono text-sm font-bold text-white">{label}</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={`Decrease ${label}`}
          disabled={disabled || busy || done <= 0}
          onClick={() => onAdjust(-1)}
          className="flex size-9 items-center justify-center rounded-sm border border-white/15 text-white disabled:opacity-30"
        >
          <span className="material-symbols-outlined text-lg">remove</span>
        </button>
        <div className="flex items-center gap-1 text-sm font-bold tabular-nums text-white">
          <input
            type="number"
            inputMode="numeric"
            aria-label={`Completed count for ${label}`}
            min={0}
            max={total}
            value={draft}
            disabled={disabled || busy}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            className="w-12 rounded-sm border border-white/15 bg-background-dark px-1 py-1 text-center text-white [appearance:textfield] disabled:opacity-50 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <span className="text-muted">/ {total}</span>
        </div>
        <button
          type="button"
          aria-label={`Increase ${label}`}
          disabled={disabled || busy || done >= total}
          onClick={() => onAdjust(1)}
          className="flex size-9 items-center justify-center rounded-sm border border-primary/40 bg-primary/15 text-primary disabled:opacity-30"
        >
          <span className="material-symbols-outlined text-lg">add</span>
        </button>
      </div>
    </div>
  );
}

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
          {subtitle && <p className="text-[11px] text-muted">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${accentDone}`}>
            {totalDone}/{totalUnits} {allDone ? '✓' : ''}
          </span>
          <span className="material-symbols-outlined text-base text-muted">
            {open ? 'expand_less' : 'expand_more'}
          </span>
        </div>
      </button>

      {open && (
        <div className="space-y-1.5 border-t border-white/10 p-2.5">
          {variantKeys.map((key) => {
            // Coerce defensively (mirrors the steppers' sum()) so corrupt counts can't yield
            // a negative/NaN total that produces a garbage delta from the number box.
            const total = Math.max(0, Number(unitCounts[key]) || 0);
            const done = Math.min(Math.max(0, Number(doneCounts[key]) || 0), total);
            return (
              <VariantRow
                key={key}
                label={labelFor(key)}
                total={total}
                done={done}
                disabled={disabled}
                busy={busyKey === key}
                onAdjust={(delta) => adjust(key, delta)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

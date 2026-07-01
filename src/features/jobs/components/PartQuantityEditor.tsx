import React from 'react';
import { formatDashSummary, formatSetComposition } from '@/lib/formatJob';
import { deriveSetCountFromDashQuantities } from '@/lib/jobPriceFromPart';
import { getDashQuantity, toDashSuffix } from '@/lib/variantMath';
import {
  buildDashQuantitiesFromSetCount,
  getEffectiveSetComposition,
  NO_VARIANT_DASH_KEY,
  type PartAllocationMeta,
  type PartWithVariants,
} from '@/lib/partAllocation';

interface PartQuantityEditorProps {
  part: PartWithVariants;
  dashQuantities: Record<string, number>;
  /** Current allocation mode (sets vs per-variant). */
  mode: 'sets' | 'variants';
  /** Set count shown in sets mode. */
  setCount: number;
  disabled?: boolean;
  /** Emitted on every change with the new quantities and how they were entered. */
  onChange: (dashQuantities: Record<string, number>, meta: PartAllocationMeta) => void;
}

/**
 * Controlled sets/variants quantity editor for a single part. Unlike PartSelector this does
 * NO part lookup — the part is already chosen — so it can be safely rendered bound to a row
 * (e.g. each additional part of a multi-part job) and edited independently. The toggle and
 * the field below it always stay in sync because both render from the same `mode` prop.
 */
const PartQuantityEditor: React.FC<PartQuantityEditorProps> = ({
  part,
  dashQuantities,
  mode,
  setCount,
  disabled,
  onChange,
}) => {
  const effectiveSetComposition = getEffectiveSetComposition(part);
  const hasVariants = !!part.variants?.length;
  const hasSetMode = !!effectiveSetComposition;
  const total = Object.values(dashQuantities).reduce((sum, qty) => sum + (qty || 0), 0);

  // No real variants: a single units field, stored under the synthetic dash key.
  if (!hasVariants) {
    const units = getDashQuantity(dashQuantities, NO_VARIANT_DASH_KEY);
    return (
      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-muted">Quantity (units)</label>
        <input
          type="number"
          min="0"
          step="1"
          value={units || 0}
          disabled={disabled}
          onChange={(e) => {
            const n = Math.max(0, parseInt(e.target.value) || 0);
            const next: Record<string, number> = n > 0 ? { [NO_VARIANT_DASH_KEY]: n } : {};
            onChange(next, { mode: 'variants', setCount: 0 });
          }}
          className="w-full rounded border border-line bg-white/5 px-2 py-1.5 text-sm text-white focus:border-primary/50 focus:outline-none disabled:opacity-50"
          placeholder="0"
        />
      </div>
    );
  }

  const setVariantsMode = () => onChange(dashQuantities, { mode: 'variants', setCount: 0 });

  const setSetsMode = () => {
    const derived = deriveSetCountFromDashQuantities(effectiveSetComposition, dashQuantities);
    const nextCount = derived != null && derived > 0 ? Math.floor(derived) : 1;
    onChange(buildDashQuantitiesFromSetCount(part, nextCount), {
      mode: 'sets',
      setCount: nextCount,
    });
  };

  const onSetCountChange = (value: number) => {
    const n = Math.max(0, Math.floor(value));
    onChange(buildDashQuantitiesFromSetCount(part, n), { mode: 'sets', setCount: n });
  };

  const onVariantChange = (suffix: string, qty: number) => {
    const key = toDashSuffix(suffix);
    const next = { ...dashQuantities };
    if (qty > 0) next[key] = Math.max(0, qty);
    else delete next[key];
    const derived = deriveSetCountFromDashQuantities(effectiveSetComposition, next);
    onChange(next, {
      mode: 'variants',
      setCount: derived != null && derived > 0 ? Math.floor(derived) : 0,
    });
  };

  return (
    <div className="space-y-2">
      {hasSetMode && (
        <div className="space-y-2 rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted">One set:</span>
            <span className="text-xs font-medium text-white">
              {formatSetComposition(effectiveSetComposition)}
            </span>
          </div>
          <div className="inline-flex rounded-lg border border-primary/30 bg-background-dark p-0.5">
            <button
              type="button"
              disabled={disabled}
              onClick={setSetsMode}
              className={`rounded px-2 py-1 text-[10px] font-medium transition-colors ${
                mode === 'sets' ? 'bg-primary text-on-accent' : 'text-primary hover:bg-primary/20'
              }`}
            >
              By sets
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={setVariantsMode}
              className={`rounded px-2 py-1 text-[10px] font-medium transition-colors ${
                mode === 'variants'
                  ? 'bg-primary text-on-accent'
                  : 'text-primary hover:bg-primary/20'
              }`}
            >
              By variant
            </button>
          </div>
        </div>
      )}

      {mode === 'sets' && hasSetMode ? (
        <div className="space-y-2 rounded-2xl border border-line bg-background-dark/40 p-2.5">
          <label className="block text-xs font-medium text-muted">Number of sets</label>
          <input
            type="number"
            min="0"
            step="1"
            value={setCount}
            disabled={disabled}
            onChange={(e) => onSetCountChange(parseInt(e.target.value) || 0)}
            className="w-full rounded border border-line bg-white/5 px-2 py-1.5 text-sm text-white focus:border-primary/50 focus:outline-none disabled:opacity-50"
            placeholder="0"
          />
          {total > 0 && (
            <p className="text-[11px] text-muted">
              Dash quantities: {formatDashSummary(dashQuantities)} → {total} total
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs font-medium text-muted">Dash Quantities</label>
            {total > 0 && <span className="text-[10px] text-muted">Total: {total}</span>}
          </div>
          <div className="space-y-1.5">
            {part.variants?.map((variant) => {
              const qty = getDashQuantity(dashQuantities, variant.variantSuffix);
              return (
                <div key={variant.id} className="flex items-center gap-2">
                  <label className="w-24 text-xs text-muted">
                    {part.partNumber}-{variant.variantSuffix}:
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={qty}
                    disabled={disabled}
                    onChange={(e) =>
                      onVariantChange(variant.variantSuffix, parseInt(e.target.value) || 0)
                    }
                    className="flex-1 rounded border border-line bg-white/5 px-2 py-1.5 text-sm text-white focus:border-primary/50 focus:outline-none disabled:opacity-50"
                    placeholder="0"
                  />
                  <span className="text-[10px] text-subtle">units</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

export default PartQuantityEditor;

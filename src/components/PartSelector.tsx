import React, { useState, useEffect, useCallback } from 'react';
import { Part, PartVariant } from '@/core/types';
import { partsService } from '@/services/api/parts';
import { useToast } from '@/Toast';
import { formatDashSummary, formatSetComposition } from '@/lib/formatJob';
import { deriveSetCountFromDashQuantities } from '@/lib/jobPriceFromPart';
import { getDashQuantity, normalizeDashQuantities, toDashSuffix } from '@/lib/variantMath';

interface PartSelectorProps {
  onSelect: (part: Part, dashQuantities: Record<string, number>) => void;
  onPartNumberResolved?: (partNumber: string, matchedPart: Part | null) => void;
  initialPartNumber?: string;
  /** Pre-fill dash quantities when editing an existing job */
  initialDashQuantities?: Record<string, number>;
  isAdmin?: boolean;
  showPrices?: boolean;
}

const PartSelector: React.FC<PartSelectorProps> = ({
  onSelect,
  onPartNumberResolved,
  initialPartNumber = '',
  initialDashQuantities,
  isAdmin: _isAdmin = true,
  showPrices: _showPrices = false,
}) => {
  const { showToast } = useToast();
  const [search, setSearch] = useState(initialPartNumber);
  const [part, setPart] = useState<(Part & { variants?: PartVariant[] }) | null>(null);
  const [dashQuantities, setDashQuantities] = useState<Record<string, number>>(
    normalizeDashQuantities(initialDashQuantities ?? {})
  );
  const [quantityMode, setQuantityMode] = useState<'sets' | 'variants'>('variants');
  const [setCount, setSetCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const getEffectiveSetComposition = useCallback(
    (targetPart: Part & { variants?: PartVariant[] }): Record<string, number> | null => {
      if (targetPart.setComposition && Object.keys(targetPart.setComposition).length > 0) {
        return targetPart.setComposition;
      }
      if (!targetPart.variants?.length) return null;
      const fallback: Record<string, number> = {};
      targetPart.variants.forEach((variant) => {
        fallback[toDashSuffix(variant.variantSuffix)] = 1;
      });
      return fallback;
    },
    []
  );

  const buildDashQuantitiesFromSetCount = useCallback(
    (targetPart: Part & { variants?: PartVariant[] }, count: number): Record<string, number> => {
      const effectiveSetComposition = getEffectiveSetComposition(targetPart);
      if (!targetPart.variants?.length || !effectiveSetComposition) return {};
      const normalizedCount = Math.max(0, Math.floor(count));
      if (normalizedCount <= 0) return {};
      const fromSets: Record<string, number> = {};
      targetPart.variants.forEach((variant) => {
        const perSetQty = getDashQuantity(effectiveSetComposition, variant.variantSuffix);
        if (perSetQty > 0) {
          fromSets[toDashSuffix(variant.variantSuffix)] = perSetQty * normalizedCount;
        }
      });
      return normalizeDashQuantities(fromSets);
    },
    [getEffectiveSetComposition]
  );

  const loadPart = useCallback(
    async (partNumber: string) => {
      const normalizedPartNumber = partNumber.trim().toUpperCase();
      if (!normalizedPartNumber) {
        setPart(null);
        setDashQuantities({});
        setQuantityMode('variants');
        setSetCount(0);
        onPartNumberResolved?.('', null);
        return;
      }

      setLoading(true);
      try {
        const found = await partsService.getPartByNumber(normalizedPartNumber);
        if (found) {
          const fullPart = await partsService.getPartWithVariants(found.id);
          if (!fullPart) {
            setPart(null);
            setDashQuantities({});
            setQuantityMode('variants');
            setSetCount(0);
            onPartNumberResolved?.(normalizedPartNumber, null);
            return;
          }
          setPart(fullPart);

          // Initialize: use pre-filled edit values when present, omit zero-qty variants
          const initial: Record<string, number> = {};
          fullPart.variants?.forEach((v) => {
            const key = toDashSuffix(v.variantSuffix);
            const fromInitial = initialDashQuantities
              ? getDashQuantity(initialDashQuantities, key)
              : undefined;
            const nextQty = fromInitial ?? 0;
            if (nextQty > 0) {
              initial[key] = nextQty;
            }
          });
          setDashQuantities(initial);
          const effectiveSetComposition = getEffectiveSetComposition(fullPart);
          if (effectiveSetComposition) {
            const derivedSets = deriveSetCountFromDashQuantities(effectiveSetComposition, initial);
            setQuantityMode('sets');
            setSetCount(derivedSets != null && derivedSets > 0 ? Math.floor(derivedSets) : 0);
          } else {
            setQuantityMode('variants');
            setSetCount(0);
          }
          onSelect(fullPart, initial);
          onPartNumberResolved?.(fullPart.partNumber, fullPart);
          showToast(`Found part: ${fullPart.name}`, 'success');
        } else {
          setPart(null);
          setDashQuantities({});
          setQuantityMode('variants');
          setSetCount(0);
          onPartNumberResolved?.(normalizedPartNumber, null);
          showToast(
            `Part ${normalizedPartNumber} not found. It will be created when you create the job.`,
            'warning'
          );
        }
      } catch (error) {
        console.error('Error loading part:', error);
        setPart(null);
        setDashQuantities({});
        setQuantityMode('variants');
        setSetCount(0);
        onPartNumberResolved?.(normalizedPartNumber, null);
      } finally {
        setLoading(false);
      }
    },
    [showToast, initialDashQuantities, onPartNumberResolved, onSelect, getEffectiveSetComposition]
  );

  useEffect(() => {
    if (initialPartNumber) {
      setSearch(initialPartNumber);
      loadPart(initialPartNumber);
    }
  }, [initialPartNumber, loadPart]);

  const handleSearch = () => {
    loadPart(search);
  };

  const handleQuantityChange = (suffix: string, qty: number) => {
    const key = toDashSuffix(suffix);
    const newQuantities = { ...normalizeDashQuantities(dashQuantities) };
    if (qty > 0) {
      newQuantities[key] = Math.max(0, qty);
    } else {
      delete newQuantities[key];
    }
    setDashQuantities(newQuantities);
    // Auto-update parent when quantities change (live update)
    if (part) {
      const derivedSets = deriveSetCountFromDashQuantities(
        getEffectiveSetComposition(part),
        newQuantities
      );
      setSetCount(derivedSets != null && derivedSets > 0 ? Math.floor(derivedSets) : 0);
      onSelect(part, newQuantities);
    }
  };

  const handleSetCountChange = (value: number) => {
    if (!part) return;
    const normalizedCount = Math.max(0, Math.floor(value));
    setSetCount(normalizedCount);
    const newQuantities = buildDashQuantitiesFromSetCount(part, normalizedCount);
    setDashQuantities(newQuantities);
    onSelect(part, newQuantities);
  };

  const handleQuantityModeChange = (nextMode: 'sets' | 'variants') => {
    if (!part) return;
    const effectiveSetComposition = getEffectiveSetComposition(part);
    if (!effectiveSetComposition) {
      setQuantityMode('variants');
      return;
    }
    if (nextMode === 'sets') {
      const derivedSets = deriveSetCountFromDashQuantities(effectiveSetComposition, dashQuantities);
      const nextSetCount = derivedSets != null && derivedSets > 0 ? Math.floor(derivedSets) : 1;
      setQuantityMode('sets');
      handleSetCountChange(nextSetCount);
      return;
    }
    setQuantityMode('variants');
  };

  const handleAutoAssign = () => {
    if (!part) return;
    onSelect(part, dashQuantities);
    showToast('Part and dash quantities selected', 'success');
  };

  const handleFillFullSet = () => {
    if (!part?.variants?.length) return;
    const newQuantities = buildDashQuantitiesFromSetCount(part, 1);
    setQuantityMode('sets');
    setSetCount(1);
    setDashQuantities(newQuantities);
    onSelect(part, newQuantities);
    showToast('Filled with one full set', 'success');
  };

  const totalQuantity = Object.values(dashQuantities).reduce((sum, qty) => sum + qty, 0);
  const effectiveSetComposition = part ? getEffectiveSetComposition(part) : null;
  const hasSetMode = !!effectiveSetComposition;

  return (
    <div className="rounded-sm border border-white/10 bg-white/5 p-4">
      <h3 className="mb-3 text-sm font-bold text-white">Part & Dash Numbers</h3>

      <div className="mb-3">
        <label className="mb-1 block text-xs font-medium text-slate-300">Part Number</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => {
              const nextValue = e.target.value.toUpperCase();
              setSearch(nextValue);
              onPartNumberResolved?.(nextValue.trim(), null);
            }}
            onBlur={handleSearch}
            placeholder="e.g., SK-F35-0911"
            className="flex-1 rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-primary/50 focus:outline-none"
          />
          {loading && (
            <span className="material-symbols-outlined animate-spin text-primary">refresh</span>
          )}
        </div>
        {part && (
          <div className="mt-1.5 rounded-sm border border-green-500/30 bg-green-500/10 p-2">
            <p className="text-xs font-medium text-green-400">✓ {part.name}</p>
            <p className="text-[10px] text-slate-400">{part.partNumber}</p>
          </div>
        )}
      </div>

      {part && part.variants && part.variants.length > 0 && (
        <div className="mb-3">
          {hasSetMode && (
            <div className="mb-2 space-y-2 rounded-sm border border-primary/20 bg-primary/5 px-2.5 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-slate-400">One set:</span>
                <span className="text-xs font-medium text-white">
                  {formatSetComposition(effectiveSetComposition)}
                </span>
              </div>
              <div className="inline-flex rounded-sm border border-primary/30 bg-background-dark p-0.5">
                <button
                  type="button"
                  onClick={() => handleQuantityModeChange('sets')}
                  className={`rounded px-2 py-1 text-[10px] font-medium transition-colors ${
                    quantityMode === 'sets'
                      ? 'bg-primary text-white'
                      : 'text-primary hover:bg-primary/20'
                  }`}
                >
                  By sets
                </button>
                <button
                  type="button"
                  onClick={() => handleQuantityModeChange('variants')}
                  className={`rounded px-2 py-1 text-[10px] font-medium transition-colors ${
                    quantityMode === 'variants'
                      ? 'bg-primary text-white'
                      : 'text-primary hover:bg-primary/20'
                  }`}
                >
                  By variant
                </button>
              </div>
            </div>
          )}
          {quantityMode === 'sets' && hasSetMode ? (
            <div className="space-y-2 rounded-sm border border-white/10 bg-background-dark/40 p-2.5">
              <label className="block text-xs font-medium text-slate-300">Number of sets</label>
              <input
                type="number"
                min="0"
                step="1"
                value={setCount}
                onChange={(e) => handleSetCountChange(parseInt(e.target.value) || 0)}
                className="w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white focus:border-primary/50 focus:outline-none"
                placeholder="0"
              />
              {totalQuantity > 0 && (
                <p className="text-[11px] text-slate-400">
                  Auto dash quantities: {formatDashSummary(dashQuantities)}
                </p>
              )}
              <button
                type="button"
                onClick={handleFillFullSet}
                className="rounded border border-primary/30 bg-primary/20 px-2 py-1 text-[10px] font-medium text-primary transition-colors hover:bg-primary/30"
              >
                Set to one full set
              </button>
            </div>
          ) : (
            <>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-xs font-medium text-slate-300">Dash Quantities</label>
                {totalQuantity > 0 && (
                  <span className="text-[10px] text-slate-400">Total: {totalQuantity}</span>
                )}
              </div>
              <div className="space-y-1.5">
                {part.variants.map((variant) => {
                  const qty = getDashQuantity(dashQuantities, variant.variantSuffix);
                  return (
                    <div key={variant.id} className="flex items-center gap-2">
                      <label className="w-24 text-xs text-slate-400">
                        {part.partNumber}-{variant.variantSuffix}:
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={qty}
                        onChange={(e) =>
                          handleQuantityChange(variant.variantSuffix, parseInt(e.target.value) || 0)
                        }
                        className="flex-1 rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white focus:border-primary/50 focus:outline-none"
                        placeholder="0"
                      />
                      <span className="text-[10px] text-slate-500">units</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {part && totalQuantity > 0 && (
        <button
          onClick={handleAutoAssign}
          className="w-full rounded-sm border border-primary/30 bg-primary/20 px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/30"
        >
          Apply Part & Dash Quantities
        </button>
      )}
    </div>
  );
};

export default PartSelector;

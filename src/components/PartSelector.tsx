import React, { useState, useEffect, useCallback } from 'react';
import { Part, PartVariant } from '@/core/types';
import { partsService } from '@/services/api/parts';
import { useToast } from '@/Toast';
import { formatSetComposition } from '@/lib/formatJob';

interface PartSelectorProps {
  onSelect: (part: Part, dashQuantities: Record<string, number>) => void;
  initialPartNumber?: string;
  /** Pre-fill dash quantities when editing an existing job */
  initialDashQuantities?: Record<string, number>;
  isAdmin?: boolean;
  showPrices?: boolean;
}

const PartSelector: React.FC<PartSelectorProps> = ({
  onSelect,
  initialPartNumber = '',
  initialDashQuantities,
  isAdmin = true,
  showPrices = false,
}) => {
  const { showToast } = useToast();
  const [search, setSearch] = useState(initialPartNumber);
  const [part, setPart] = useState<(Part & { variants?: PartVariant[] }) | null>(null);
  const [dashQuantities, setDashQuantities] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (initialPartNumber) {
      setSearch(initialPartNumber);
      loadPart(initialPartNumber);
    }
  }, [initialPartNumber]);

  const loadPart = useCallback(
    async (partNumber: string) => {
      if (!partNumber.trim()) {
        setPart(null);
        setDashQuantities({});
        return;
      }

      setLoading(true);
      try {
        const found = await partsService.getPartByNumber(partNumber.trim());
        if (found) {
          const fullPart = await partsService.getPartWithVariants(found.id);
          setPart(fullPart);

          // Initialize: use initialDashQuantities when editing, else 0 per variant
          const initial: Record<string, number> = {};
          fullPart.variants?.forEach((v) => {
            const key = v.variantSuffix;
            const fromInitial = initialDashQuantities
              ? (initialDashQuantities[key] ??
                initialDashQuantities[`-${key}`] ??
                initialDashQuantities[key.replace(/^-/, '')])
              : undefined;
            initial[key] = fromInitial ?? 0;
          });
          setDashQuantities(initial);
          showToast(`Found part: ${fullPart.name}`, 'success');
        } else {
          setPart(null);
          setDashQuantities({});
        }
      } catch (error) {
        console.error('Error loading part:', error);
        setPart(null);
        setDashQuantities({});
      } finally {
        setLoading(false);
      }
    },
    [showToast, initialDashQuantities]
  );

  const handleSearch = () => {
    loadPart(search);
  };

  const handleQuantityChange = (suffix: string, qty: number) => {
    const newQuantities = { ...dashQuantities };
    if (qty > 0) {
      newQuantities[suffix] = Math.max(0, qty);
    } else {
      delete newQuantities[suffix];
    }
    setDashQuantities(newQuantities);
    // Auto-update parent when quantities change (live update)
    if (part) {
      onSelect(part, newQuantities);
    }
  };

  const handleAutoAssign = () => {
    if (!part) return;
    onSelect(part, dashQuantities);
    showToast('Part and dash quantities selected', 'success');
  };

  const handleFillFullSet = () => {
    if (!part?.variants?.length) return;
    const setComp =
      part.setComposition && Object.keys(part.setComposition).length > 0
        ? part.setComposition
        : null;
    const newQuantities: Record<string, number> = {};
    part.variants.forEach((v) => {
      const qty = setComp?.[v.variantSuffix] ?? setComp?.[v.variantSuffix.replace(/^-/, '')] ?? 1;
      newQuantities[v.variantSuffix] = qty;
    });
    setDashQuantities(newQuantities);
    onSelect(part, newQuantities);
    showToast('Filled with one full set', 'success');
  };

  const totalQuantity = Object.values(dashQuantities).reduce((sum, qty) => sum + qty, 0);
  const hasSetComposition = part?.setComposition && Object.keys(part.setComposition).length > 0;

  return (
    <div className="rounded-sm border border-white/10 bg-white/5 p-4">
      <h3 className="mb-3 text-sm font-bold text-white">Part & Dash Numbers</h3>

      <div className="mb-3">
        <label className="mb-1 block text-xs font-medium text-slate-300">Part Number</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value.toUpperCase())}
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
          {hasSetComposition && (
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-sm border border-primary/20 bg-primary/5 px-2.5 py-1.5">
              <span className="text-xs text-slate-400">One set:</span>
              <span className="text-xs font-medium text-white">
                {formatSetComposition(part.setComposition)}
              </span>
              <button
                type="button"
                onClick={handleFillFullSet}
                className="rounded border border-primary/30 bg-primary/20 px-2 py-1 text-[10px] font-medium text-primary transition-colors hover:bg-primary/30"
              >
                Fill full set
              </button>
            </div>
          )}
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs font-medium text-slate-300">Dash Quantities</label>
            {totalQuantity > 0 && (
              <span className="text-[10px] text-slate-400">Total: {totalQuantity}</span>
            )}
          </div>
          <div className="space-y-1.5">
            {part.variants.map((variant) => {
              const qty = dashQuantities[variant.variantSuffix] || 0;
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

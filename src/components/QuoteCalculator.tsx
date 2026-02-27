import React, { useState, useMemo, useEffect, useRef } from 'react';
import type { Part, PartVariant, InventoryItem } from '@/core/types';
import { calculatePartQuote } from '@/lib/partsCalculations';
import { calculateSetPriceFromVariants } from '@/lib/partDistribution';

export interface QuoteCalculatorProps {
  part: Part & { variants?: Array<{ variantSuffix: string; materials?: unknown[] }> };
  inventoryItems: InventoryItem[];
  /** Variants with pricePerVariant; used to compute auto set price when set composition exists */
  variants?: PartVariant[];
  setComposition?: Record<string, number> | null;
  laborRate?: number;
  cncRate?: number;
  printer3DRate?: number;
  className?: string;
  /** Callback when set price changes - parent should save to part. Pass undefined to revert to auto (parent recalculates from variants). */
  onSetPriceChange?: (price: number | undefined) => void;
  /** Callback when set labor hours change. */
  onLaborHoursChange?: (laborHours: number | undefined) => void;
  /** Optional auto-calculated set labor hours from variant composition. */
  autoSetLaborHours?: number;
  /** When true, set price and labor inputs are display-only (e.g. when set is aggregate of variants). */
  readOnly?: boolean;
  /** When true, use first variant price for all units in set (variants are copies). */
  variantsAreCopies?: boolean;
}

const QuoteCalculator: React.FC<QuoteCalculatorProps> = ({
  part,
  inventoryItems,
  variants,
  setComposition,
  laborRate = 175,
  cncRate = 150,
  printer3DRate = 100,
  className = '',
  onSetPriceChange,
  onLaborHoursChange,
  autoSetLaborHours,
  readOnly = false,
  variantsAreCopies = false,
}) => {
  const quantity = 1;
  const [manualSetPrice, setManualSetPrice] = useState<string>(part.pricePerSet?.toString() || '');
  const [isManualPrice, setIsManualPrice] = useState(!!part.pricePerSet);
  const [hasUserEdited, setHasUserEdited] = useState(false);
  const [hasUserEditedSetLabor, setHasUserEditedSetLabor] = useState(false);
  const [laborHoursInput, setLaborHoursInput] = useState<string>(part.laborHours?.toString() ?? '');
  const onSetPriceChangeRef = useRef(onSetPriceChange);
  onSetPriceChangeRef.current = onSetPriceChange;

  const autoSetPrice = useMemo(
    () => calculateSetPriceFromVariants(variants ?? [], setComposition ?? {}, variantsAreCopies),
    [variants, setComposition, variantsAreCopies]
  );

  useEffect(() => {
    if (!hasUserEdited) {
      const matchesAuto =
        autoSetPrice != null &&
        part.pricePerSet != null &&
        Math.abs(part.pricePerSet - autoSetPrice) < 0.01;
      if (part.pricePerSet != null && !matchesAuto) {
        setManualSetPrice(part.pricePerSet.toString());
        setIsManualPrice(true);
      } else {
        setManualSetPrice(
          autoSetPrice != null ? autoSetPrice.toString() : (part.pricePerSet?.toString() ?? '')
        );
        setIsManualPrice(false);
      }
    }
  }, [part.pricePerSet, hasUserEdited, autoSetPrice]);

  useEffect(() => {
    if (!hasUserEditedSetLabor) {
      setLaborHoursInput(part.laborHours?.toString() ?? '');
    }
    // Do not overwrite manual set labor when part updates (e.g. from set-price distribution).
  }, [part.laborHours, hasUserEditedSetLabor]);

  useEffect(() => {
    if (hasUserEdited && onSetPriceChangeRef.current) {
      if (isManualPrice && manualSetPrice) {
        const price = parseFloat(manualSetPrice);
        if (!Number.isNaN(price)) {
          onSetPriceChangeRef.current(price);
        }
      } else {
        onSetPriceChangeRef.current(undefined);
      }
    }
  }, [manualSetPrice, isManualPrice, hasUserEdited]);

  const result = useMemo(() => {
    const manualParsed = manualSetPrice.trim() ? parseFloat(manualSetPrice) : undefined;
    const effectiveSetPrice =
      isManualPrice && manualParsed != null && Number.isFinite(manualParsed) && manualParsed > 0
        ? manualParsed
        : autoSetPrice != null && Number.isFinite(autoSetPrice) && autoSetPrice > 0
          ? autoSetPrice
          : part.pricePerSet != null && Number.isFinite(part.pricePerSet) && part.pricePerSet > 0
            ? part.pricePerSet
            : undefined;
    return calculatePartQuote(part, quantity, inventoryItems, {
      laborRate,
      cncRate,
      printer3DRate,
      manualSetPrice: effectiveSetPrice,
      overrideLaborHours:
        part.laborHours != null && Number.isFinite(part.laborHours) ? part.laborHours : undefined,
    });
  }, [
    part,
    quantity,
    inventoryItems,
    laborRate,
    cncRate,
    printer3DRate,
    manualSetPrice,
    isManualPrice,
    autoSetPrice,
  ]);

  const AutoBadge = () => (
    <span className="ml-1.5 rounded bg-primary/20 px-1.5 py-0.5 text-xs text-primary">auto</span>
  );

  const revertToAuto = () => {
    setHasUserEdited(false);
    setIsManualPrice(false);
    setManualSetPrice(autoSetPrice != null ? autoSetPrice.toString() : '');
    onSetPriceChange?.(undefined);
  };

  const displayValue = isManualPrice
    ? manualSetPrice
    : autoSetPrice != null
      ? autoSetPrice.toString()
      : '';
  const isLaborAutoFromTarget = !!result?.isLaborAutoAdjusted;
  const laborDisplayValue = isLaborAutoFromTarget
    ? (result?.laborHours?.toFixed(2) ?? laborHoursInput)
    : laborHoursInput;

  // When set price is manual and labor was reverse-calculated from it, "Use Auto" for set labor should use that value and persist it (and distribute to variants)
  const effectiveAutoSetLabor =
    result?.isLaborAutoAdjusted && result != null && Number.isFinite(result.laborHours)
      ? result.laborHours
      : (autoSetLaborHours ?? (part.laborHours != null ? part.laborHours : 0));
  const showUseAutoLabor =
    (part.variants?.length ?? 0) > 0 &&
    part.setComposition &&
    Object.keys(part.setComposition).length > 0;

  return (
    <div className={`rounded-sm border border-primary/30 bg-primary/10 p-4 ${className}`}>
      <p className="mb-3 text-xs font-bold uppercase text-slate-400">Quote calculator (per set)</p>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="text-sm text-slate-300">Set labor hours</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            step="0.1"
            min={0}
            value={laborDisplayValue}
            onChange={(e) => {
              if (readOnly) return;
              setLaborHoursInput(e.target.value);
              setHasUserEditedSetLabor(true);
            }}
            onBlur={() => {
              if (readOnly || isLaborAutoFromTarget) return;
              const nextLabor = laborHoursInput.trim() === '' ? undefined : Number(laborHoursInput);
              if (nextLabor != null && Number.isNaN(nextLabor)) return;
              onLaborHoursChange?.(nextLabor);
            }}
            readOnly={readOnly || isLaborAutoFromTarget}
            className="w-32 rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-primary/50 focus:outline-none disabled:opacity-70"
            placeholder="0.0"
          />
          {isLaborAutoFromTarget && <AutoBadge />}
          {!readOnly && showUseAutoLabor && (
            <button
              type="button"
              onClick={() => {
                setHasUserEditedSetLabor(false);
                const nextAuto = Number(
                  (typeof effectiveAutoSetLabor === 'number' ? effectiveAutoSetLabor : 0).toFixed(2)
                );
                setLaborHoursInput(nextAuto.toString());
                onLaborHoursChange?.(nextAuto);
              }}
              className="rounded bg-primary/20 px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/30"
            >
              Use Auto
            </button>
          )}
        </div>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="text-sm text-slate-300">Set price</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            step="0.01"
            min={0}
            value={displayValue}
            onChange={(e) => {
              if (readOnly) return;
              setManualSetPrice(e.target.value);
              setHasUserEdited(true);
              setIsManualPrice(e.target.value.trim() !== '');
            }}
            onBlur={() => {
              if (readOnly) return;
              if (manualSetPrice.trim() === '' && !isManualPrice) {
                setManualSetPrice(autoSetPrice != null ? autoSetPrice.toString() : '');
              }
            }}
            readOnly={readOnly}
            className="w-32 rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-primary/50 focus:outline-none disabled:opacity-70"
            placeholder={autoSetPrice != null ? autoSetPrice.toFixed(2) : 'Auto'}
          />
          {!readOnly && !isManualPrice && autoSetPrice != null && <AutoBadge />}
          {!readOnly && isManualPrice && (autoSetPrice != null || part.pricePerSet != null) && (
            <button
              type="button"
              onClick={revertToAuto}
              className="rounded bg-primary/20 px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/30"
            >
              Use Auto
            </button>
          )}
        </div>
        <span className="text-xs text-slate-500">
          {isManualPrice
            ? 'Labor auto-adjusted to hit total price'
            : 'From variant prices × set composition'}
        </span>
      </div>
      {result ? (
        <div className="space-y-1 text-sm">
          <div className="flex justify-between text-slate-300">
            <span>Material cost (customer)</span>
            <span className="text-white">${result.materialCostCustomer.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-slate-300">
            <span className="flex items-center">
              Labor ({result.laborHours.toFixed(1)} h × ${laborRate}/h)
              {result.isLaborAutoAdjusted && <AutoBadge />}
            </span>
            <span className="text-white">${result.laborCost.toFixed(2)}</span>
          </div>
          {result.cncHours > 0 && (
            <div className="flex justify-between text-slate-300">
              <span>
                CNC ({result.cncHours.toFixed(1)} h × ${cncRate}/h)
              </span>
              <span className="text-white">${result.cncCost.toFixed(2)}</span>
            </div>
          )}
          {result.printer3DHours > 0 && (
            <div className="flex justify-between text-slate-300">
              <span>
                3D Print ({result.printer3DHours.toFixed(1)} h × ${printer3DRate}/h)
              </span>
              <span className="text-white">${result.printer3DCost.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-white/10 pt-2 text-slate-300">
            <span>Subtotal</span>
            <span className="text-white">${result.subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between border-t border-primary/30 pt-2 text-base font-semibold text-white">
            <span>Total quote</span>
            <span>${result.total.toFixed(2)}</span>
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-500">
          Enter quantity and set labor hours / set composition to see quote.
        </p>
      )}
    </div>
  );
};

export default QuoteCalculator;

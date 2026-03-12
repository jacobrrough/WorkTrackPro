import React, { useState, useMemo } from 'react';
import type { Part, PartVariant, InventoryItem } from '@/core/types';
import {
  calculatePartQuote,
  calculateVariantQuote,
  type PartQuoteResult,
} from '@/lib/partsCalculations';

const normSuffix = (s: string) =>
  String(s ?? '')
    .trim()
    .replace(/^-/, '');

function getVariantQtyInSet(
  setComposition: Record<string, number> | null | undefined,
  variantSuffix: string
): number {
  if (!setComposition || typeof setComposition !== 'object') return 0;
  const n = normSuffix(variantSuffix);
  for (const [key, val] of Object.entries(setComposition)) {
    if (normSuffix(key) === n) return Number(val) || 0;
  }
  return 0;
}

export interface QuoteCalculatorProps {
  part: Part & { variants?: Array<{ variantSuffix: string; materials?: unknown[] }> };
  inventoryItems: InventoryItem[];
  variants?: PartVariant[];
  setComposition?: Record<string, number> | null;
  laborRate?: number;
  cncRate?: number;
  printer3DRate?: number;
  className?: string;
  /** When true, part is read-only (e.g. set from variants). */
  readOnly?: boolean;
  /** When true, use first variant for all in set (variants are copies). */
  variantsAreCopies?: boolean;
  /** Optional: effective labor hours when part has variants (from parent). */
  autoSetLaborHours?: number;
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
  readOnly = false,
  variantsAreCopies = false,
  autoSetLaborHours,
}) => {
  const [quantityInput, setQuantityInput] = useState('1');
  const [quoteBy, setQuoteBy] = useState<'sets' | 'variants'>('sets');
  const [variantQtyInputs, setVariantQtyInputs] = useState<Record<string, string>>({});

  const hasVariants = !!(
    variants?.length &&
    setComposition &&
    Object.keys(setComposition).length > 0
  );
  const numSets = Math.max(0, Number(quantityInput) || 0);

  const result = useMemo(() => {
    if (quoteBy === 'variants' && hasVariants) return null;
    const sets = Math.max(1, numSets || 1);
    return calculatePartQuote(part, sets, inventoryItems, {
      laborRate,
      cncRate,
      printer3DRate,
      manualSetPrice: undefined,
      overrideLaborHours:
        part.laborHours != null && Number.isFinite(part.laborHours) ? part.laborHours : undefined,
    });
  }, [part, numSets, inventoryItems, laborRate, cncRate, printer3DRate, quoteBy, hasVariants]);

  const variantQuotes = useMemo((): Array<{
    variant: PartVariant;
    qty: number;
    quote: PartQuoteResult;
  }> => {
    if (!variants?.length) return [];
    const list: Array<{ variant: PartVariant; qty: number; quote: PartQuoteResult }> = [];
    for (const variant of variants) {
      const key = normSuffix(variant.variantSuffix);
      let variantQty: number;
      if (quoteBy === 'variants') {
        variantQty = Math.max(0, Number(variantQtyInputs[key]) || 0);
      } else {
        const qtyInSet = getVariantQtyInSet(setComposition, variant.variantSuffix);
        variantQty = qtyInSet * Math.max(1, numSets || 1);
      }
      if (variantQty <= 0) continue;
      const quote = calculateVariantQuote(part.partNumber, variant, variantQty, inventoryItems, {
        laborRate,
        cncRate,
        printer3DRate,
      });
      if (quote) list.push({ variant, qty: variantQty, quote });
    }
    return list;
  }, [
    part.partNumber,
    variants,
    setComposition,
    numSets,
    quoteBy,
    variantQtyInputs,
    inventoryItems,
    laborRate,
    cncRate,
    printer3DRate,
  ]);

  const totalFromVariants = variantQuotes.reduce((sum, { quote }) => sum + quote.total, 0);
  const effectiveResult =
    result ?? (variantQuotes.length > 0 ? { total: totalFromVariants, quantity: 0 } : null);
  const displayQty = result?.quantity ?? (quoteBy === 'sets' ? Math.max(1, numSets || 1) : 0);
  const showPerVariant = variantQuotes.length > 0;

  const setVariantQty = (suffixKey: string, value: string) => {
    setVariantQtyInputs((prev) => ({ ...prev, [suffixKey]: value }));
  };

  const fillVariantQuantitiesFromSets = () => {
    if (!variants?.length || !setComposition) return;
    const sets = Math.max(1, numSets || 1);
    const next: Record<string, string> = {};
    for (const variant of variants) {
      const key = normSuffix(variant.variantSuffix);
      const qtyInSet = getVariantQtyInSet(setComposition, variant.variantSuffix);
      next[key] = String(qtyInSet * sets);
    }
    setVariantQtyInputs(next);
  };

  return (
    <div className={`rounded-sm border border-primary/30 bg-primary/10 p-4 ${className}`}>
      <p className="mb-3 text-xs font-bold uppercase text-slate-400">Quote calculator</p>

      {hasVariants && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-400">Quote by:</span>
          <div className="flex rounded border border-white/10 bg-black/20 p-0.5">
            <button
              type="button"
              onClick={() => setQuoteBy('sets')}
              className={`min-h-[36px] rounded px-3 text-sm font-medium transition-colors ${
                quoteBy === 'sets'
                  ? 'bg-primary text-white'
                  : 'text-slate-400 hover:bg-white/10 hover:text-white'
              }`}
            >
              Sets
            </button>
            <button
              type="button"
              onClick={() => {
                setQuoteBy('variants');
                fillVariantQuantitiesFromSets();
              }}
              className={`min-h-[36px] rounded px-3 text-sm font-medium transition-colors ${
                quoteBy === 'variants'
                  ? 'bg-primary text-white'
                  : 'text-slate-400 hover:bg-white/10 hover:text-white'
              }`}
            >
              Variants
            </button>
          </div>
        </div>
      )}

      {quoteBy === 'sets' && (
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <label className="text-sm text-slate-300">
            {hasVariants ? 'Number of sets' : 'Quantity'}
          </label>
          <input
            type="number"
            min={1}
            step={1}
            value={quantityInput}
            onChange={(e) => {
              const v = e.target.value;
              const n = parseInt(v, 10);
              if (v === '' || (!Number.isNaN(n) && n >= 0))
                setQuantityInput(v === '' ? '1' : String(Math.max(1, n)));
            }}
            className="w-24 rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-primary/50 focus:outline-none"
          />
        </div>
      )}

      {quoteBy === 'variants' && hasVariants && variants && (
        <div className="mb-3 space-y-2">
          <p className="text-[10px] font-bold uppercase text-slate-400">Quantity per variant</p>
          <div className="flex flex-wrap gap-3">
            {variants.map((variant) => {
              const key = normSuffix(variant.variantSuffix);
              const dashLabel = key ? `-${key.padStart(2, '0')}` : '';
              return (
                <label key={variant.id} className="flex items-center gap-2">
                  <span className="w-14 shrink-0 text-sm text-slate-300">{dashLabel}</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={variantQtyInputs[key] ?? ''}
                    onChange={(e) => setVariantQty(key, e.target.value)}
                    placeholder="0"
                    className="w-20 rounded-sm border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white focus:border-primary/50 focus:outline-none"
                  />
                </label>
              );
            })}
          </div>
        </div>
      )}

      {effectiveResult ? (
        <div className="space-y-2 text-sm">
          {showPerVariant ? (
            <>
              {variantQuotes.map(({ variant, qty, quote }) => (
                <div
                  key={variant.id}
                  className="space-y-1 rounded border border-white/10 bg-black/20 p-2"
                >
                  <p className="text-[10px] font-bold uppercase text-slate-400">
                    Variant -{normSuffix(variant.variantSuffix)} (×{qty})
                  </p>
                  {quote.materialLineItems.length > 0 &&
                    quote.materialLineItems.map((line) => (
                      <div
                        key={`${variant.id}-${line.inventoryId}`}
                        className="flex justify-between text-xs text-slate-300"
                        title={`${line.quantity} ${line.unit} × $${line.price.toFixed(2)}`}
                      >
                        <span className="min-w-0 truncate pr-2">
                          {line.name} ({line.quantity} {line.unit})
                        </span>
                        <span className="shrink-0 text-white">
                          ${line.lineTotalCustomer.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  <div className="flex justify-between text-xs text-slate-300">
                    <span>
                      Labor ({quote.laborHours.toFixed(1)} h × ${laborRate}/h)
                    </span>
                    <span className="text-white">${quote.laborCost.toFixed(2)}</span>
                  </div>
                  {quote.cncHours > 0 && (
                    <div className="flex justify-between text-xs text-slate-300">
                      <span>
                        CNC ({quote.cncHours.toFixed(1)} h × ${cncRate}/h)
                      </span>
                      <span className="text-white">${quote.cncCost.toFixed(2)}</span>
                    </div>
                  )}
                  {quote.printer3DHours > 0 && (
                    <div className="flex justify-between text-xs text-slate-300">
                      <span>
                        3D Print ({quote.printer3DHours.toFixed(1)} h × ${printer3DRate}/h)
                      </span>
                      <span className="text-white">${quote.printer3DCost.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-white/10 pt-1 font-medium text-slate-300">
                    <span>Variant total</span>
                    <span className="text-white">${quote.total.toFixed(2)}</span>
                  </div>
                </div>
              ))}
              <div className="flex justify-between border-t border-primary/30 pt-2 text-base font-semibold text-white">
                <span>
                  Total
                  {quoteBy === 'sets' && displayQty > 0
                    ? ` (${displayQty} set${displayQty !== 1 ? 's' : ''})`
                    : ''}
                </span>
                <span>${effectiveResult.total.toFixed(2)}</span>
              </div>
            </>
          ) : result ? (
            <>
              {result.materialLineItems.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-bold uppercase text-slate-400">Materials</p>
                  {result.materialLineItems.map((line) => (
                    <div
                      key={line.inventoryId}
                      className="flex justify-between text-slate-300"
                      title={`${line.quantity} ${line.unit} × $${line.price.toFixed(2)}`}
                    >
                      <span className="min-w-0 truncate pr-2">
                        {line.name} ({line.quantity} {line.unit})
                      </span>
                      <span className="shrink-0 text-white">
                        ${line.lineTotalCustomer.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex justify-between text-slate-300">
                <span>
                  Labor ({result.laborHours.toFixed(1)} h × ${laborRate}/h)
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
                <span>
                  Total ({displayQty} set{displayQty !== 1 ? 's' : ''})
                </span>
                <span>${result.total.toFixed(2)}</span>
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-500">
              Enter quantity for at least one variant to see the quote.
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-slate-500">
          Set labor hours and materials on the part or variants to see a quote.
        </p>
      )}
    </div>
  );
};

export default QuoteCalculator;

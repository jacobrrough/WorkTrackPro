import React, { useState, useMemo } from 'react';
import type { Part, InventoryItem } from '@/core/types';
import { calculatePartQuote } from '@/lib/calculatePartQuote';

export interface QuoteCalculatorProps {
  part: Part & { variants?: Array<{ variantSuffix: string; materials?: unknown[] }> };
  inventoryItems: InventoryItem[];
  initialQuantity?: number;
  laborRate?: number;
  markupPercent?: number;
  className?: string;
}

const QuoteCalculator: React.FC<QuoteCalculatorProps> = ({
  part,
  inventoryItems,
  initialQuantity = 1,
  laborRate = 175,
  markupPercent = 20,
  className = '',
}) => {
  const [quantity, setQuantity] = useState(initialQuantity);

  const result = useMemo(() => {
    return calculatePartQuote(part, quantity, inventoryItems, {
      laborRate,
      markupPercent,
    });
  }, [part, quantity, inventoryItems, laborRate, markupPercent]);

  return (
    <div className={`rounded-sm border border-primary/30 bg-primary/10 p-4 ${className}`}>
      <p className="mb-3 text-xs font-bold uppercase text-slate-400">Quote calculator</p>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="text-sm text-slate-300">Quote for</label>
        <input
          type="number"
          min={1}
          value={quantity}
          onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
          className="w-24 rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-primary/50 focus:outline-none"
        />
        <span className="text-sm text-slate-400">sets</span>
      </div>
      {result ? (
        <div className="space-y-1 text-sm">
          <div className="flex justify-between text-slate-300">
            <span>Material cost (customer)</span>
            <span className="text-white">${result.materialCostCustomer.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-slate-300">
            <span>Labor ({result.laborHours.toFixed(1)} h × ${laborRate}/h)</span>
            <span className="text-white">${result.laborCost.toFixed(2)}</span>
          </div>
          {result.machineHours > 0 && (
            <div className="flex justify-between text-slate-300">
              <span>Machine / CNC ({result.machineHours.toFixed(1)} h × ${laborRate}/h)</span>
              <span className="text-white">${result.machineCost.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-white/10 pt-2 text-slate-300">
            <span>Subtotal</span>
            <span className="text-white">${result.subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-slate-300">
            <span>Markup ({result.markupPercent}%)</span>
            <span className="text-white">${result.markupAmount.toFixed(2)}</span>
          </div>
          <div className="flex justify-between border-t border-primary/30 pt-2 text-base font-semibold text-white">
            <span>Total quote</span>
            <span>${result.total.toFixed(2)}</span>
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-500">Enter quantity and set labor hours / set composition to see quote.</p>
      )}
    </div>
  );
};

export default QuoteCalculator;

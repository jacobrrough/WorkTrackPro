import React, { useState } from 'react';
import type { StorePart } from '@/services/api/storefront';
import type { CartItem } from './storefrontCart';

interface AddToCartModalProps {
  part: StorePart;
  initialVariantSuffix?: string | null;
  onClose: () => void;
  onAdd: (item: CartItem) => void;
}

export default function AddToCartModal({
  part,
  initialVariantSuffix,
  onClose,
  onAdd,
}: AddToCartModalProps) {
  const [quantity, setQuantity] = useState(1);
  const [variantSuffix, setVariantSuffix] = useState<string | null>(
    initialVariantSuffix ?? (part.variants.length === 1 ? part.variants[0].variantSuffix : null)
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const qty = Math.max(1, Math.floor(Number(quantity)) || 1);
    onAdd({
      partId: part.id,
      partNumber: part.partNumber,
      partName: part.name,
      variantSuffix,
      quantity: qty,
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-to-cart-title"
    >
      <div className="w-full max-w-md rounded-lg border border-white/10 bg-[#0f0f14] p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="add-to-cart-title" className="text-lg font-bold text-white">
            Add to cart
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] rounded-sm text-slate-400 hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <p className="mb-4 text-sm text-slate-300">
          {part.partNumber} — {part.name}
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          {part.variants.length > 1 ? (
            <label className="block">
              <span className="mb-1 block text-sm text-slate-400">Variant</span>
              <select
                value={variantSuffix ?? ''}
                onChange={(e) => setVariantSuffix(e.target.value || null)}
                className="w-full rounded-sm border border-white/10 bg-[#1a1e31] px-3 py-2 text-white focus:border-primary/60 focus:outline-none"
              >
                <option value="">— Select —</option>
                {part.variants.map((v) => (
                  <option key={v.id} value={v.variantSuffix}>
                    {part.partNumber}-{v.variantSuffix}
                    {v.name ? ` — ${v.name}` : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="block">
            <span className="mb-1 block text-sm text-slate-400">Quantity</span>
            <input
              type="number"
              min={1}
              step={1}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value) || 1)}
              className="w-full rounded-sm border border-white/10 bg-[#1a1e31] px-3 py-2 text-white focus:border-primary/60 focus:outline-none"
            />
          </label>
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] flex-1 rounded-sm border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="min-h-[44px] flex-1 rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
            >
              Add to cart
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

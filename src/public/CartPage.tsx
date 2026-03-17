import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import type { CartItem } from './storefrontCart';
import { removeFromCart, updateCartItemQty, cartTotalItems } from './storefrontCart';

interface CartPageProps {
  cart: CartItem[];
  onCartChange: (next: CartItem[]) => void;
  onRequestQuote: () => void;
  onContinueShopping: () => void;
}

export default function CartPage({
  cart,
  onCartChange,
  onRequestQuote,
  onContinueShopping,
}: CartPageProps) {
  const totalUnits = cartTotalItems(cart);
  const [qtyInputs, setQtyInputs] = useState<Record<string, string>>({});

  const itemKey = (item: CartItem) => `${item.partId}:${item.variantSuffix ?? ''}`;

  const handleRemove = (item: CartItem) => {
    onCartChange(removeFromCart(cart, item));
    setQtyInputs((prev) => {
      const next = { ...prev };
      delete next[itemKey(item)];
      return next;
    });
  };

  const handleQtyChange = (item: CartItem, delta: number) => {
    const next = item.quantity + delta;
    if (next < 1) {
      handleRemove(item);
      return;
    }
    onCartChange(updateCartItemQty(cart, item, next));
    setQtyInputs((prev) => ({ ...prev, [itemKey(item)]: '' }));
  };

  const handleQtyInputChange = (item: CartItem, value: string) => {
    setQtyInputs((prev) => ({ ...prev, [itemKey(item)]: value }));
  };

  const handleQtyInputBlur = (item: CartItem) => {
    const key = itemKey(item);
    const raw = qtyInputs[key];
    if (raw === '' || raw === undefined) return;
    const parsed = Math.floor(Number(raw));
    if (!Number.isFinite(parsed) || parsed < 1) {
      onCartChange(updateCartItemQty(cart, item, 1));
    } else {
      onCartChange(updateCartItemQty(cart, item, parsed));
    }
    setQtyInputs((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="mb-6 text-2xl font-bold text-white">Cart</h1>

      {cart.length === 0 ? (
        <div className="rounded border border-white/10 bg-white/5 p-8 text-center">
          <p className="text-slate-400">Your cart is empty.</p>
          <Link
            to="/shop"
            onClick={(e) => {
              e.preventDefault();
              onContinueShopping();
            }}
            className="mt-4 inline-block min-h-[44px] touch-manipulation rounded-sm bg-primary px-4 py-3 font-semibold text-white transition-colors hover:bg-primary/90"
          >
            Continue shopping
          </Link>
        </div>
      ) : (
        <>
          <ul className="space-y-4">
            {cart.map((item) => {
              const key = itemKey(item);
              const label = item.variantSuffix
                ? `${item.partNumber}-${item.variantSuffix}`
                : item.partNumber;
              const displayQty =
                qtyInputs[key] !== undefined ? qtyInputs[key] : String(item.quantity);
              return (
                <li
                  key={key}
                  className="flex flex-wrap items-center gap-3 rounded border border-white/10 bg-white/5 p-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-sm font-medium text-white">{label}</p>
                    {item.partName && (
                      <p className="truncate text-xs text-slate-400">{item.partName}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleQtyChange(item, -1)}
                      className="flex h-9 w-9 shrink-0 touch-manipulation items-center justify-center rounded border border-white/10 text-slate-300 hover:bg-white/10"
                      aria-label="Decrease quantity"
                    >
                      <span className="material-symbols-outlined text-lg">remove</span>
                    </button>
                    <input
                      type="number"
                      min={1}
                      value={displayQty}
                      onChange={(e) => handleQtyInputChange(item, e.target.value)}
                      onBlur={() => handleQtyInputBlur(item)}
                      className="w-14 rounded border border-white/10 bg-white/5 px-2 py-1.5 text-center text-sm font-medium text-white focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                      aria-label={`Quantity for ${label}`}
                    />
                    <button
                      type="button"
                      onClick={() => handleQtyChange(item, 1)}
                      className="flex h-9 w-9 shrink-0 touch-manipulation items-center justify-center rounded border border-white/10 text-slate-300 hover:bg-white/10"
                      aria-label="Increase quantity"
                    >
                      <span className="material-symbols-outlined text-lg">add</span>
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemove(item)}
                    className="min-h-[44px] touch-manipulation rounded border border-red-500/30 px-3 text-sm text-red-400 hover:bg-red-500/10"
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="mt-8 border-t border-white/10 pt-6">
            <p className="mb-4 text-sm text-slate-400">
              {totalUnits} unit{totalUnits !== 1 ? 's' : ''} total
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Link
                to="/shop"
                onClick={(e) => {
                  e.preventDefault();
                  onContinueShopping();
                }}
                className="min-h-[48px] touch-manipulation rounded-sm border border-white/20 px-4 py-3 text-center font-semibold text-white transition-colors hover:bg-white/10"
              >
                Continue shopping
              </Link>
              <button
                type="button"
                onClick={onRequestQuote}
                className="min-h-[48px] flex-1 rounded-sm bg-primary px-4 py-3 font-semibold text-white transition-colors hover:bg-primary/90 sm:min-w-[180px] sm:flex-initial"
              >
                Request quote
              </button>
            </div>
          </div>
        </>
      )}
    </main>
  );
}

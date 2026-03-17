import React from 'react';
import { Link } from 'react-router-dom';
import type { CartItem } from './storefrontCart';
import { removeFromCart, updateCartItemQty, cartTotalItems } from './storefrontCart';

interface CartDrawerProps {
  cart: CartItem[];
  onCartChange: (next: CartItem[]) => void;
  onClose: () => void;
  onSubmitQuote: () => void;
}

export default function CartDrawer({
  cart,
  onCartChange,
  onClose,
  onSubmitQuote,
}: CartDrawerProps) {
  const totalUnits = cartTotalItems(cart);

  const handleRemove = (item: CartItem) => {
    onCartChange(removeFromCart(cart, item));
  };

  const handleQtyChange = (item: CartItem, delta: number) => {
    const next = item.quantity + delta;
    if (next < 1) {
      onCartChange(removeFromCart(cart, item));
      return;
    }
    onCartChange(updateCartItemQty(cart, item, next));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-label="Cart"
    >
      <div className="flex w-full max-w-md flex-col bg-[#0f0f14] shadow-xl sm:max-w-sm">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <h2 className="text-lg font-bold text-white">Cart</h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] rounded-sm text-slate-400 hover:bg-white/10 hover:text-white"
            aria-label="Close cart"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {cart.length === 0 ? (
            <p className="py-8 text-center text-slate-400">Your cart is empty.</p>
          ) : (
            <ul className="space-y-3">
              {cart.map((item) => {
                const label = item.variantSuffix
                  ? `${item.partNumber}-${item.variantSuffix}`
                  : item.partNumber;
                return (
                  <li
                    key={`${item.partId}:${item.variantSuffix ?? ''}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border border-white/10 bg-white/5 p-3"
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
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-white/10 text-slate-300 hover:bg-white/10"
                        aria-label="Decrease quantity"
                      >
                        <span className="material-symbols-outlined text-lg">remove</span>
                      </button>
                      <span className="min-w-[2rem] text-center text-sm font-medium text-white">
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleQtyChange(item, 1)}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-white/10 text-slate-300 hover:bg-white/10"
                        aria-label="Increase quantity"
                      >
                        <span className="material-symbols-outlined text-lg">add</span>
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemove(item)}
                      className="min-h-[36px] rounded border border-red-500/30 px-2 text-xs text-red-400 hover:bg-red-500/10"
                    >
                      Remove
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {cart.length > 0 && (
          <div className="border-t border-white/10 p-4">
            <Link
              to="/shop/cart"
              onClick={onClose}
              className="mb-3 block text-center text-sm font-medium text-primary hover:underline"
            >
              View full cart
            </Link>
            <p className="mb-3 text-sm text-slate-400">
              {totalUnits} unit{totalUnits !== 1 ? 's' : ''} total
            </p>
            <button
              type="button"
              onClick={onSubmitQuote}
              className="flex min-h-[48px] w-full items-center justify-center rounded-sm bg-primary py-3 text-base font-semibold text-white transition-colors hover:bg-primary/90"
            >
              Request quote
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

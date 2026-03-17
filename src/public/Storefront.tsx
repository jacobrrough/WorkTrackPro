import React, { useEffect, useState } from 'react';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import PublicHeader from './PublicHeader';
import RequestQuoteModal from './RequestQuoteModal';
import AddToCartModal from './AddToCartModal';
import CartDrawer from './CartDrawer';
import CartPage from './CartPage';
import {
  fetchStoreParts,
  fetchStorePartById,
  type StorePart,
  type StoreVariant,
} from '@/services/api/storefront';
import { getCart, addToCart, setCart as persistCart, type CartItem } from './storefrontCart';
import { useToast } from '@/Toast';

interface StorefrontProps {
  onEmployeeLogin: () => void;
}

type QuoteModalState = { part: StorePart; variantSuffix?: string } | { cart: CartItem[] } | null;

function ProductCard({
  part,
  onRequestQuote,
  onAddToCart,
}: {
  part: StorePart;
  onRequestQuote: (part: StorePart, variantSuffix?: string) => void;
  onAddToCart: (part: StorePart) => void;
}) {
  const firstImage = part.productImages[0];
  const variantPrices = part.variants
    .map((v) => v.pricePerVariant)
    .filter((n): n is number => n != null && Number.isFinite(n));
  const minPrice = variantPrices.length > 0 ? Math.min(...variantPrices) : part.pricePerSet;
  const hasMultiplePrices =
    variantPrices.length > 1 || (part.variants.length > 1 && variantPrices.length >= 1);

  return (
    <article className="flex flex-col overflow-hidden rounded-sm border border-white/10 bg-white/5">
      <Link
        to={`/shop/${part.id}`}
        className="aspect-square w-full bg-white/5 focus:outline-none focus:ring-2 focus:ring-primary"
      >
        {firstImage ? (
          <img src={firstImage.url} alt={part.name} className="h-full w-full object-contain p-2" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-slate-500">
            <span className="material-symbols-outlined text-5xl">precision_manufacturing</span>
          </div>
        )}
      </Link>
      <div className="flex flex-1 flex-col p-3">
        <Link
          to={`/shop/${part.id}`}
          className="font-mono text-sm font-semibold text-primary hover:underline"
        >
          {part.partNumber}
        </Link>
        <Link
          to={`/shop/${part.id}`}
          className="mt-0.5 text-base font-semibold text-white hover:underline"
        >
          {part.name}
        </Link>
        {part.description && (
          <p className="mt-1 line-clamp-2 text-sm text-slate-400">{part.description}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-300">
          {minPrice != null && Number.isFinite(minPrice) ? (
            <>
              {hasMultiplePrices ? (
                <span>From ${minPrice.toFixed(2)}</span>
              ) : part.variants.length === 1 && part.variants[0].pricePerVariant != null ? (
                <span>${part.variants[0].pricePerVariant!.toFixed(2)}</span>
              ) : part.variants.length > 1 ? (
                <span>
                  {part.variants
                    .filter((v) => v.pricePerVariant != null)
                    .map(
                      (v) =>
                        `${part.partNumber}-${v.variantSuffix}: $${v.pricePerVariant!.toFixed(2)}`
                    )
                    .join(' · ')}
                </span>
              ) : (
                <span>${minPrice.toFixed(2)}</span>
              )}
            </>
          ) : (
            <span>Price on request</span>
          )}
        </div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onAddToCart(part);
            }}
            className="flex min-h-[44px] flex-1 touch-manipulation items-center justify-center rounded-sm border border-white/20 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10"
          >
            Add to cart
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onRequestQuote(part);
            }}
            className="flex min-h-[44px] flex-1 touch-manipulation items-center justify-center rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
          >
            Request quote
          </button>
        </div>
      </div>
    </article>
  );
}

function ProductDetail({
  part,
  onRequestQuote,
  onAddToCart,
}: {
  part: StorePart;
  onRequestQuote: (part: StorePart, variantSuffix?: string) => void;
  onAddToCart: (part: StorePart, variantSuffix?: string) => void;
}) {
  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-6">
      <Link
        to="/shop"
        className="inline-flex min-h-[44px] touch-manipulation items-center gap-2 rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-300 hover:bg-white/10"
      >
        <span className="material-symbols-outlined text-lg">arrow_back</span>
        Back to shop
      </Link>

      <div className="overflow-hidden rounded-sm border border-white/10 bg-white/5">
        {part.productImages.length > 0 ? (
          <div className="flex gap-2 overflow-x-auto p-4">
            {part.productImages.map((img) => (
              <img
                key={img.id}
                src={img.url}
                alt={part.name}
                className="h-48 w-auto shrink-0 rounded object-contain"
              />
            ))}
          </div>
        ) : (
          <div className="flex aspect-video items-center justify-center bg-white/5 text-slate-500">
            <span className="material-symbols-outlined text-6xl">precision_manufacturing</span>
          </div>
        )}
        <div className="border-t border-white/10 p-4">
          <p className="font-mono text-sm font-semibold text-primary">{part.partNumber}</p>
          <h1 className="mt-1 text-xl font-bold text-white">{part.name}</h1>
          {part.description && <p className="mt-3 text-slate-300">{part.description}</p>}
        </div>
      </div>

      {part.variants.length > 0 && (
        <div className="rounded-sm border border-white/10 bg-white/5 p-4">
          <h2 className="mb-3 text-base font-semibold text-white">Quote price by variant</h2>
          <ul className="space-y-2">
            {part.variants.map((v: StoreVariant) => (
              <li
                key={v.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-white/10 bg-white/5 px-3 py-2"
              >
                <span className="font-mono text-sm text-slate-200">
                  {part.partNumber}-{v.variantSuffix}
                  {v.name ? ` — ${v.name}` : ''}
                </span>
                {v.pricePerVariant != null && Number.isFinite(v.pricePerVariant) ? (
                  <span className="font-semibold text-white">${v.pricePerVariant.toFixed(2)}</span>
                ) : part.pricePerSet != null && Number.isFinite(part.pricePerSet) ? (
                  <span className="font-semibold text-white">${part.pricePerSet.toFixed(2)}</span>
                ) : (
                  <span className="text-slate-500">Price on request</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => onAddToCart(part)}
          className="flex min-h-[48px] flex-1 touch-manipulation items-center justify-center rounded-sm border border-white/20 bg-white/5 px-4 py-3 text-base font-semibold text-white transition-colors hover:bg-white/10"
        >
          Add to cart
        </button>
        <button
          type="button"
          onClick={() => onRequestQuote(part)}
          className="flex min-h-[48px] flex-1 touch-manipulation items-center justify-center rounded-sm bg-primary px-4 py-3 text-base font-semibold text-white transition-colors hover:bg-primary/90"
        >
          Request quote
        </button>
      </div>
    </div>
  );
}

const Storefront: React.FC<StorefrontProps> = ({ onEmployeeLogin }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const pathname = location.pathname;
  const isCartPage = pathname === '/shop/cart';
  const rawPartId =
    pathname.startsWith('/shop/') && pathname.length > 6
      ? pathname
          .replace(/^\/shop\/?/, '')
          .split('/')[0]
          ?.trim() || null
      : null;
  const partId = isCartPage ? null : rawPartId;

  const [parts, setParts] = useState<StorePart[]>([]);
  const [detailPart, setDetailPart] = useState<StorePart | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(!!partId);
  const [quoteModal, setQuoteModal] = useState<QuoteModalState>(null);
  const [cart, setCartState] = useState<CartItem[]>(() => getCart());
  const [cartOpen, setCartOpen] = useState(false);
  const [addToCartPart, setAddToCartPart] = useState<StorePart | null>(null);
  const [addToCartVariant, setAddToCartVariant] = useState<string | null>(null);
  const { showToast } = useToast();

  const setCart = (next: CartItem[]) => {
    persistCart(next);
    setCartState(next);
  };

  useEffect(() => {
    let cancelled = false;
    fetchStoreParts().then((list) => {
      if (!cancelled) {
        setParts(list);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!partId) {
      setDetailPart(null);
      setDetailLoading(false);
      return;
    }
    setDetailLoading(true);
    let cancelled = false;
    fetchStorePartById(partId).then((p) => {
      if (!cancelled) {
        setDetailPart(p ?? null);
        setDetailLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [partId]);

  const showDetail = partId && (detailPart || detailLoading);

  const totalCartItems = cart.reduce((s, i) => s + i.quantity, 0);

  return (
    <div className="relative min-h-[100dvh] overflow-y-auto bg-[#08090f] text-white">
      <PublicHeader
        onEmployeeLogin={onEmployeeLogin}
        currentPath="shop"
        cartCount={totalCartItems}
      />
      {!isCartPage && (
        <div className="absolute right-4 top-4 flex items-center gap-2 sm:right-6 sm:top-5">
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="relative flex min-h-[44px] min-w-[44px] items-center justify-center rounded-sm border border-white/20 bg-white/5 text-white hover:bg-white/10"
            aria-label={`Cart, ${totalCartItems} items`}
          >
            <span className="material-symbols-outlined">shopping_cart</span>
            {totalCartItems > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-primary px-1 text-xs font-bold text-white">
                {totalCartItems > 99 ? '99+' : totalCartItems}
              </span>
            )}
          </button>
        </div>
      )}

      {cartOpen && (
        <CartDrawer
          cart={cart}
          onCartChange={setCart}
          onClose={() => setCartOpen(false)}
          onSubmitQuote={() => {
            setCartOpen(false);
            setQuoteModal({ cart: [...cart] });
          }}
        />
      )}
      {quoteModal && 'cart' in quoteModal && (
        <RequestQuoteModal
          cart={quoteModal.cart}
          onClose={() => setQuoteModal(null)}
          onSuccess={(message) => {
            showToast(message, 'success');
            setCart([]);
          }}
        />
      )}
      {quoteModal && 'part' in quoteModal && (
        <RequestQuoteModal
          part={quoteModal.part}
          variantSuffix={quoteModal.variantSuffix}
          onClose={() => setQuoteModal(null)}
          onSuccess={(message) => {
            showToast(message, 'success');
          }}
        />
      )}
      {addToCartPart && (
        <AddToCartModal
          part={addToCartPart}
          initialVariantSuffix={addToCartVariant}
          onClose={() => {
            setAddToCartPart(null);
            setAddToCartVariant(null);
          }}
          onAdd={(item) => {
            const next = addToCart(cart, item);
            setCart(next);
            setAddToCartPart(null);
            setAddToCartVariant(null);
            showToast('Added to cart', 'success');
          }}
        />
      )}

      <main className="mx-auto max-w-6xl px-4 py-6">
        {isCartPage ? (
          <CartPage
            cart={cart}
            onCartChange={setCart}
            onRequestQuote={() => setQuoteModal({ cart: [...cart] })}
            onContinueShopping={() => navigate('/shop')}
          />
        ) : showDetail ? (
          detailLoading ? (
            <div className="flex min-h-[40vh] items-center justify-center text-slate-400">
              Loading…
            </div>
          ) : detailPart ? (
            <ProductDetail
              part={detailPart}
              onRequestQuote={(p, variantSuffix) => setQuoteModal({ part: p, variantSuffix })}
              onAddToCart={(p, variantSuffix) => {
                setAddToCartPart(p);
                setAddToCartVariant(variantSuffix ?? null);
              }}
            />
          ) : (
            <div className="py-12 text-center">
              <p className="text-slate-400">Product not found.</p>
              <a href="/shop" className="mt-3 inline-block text-primary hover:underline">
                Back to shop
              </a>
            </div>
          )
        ) : (
          <>
            <h2 className="mb-4 text-2xl font-bold text-white">Shop</h2>
            {loading ? (
              <div className="flex min-h-[40vh] items-center justify-center text-slate-400">
                Loading…
              </div>
            ) : parts.length === 0 ? (
              <div className="py-12 text-center text-slate-400">
                <span className="material-symbols-outlined text-5xl">storefront</span>
                <p className="mt-4">No products on the store yet.</p>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {parts.map((part) => (
                  <ProductCard
                    key={part.id}
                    part={part}
                    onRequestQuote={(p) => setQuoteModal({ part: p })}
                    onAddToCart={(p) => {
                      setAddToCartPart(p);
                      setAddToCartVariant(null);
                    }}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
};

export default Storefront;

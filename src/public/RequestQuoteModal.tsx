import React, { useEffect, useRef, useState } from 'react';
import type { StorePart } from '@/services/api/storefront';
import type { CartItem } from './storefrontCart';

declare global {
  interface Window {
    turnstile?: {
      render: (el: string | HTMLElement, options: Record<string, unknown>) => string;
      remove: (widgetId?: string) => void;
    };
  }
}

const TURNSTILE_SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim();

interface RequestQuoteModalPropsSingle {
  part: StorePart;
  variantSuffix?: string;
  cart?: null;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

interface RequestQuoteModalPropsCart {
  part?: null;
  variantSuffix?: undefined;
  cart: CartItem[];
  onClose: () => void;
  onSuccess: (message: string) => void;
}

type RequestQuoteModalProps = RequestQuoteModalPropsSingle | RequestQuoteModalPropsCart;

function isCartMode(props: RequestQuoteModalProps): props is RequestQuoteModalPropsCart {
  return (
    Array.isArray((props as RequestQuoteModalPropsCart).cart) &&
    (props as RequestQuoteModalPropsCart).cart.length > 0
  );
}

export default function RequestQuoteModal(props: RequestQuoteModalProps) {
  const { onClose, onSuccess } = props;
  const part = !isCartMode(props) ? props.part : null;
  const variantSuffix = !isCartMode(props) ? props.variantSuffix : undefined;
  const cart = isCartMode(props) ? props.cart : null;

  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [selectedVariantSuffix, setSelectedVariantSuffix] = useState<string | undefined>(
    variantSuffix
  );
  const [turnstileToken, setTurnstileToken] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const turnstileWidgetIdRef = useRef<string | null>(null);
  const turnstileContainerRef = useRef<HTMLDivElement | null>(null);

  const effectiveVariant = selectedVariantSuffix ?? variantSuffix;
  const cartMode = isCartMode(props);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    const ensureWidget = () => {
      if (!window.turnstile || !turnstileContainerRef.current) return;
      if (turnstileWidgetIdRef.current) {
        window.turnstile.remove(turnstileWidgetIdRef.current);
      }
      turnstileWidgetIdRef.current = window.turnstile.render(turnstileContainerRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (token: string) => setTurnstileToken(token),
        'expired-callback': () => setTurnstileToken(''),
        'error-callback': () => setTurnstileToken(''),
        theme: 'dark',
      });
    };
    if (window.turnstile) {
      ensureWidget();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.onload = ensureWidget;
    document.head.appendChild(script);
    return () => {
      script.remove();
      if (window.turnstile && turnstileWidgetIdRef.current) {
        window.turnstile.remove(turnstileWidgetIdRef.current);
      }
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    if (!contactName.trim() || !email.trim() || !phone.trim()) {
      setErrorMessage('Please fill in contact name, email, and phone.');
      return;
    }
    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      setErrorMessage('Please complete the security check.');
      return;
    }

    setIsSubmitting(true);
    try {
      let body: Record<string, unknown>;
      if (cartMode && cart) {
        body = {
          contactName: contactName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          description: 'Store quote (cart)',
          ...(TURNSTILE_SITE_KEY && turnstileToken ? { turnstileToken } : {}),
          files: [],
          cart: cart.map((item) => ({
            partId: item.partId,
            partNumber: item.partNumber,
            partName: item.partName,
            variantSuffix: item.variantSuffix,
            quantity: item.quantity,
          })),
        };
      } else if (part) {
        const qty = Math.max(1, Math.floor(Number(quantity)) || 1);
        const partLabel = effectiveVariant
          ? `${part.partNumber}-${effectiveVariant}`
          : part.partNumber;
        const description = [
          'Store quote request',
          '',
          `Part: ${partLabel}`,
          `Part name: ${part.name}`,
          `Quantity: ${qty}`,
          '',
          `Contact: ${contactName.trim()}`,
          `Email: ${email.trim()}`,
          `Phone: ${phone.trim()}`,
        ].join('\n');
        body = {
          contactName: contactName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          description,
          ...(TURNSTILE_SITE_KEY && turnstileToken ? { turnstileToken } : {}),
          files: [],
          partId: part.id,
          partNumber: part.partNumber,
          quantity: qty,
          variantSuffix: effectiveVariant ?? null,
        };
      } else {
        setErrorMessage('Nothing to submit.');
        setIsSubmitting(false);
        return;
      }

      const apiOrigin = (import.meta.env.VITE_API_ORIGIN as string) || '';
      const response = await fetch(`${apiOrigin}/api/submit-proposal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        jobCode?: number;
      };
      if (!response.ok) {
        throw new Error(data?.error ?? 'Submission failed.');
      }
      onSuccess(`Quote request submitted. Job #${data?.jobCode ?? ''} is in To Be Quoted.`);
      onClose();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="request-quote-title"
    >
      <div className="w-full max-w-md rounded-lg border border-white/10 bg-[#0f0f14] p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="request-quote-title" className="text-lg font-bold text-white">
            {cartMode ? 'Submit quote request' : 'Request quote'}
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
        {cartMode && cart ? (
          <p className="mb-4 text-sm text-slate-300">
            Requesting quote for {cart.length} item(s) ({cart.reduce((s, i) => s + i.quantity, 0)}{' '}
            total units)
          </p>
        ) : part ? (
          <p className="mb-4 text-sm text-slate-300">
            {part.partNumber}
            {effectiveVariant ? `-${effectiveVariant}` : ''} — {part.name}
          </p>
        ) : null}
        <form onSubmit={handleSubmit} className="space-y-4">
          {!cartMode && part && part.variants.length > 1 && (
            <label className="block">
              <span className="mb-1 block text-sm text-slate-400">Variant</span>
              <select
                value={selectedVariantSuffix ?? ''}
                onChange={(e) => setSelectedVariantSuffix(e.target.value || undefined)}
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
          )}
          {!cartMode && part && (
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
          )}
          <label className="block">
            <span className="mb-1 block text-sm text-slate-400">Contact name *</span>
            <input
              type="text"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              className="w-full rounded-sm border border-white/10 bg-[#1a1e31] px-3 py-2 text-white focus:border-primary/60 focus:outline-none"
              required
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-slate-400">Email *</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-sm border border-white/10 bg-[#1a1e31] px-3 py-2 text-white focus:border-primary/60 focus:outline-none"
              required
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-slate-400">Phone *</span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-sm border border-white/10 bg-[#1a1e31] px-3 py-2 text-white focus:border-primary/60 focus:outline-none"
              required
            />
          </label>
          {TURNSTILE_SITE_KEY && (
            <div ref={turnstileContainerRef} className="flex justify-center" />
          )}
          {errorMessage && <p className="text-sm text-red-400">{errorMessage}</p>}
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
              disabled={isSubmitting || (!!TURNSTILE_SITE_KEY && !turnstileToken)}
              className="min-h-[44px] flex-1 rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {isSubmitting ? 'Submitting…' : 'Submit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

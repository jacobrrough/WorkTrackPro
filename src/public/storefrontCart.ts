const CART_KEY = 'worktrack-storefront-cart';

export interface CartItem {
  partId: string;
  partNumber: string;
  partName: string;
  variantSuffix: string | null;
  quantity: number;
}

export function getCart(): CartItem[] {
  try {
    const raw = sessionStorage.getItem(CART_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is CartItem =>
        item &&
        typeof item === 'object' &&
        typeof item.partId === 'string' &&
        typeof item.partNumber === 'string' &&
        typeof item.partName === 'string' &&
        (item.variantSuffix === null || typeof item.variantSuffix === 'string') &&
        typeof item.quantity === 'number' &&
        item.quantity >= 1
    );
  } catch {
    return [];
  }
}

export function setCart(items: CartItem[]): void {
  const normalized = items.filter((i) => i.quantity >= 1);
  sessionStorage.setItem(CART_KEY, JSON.stringify(normalized));
}

function itemKey(item: CartItem): string {
  return `${item.partId}:${item.variantSuffix ?? ''}`;
}

export function addToCart(cart: CartItem[], item: CartItem): CartItem[] {
  const key = itemKey(item);
  const existing = cart.find((i) => itemKey(i) === key);
  const qty = Math.max(1, Math.floor(item.quantity) || 1);
  let next: CartItem[];
  if (existing) {
    next = cart.map((i) => (itemKey(i) === key ? { ...i, quantity: i.quantity + qty } : i));
  } else {
    next = [...cart, { ...item, quantity: qty }];
  }
  setCart(next);
  return next;
}

export function removeFromCart(cart: CartItem[], item: CartItem): CartItem[] {
  const key = itemKey(item);
  const next = cart.filter((i) => itemKey(i) !== key);
  setCart(next);
  return next;
}

export function updateCartItemQty(cart: CartItem[], item: CartItem, quantity: number): CartItem[] {
  const qty = Math.max(1, Math.floor(quantity) || 1);
  const key = itemKey(item);
  const next = cart.map((i) => (itemKey(i) === key ? { ...i, quantity: qty } : i));
  setCart(next);
  return next;
}

export function cartTotalItems(cart: CartItem[]): number {
  return cart.reduce((sum, i) => sum + i.quantity, 0);
}

/** Aggregate cart by part for job_parts: partId -> dash_quantities (variantSuffix -> qty) */
export function cartToDashQuantitiesByPart(cart: CartItem[]): Map<string, Record<string, number>> {
  const byPart = new Map<string, Record<string, number>>();
  for (const item of cart) {
    const key = item.partId;
    const suffix = item.variantSuffix ?? '';
    const prev = byPart.get(key) ?? {};
    prev[suffix] = (prev[suffix] ?? 0) + item.quantity;
    byPart.set(key, prev);
  }
  return byPart;
}

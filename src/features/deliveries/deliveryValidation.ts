import type { DeliveryLineItem } from '@/core/types';

/** Build the map key used to look up the remaining quantity for a part/variant. */
export function deliveryLineKey(partNumber?: string, variantSuffix?: string): string {
  return `${partNumber ?? ''}|${variantSuffix ?? ''}`;
}

export interface DeliveryQuantityError {
  /** Index of the offending line within the input array. */
  index: number;
  partNumber?: string;
  variantSuffix?: string;
  quantity: number;
  remaining: number;
}

/**
 * Validate that no delivery line ships more than the remaining quantity for its
 * part/variant. `remainingByKey` is keyed by {@link deliveryLineKey}; a key that
 * is absent (or maps to a non-finite value) is treated as unbounded — this covers
 * zero-ordered parts and ad-hoc custom lines, which have no cap. Quantity equal to
 * the remaining amount is allowed; only strictly-greater quantities are errors.
 */
export function validateDeliveryQuantities(
  lines: Pick<DeliveryLineItem, 'partNumber' | 'variantSuffix' | 'quantity'>[],
  remainingByKey: Record<string, number>
): DeliveryQuantityError[] {
  const errors: DeliveryQuantityError[] = [];
  lines.forEach((line, index) => {
    const key = deliveryLineKey(line.partNumber, line.variantSuffix);
    const remaining = remainingByKey[key];
    // Unbounded when no remaining is tracked for this key (e.g. zero-ordered / custom line).
    if (remaining == null || !Number.isFinite(remaining)) return;
    const quantity = Number(line.quantity) || 0;
    if (quantity > remaining) {
      errors.push({
        index,
        partNumber: line.partNumber,
        variantSuffix: line.variantSuffix,
        quantity,
        remaining,
      });
    }
  });
  return errors;
}

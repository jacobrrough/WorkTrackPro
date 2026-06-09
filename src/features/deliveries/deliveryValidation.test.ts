import { describe, expect, it } from 'vitest';
import { deliveryLineKey, validateDeliveryQuantities } from './deliveryValidation';

describe('deliveryLineKey', () => {
  it('joins part number and variant suffix', () => {
    expect(deliveryLineKey('ABC', '01')).toBe('ABC|01');
  });

  it('treats missing parts/variants as empty segments', () => {
    expect(deliveryLineKey(undefined, undefined)).toBe('|');
    expect(deliveryLineKey('ABC', undefined)).toBe('ABC|');
  });
});

describe('validateDeliveryQuantities', () => {
  it('flags a line shipping more than the remaining quantity', () => {
    const lines = [{ partNumber: 'ABC', variantSuffix: '01', quantity: 6 }];
    const remaining = { 'ABC|01': 5 };

    const errors = validateDeliveryQuantities(lines, remaining);

    expect(errors).toEqual([
      { index: 0, partNumber: 'ABC', variantSuffix: '01', quantity: 6, remaining: 5 },
    ]);
  });

  it('allows shipping exactly the remaining quantity', () => {
    const lines = [{ partNumber: 'ABC', variantSuffix: '01', quantity: 5 }];
    const remaining = { 'ABC|01': 5 };

    expect(validateDeliveryQuantities(lines, remaining)).toEqual([]);
  });

  it('allows shipping fewer than the remaining quantity', () => {
    const lines = [{ partNumber: 'ABC', variantSuffix: '01', quantity: 2 }];
    const remaining = { 'ABC|01': 5 };

    expect(validateDeliveryQuantities(lines, remaining)).toEqual([]);
  });

  it('treats a part with no tracked remaining (zero-ordered) as unbounded', () => {
    const lines = [{ partNumber: 'CUSTOM', variantSuffix: undefined, quantity: 999 }];

    // No key present for this line => no cap.
    expect(validateDeliveryQuantities(lines, {})).toEqual([]);
  });

  it('treats a non-finite remaining as unbounded', () => {
    const lines = [{ partNumber: 'ABC', variantSuffix: '01', quantity: 999 }];
    const remaining = { 'ABC|01': Number.POSITIVE_INFINITY };

    expect(validateDeliveryQuantities(lines, remaining)).toEqual([]);
  });

  it('reports only the offending lines when a mix is present', () => {
    const lines = [
      { partNumber: 'ABC', variantSuffix: '01', quantity: 3 }, // under -> ok
      { partNumber: 'ABC', variantSuffix: '02', quantity: 5 }, // exact -> ok
      { partNumber: 'DEF', variantSuffix: undefined, quantity: 8 }, // over -> error
      { partNumber: 'CUSTOM', variantSuffix: undefined, quantity: 100 }, // unbounded -> ok
    ];
    const remaining = { 'ABC|01': 5, 'ABC|02': 5, 'DEF|': 4 };

    const errors = validateDeliveryQuantities(lines, remaining);

    expect(errors).toEqual([
      { index: 2, partNumber: 'DEF', variantSuffix: undefined, quantity: 8, remaining: 4 },
    ]);
  });

  it('coerces non-numeric quantities to zero (never an over-delivery)', () => {
    const lines = [
      { partNumber: 'ABC', variantSuffix: '01', quantity: Number.NaN as unknown as number },
    ];
    const remaining = { 'ABC|01': 5 };

    expect(validateDeliveryQuantities(lines, remaining)).toEqual([]);
  });
});

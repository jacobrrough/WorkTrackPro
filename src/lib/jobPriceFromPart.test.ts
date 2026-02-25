import { describe, expect, it } from 'vitest';
import type { Part, PartVariant } from '@/core/types';
import { calculateJobPriceFromPart, deriveSetCountFromDashQuantities } from './jobPriceFromPart';

const makeVariant = (id: string, suffix: string, pricePerVariant?: number): PartVariant => ({
  id,
  partId: 'part-1',
  variantSuffix: suffix,
  pricePerVariant,
});

const makePart = (
  overrides: Partial<Part & { variants?: PartVariant[] }> = {}
): Part & { variants?: PartVariant[] } => ({
  id: 'part-1',
  partNumber: 'SK-1000',
  name: 'Seat Kit',
  pricePerSet: 100,
  setComposition: { '-01': 1, '-02': 1 },
  variants: [makeVariant('v1', '01', 60), makeVariant('v2', '02', 40)],
  ...overrides,
});

describe('deriveSetCountFromDashQuantities', () => {
  it('returns exact set count when dash quantities match set composition ratio', () => {
    const setCount = deriveSetCountFromDashQuantities(
      { '-01': 1, '-02': 2 },
      { '-01': 3, '-02': 6 }
    );
    expect(setCount).toBe(3);
  });

  it('returns null when dash quantities do not match set composition ratio', () => {
    const setCount = deriveSetCountFromDashQuantities(
      { '-01': 1, '-02': 2 },
      { '-01': 3, '-02': 5 }
    );
    expect(setCount).toBeNull();
  });
});

describe('calculateJobPriceFromPart', () => {
  it('uses variant prices when all selected variants have price', () => {
    const result = calculateJobPriceFromPart(makePart(), { '-01': 2, '-02': 3 });
    expect(result).not.toBeNull();
    expect(result?.source).toBe('variant_prices');
    expect(result?.totalPrice).toBe(240); // (2*60) + (3*40)
  });

  it('uses set price when quantities map to whole sets', () => {
    const part = makePart({
      variants: [makeVariant('v1', '01'), makeVariant('v2', '02')],
      pricePerSet: 150,
      setComposition: { '-01': 1, '-02': 2 },
    });
    const result = calculateJobPriceFromPart(part, { '-01': 2, '-02': 4 });
    expect(result).not.toBeNull();
    expect(result?.source).toBe('set_price');
    expect(result?.setCount).toBe(2);
    expect(result?.totalPrice).toBe(300);
  });

  it('falls back to derived set-price distribution when variants miss prices', () => {
    const part = makePart({
      variants: [makeVariant('v1', '01', 60), makeVariant('v2', '02')],
      pricePerSet: 120,
      setComposition: { '-01': 1, '-02': 2 },
    });
    const result = calculateJobPriceFromPart(part, { '-01': 1, '-02': 1 });
    expect(result).not.toBeNull();
    expect(result?.source).toBe('derived_set_price');
    // -01 priced from variant (60), -02 derived as 120*(2/3)=80 => 60 + 80
    expect(result?.totalPrice).toBe(140);
    expect(result?.missingVariantPrices).toContain('-02');
  });

  it('uses implicit one-per-variant set composition when none is defined', () => {
    const part = makePart({
      setComposition: null,
      variants: [makeVariant('v1', '01'), makeVariant('v2', '02')],
      pricePerSet: 80,
    });
    const result = calculateJobPriceFromPart(part, { '-01': 2, '-02': 2 });
    expect(result).not.toBeNull();
    expect(result?.source).toBe('set_price');
    expect(result?.setCount).toBe(2);
    expect(result?.totalPrice).toBe(160);
  });
});

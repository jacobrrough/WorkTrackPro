import { describe, it, expect } from 'vitest';
import {
  buildDashQuantitiesFromSetCount,
  getEffectiveSetComposition,
  type PartWithVariants,
} from './partAllocation';

/** Minimal part fixture — only the fields these helpers read. */
const makePart = (
  variantSuffixes: string[],
  setComposition?: Record<string, number> | null
): PartWithVariants =>
  ({
    partNumber: 'SK-1',
    variants: variantSuffixes.map((s, i) => ({ id: `v${i}`, variantSuffix: s })),
    setComposition,
  }) as unknown as PartWithVariants;

describe('getEffectiveSetComposition', () => {
  it('returns the explicit set composition when present', () => {
    const part = makePart(['01', '02'], { '-01': 2, '-02': 1 });
    expect(getEffectiveSetComposition(part)).toEqual({ '-01': 2, '-02': 1 });
  });

  it("strips the '_' no-variant sentinel", () => {
    const part = makePart(['01'], { _: 5, '-01': 2 });
    expect(getEffectiveSetComposition(part)).toEqual({ '-01': 2 });
  });

  it('falls back to one of each variant when there is no set composition', () => {
    const part = makePart(['01', '02']);
    expect(getEffectiveSetComposition(part)).toEqual({ '-01': 1, '-02': 1 });
  });

  it('returns null when the part has no variants', () => {
    expect(getEffectiveSetComposition(makePart([]))).toBeNull();
  });
});

describe('buildDashQuantitiesFromSetCount', () => {
  it('multiplies the set composition by the set count', () => {
    const part = makePart(['01', '02'], { '-01': 2, '-02': 1 });
    expect(buildDashQuantitiesFromSetCount(part, 3)).toEqual({ '-01': 6, '-02': 3 });
  });

  it('uses the one-each fallback when there is no explicit composition', () => {
    const part = makePart(['01', '02']);
    expect(buildDashQuantitiesFromSetCount(part, 2)).toEqual({ '-01': 2, '-02': 2 });
  });

  it('returns empty for zero/negative counts or parts without variants', () => {
    const part = makePart(['01'], { '-01': 2 });
    expect(buildDashQuantitiesFromSetCount(part, 0)).toEqual({});
    expect(buildDashQuantitiesFromSetCount(part, -1)).toEqual({});
    expect(buildDashQuantitiesFromSetCount(makePart([]), 5)).toEqual({});
  });
});

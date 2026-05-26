import { describe, expect, it } from 'vitest';
import type { Part, PartMaterial, PartVariant } from '@/core/types';
import { computeRequiredMaterials } from './materialFromPart';

type VariantPart = Part & {
  variants?: PartVariant[];
  setComposition?: Record<string, number> | null;
  variantsAreCopies?: boolean;
};

const makeMaterial = (
  id: string,
  inventoryId: string,
  quantityPerUnit: number,
  usageType?: 'per_set' | 'per_variant',
  unit: string = 'ea'
): PartMaterial => ({
  id,
  partId: 'part-master',
  inventoryId,
  quantityPerUnit,
  unit,
  usageType,
});

const makeVariantMaterial = (
  id: string,
  partVariantId: string,
  inventoryId: string,
  quantityPerUnit: number,
  usageType?: 'per_set' | 'per_variant',
  unit: string = 'ea'
): PartMaterial =>
  ({
    id,
    partVariantId,
    inventoryId,
    quantityPerUnit,
    unit,
    usageType,
  }) as unknown as PartMaterial;

const makeMasterPart = (
  materials: PartMaterial[]
): Part & { variants?: []; materials: PartMaterial[] } => ({
  id: 'part-master',
  partNumber: 'SK-9000',
  name: 'Master Part',
  rev: '01',
  materials,
  variants: [],
});

interface MakeVariantPartArgs {
  id?: string;
  partNumber?: string;
  name?: string;
  variants: Array<{
    id: string;
    variantSuffix: string;
    materials: PartMaterial[];
  }>;
  setComposition?: Record<string, number> | null;
  materials?: PartMaterial[];
  variantsAreCopies?: boolean;
}

const makeVariantPart = (args: MakeVariantPartArgs): VariantPart =>
  ({
    id: args.id ?? 'part-variant',
    partNumber: args.partNumber ?? 'SK-1000',
    name: args.name ?? 'Variant Part',
    variants: args.variants as unknown as PartVariant[],
    setComposition: args.setComposition,
    materials: args.materials ?? [],
    variantsAreCopies: args.variantsAreCopies,
  }) as unknown as VariantPart;

describe('computeRequiredMaterials', () => {
  it('returns an empty map when totalQty is zero (early return)', () => {
    const part = makeMasterPart([makeMaterial('m1', 'inv-1', 2, 'per_set')]);
    const result = computeRequiredMaterials(part, {});
    expect(result.size).toBe(0);
  });

  it('uses part-level materials for no-variant parts even when usageType is per_variant', () => {
    const part = makeMasterPart([
      makeMaterial('m1', 'inv-1', 2, 'per_variant'),
      makeMaterial('m2', 'inv-2', 1.5, 'per_set'),
    ]);

    const result = computeRequiredMaterials(part, { '-01': 4 });

    expect(result.get('inv-1')?.quantity).toBe(8);
    expect(result.get('inv-2')?.quantity).toBe(6);
  });

  it('includes variant-linked materials even when usageType is per_set', () => {
    const part = makeVariantPart({
      id: 'part-variant',
      variants: [
        {
          id: 'v-1',
          variantSuffix: '01',
          materials: [makeVariantMaterial('vm-1', 'v-1', 'inv-1', 2, 'per_set')],
        },
      ],
      setComposition: { '-01': 1 },
    });

    const result = computeRequiredMaterials(part, { '-01': 3 });
    expect(result.get('inv-1')?.quantity).toBe(6);
  });

  it('shows per_set materials using totalQty when job only covers a subset of set composition variants', () => {
    const part = makeVariantPart({
      id: 'part-multi',
      partNumber: 'SK-2000',
      name: 'Multi-Variant Part',
      variants: [
        { id: 'v-1', variantSuffix: '01', materials: [] },
        { id: 'v-2', variantSuffix: '02', materials: [] },
      ],
      setComposition: { '-01': 8, '-02': 8 },
      materials: [makeMaterial('pm-1', 'inv-material', 1, 'per_set')],
    });

    // Job only has -01 quantities (incomplete set by setComposition rules).
    // Should fall back to totalQty (16) instead of completeSets (0).
    const result = computeRequiredMaterials(part, { '-01': 16 });
    expect(result.get('inv-material')?.quantity).toBe(16);
  });

  it('uses completeSets as multiplier when all set composition variants are present', () => {
    // Two materials: qpu=1 isolates the multiplier (= completeSets directly),
    // qpu=2 verifies multiplication still happens correctly.
    const part = makeVariantPart({
      id: 'part-multi',
      partNumber: 'SK-2000',
      name: 'Multi-Variant Part',
      variants: [
        { id: 'v-1', variantSuffix: '01', materials: [] },
        { id: 'v-2', variantSuffix: '02', materials: [] },
      ],
      setComposition: { '-01': 8, '-02': 8 },
      materials: [
        makeMaterial('pm-1', 'inv-material', 2, 'per_set'),
        makeMaterial('pm-probe', 'inv-multiplier-probe', 1, 'per_set'),
      ],
    });

    // Both variants present: 16 of each → 2 complete sets.
    const result = computeRequiredMaterials(part, { '-01': 16, '-02': 16 });
    // Independent verification: qpu=1 means quantity equals the multiplier itself.
    expect(result.get('inv-multiplier-probe')?.quantity).toBe(2);
    // Then qpu=2 × 2 sets = 4.
    expect(result.get('inv-material')?.quantity).toBe(4);
  });

  it('treats setComposition with only the "_" sentinel as no set composition and uses totalQty', () => {
    const part = makeVariantPart({
      id: 'part-sentinel',
      partNumber: 'SK-3000',
      name: 'Sentinel Part',
      variants: [{ id: 'v-1', variantSuffix: '01', materials: [] }],
      setComposition: { _: 16 },
      materials: [makeMaterial('pm-1', 'inv-wire', 2, 'per_set', 'ft')],
    });

    // setComposition = { '_': 16 } → stripped to empty → activeSetComposition = null → totalQty = 5 → 2 × 5 = 10.
    const result = computeRequiredMaterials(part, { '-01': 5 });
    expect(result.get('inv-wire')?.quantity).toBe(10);
    expect(result.get('inv-wire')?.unit).toBe('ft');
  });

  it('uses completeSets when setComposition has mixed real and "_" sentinel keys', () => {
    // Two materials: qpu=1 isolates the multiplier, qpu=2 verifies multiplication.
    // '_' is stripped before calculateSetCompletion is called.
    const part = makeVariantPart({
      id: 'part-mixed',
      partNumber: 'SK-4000',
      name: 'Mixed Sentinel Part',
      variants: [
        { id: 'v-1', variantSuffix: '01', materials: [] },
        { id: 'v-2', variantSuffix: '02', materials: [] },
      ],
      setComposition: { '-01': 4, '-02': 4, _: 8 },
      materials: [
        makeMaterial('pm-1', 'inv-bolt', 1, 'per_set'),
        makeMaterial('pm-2', 'inv-bolt-x2', 2, 'per_set'),
      ],
    });

    // Real keys: -01 and -02 both satisfied (8 each → 2 sets). '_' is ignored.
    const result = computeRequiredMaterials(part, { '-01': 8, '-02': 8 });
    expect(result.get('inv-bolt')?.quantity).toBe(2); // 1 × 2 sets
    expect(result.get('inv-bolt-x2')?.quantity).toBe(4); // 2 × 2 sets
  });

  it('skips part-level per_set materials when variantsAreCopies is true', () => {
    // With variantsAreCopies, the single source of truth is the variant materials.
    // Part-level per_set rows must NOT be added on top.
    const part = makeVariantPart({
      id: 'part-copies',
      partNumber: 'SK-5000',
      name: 'Copies Part',
      variants: [
        {
          id: 'v-1',
          variantSuffix: '01',
          materials: [makeVariantMaterial('vm-1', 'v-1', 'inv-variant', 1, 'per_variant')],
        },
        { id: 'v-2', variantSuffix: '02', materials: [] },
      ],
      setComposition: { '-01': 1, '-02': 1 },
      materials: [makeMaterial('pm-1', 'inv-should-skip', 5, 'per_set')],
      variantsAreCopies: true,
    });

    const result = computeRequiredMaterials(part, { '-01': 3, '-02': 4 });
    // Variant materials applied to BOTH dash entries (first variant's materials used for all).
    expect(result.get('inv-variant')?.quantity).toBe(7);
    // Part-level per_set must be absent.
    expect(result.has('inv-should-skip')).toBe(false);
  });

  it('accumulates quantities (+=) when the same inventoryId appears in multiple per_set rows', () => {
    const part = makeVariantPart({
      id: 'part-accum',
      partNumber: 'SK-6000',
      name: 'Accumulation Part',
      variants: [
        { id: 'v-1', variantSuffix: '01', materials: [] },
        { id: 'v-2', variantSuffix: '02', materials: [] },
      ],
      setComposition: { '-01': 1, '-02': 1 },
      materials: [
        makeMaterial('pm-a', 'inv-shared', 1, 'per_set'),
        makeMaterial('pm-b', 'inv-shared', 3, 'per_set'),
      ],
    });

    // Both variants present at 2 each → 2 complete sets.
    // Row A: 1 × 2 = 2. Row B: 3 × 2 = 6. Sum = 8.
    const result = computeRequiredMaterials(part, { '-01': 2, '-02': 2 });
    expect(result.get('inv-shared')?.quantity).toBe(8);
  });
});

import { describe, expect, it } from 'vitest';
import type { Part, PartMaterial } from '@/core/types';
import { computeRequiredMaterials } from './materialFromPart';

const makeMaterial = (
  id: string,
  inventoryId: string,
  quantityPerUnit: number,
  usageType?: 'per_set' | 'per_variant'
): PartMaterial => ({
  id,
  partId: 'part-master',
  inventoryId,
  quantityPerUnit,
  unit: 'ea',
  usageType,
});

const makeMasterPart = (
  materials: PartMaterial[]
): Part & { variants?: []; materials: PartMaterial[] } => ({
  id: 'part-master',
  partNumber: 'SK-9000',
  name: 'Master Part',
  materials,
  variants: [],
});

describe('computeRequiredMaterials', () => {
  it('uses part-level materials for no-variant parts even when usageType is per_variant', () => {
    const part = makeMasterPart([
      makeMaterial('m1', 'inv-1', 2, 'per_variant'),
      makeMaterial('m2', 'inv-2', 1.5, 'per_set'),
    ]);

    const result = computeRequiredMaterials(part, { '-01': 4 });

    expect(result.get('inv-1')?.quantity).toBe(8);
    expect(result.get('inv-2')?.quantity).toBe(6);
  });
});

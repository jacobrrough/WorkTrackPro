import { useMemo } from 'react';
import type { InventoryItem, JobInventoryItem, Part } from '../../../core/types';
import { computeMaterialCosts } from './materialCostUtils';

interface UseMaterialCostsParams {
  linkedPart: Part | null;
  selectedVariantSuffix?: string;
  dashQuantities: Record<string, number>;
  inventoryById: Map<string, InventoryItem>;
  jobInventoryItems: JobInventoryItem[];
  materialUpcharge: number;
  isAdmin: boolean;
}

export function useMaterialCosts({
  linkedPart,
  selectedVariantSuffix,
  dashQuantities,
  inventoryById,
  jobInventoryItems,
  materialUpcharge,
  isAdmin,
}: UseMaterialCostsParams): Map<string, number> {
  return useMemo(
    () =>
      computeMaterialCosts({
        isAdmin,
        linkedPart,
        selectedVariantSuffix,
        dashQuantities,
        inventoryById,
        jobInventoryItems,
        materialUpcharge,
      }),
    [
      isAdmin,
      linkedPart,
      selectedVariantSuffix,
      dashQuantities,
      inventoryById,
      jobInventoryItems,
      materialUpcharge,
    ]
  );
}

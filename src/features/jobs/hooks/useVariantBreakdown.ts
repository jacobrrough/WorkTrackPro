import { useMemo } from 'react';
import type { Part } from '../../../core/types';
import { computeVariantBreakdown } from '../../../lib/variantAllocation';
import { buildPersistedVariantBreakdowns } from './variantBreakdownUtils';

interface UseVariantBreakdownParams {
  part: Part | null;
  dashQuantities: Record<string, number>;
  source: 'variant' | 'total';
  totalLaborHours: number;
  totalCncHours: number;
  totalPrinter3DHours: number;
  laborOverridePerUnit: Record<string, number>;
  machineOverridePerUnit: Record<
    string,
    { cncHoursPerUnit?: number; printer3DHoursPerUnit?: number }
  >;
}

export function useVariantBreakdown({
  part,
  dashQuantities,
  source,
  totalLaborHours,
  totalCncHours,
  totalPrinter3DHours,
  laborOverridePerUnit,
  machineOverridePerUnit,
}: UseVariantBreakdownParams) {
  const variantAllocation = useMemo(
    () =>
      computeVariantBreakdown({
        part,
        dashQuantities,
        source,
        totalLaborHours,
        totalCncHours,
        totalPrinter3DHours,
        laborOverridePerUnit,
        machineOverridePerUnit,
      }),
    [
      part,
      dashQuantities,
      source,
      totalLaborHours,
      totalCncHours,
      totalPrinter3DHours,
      laborOverridePerUnit,
      machineOverridePerUnit,
    ]
  );

  const laborBreakdownByDash = useMemo(() => {
    if (variantAllocation.entries.length === 0) return null;
    return {
      entries: variantAllocation.entries,
      totalFromDash: variantAllocation.totals.laborHours,
      totalCncFromDash: variantAllocation.totals.cncHours,
      totalPrinter3DFromDash: variantAllocation.totals.printer3DHours,
    };
  }, [variantAllocation]);

  const { persistedLaborBreakdown, persistedMachineBreakdown } = useMemo(
    () => buildPersistedVariantBreakdowns(variantAllocation.entries),
    [variantAllocation.entries]
  );

  return {
    variantAllocation,
    laborBreakdownByDash,
    persistedLaborBreakdown,
    persistedMachineBreakdown,
  };
}

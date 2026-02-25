import type { Part, PartVariant } from '@/core/types';
import {
  buildDistributionWeights,
  getDashQuantity,
  normalizeDashQuantities,
  normalizeVariantSuffix,
  toDashSuffix,
} from '@/lib/variantMath';

export interface VariantRuntimeBreakdown {
  suffix: string;
  qty: number;
  laborHoursPerUnit: number;
  laborHoursTotal: number;
  cncHoursPerUnit: number;
  cncHoursTotal: number;
  printer3DHoursPerUnit: number;
  printer3DHoursTotal: number;
}

export interface VariantBreakdownTotals {
  laborHours: number;
  cncHours: number;
  printer3DHours: number;
}

export type VariantAllocationSource = 'variant' | 'total';

type LaborOverride = Record<string, number>;
type MachineOverride = Record<string, { cncHoursPerUnit?: number; printer3DHoursPerUnit?: number }>;

function getVariantBySuffix(
  part: (Part & { variants?: PartVariant[] }) | null,
  suffix: string
): PartVariant | undefined {
  if (!part?.variants?.length) return undefined;
  const normalized = normalizeVariantSuffix(suffix);
  return part.variants.find((v) => normalizeVariantSuffix(v.variantSuffix) === normalized);
}

function distributeTotalPerUnit(
  totalHours: number,
  dashQuantities: Record<string, number>,
  setComposition?: Record<string, number> | null
): Record<string, number> {
  const ratios = buildDistributionWeights(dashQuantities, setComposition);
  if (!Object.keys(ratios).length || totalHours <= 0) return {};

  const out: Record<string, number> = {};
  for (const [suffix, ratio] of Object.entries(ratios)) {
    const qty = getDashQuantity(dashQuantities, suffix);
    if (qty <= 0) continue;
    const variantTotal = totalHours * ratio;
    out[suffix] = variantTotal / qty;
  }
  return out;
}

export function computeVariantBreakdown(params: {
  part: (Part & { variants?: PartVariant[] }) | null;
  dashQuantities: Record<string, number>;
  source: VariantAllocationSource;
  totalLaborHours?: number;
  totalCncHours?: number;
  totalPrinter3DHours?: number;
  laborOverridePerUnit?: LaborOverride;
  machineOverridePerUnit?: MachineOverride;
}): { entries: VariantRuntimeBreakdown[]; totals: VariantBreakdownTotals } {
  const {
    part,
    source,
    totalLaborHours = 0,
    totalCncHours = 0,
    totalPrinter3DHours = 0,
    laborOverridePerUnit = {},
    machineOverridePerUnit = {},
  } = params;
  const normalizedDash = normalizeDashQuantities(params.dashQuantities);

  const distributedLabor = distributeTotalPerUnit(totalLaborHours, normalizedDash, part?.setComposition);
  const distributedCnc = distributeTotalPerUnit(totalCncHours, normalizedDash, part?.setComposition);
  const distributedPrinter = distributeTotalPerUnit(
    totalPrinter3DHours,
    normalizedDash,
    part?.setComposition
  );

  const entries: VariantRuntimeBreakdown[] = [];

  for (const [suffix, qty] of Object.entries(normalizedDash)) {
    if (qty <= 0) continue;
    const variant = getVariantBySuffix(part, suffix);
    const suffixKey = toDashSuffix(suffix);
    const laborFromPart = variant?.laborHours ?? part?.laborHours ?? 0;
    const cncFromPart = variant?.requiresCNC ? (variant.cncTimeHours ?? 0) : 0;
    const printerFromPart = variant?.requires3DPrint ? (variant.printer3DTimeHours ?? 0) : 0;

    const laborHoursPerUnit =
      source === 'variant'
        ? laborOverridePerUnit[suffixKey] ?? laborFromPart
        : distributedLabor[suffixKey] ?? laborFromPart;
    const cncHoursPerUnit =
      source === 'variant'
        ? machineOverridePerUnit[suffixKey]?.cncHoursPerUnit ?? cncFromPart
        : distributedCnc[suffixKey] ?? cncFromPart;
    const printer3DHoursPerUnit =
      source === 'variant'
        ? machineOverridePerUnit[suffixKey]?.printer3DHoursPerUnit ?? printerFromPart
        : distributedPrinter[suffixKey] ?? printerFromPart;

    entries.push({
      suffix: suffixKey,
      qty,
      laborHoursPerUnit,
      laborHoursTotal: laborHoursPerUnit * qty,
      cncHoursPerUnit,
      cncHoursTotal: cncHoursPerUnit * qty,
      printer3DHoursPerUnit,
      printer3DHoursTotal: printer3DHoursPerUnit * qty,
    });
  }

  const totals = entries.reduce<VariantBreakdownTotals>(
    (acc, entry) => {
      acc.laborHours += entry.laborHoursTotal;
      acc.cncHours += entry.cncHoursTotal;
      acc.printer3DHours += entry.printer3DHoursTotal;
      return acc;
    },
    { laborHours: 0, cncHours: 0, printer3DHours: 0 }
  );

  return { entries, totals };
}

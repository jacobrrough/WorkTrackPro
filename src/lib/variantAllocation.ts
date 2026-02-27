import type { Part, PartVariant } from '@/core/types';
import {
  buildDistributionWeights,
  getDashQuantity,
  normalizeDashQuantities,
  normalizeVariantSuffix,
  toDashSuffix,
} from './variantMath';

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

export interface VariantDefaultOverrides {
  laborPerUnit: Record<string, number>;
  machinePerUnit: Record<string, { cncHoursPerUnit?: number; printer3DHoursPerUnit?: number }>;
  totals: VariantBreakdownTotals;
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

function getEffectiveSetTotalUnits(part: (Part & { variants?: PartVariant[] }) | null): number {
  if (!part) return 0;
  if (part.setComposition && Object.keys(part.setComposition).length > 0) {
    return Object.values(part.setComposition).reduce((sum, rawQty) => {
      const qty = Number(rawQty);
      return Number.isFinite(qty) && qty > 0 ? sum + qty : sum;
    }, 0);
  }
  return part.variants?.length ?? 0;
}

function isSuffixInSetComposition(
  part: (Part & { variants?: PartVariant[] }) | null,
  suffix: string
): boolean {
  if (!part) return false;
  if (part.setComposition && Object.keys(part.setComposition).length > 0) {
    const normalized = normalizeVariantSuffix(suffix);
    return Object.keys(part.setComposition).some(
      (rawSuffix) => normalizeVariantSuffix(rawSuffix) === normalized
    );
  }
  return !!getVariantBySuffix(part, suffix);
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

  const distributedLabor = distributeTotalPerUnit(
    totalLaborHours,
    normalizedDash,
    part?.setComposition
  );
  const distributedCnc = distributeTotalPerUnit(
    totalCncHours,
    normalizedDash,
    part?.setComposition
  );
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
    const setTotalUnits = getEffectiveSetTotalUnits(part);
    const suffixInSet = isSuffixInSetComposition(part, suffix);
    const partLaborPerUnit =
      typeof part?.laborHours === 'number' &&
      part.laborHours > 0 &&
      setTotalUnits > 0 &&
      suffixInSet
        ? part.laborHours / setTotalUnits
        : (part?.laborHours ?? 0);
    const laborFromPart = variant?.laborHours ?? partLaborPerUnit;
    const variantDefinesCnc =
      variant != null &&
      (variant.requiresCNC === true ||
        (typeof variant.cncTimeHours === 'number' && variant.cncTimeHours > 0));
    const variantDefines3d =
      variant != null &&
      (variant.requires3DPrint === true ||
        (typeof variant.printer3DTimeHours === 'number' && variant.printer3DTimeHours > 0));

    const requiresCNC = variantDefinesCnc
      ? (variant?.requiresCNC ?? false)
      : (part?.requiresCNC ?? false);
    const requires3DPrint = variantDefines3d
      ? (variant?.requires3DPrint ?? false)
      : (part?.requires3DPrint ?? false);

    const partCncPerUnit =
      typeof part?.cncTimeHours === 'number' &&
      part.cncTimeHours > 0 &&
      setTotalUnits > 0 &&
      suffixInSet
        ? part.cncTimeHours / setTotalUnits
        : (part?.cncTimeHours ?? 0);
    const partPrinterPerUnit =
      typeof part?.printer3DTimeHours === 'number' &&
      part.printer3DTimeHours > 0 &&
      setTotalUnits > 0 &&
      suffixInSet
        ? part.printer3DTimeHours / setTotalUnits
        : (part?.printer3DTimeHours ?? 0);

    const cncFromPart = requiresCNC
      ? variantDefinesCnc
        ? (variant?.cncTimeHours ?? 0)
        : partCncPerUnit
      : 0;
    const printerFromPart = requires3DPrint
      ? variantDefines3d
        ? (variant?.printer3DTimeHours ?? 0)
        : partPrinterPerUnit
      : 0;

    const laborHoursPerUnit =
      source === 'variant'
        ? (laborOverridePerUnit[suffixKey] ?? laborFromPart)
        : (distributedLabor[suffixKey] ?? laborFromPart);
    const cncHoursPerUnit =
      source === 'variant'
        ? (machineOverridePerUnit[suffixKey]?.cncHoursPerUnit ?? cncFromPart)
        : (distributedCnc[suffixKey] ?? cncFromPart);
    const printer3DHoursPerUnit =
      source === 'variant'
        ? (machineOverridePerUnit[suffixKey]?.printer3DHoursPerUnit ?? printerFromPart)
        : (distributedPrinter[suffixKey] ?? printerFromPart);

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

export function buildPartVariantDefaults(
  part: (Part & { variants?: PartVariant[] }) | null,
  dashQuantities: Record<string, number>
): VariantDefaultOverrides {
  const { entries, totals } = computeVariantBreakdown({
    part,
    dashQuantities,
    source: 'variant',
  });

  const laborPerUnit: Record<string, number> = {};
  const machinePerUnit: Record<
    string,
    { cncHoursPerUnit?: number; printer3DHoursPerUnit?: number }
  > = {};

  entries.forEach((entry) => {
    laborPerUnit[entry.suffix] = entry.laborHoursPerUnit;
    machinePerUnit[entry.suffix] = {
      cncHoursPerUnit: entry.cncHoursPerUnit,
      printer3DHoursPerUnit: entry.printer3DHoursPerUnit,
    };
  });

  return { laborPerUnit, machinePerUnit, totals };
}

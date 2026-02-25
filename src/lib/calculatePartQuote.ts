import type { Part, PartVariant, PartMaterial, InventoryItem } from '@/core/types';
import { quantityPerUnit } from './variantMath';

const DEFAULT_LABOR_RATE = 175;
const MATERIAL_MARKUP_MULTIPLIER = 2.25;

export interface PartQuoteResult {
  materialCostOur: number;
  materialCostCustomer: number;
  laborHours: number;
  laborCost: number;
  /** CNC time (hours) for the quoted quantity */
  cncHours: number;
  /** Cost for CNC time at CNC rate */
  cncCost: number;
  /** 3D printer time (hours) for the quoted quantity */
  printer3DHours: number;
  /** Cost for 3D printer time at 3D printer rate */
  printer3DCost: number;
  subtotal: number;
  markupPercent: number;
  markupAmount: number;
  total: number;
  quantity: number;
  /** True if total was set manually and other values were calculated backwards */
  isReverseCalculated?: boolean;
  /** Effective markup percent when reverse calculated (may differ from input markupPercent) */
  effectiveMarkupPercent?: number;
  /** True when labor hours were auto-adjusted from a manual set total */
  isLaborAutoAdjusted?: boolean;
}

/**
 * Compute material quantities required for one set: variant materials × setComposition + part-level per_set materials.
 */
function materialRequirementsForOneSet(
  part: Part & { variants?: PartVariant[]; materials?: PartMaterial[] },
  setComposition: Record<string, number>
): Map<string, { quantity: number; unit: string }> {
  const map = new Map<string, { quantity: number; unit: string }>();
  const norm = (s: string) => s.replace(/^-/, '');

  for (const [suffix, setQty] of Object.entries(setComposition)) {
    if (setQty <= 0) continue;
    const variant = part.variants?.find((v) => norm(v.variantSuffix) === norm(suffix));
    if (!variant?.materials) continue;
    for (const mat of variant.materials) {
      if (mat.usageType === 'per_set') continue;
      const qty = quantityPerUnit(mat as { quantityPerUnit?: number; quantity?: number }) * setQty;
      const unit = mat.unit ?? 'units';
      const existing = map.get(mat.inventoryId);
      if (existing) {
        existing.quantity += qty;
      } else {
        map.set(mat.inventoryId, { quantity: qty, unit });
      }
    }
  }

  if (part.materials) {
    for (const mat of part.materials) {
      if (mat.usageType !== 'per_set') continue;
      const qtyPerSet = quantityPerUnit(mat as { quantityPerUnit?: number; quantity?: number });
      const unit = mat.unit ?? 'units';
      const existing = map.get(mat.inventoryId);
      if (existing) {
        existing.quantity += qtyPerSet;
      } else {
        map.set(mat.inventoryId, { quantity: qtyPerSet, unit });
      }
    }
  }

  return map;
}

/**
 * Calculate quote for a part given quantity (number of sets).
 */
export function calculatePartQuote(
  part: Part & { variants?: PartVariant[] },
  quantity: number,
  inventoryItems: InventoryItem[],
  options?: {
    laborRate?: number;
    /** Rate per hour for CNC machine time */
    cncRate?: number;
    /** Rate per hour for 3D printer time */
    printer3DRate?: number;
    materialMultiplier?: number;
    /** Manual set price - when provided, total = manualSetPrice * quantity and calculation works backwards */
    manualSetPrice?: number;
  }
): PartQuoteResult | null {
  if (quantity <= 0) return null;

  const laborRate = options?.laborRate ?? DEFAULT_LABOR_RATE;
  const cncRate = options?.cncRate ?? DEFAULT_LABOR_RATE;
  const printer3DRate = options?.printer3DRate ?? DEFAULT_LABOR_RATE;
  const multiplier = options?.materialMultiplier ?? MATERIAL_MARKUP_MULTIPLIER;
  const manualSetPrice = options?.manualSetPrice;

  const setComposition =
    part.setComposition && Object.keys(part.setComposition).length > 0 ? part.setComposition : {};
  const requirementsOneSet = materialRequirementsForOneSet(part, setComposition);
  const totalQtyMultiplier = quantity;

  let materialCostOur = 0;
  const priceById = new Map(inventoryItems.map((i) => [i.id, i.price ?? 0]));

  for (const [invId, { quantity: qty }] of requirementsOneSet.entries()) {
    const price = priceById.get(invId) ?? 0;
    materialCostOur += qty * totalQtyMultiplier * price;
  }

  const materialCostCustomer = materialCostOur * multiplier;
  const baseLaborHours = (part.laborHours ?? 0) * quantity;
  const cncHours = part.requiresCNC ? (part.cncTimeHours ?? 0) * quantity : 0;
  const cncCost = cncHours * cncRate;
  const printer3DHours = part.requires3DPrint ? (part.printer3DTimeHours ?? 0) * quantity : 0;
  const printer3DCost = printer3DHours * printer3DRate;

  let laborHours = baseLaborHours;
  const isReverseCalculated = manualSetPrice != null && manualSetPrice > 0;
  let isLaborAutoAdjusted = false;
  if (isReverseCalculated) {
    // Reverse calculation for set totals: solve labor hours directly.
    const targetTotal = manualSetPrice * quantity;
    const fixedNonLaborSubtotal = materialCostCustomer + cncCost + printer3DCost;
    const targetLaborCost = Math.max(0, targetTotal - fixedNonLaborSubtotal);
    laborHours = laborRate > 0 ? targetLaborCost / laborRate : baseLaborHours;
    isLaborAutoAdjusted = true;
  }
  const laborCost = laborHours * laborRate;

  // Always calculate subtotal from actual costs (materials, labor, machine time)
  // Materials and quantities are NEVER auto-adjusted - they stay fixed
  const subtotal = materialCostCustomer + laborCost + cncCost + printer3DCost;

  const markupPercent = 0;
  const markupAmount = 0;
  const total = subtotal;

  return {
    materialCostOur,
    materialCostCustomer,
    laborHours,
    laborCost,
    cncHours,
    cncCost,
    printer3DHours,
    printer3DCost,
    subtotal,
    markupPercent,
    markupAmount,
    total,
    quantity,
    isReverseCalculated,
    effectiveMarkupPercent: undefined,
    isLaborAutoAdjusted,
  };
}

/**
 * Calculate quote for a single variant (e.g. quantity of -01).
 */
export function calculateVariantQuote(
  partNumber: string,
  variant: PartVariant & { materials?: PartMaterial[] },
  quantity: number,
  inventoryItems: InventoryItem[],
  options?: {
    laborRate?: number;
    cncRate?: number;
    printer3DRate?: number;
    materialMultiplier?: number;
    /** Manual variant price - when provided, total = manualVariantPrice * quantity and calculation works backwards */
    manualVariantPrice?: number;
    /** Markup percent for reverse calculation (defaults to 0 for variants) */
    markupPercent?: number;
  }
): PartQuoteResult | null {
  if (quantity <= 0) return null;

  const laborRate = options?.laborRate ?? DEFAULT_LABOR_RATE;
  const cncRate = options?.cncRate ?? DEFAULT_LABOR_RATE;
  const printer3DRate = options?.printer3DRate ?? DEFAULT_LABOR_RATE;
  const multiplier = options?.materialMultiplier ?? MATERIAL_MARKUP_MULTIPLIER;
  const markupPercent = options?.markupPercent ?? 0; // Variants typically don't have markup
  const manualVariantPrice = options?.manualVariantPrice;

  let materialCostOur = 0;
  const priceById = new Map(inventoryItems.map((i) => [i.id, i.price ?? 0]));

  for (const mat of variant.materials ?? []) {
    const qtyPerUnit = quantityPerUnit(mat as { quantityPerUnit?: number; quantity?: number });
    const totalQty = qtyPerUnit * quantity;
    const price = priceById.get(mat.inventoryId) ?? 0;
    materialCostOur += totalQty * price;
  }

  const materialCostCustomer = materialCostOur * multiplier;
  const baseLaborHours = (variant.laborHours ?? 0) * quantity;
  const cncHours = variant.requiresCNC ? (variant.cncTimeHours ?? 0) * quantity : 0;
  const cncCost = cncHours * cncRate;
  const printer3DHours = variant.requires3DPrint ? (variant.printer3DTimeHours ?? 0) * quantity : 0;
  const printer3DCost = printer3DHours * printer3DRate;
  const isReverseCalculated = manualVariantPrice != null && manualVariantPrice > 0;
  let laborHours = baseLaborHours;
  let isLaborAutoAdjusted = false;

  if (isReverseCalculated) {
    // Reverse calculation for variant totals: solve labor to hit manual target.
    const targetTotal = manualVariantPrice * quantity;
    const fixedNonLaborSubtotal = materialCostCustomer + cncCost + printer3DCost;
    const targetLaborCost = Math.max(0, targetTotal - fixedNonLaborSubtotal);
    laborHours = laborRate > 0 ? targetLaborCost / laborRate : baseLaborHours;
    isLaborAutoAdjusted = true;
  }
  const laborCost = laborHours * laborRate;

  // Always calculate subtotal from actual costs (materials, labor)
  // Materials and quantities are NEVER auto-adjusted - they stay fixed
  const subtotal = materialCostCustomer + laborCost + cncCost + printer3DCost;

  let markupAmount: number;
  let total: number;
  let effectiveMarkupPercent: number | undefined;

  if (isReverseCalculated) {
    // Keep total anchored to the manual variant target.
    total = manualVariantPrice * quantity;
    markupAmount = total - subtotal;
    effectiveMarkupPercent = subtotal > 0 ? (markupAmount / subtotal) * 100 : markupPercent;
  } else {
    // Forward calculation: normal flow
    markupAmount = subtotal * (markupPercent / 100);
    total = subtotal + markupAmount;
  }

  return {
    materialCostOur,
    materialCostCustomer,
    laborHours,
    laborCost,
    cncHours,
    cncCost,
    printer3DHours,
    printer3DCost,
    subtotal,
    markupPercent,
    markupAmount,
    total,
    quantity,
    isReverseCalculated,
    effectiveMarkupPercent,
    isLaborAutoAdjusted,
  };
}

import type { Part, PartVariant, PartMaterial, InventoryItem } from '@/core/types';

const DEFAULT_LABOR_RATE = 175;
const MATERIAL_MARKUP_MULTIPLIER = 2.25;
const DEFAULT_MARKUP_PERCENT = 20;

export interface PartQuoteResult {
  materialCostOur: number;
  materialCostCustomer: number;
  laborHours: number;
  laborCost: number;
  /** CNC / 3D print machine time (hours) for the quoted quantity */
  machineHours: number;
  /** Cost for machine time at machine rate */
  machineCost: number;
  subtotal: number;
  markupPercent: number;
  markupAmount: number;
  total: number;
  quantity: number;
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
    const variant = part.variants?.find(
      (v) => norm(v.variantSuffix) === norm(suffix)
    );
    if (!variant?.materials) continue;
    for (const mat of variant.materials) {
      if (mat.usageType === 'per_set') continue;
      const qty = (mat.quantityPerUnit ?? (mat as { quantity?: number }).quantity ?? 1) * setQty;
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
      const qtyPerSet = mat.quantityPerUnit ?? (mat as { quantity?: number }).quantity ?? 1;
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
    /** Rate per hour for CNC/3D print machine time; defaults to labor rate */
    machineRate?: number;
    markupPercent?: number;
    materialMultiplier?: number;
  }
): PartQuoteResult | null {
  if (quantity <= 0) return null;

  const laborRate = options?.laborRate ?? DEFAULT_LABOR_RATE;
  const machineRate = options?.machineRate ?? laborRate;
  const markupPercent = options?.markupPercent ?? DEFAULT_MARKUP_PERCENT;
  const multiplier = options?.materialMultiplier ?? MATERIAL_MARKUP_MULTIPLIER;

  const setComposition = part.setComposition && Object.keys(part.setComposition).length > 0
    ? part.setComposition
    : {};
  const requirementsOneSet = materialRequirementsForOneSet(part, setComposition);
  const totalQtyMultiplier = quantity;

  let materialCostOur = 0;
  const priceById = new Map(inventoryItems.map((i) => [i.id, i.price ?? 0]));

  for (const [invId, { quantity: qty }] of requirementsOneSet.entries()) {
    const price = priceById.get(invId) ?? 0;
    materialCostOur += qty * totalQtyMultiplier * price;
  }

  const materialCostCustomer = materialCostOur * multiplier;
  const laborHours = (part.laborHours ?? 0) * quantity;
  const laborCost = laborHours * laborRate;
  const machineHours = part.requiresMachineWork ? (part.machineTimeHours ?? 0) * quantity : 0;
  const machineCost = machineHours * machineRate;
  const subtotal = materialCostCustomer + laborCost + machineCost;
  const markupAmount = subtotal * (markupPercent / 100);
  const total = subtotal + markupAmount;

  return {
    materialCostOur,
    materialCostCustomer,
    laborHours,
    laborCost,
    machineHours,
    machineCost,
    subtotal,
    markupPercent,
    markupAmount,
    total,
    quantity,
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
    materialMultiplier?: number;
  }
): PartQuoteResult | null {
  if (quantity <= 0) return null;

  const laborRate = options?.laborRate ?? DEFAULT_LABOR_RATE;
  const multiplier = options?.materialMultiplier ?? MATERIAL_MARKUP_MULTIPLIER;

  let materialCostOur = 0;
  const priceById = new Map(inventoryItems.map((i) => [i.id, i.price ?? 0]));

  for (const mat of variant.materials ?? []) {
    const qtyPerUnit = mat.quantityPerUnit ?? (mat as { quantity?: number }).quantity ?? 1;
    const totalQty = qtyPerUnit * quantity;
    const price = priceById.get(mat.inventoryId) ?? 0;
    materialCostOur += totalQty * price;
  }

  const materialCostCustomer = materialCostOur * multiplier;
  const laborHours = (variant.laborHours ?? 0) * quantity;
  const laborCost = laborHours * laborRate;
  const machineHours = 0; // Machine time is part-level only
  const machineCost = 0;
  const subtotal = materialCostCustomer + laborCost;
  const markupPercent = 0; // Per-variant quote often shown without markup
  const markupAmount = 0;
  const total = subtotal;

  return {
    materialCostOur,
    materialCostCustomer,
    laborHours,
    laborCost,
    machineHours,
    machineCost,
    subtotal,
    markupPercent,
    markupAmount,
    total,
    quantity,
  };
}

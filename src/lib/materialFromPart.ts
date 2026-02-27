import type { Part, PartVariant } from '@/core/types';
import { jobService } from '@/services/api/jobs';
import { partsService } from '@/services/api/parts';
import { calculateSetCompletion } from '@/lib/formatJob';
import {
  normalizeVariantSuffix,
  normalizeDashQuantities,
  quantityPerUnit,
} from '@/lib/variantMath';

/** Epsilon for quantity comparison to avoid float drift and unnecessary updates; align with useMaterialSync isMaterialAuto. */
const QTY_EPSILON = 1e-6;

function qtyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < QTY_EPSILON;
}

/**
 * Compute required materials for a job from part definition and dash quantities.
 * Returns a Map keyed by inventoryId with { quantity, unit }.
 * Algorithm: per-variant materials × dash qty; part-level per_set × complete sets (or total qty if no set composition).
 */
export function computeRequiredMaterials(
  part: Part & { variants?: PartVariant[]; setComposition?: Record<string, number> | null },
  dashQuantities: Record<string, number>
): Map<string, { quantity: number; unit: string }> {
  const materialMap = new Map<string, { quantity: number; unit: string }>();
  const normalizedDash = normalizeDashQuantities(dashQuantities);

  const totalQty = Object.values(normalizedDash).reduce((sum, q) => sum + q, 0);
  if (totalQty <= 0) return materialMap;

  // Per-variant materials × dash quantity
  for (const [suffix, qty] of Object.entries(normalizedDash)) {
    if (qty <= 0) continue;
    const normalized = normalizeVariantSuffix(suffix);
    const variant = part.variants?.find(
      (v) => normalizeVariantSuffix(v.variantSuffix) === normalized
    );
    if (!variant?.materials) continue;
    for (const material of variant.materials) {
      if (material.usageType === 'per_set') continue;
      const qtyPerUnit = quantityPerUnit(
        material as { quantityPerUnit?: number; quantity?: number }
      );
      const requiredQty = qtyPerUnit * qty;
      const existing = materialMap.get(material.inventoryId);
      const unit = material.unit || 'units';
      if (existing) {
        existing.quantity += requiredQty;
      } else {
        materialMap.set(material.inventoryId, { quantity: requiredQty, unit });
      }
    }
  }

  // Part-level per_set: use complete sets when setComposition exists (matches part definition and calculateSetCompletion), else total quantity
  const setComposition =
    part.setComposition && Object.keys(part.setComposition).length > 0 ? part.setComposition : null;
  const perSetMultiplier = setComposition
    ? calculateSetCompletion(normalizedDash, setComposition).completeSets
    : totalQty;

  if (part.materials && perSetMultiplier > 0) {
    for (const material of part.materials) {
      if (material.usageType !== 'per_set') continue;
      const qtyPerSet = quantityPerUnit(
        material as { quantityPerUnit?: number; quantity?: number }
      );
      const requiredQty = qtyPerSet * perSetMultiplier;
      const existing = materialMap.get(material.inventoryId);
      const unit = material.unit || 'units';
      if (existing) {
        existing.quantity += requiredQty;
      } else {
        materialMap.set(material.inventoryId, { quantity: requiredQty, unit });
      }
    }
  }

  return materialMap;
}

/**
 * Sync job_inventory for a job from part and dash quantities.
 * When replace is true: job_inventory is replaced by Part BOM (rows not in Part BOM are removed).
 * When replace is false: adds or updates lines only; does not remove existing lines (preserves manual additions).
 */
export async function syncJobInventoryFromPart(
  jobId: string,
  part: Part & { variants?: PartVariant[] },
  dashQuantities: Record<string, number>,
  options?: { replace?: boolean }
): Promise<void> {
  const replace = options?.replace === true;
  const required = computeRequiredMaterials(part, dashQuantities);

  const job = await jobService.getJobById(jobId);
  if (!job) throw new Error('Job not found');

  if (replace) {
    const requiredIds = new Set(required.keys());
    for (const ji of job.inventoryItems ?? []) {
      if (!requiredIds.has(ji.inventoryId)) {
        await jobService.removeJobInventory(jobId, ji.id);
      }
    }
  }

  if (required.size === 0) return;

  const existingByInventoryId = new Map<string, { id: string; quantity: number; unit: string }>();
  for (const ji of job.inventoryItems ?? []) {
    existingByInventoryId.set(ji.inventoryId, {
      id: ji.id!,
      quantity: ji.quantity,
      unit: ji.unit ?? 'units',
    });
  }

  for (const [inventoryId, { quantity, unit }] of required.entries()) {
    const existing = existingByInventoryId.get(inventoryId);
    if (existing) {
      if (!qtyEqual(existing.quantity, quantity) || (existing.unit || 'units') !== unit) {
        await jobService.updateJobInventory(existing.id, quantity, unit);
      }
    } else {
      await jobService.addJobInventory(jobId, inventoryId, quantity, unit);
    }
  }
}

/**
 * When the user edits a job material line (quantity or unit) and the job has a linked Part,
 * push the new quantity back to the Part's BOM (PartMaterial) so Part and job stay in sync.
 * Computes quantityPerUnit = newJobQuantity / totalUnits (from dash quantities or 1).
 */
export async function syncPartMaterialFromJobQuantity(
  part: Part & { variants?: PartVariant[] },
  dashQuantities: Record<string, number>,
  inventoryId: string,
  newJobQuantity: number,
  unit: string
): Promise<void> {
  const normalizedDash = normalizeDashQuantities(dashQuantities);
  const totalUnits = Object.values(normalizedDash).reduce((sum, q) => sum + q, 0) || 1;
  const quantityPerUnit = newJobQuantity / totalUnits;

  const toUpdate: Array<{ id: string }> = [];
  if (part.materials) {
    for (const m of part.materials) {
      if (m.inventoryId === inventoryId) toUpdate.push({ id: m.id });
    }
  }
  if (part.variants) {
    for (const v of part.variants) {
      if (!v.materials) continue;
      for (const m of v.materials) {
        if (m.inventoryId === inventoryId) toUpdate.push({ id: m.id });
      }
    }
  }

  for (const { id } of toUpdate) {
    await partsService.updatePartMaterial(id, { quantityPerUnit, unit });
  }
}

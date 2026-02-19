import type { Part, PartVariant, PartMaterial } from '@/core/types';
import { jobService } from '@/services/api/jobs';
import { calculateSetCompletion } from '@/lib/formatJob';

/**
 * Normalize variant suffix for matching (e.g. "01" vs "-01").
 */
function normalizeSuffix(suffix: string): string {
  return suffix.replace(/^-/, '');
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

  const totalQty = Object.values(dashQuantities).reduce((sum, q) => sum + q, 0);
  if (totalQty <= 0) return materialMap;

  // Per-variant materials × dash quantity
  for (const [suffix, qty] of Object.entries(dashQuantities)) {
    if (qty <= 0) continue;
    const normalized = normalizeSuffix(suffix);
    const variant = part.variants?.find((v) => normalizeSuffix(v.variantSuffix) === normalized);
    if (!variant?.materials) continue;
    for (const material of variant.materials) {
      if (material.usageType === 'per_set') continue;
      const qtyPerUnit = material.quantityPerUnit ?? (material as { quantity?: number }).quantity ?? 1;
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

  // Part-level per_set: use complete sets when setComposition exists, else total quantity
  const setComposition = part.setComposition && Object.keys(part.setComposition).length > 0
    ? part.setComposition
    : null;
  const perSetMultiplier = setComposition
    ? calculateSetCompletion(dashQuantities, setComposition).completeSets
    : totalQty;

  if (part.materials && perSetMultiplier > 0) {
    for (const material of part.materials) {
      if (material.usageType !== 'per_set') continue;
      const qtyPerSet = material.quantityPerUnit ?? (material as { quantity?: number }).quantity ?? 1;
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
 * Adds or updates lines; does not remove existing lines (preserves manual additions).
 */
export async function syncJobInventoryFromPart(
  jobId: string,
  part: Part & { variants?: PartVariant[] },
  dashQuantities: Record<string, number>
): Promise<void> {
  const required = computeRequiredMaterials(part, dashQuantities);
  if (required.size === 0) return;

  const job = await jobService.getJobById(jobId);
  if (!job) throw new Error('Job not found');

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
      if (existing.quantity !== quantity) {
        await jobService.updateJobInventory(existing.id, quantity, unit);
      }
    } else {
      await jobService.addJobInventory(jobId, inventoryId, quantity, unit);
    }
  }
}

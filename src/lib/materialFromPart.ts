import type { Part, PartVariant } from '@/core/types';
import { jobService } from '@/services/api/jobs';
import { partsService } from '@/services/api/parts';
import { calculateSetCompletion } from '@/lib/formatJob';
import { allowMaterialAllocation, isConsumedStatus } from '@/lib/inventoryCalculations';
import {
  getDashQuantity,
  normalizeVariantSuffix,
  normalizeDashQuantities,
  quantityPerUnit,
  toDashSuffix,
} from '@/lib/variantMath';
import { deriveSetCountFromDashQuantities } from '@/lib/jobPriceFromPart';

/** Epsilon for quantity comparison to avoid float drift and unnecessary updates; align with useMaterialSync isMaterialAuto. */
const QTY_EPSILON = 1e-6;

/**
 * Sentinel key used in setComposition for no-variant parts (units-per-set on a master part).
 * It has no meaning for variant parts and must be filtered out before set-completion math.
 */
const NO_VARIANT_SENTINEL = '_' as const;

function qtyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < QTY_EPSILON;
}

/**
 * Compute required materials for a job from part definition and dash quantities.
 * Returns a Map keyed by inventoryId with { quantity, unit }.
 * Algorithm: per-variant materials × dash qty; part-level per_set × complete sets (or total qty if no set composition).
 * When variantsAreCopies is true, first variant's materials are used for every variant in dashQuantities.
 */
export function computeRequiredMaterials(
  part: Part & {
    variants?: PartVariant[];
    setComposition?: Record<string, number> | null;
    variantsAreCopies?: boolean;
  },
  dashQuantities: Record<string, number>
): Map<string, { quantity: number; unit: string }> {
  const materialMap = new Map<string, { quantity: number; unit: string }>();
  let normalizedDash = normalizeDashQuantities(dashQuantities);

  let totalQty = Object.values(normalizedDash).reduce((sum, q) => sum + q, 0);

  // When "variants are copies", use one variant's materials for all. Prefer the first variant that has materials.
  const firstVariantWithMaterials =
    part.variants?.find((v) => (v.materials?.length ?? 0) > 0) ?? part.variants?.[0];
  const useFirstVariantForAll =
    part.variantsAreCopies === true &&
    part.variants != null &&
    part.variants.length > 0 &&
    (firstVariantWithMaterials?.materials?.length ?? 0) > 0;

  // Fallback when normalized dash is empty but we have quantity and at least one variant with materials.
  // Handles: key format mismatch, variantsAreCopies not set in API, or job.dashQuantities not loaded.
  if (totalQty <= 0 && part.variants?.length) {
    const rawTotal = Object.values(dashQuantities).reduce(
      (sum, v) => sum + (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0),
      0
    );
    if (rawTotal > 0) {
      const variantWithMaterials = part.variants[0]?.materials?.length
        ? part.variants[0]
        : part.variants.find((v) => (v.materials?.length ?? 0) > 0);
      if (variantWithMaterials?.materials?.length) {
        const suffix = toDashSuffix(variantWithMaterials.variantSuffix) || '-01';
        normalizedDash = { [suffix]: rawTotal };
        totalQty = rawTotal;
      }
    }
  }

  if (totalQty <= 0) return materialMap;

  // Master part path: when no variants exist, treat all part-level materials as set-level
  // regardless of usageType to support legacy rows that were tagged per_variant.
  if (!part.variants?.length) {
    for (const material of part.materials ?? []) {
      const qtyPerUnit = quantityPerUnit(
        material as { quantityPerUnit?: number; quantity?: number }
      );
      const requiredQty = qtyPerUnit * totalQty;
      const existing = materialMap.get(material.inventoryId);
      const unit = material.unit || 'units';
      if (existing) {
        existing.quantity += requiredQty;
      } else {
        materialMap.set(material.inventoryId, { quantity: requiredQty, unit });
      }
    }
    return materialMap;
  }

  // Per-variant materials × dash quantity (or first variant's materials for all when variantsAreCopies)
  for (const [suffix, qty] of Object.entries(normalizedDash)) {
    if (qty <= 0) continue;
    const variant = useFirstVariantForAll
      ? firstVariantWithMaterials!
      : part.variants?.find(
          (v) => normalizeVariantSuffix(v.variantSuffix) === normalizeVariantSuffix(suffix)
        );
    if (!variant?.materials) continue;
    for (const material of variant.materials) {
      // Variant-linked rows should always be treated as per-variant requirements,
      // even if legacy data has usageType incorrectly set to per_set.
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

  // Part-level per_set: when variants exist and variantsAreCopies, skip (single source is variants).
  // Otherwise use complete sets when setComposition exists, else total quantity.
  if (useFirstVariantForAll) {
    return materialMap;
  }

  // Strip the no-variant sentinel from setComposition before any set-completion math.
  // calculateSetCompletion currently also skips it internally, but we own the contract here:
  // if the only key is the sentinel, the part effectively has no set composition.
  const strippedComposition: Record<string, number> = Object.fromEntries(
    Object.entries(part.setComposition ?? {}).filter(([k]) => k !== NO_VARIANT_SENTINEL)
  );
  const activeSetComposition =
    Object.keys(strippedComposition).length > 0 ? strippedComposition : null;
  const { completeSets } = activeSetComposition
    ? calculateSetCompletion(normalizedDash, activeSetComposition)
    : { completeSets: 0 };

  // Three distinct states, made explicit:
  //   1. No set composition defined  → use totalQty (legacy / single-variant behavior)
  //   2. Set composition + all variants present (completeSets > 0) → use completeSets
  //   3. Set composition + partial coverage (completeSets === 0) → fall back to totalQty.
  //      Intentional overestimate so admins see a non-empty BOM while filling variants.
  const perSetMultiplier = !activeSetComposition
    ? totalQty
    : completeSets > 0
      ? completeSets
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
 * Sync job_inventory from a precomputed required map (e.g. merged from multiple parts).
 * When replace is true: job_inventory is replaced by the map (rows not in map are removed).
 * When replace is false: adds or updates lines only; does not remove existing lines.
 */
export async function syncJobInventoryFromRequiredMap(
  jobId: string,
  required: Map<string, { quantity: number; unit: string }>,
  options?: { replace?: boolean }
): Promise<void> {
  const replace = options?.replace === true;
  const job = await jobService.getJobById(jobId);
  if (!job) throw new Error('Job not found');
  if (isConsumedStatus(job.status)) throw new Error('material_sync_skipped: job is consumed');
  if (!allowMaterialAllocation(job.status)) return;
  if (replace) {
    const requiredIds = new Set(required.keys());
    for (const ji of job.inventoryItems ?? []) {
      if (ji.inventoryId && !requiredIds.has(ji.inventoryId)) {
        await jobService.removeJobInventory(jobId, ji.id);
      }
    }
  }

  if (required.size === 0) return;

  const existingByInventoryId = new Map<string, { id: string; quantity: number; unit: string }>();
  for (const ji of job.inventoryItems ?? []) {
    if (ji.inventoryId) {
      existingByInventoryId.set(ji.inventoryId, {
        id: ji.id!,
        quantity: ji.quantity,
        unit: ji.unit ?? 'units',
      });
    }
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
  const isMasterPartWithoutVariants = !part.variants?.length;
  const hasAnyPartMaterialRows = (part.materials?.length ?? 0) > 0;

  // Safety: if source part has no variants and no loaded material rows, never do a destructive replace.
  // This avoids wiping job BOM from transient/legacy loader gaps.
  if (replace && required.size === 0 && isMasterPartWithoutVariants && !hasAnyPartMaterialRows) {
    return;
  }

  return syncJobInventoryFromRequiredMap(jobId, required, { replace });
}

/** Which Part BOM scope a job-material writeback targets, for inventory shared across rows. */
export type MaterialSyncScope = { kind: 'part' } | { kind: 'variant'; variantSuffix: string };

/**
 * When the user adds/edits a job material line and the job has a linked Part, push the new
 * quantity back to the Part's BOM (PartMaterial) so Part and job stay in sync, dividing by
 * the per-unit denominator appropriate to the targeted BOM row.
 *
 * The same inventory can appear in more than one BOM row (the part-level per_set row and/or
 * one row per variant), and the correct denominator differs per row (a variant row divides by
 * THAT variant's dash quantity; the per_set row divides by the number of complete sets). When
 * the match is ambiguous, the caller supplies `scope` (chosen via the add-material picker) to
 * say which row the quantity belongs to. Without a matching scope on an ambiguous inventory we
 * SKIP the writeback rather than flatten every row to one uniform value (which would corrupt a
 * multi-variant BOM). The unambiguous single-row case needs no scope.
 */
export async function syncPartMaterialFromJobQuantity(
  part: Part & { variants?: PartVariant[]; setComposition?: Record<string, number> | null },
  dashQuantities: Record<string, number>,
  inventoryId: string,
  newJobQuantity: number,
  unit: string,
  scope?: MaterialSyncScope
): Promise<void> {
  const normalizedDash = normalizeDashQuantities(dashQuantities);

  // Collect every BOM row that references this inventory, tagged by its scope.
  type Match =
    | { id: string; kind: 'part' }
    | { id: string; kind: 'variant'; variantSuffix: string };
  const matches: Match[] = [];
  for (const m of part.materials ?? []) {
    if (m.inventoryId === inventoryId) matches.push({ id: m.id, kind: 'part' });
  }
  for (const v of part.variants ?? []) {
    for (const m of v.materials ?? []) {
      if (m.inventoryId === inventoryId)
        matches.push({ id: m.id, kind: 'variant', variantSuffix: v.variantSuffix });
    }
  }
  if (matches.length === 0) return;

  // Resolve the single row to write. An unambiguous match needs no scope; otherwise the
  // caller's scope picks the row. No (matching) scope on an ambiguous inventory => skip.
  let target: Match | undefined;
  if (matches.length === 1 && !scope) {
    target = matches[0];
  } else if (scope) {
    const wantSuffix =
      scope.kind === 'variant' ? normalizeVariantSuffix(scope.variantSuffix) : null;
    target = matches.find((m) =>
      scope.kind === 'part'
        ? m.kind === 'part'
        : m.kind === 'variant' && normalizeVariantSuffix(m.variantSuffix) === wantSuffix
    );
  }
  if (!target) return;

  // Per-unit denominator for the targeted scope.
  let denominator: number;
  if (target.kind === 'variant') {
    denominator = getDashQuantity(normalizedDash, target.variantSuffix);
  } else {
    const sets = deriveSetCountFromDashQuantities(part.setComposition, dashQuantities);
    denominator = sets ?? Object.values(normalizedDash).reduce((sum, q) => sum + q, 0);
  }
  if (!denominator || denominator <= 0) return;

  await partsService.updatePartMaterial(target.id, {
    quantityPerUnit: newJobQuantity / denominator,
    unit,
  });
}

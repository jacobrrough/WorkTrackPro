/**
 * Per-unit CNC / production inventory deduction math.
 *
 * The shop intentionally over-estimates a job's BOM, so we DISTRIBUTE each material's padded job
 * total across only the variants that actually use it (proportional to usage), rather than using
 * the part's canonical per-unit spec. By the time every unit is logged, the full padded amount has
 * been deducted (intentional conservative over-deduction). See docs/cnc-unit-progress-deduction.md.
 *
 * Pure functions — `cncAbleCategories` is passed in so this module has no dependency on settings.
 */
import type { Job, Part, InventoryItem, PartMaterial } from '@/core/types';

/** Normalize a variant suffix to a bare key (no leading dash): '-04' -> '04'. */
export const normSuffix = (s: string): string => s.replace(/^-+/, '');

/** Synthetic key used for a no-variant job's single pseudo-unit group. */
export const NO_VARIANT_KEY = '';

/** Per-unit material quantity for one variant, split by whether the material is CNC-able. */
export interface VariantMaterialShare {
  /** inventoryId -> per-unit quantity (CNC-able materials, deducted on the CNC milestone). */
  cncable: Record<string, number>;
  /** inventoryId -> per-unit quantity (everything else, deducted on the unit-done milestone). */
  nonCncable: Record<string, number>;
  /**
   * Whether this variant has a CNC milestone — i.e. the variant has CNC hours. This (not the
   * presence of foam material) gates whether the variant shows in the CNC checklist. A variant with
   * CNC hours but no foam still appears (it just deducts nothing on the CNC step).
   */
  hasCncHours: boolean;
}

/** Distributed BOM: normalized variant key -> per-unit material shares. */
export type DistributedBom = Record<string, VariantMaterialShare>;

export interface DeductionInputs {
  job: Pick<Job, 'inventoryItems' | 'dashQuantities' | 'qty' | 'machineBreakdownByVariant'>;
  /** Linked part (with variants + materials). Null when the job has no part / no spec. */
  part: Part | null;
  inventoryById: Map<string, InventoryItem>;
  /** Inventory categories whose materials deduct on the CNC milestone (e.g. {'foam'}). */
  cncAbleCategories: ReadonlySet<string>;
}

/**
 * Units per variant. Keys are normalized suffixes. A job with no dash variants collapses to a
 * single NO_VARIANT_KEY group carrying the job's total quantity (parseInt(job.qty) || 1).
 */
export function unitCountsByVariant(
  job: Pick<Job, 'dashQuantities' | 'qty'>
): Record<string, number> {
  const dash = job.dashQuantities ?? {};
  const keys = Object.keys(dash);
  if (keys.length > 0) {
    const out: Record<string, number> = {};
    for (const k of keys) {
      const n = Number(dash[k]);
      if (Number.isFinite(n) && n > 0) out[normSuffix(k)] = n;
    }
    return out;
  }
  const total = Math.max(1, Math.floor(Number(job.qty) || 1));
  return { [NO_VARIANT_KEY]: total };
}

/** Total units across all variants. */
export function totalUnits(job: Pick<Job, 'dashQuantities' | 'qty'>): number {
  return Object.values(unitCountsByVariant(job)).reduce((a, b) => a + b, 0);
}

/** CNC hours for one machine-breakdown entry (total, falling back to per-unit). */
function entryCncHours(entry: { cncHoursTotal?: number; cncHoursPerUnit?: number }): number {
  const total = Number(entry?.cncHoursTotal) || 0;
  if (total > 0) return total;
  return Number(entry?.cncHoursPerUnit) || 0;
}

/** Normalized-key (no leading dash) map of variant -> CNC hours from the job's machine breakdown. */
export function cncHoursByVariant(
  job: Pick<Job, 'machineBreakdownByVariant'>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [suffix, entry] of Object.entries(job.machineBreakdownByVariant ?? {})) {
    out[normSuffix(suffix)] = entryCncHours(entry);
  }
  return out;
}

/**
 * Whether a variant has a CNC milestone (CNC hours > 0). For the no-variant group (single unit
 * group), any CNC hours in the breakdown belong to it, so we treat the whole job's CNC hours as
 * that group's — this side-steps key-mapping differences for no-variant jobs.
 */
function variantHasCncHours(hoursByVariant: Record<string, number>, variantKey: string): boolean {
  if (variantKey === NO_VARIANT_KEY) {
    return Object.values(hoursByVariant).some((h) => h > 0);
  }
  return (hoursByVariant[variantKey] ?? 0) > 0;
}

/** Whether a material's inventory category deducts on the CNC milestone (e.g. foam). */
function isCncCategory(
  inventoryId: string,
  inventoryById: Map<string, InventoryItem>,
  cncAbleCategories: ReadonlySet<string>
): boolean {
  const item = inventoryById.get(inventoryId);
  return !!item && cncAbleCategories.has(item.category);
}

/** Per-unit spec quantity of a material for a given variant, derived from the part definition. */
function specQtyPerUnit(part: Part | null, variantKey: string, inventoryId: string): number {
  if (!part) return 0;
  const collect = (mats: PartMaterial[] | undefined): number => {
    let q = 0;
    for (const m of mats ?? []) {
      if (m.inventoryId === inventoryId) q += Number(m.quantityPerUnit) || 0;
    }
    return q;
  };
  // Part-level (per_set) materials apply to every unit regardless of variant.
  let qty = collect((part.materials ?? []).filter((m) => m.usageType !== 'per_variant'));
  // Variant-level materials only apply to their own variant.
  const variant = (part.variants ?? []).find((v) => normSuffix(v.variantSuffix) === variantKey);
  if (variant) qty += collect(variant.materials);
  return qty;
}

/**
 * Whether the part spec flags a material as requiring CNC for a given variant (the per-material
 * "needs CNC'd out" slider). Only an EXPLICIT boolean on a matching spec material counts; an absent
 * flag means "no opinion". Returns:
 *   - `true`  — at least one matching spec material is explicitly requiresCnc=true.
 *   - `false` — matching material(s) carry an explicit flag and none is true (explicitly off).
 *   - `undefined` — no matching spec material carries an explicit flag (or the part has no such
 *     material), so the caller falls back to the per-variant CNC-hours gate. This preserves
 *     pre-slider behavior for parts/materials that predate the flag and for jobs with no linked part.
 */
function specMaterialRequiresCnc(
  part: Part | null,
  variantKey: string,
  inventoryId: string
): boolean | undefined {
  if (!part) return undefined;
  let sawFlag = false; // a matching material carried an explicit requiresCnc boolean
  let requires = false; // OR of the explicit trues (any instance needing CNC wins)
  const scan = (mats: PartMaterial[] | undefined): void => {
    for (const m of mats ?? []) {
      if (m.inventoryId !== inventoryId) continue;
      if (typeof m.requiresCnc === 'boolean') {
        sawFlag = true;
        if (m.requiresCnc) requires = true;
      }
    }
  };
  // Part-level (per_set) materials apply to every variant; variant-level only to their own variant.
  scan((part.materials ?? []).filter((m) => m.usageType !== 'per_variant'));
  const variant = (part.variants ?? []).find((v) => normSuffix(v.variantSuffix) === variantKey);
  if (variant) scan(variant.materials);
  return sawFlag ? requires : undefined;
}

/**
 * Build the distributed BOM: for each job material, distribute its padded total across the variants
 * that use it (proportional to specQtyPerUnit × units), giving a per-unit share per variant.
 * Falls back to an even split across all units when the part has no usable per-variant spec.
 */
export function buildDistributedBom(inputs: DeductionInputs): DistributedBom {
  const { job, part, inventoryById, cncAbleCategories } = inputs;
  const counts = unitCountsByVariant(job);
  const variantKeys = Object.keys(counts);
  const grandTotalUnits = variantKeys.reduce((a, k) => a + counts[k], 0);

  // A variant has a CNC milestone iff it has CNC hours — that (not foam presence) gates the checklist.
  const hoursByVariant = cncHoursByVariant(job);
  const cncVariant: Record<string, boolean> = {};
  for (const k of variantKeys) cncVariant[k] = variantHasCncHours(hoursByVariant, k);

  const bom: DistributedBom = {};
  for (const k of variantKeys) bom[k] = { cncable: {}, nonCncable: {}, hasCncHours: cncVariant[k] };
  if (grandTotalUnits <= 0) return bom;

  for (const line of job.inventoryItems ?? []) {
    const invId = line.inventoryId;
    const total = Number(line.quantity) || 0;
    if (!invId || total <= 0) continue;
    // Foam (or any CNC category) deducts on the CNC milestone — but only when that foam actually
    // needs CNC'ing. The per-material requiresCnc slider decides this; when the part spec doesn't
    // carry the flag (parts predating the slider, or a job with no linked part) we fall back to
    // "the variant runs CNC" (has CNC hours). Non-CNC categories always fall to the unit-done step.
    const isCncCat = isCncCategory(invId, inventoryById, cncAbleCategories);
    const bucketFor = (k: string): 'cncable' | 'nonCncable' => {
      if (!isCncCat) return 'nonCncable';
      const flagged = specMaterialRequiresCnc(part, k, invId);
      const needsCnc = flagged !== undefined ? flagged : cncVariant[k];
      return needsCnc ? 'cncable' : 'nonCncable';
    };

    // Natural usage weight per variant from the spec (qtyPerUnit × units).
    let weightSum = 0;
    for (const k of variantKeys) weightSum += specQtyPerUnit(part, k, invId) * counts[k];

    if (weightSum > 0) {
      // Scale the spec so per-unit shares sum back to the padded job total exactly.
      const scale = total / weightSum;
      for (const k of variantKeys) {
        const perUnit = specQtyPerUnit(part, k, invId) * scale;
        if (perUnit > 0) bom[k][bucketFor(k)][invId] = perUnit;
      }
    } else {
      // No spec for this material — even split across every unit.
      const perUnit = total / grandTotalUnits;
      for (const k of variantKeys) bom[k][bucketFor(k)][invId] = perUnit;
    }
  }
  return bom;
}

/** True when any variant has a CNC milestone — i.e. the CNC step is relevant for this job. */
export function jobHasCncableMaterial(bom: DistributedBom): boolean {
  return cncableVariantKeys(bom).length > 0;
}

/**
 * Variant keys with a CNC milestone — shown in the CNC accordion / clock-out prompt. A variant
 * qualifies if it has scheduled CNC hours OR has at least one material flagged to deduct on the CNC
 * step (the requiresCnc slider). The union keeps two cases working: a CNC-hour variant with no
 * flagged foam still shows (deducts nothing), and flagged foam on a no-hours variant also shows.
 */
export function cncableVariantKeys(bom: DistributedBom): string[] {
  return Object.keys(bom).filter(
    (k) => bom[k].hasCncHours || Object.keys(bom[k].cncable).length > 0
  );
}

export interface InventoryDelta {
  inventoryId: string;
  /** Quantity to consume now: positive deducts from stock, negative restores (un-mark). */
  delta: number;
}

/**
 * Merge per-inventory deltas (so a material used by both buckets/variants nets to one row).
 * Drops zero rows.
 */
export function mergeDeltas(parts: Array<Record<string, number>>): InventoryDelta[] {
  const acc: Record<string, number> = {};
  for (const p of parts) {
    for (const [id, q] of Object.entries(p)) acc[id] = (acc[id] ?? 0) + q;
  }
  return Object.entries(acc)
    .map(([inventoryId, delta]) => ({ inventoryId, delta }))
    .filter((d) => d.delta !== 0);
}

function scaleShare(share: Record<string, number>, units: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, perUnit] of Object.entries(share)) out[id] = perUnit * units;
  return out;
}

/**
 * Inventory deltas for changing a variant's CNC-done count by `unitDelta` (may be negative).
 * Pulls only the CNC-able share.
 */
export function cncDeltas(
  bom: DistributedBom,
  variantKey: string,
  unitDelta: number
): Record<string, number> {
  const share = bom[variantKey]?.cncable ?? {};
  return scaleShare(share, unitDelta);
}

/**
 * Inventory deltas for changing a variant's unit-done count by `unitDelta`.
 * `alsoCnc` true means this unit-done also completes CNC (pull the CNC-able share too); pass false
 * when CNC was already pulled separately (no double deduction).
 */
export function unitDeltas(
  bom: DistributedBom,
  variantKey: string,
  unitDelta: number,
  alsoCnc: boolean
): Record<string, number> {
  const nonCnc = bom[variantKey]?.nonCncable ?? {};
  const parts = [scaleShare(nonCnc, unitDelta)];
  if (alsoCnc) parts.push(scaleShare(bom[variantKey]?.cncable ?? {}, unitDelta));
  return mergeDeltas(parts).reduce<Record<string, number>>((m, d) => {
    m[d.inventoryId] = d.delta;
    return m;
  }, {});
}

/** Sum the counts map across variants (e.g. total CNC-done units). */
export function sumCounts(counts: Record<string, number> | undefined): number {
  return Object.values(counts ?? {}).reduce((a, b) => a + (Number(b) || 0), 0);
}

/** All CNC-able units are done -> stamp cnc_completed_at. */
export function isCncFullyComplete(
  bom: DistributedBom,
  cncDoneByVariant: Record<string, number> | undefined,
  job: Pick<Job, 'dashQuantities' | 'qty'>
): boolean {
  const keys = cncableVariantKeys(bom);
  if (keys.length === 0) return false;
  const counts = unitCountsByVariant(job);
  return keys.every((k) => (Number(cncDoneByVariant?.[k]) || 0) >= (counts[k] ?? 0));
}

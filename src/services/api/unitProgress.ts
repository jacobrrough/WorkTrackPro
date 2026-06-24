import { supabase } from './supabaseClient';
import type { Job, Part, InventoryItem } from '../../core/types';
import {
  buildDistributedBom,
  unitCountsByVariant,
  cncDeltas,
  unitDeltas,
  mergeDeltas,
  isCncFullyComplete,
  type InventoryDelta,
} from '../../lib/cncDeduction';

/** One per-variant change a worker is logging (CNC milestone and/or unit-done milestone). */
export interface VariantProgressEdit {
  /** Normalized variant key (no leading dash); '' for a no-variant job. */
  variantKey: string;
  /** Change to the CNC-done count for this variant (may be negative to un-mark). */
  cncDelta?: number;
  /** Change to the unit-done count for this variant (may be negative to un-mark). */
  unitDelta?: number;
}

export interface LogUnitProgressArgs {
  job: Job;
  part: Part | null;
  inventory: InventoryItem[];
  cncAbleCategories: ReadonlySet<string>;
  edits: VariantProgressEdit[];
}

/** Clamp a per-variant count to [0, total units for that variant]. */
function clampCount(value: number, max: number): number {
  return Math.max(0, Math.min(max, value));
}

/**
 * Apply a batch of per-variant progress edits: compute the distributed-BOM inventory deltas and the
 * per-variant count deltas, then call the atomic log_unit_progress RPC (which applies the count
 * deltas server-side under the job lock). Returns false on failure.
 */
export async function logUnitProgress(args: LogUnitProgressArgs): Promise<boolean> {
  const { job, part, inventory, cncAbleCategories, edits } = args;
  const inventoryById = new Map(inventory.map((i) => [i.id, i]));
  const bom = buildDistributedBom({ job, part, inventoryById, cncAbleCategories });
  const counts = unitCountsByVariant(job);

  // Local projection of the resulting counts — only used to compute the cnc_completed_at hint.
  const nextCnc: Record<string, number> = { ...(job.cncDoneByVariant ?? {}) };
  // Per-variant count DELTAS sent to the RPC (applied server-side under the job lock).
  const cncDeltaByVariant: Record<string, number> = {};
  const unitsDeltaByVariant: Record<string, number> = {};
  const deltaParts: Array<Record<string, number>> = [];

  for (const edit of edits) {
    const max = counts[edit.variantKey] ?? 0;
    if (edit.cncDelta) {
      const before = nextCnc[edit.variantKey] ?? 0;
      const after = clampCount(before + edit.cncDelta, max);
      const applied = after - before;
      if (applied !== 0) {
        nextCnc[edit.variantKey] = after;
        cncDeltaByVariant[edit.variantKey] = (cncDeltaByVariant[edit.variantKey] ?? 0) + applied;
        deltaParts.push(cncDeltas(bom, edit.variantKey, applied));
      }
    }
    if (edit.unitDelta) {
      const before = job.unitsDoneByVariant?.[edit.variantKey] ?? 0;
      const after = clampCount(before + edit.unitDelta, max);
      const applied = after - before;
      if (applied !== 0) {
        unitsDeltaByVariant[edit.variantKey] =
          (unitsDeltaByVariant[edit.variantKey] ?? 0) + applied;
        deltaParts.push(unitDeltas(bom, edit.variantKey, applied, false));
      }
    }
  }

  const deltas: InventoryDelta[] = mergeDeltas(deltaParts);
  const cncComplete = isCncFullyComplete(bom, nextCnc, job);

  const { error } = await supabase.rpc('log_unit_progress', {
    p_job_id: job.id,
    p_cnc_delta: cncDeltaByVariant,
    p_units_delta: unitsDeltaByVariant,
    // The RPC reads each element's `inventory_id` (snake_case); InventoryDelta is camelCase, so map
    // it at the boundary. Without this, every delta's inventory_id parses to NULL and the RPC raises
    // `inventory_not_in_job_bom: <NULL>` the moment a job actually has material to pull.
    p_inventory_deltas: deltas.map((d) => ({ inventory_id: d.inventoryId, delta: d.delta })),
    p_cnc_complete: cncComplete,
  });
  if (error) {
    console.error('logUnitProgress failed:', error.message);
    return false;
  }
  return true;
}

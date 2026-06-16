import type {
  SeedOpeningInventoryExceptionReason,
  SeedOpeningInventoryExceptionRow,
  SeedOpeningInventoryPreviewRow,
  SeedOpeningInventoryResult,
} from '../../../features/accounting/types';
import { acct } from './accountingClient';
import { type Row } from './mappers';

/**
 * Opening-balance inventory seeder (migration 20260616000004). Wraps
 * accounting.seed_opening_inventory_layers(p_as_of, p_dry_run), which:
 *   • dry-run (default): returns the totals + per-item preview + EXCEPTIONS without writing.
 *   • real run: seeds an opening FIFO cost layer for each eligible stock row (in_stock > 0,
 *     price not null, no existing layer) and posts ONE BALANCED opening JE
 *     (Dr 1300 = Σ in_stock × price / Cr 3050 Opening Balance Equity). Idempotent: a prior
 *     opening JE makes it report `alreadySeeded` and write nothing.
 *
 * The DB owns the money math + the balanced JE; this service maps the jsonb payload to the
 * domain shape. The RPC returns a single jsonb OBJECT (not a row set), so we read
 * `data` directly. Returns a result object whose `error` carries any DB message (RLS
 * denial, missing default accounts) for inline display — never throws (it is a write path).
 */

/** Coerce a jsonb numeric cell to a finite number (0 otherwise). */
const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const str = (v: unknown): string => (v == null ? '' : String(v));
const bool = (v: unknown): boolean => v === true || v === 'true';

const VALID_EXCEPTION_REASONS = new Set<SeedOpeningInventoryExceptionReason>([
  'null_price',
  'non_positive_stock',
  'unknown',
]);
function exceptionReason(v: unknown): SeedOpeningInventoryExceptionReason {
  const s = str(v) as SeedOpeningInventoryExceptionReason;
  return VALID_EXCEPTION_REASONS.has(s) ? s : 'unknown';
}

function mapPreviewRow(r: Row): SeedOpeningInventoryPreviewRow {
  return {
    sourceInventoryId: str(r.source_inventory_id),
    name: str(r.name),
    inStock: num(r.in_stock),
    unitCost: num(r.unit_cost),
    extended: num(r.extended),
  };
}

function mapExceptionRow(r: Row): SeedOpeningInventoryExceptionRow {
  return {
    sourceInventoryId: str(r.source_inventory_id),
    name: str(r.name),
    inStock: r.in_stock == null ? null : num(r.in_stock),
    price: r.price == null ? null : num(r.price),
    reason: exceptionReason(r.reason),
  };
}

/** Map the seeder's jsonb result object to the domain shape. */
function mapResult(data: unknown): SeedOpeningInventoryResult {
  const o = (data ?? {}) as Row;
  const preview = Array.isArray(o.preview) ? (o.preview as Row[]).map(mapPreviewRow) : [];
  const exceptions = Array.isArray(o.exceptions)
    ? (o.exceptions as Row[]).map(mapExceptionRow)
    : [];
  return {
    asOf: str(o.as_of),
    dryRun: bool(o.dry_run),
    alreadySeeded: bool(o.already_seeded),
    posted: bool(o.posted),
    journalEntryId: o.journal_entry_id == null ? null : str(o.journal_entry_id),
    totalQty: num(o.total_qty),
    totalValue: num(o.total_value),
    itemCount: num(o.item_count),
    preview,
    exceptions,
  };
}

export const inventorySeederService = {
  /**
   * Preview the opening-balance seed WITHOUT writing (p_dry_run = true). Returns the totals,
   * the per-item rows that would seed, and the exceptions (null price / non-positive stock).
   * `asOf` defaults to today (the DB default) when omitted.
   */
  async preview(asOf?: string): Promise<SeedOpeningInventoryResult> {
    const { data, error } = await acct().rpc('seed_opening_inventory_layers', {
      ...(asOf ? { p_as_of: asOf } : {}),
      p_dry_run: true,
    });
    if (error) return { ...emptyResult(asOf), dryRun: true, error: error.message };
    return mapResult(data);
  },

  /**
   * Actually seed the opening balances (p_dry_run = false): creates the opening FIFO layers
   * and posts the ONE balanced opening JE. Idempotent — a prior opening JE yields
   * `alreadySeeded: true` and posts nothing. `asOf` is the opening-balance date (defaults
   * to today). Returns the result object; `error` carries any DB message.
   */
  async seed(asOf?: string): Promise<SeedOpeningInventoryResult> {
    const { data, error } = await acct().rpc('seed_opening_inventory_layers', {
      ...(asOf ? { p_as_of: asOf } : {}),
      p_dry_run: false,
    });
    if (error) return { ...emptyResult(asOf), dryRun: false, error: error.message };
    return mapResult(data);
  },
};

/** A zeroed result used as the base when the RPC errors (so the shape is always complete). */
function emptyResult(asOf?: string): SeedOpeningInventoryResult {
  return {
    asOf: asOf ?? '',
    dryRun: true,
    alreadySeeded: false,
    posted: false,
    journalEntryId: null,
    totalQty: 0,
    totalValue: 0,
    itemCount: 0,
    preview: [],
    exceptions: [],
  };
}

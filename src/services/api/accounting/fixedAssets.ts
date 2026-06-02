import type {
  DepreciationScheduleRow,
  FixedAsset,
  FixedAssetRegisterRow,
  FixedAssetStatus,
  GenerateScheduleResult,
  NewFixedAssetInput,
  RunDepreciationResult,
  RunDepreciationResultRow,
  UpdateFixedAssetInput,
} from '../../../features/accounting/types';
import { toIsoDate } from '../../../features/accounting/periodLock';
import { acct } from './accountingClient';
import { accountingSettingsService } from './settings';
import {
  mapDepreciationScheduleRow,
  mapFixedAssetRegisterRow,
  mapFixedAssetRow,
  type Row,
} from './mappers';

/**
 * D3 — fixed assets & depreciation (accounting.fixed_assets / depreciation_schedule).
 *
 * An asset carries its acquisition cost, salvage, useful life, method and in-service date
 * plus the three GL accounts its depreciation touches. The DB owns the money math and the
 * posting; this service is the thin app seam that drives it:
 *
 *  • create / update — write the asset header, then (re)build its straight-line schedule
 *    via accounting.generate_depreciation_schedule (integer-cents split, remainder in the
 *    final period; only UNPOSTED rows are touched, so posted history is never disturbed).
 *    Writing the header moves NO money — depreciation posts later, per period.
 *
 *  • runDepreciationForPeriod(date) — the ONLY money path. Calls
 *    accounting.run_depreciation_for_period(date), which loops every DUE (unposted,
 *    period_date <= date) row oldest-first and posts each as ONE BALANCED entry —
 *        Dr Depreciation Expense  / Cr 1510 Accumulated Depreciation
 *    — exclusively through accounting.post_journal_entry (never bypassing the balance
 *    trigger; the D1 books-closed lock is honored automatically), stamping each schedule
 *    row posted. Returns one result row per JE posted.
 *
 *  • postScheduleRow(scheduleId) — post a SINGLE due row (same balanced entry), for a
 *    per-row "post now" action. Idempotent: an already-posted row returns its existing JE.
 *
 *  • register() / getRegisterRow() — read accounting.v_fixed_asset_register (cost,
 *    accumulated depreciation from posted rows, net book value clamped at salvage,
 *    remaining plan). listSchedule() — an asset's full planned/posted schedule.
 *
 * Reads THROW so React Query surfaces them; writes/RPC writers return result objects whose
 * `error` carries the DB message (a unique-violation, an RLS denial, a closed-period
 * rejection, an unbalanced entry) so the UI can show it inline. Only accounting.* is
 * written; public.* is never touched here.
 */

/** Resolve the asset's posting-account defaults (1510 accumulated / 6000 expense) from settings. */
async function resolveAccountDefaults(): Promise<{
  accumulatedDepreciation: string | null;
  depreciationExpense: string | null;
}> {
  const defaults = await accountingSettingsService.getDefaultAccounts();
  return {
    accumulatedDepreciation: defaults.accumulatedDepreciation,
    depreciationExpense: defaults.depreciationExpense,
  };
}

/** Normalize a table-returning RPC payload (array of rows, or a single row, or null) to Row[]. */
function rpcRows(data: unknown): Row[] {
  if (Array.isArray(data)) return data as Row[];
  if (data && typeof data === 'object') return [data as Row];
  return [];
}

export const fixedAssetsService = {
  // ── Asset register (master) ───────────────────────────────────────────────────

  /** All fixed assets, newest in-service first then name. */
  async list(): Promise<FixedAsset[]> {
    const { data, error } = await acct()
      .from('fixed_assets')
      .select('*')
      .order('in_service_date', { ascending: false })
      .order('name', { ascending: true });
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapFixedAssetRow);
  },

  /** A single fixed-asset header, or null when absent. */
  async getById(id: string): Promise<FixedAsset | null> {
    const { data, error } = await acct().from('fixed_assets').select('*').eq('id', id).maybeSingle();
    if (error || !data) return null;
    return mapFixedAssetRow(data as Row);
  },

  /**
   * The asset register (accounting.v_fixed_asset_register): per asset, cost + accumulated
   * depreciation (Σ posted rows) + net book value (floored at salvage) + remaining plan.
   * Sorted by net book value descending so the most valuable assets lead.
   */
  async register(): Promise<FixedAssetRegisterRow[]> {
    const { data, error } = await acct().from('v_fixed_asset_register').select('*');
    if (error) throw error;
    return ((data ?? []) as Row[])
      .map(mapFixedAssetRegisterRow)
      .sort((a, b) => b.netBookValue - a.netBookValue);
  },

  /** One asset's register row (detail header), or null when absent. */
  async getRegisterRow(id: string): Promise<FixedAssetRegisterRow | null> {
    const { data, error } = await acct()
      .from('v_fixed_asset_register')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    return mapFixedAssetRegisterRow(data as Row);
  },

  // ── Depreciation schedule (per asset) ──────────────────────────────────────────

  /** An asset's full planned/posted depreciation schedule, oldest period first. */
  async listSchedule(fixedAssetId: string): Promise<DepreciationScheduleRow[]> {
    const { data, error } = await acct()
      .from('depreciation_schedule')
      .select('*')
      .eq('fixed_asset_id', fixedAssetId)
      .order('period_date', { ascending: true });
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapDepreciationScheduleRow);
  },

  // ── Create / update / delete ───────────────────────────────────────────────────

  /**
   * Create a fixed asset, then generate its straight-line schedule. accumDepr/deprExpense
   * accounts default to the seeded 1510 / 6000 from settings.default_accounts when the
   * caller omits them. Validates locally (cost >= 0, 0 <= salvage <= cost, life > 0) for a
   * fast clear message; the DB enforces the same checks. Writing the asset posts NO journal
   * entry (depreciation posts later, per period). Returns the asset and how many schedule
   * rows were generated; on failure `error` carries the DB/validation message.
   */
  async create(
    input: NewFixedAssetInput
  ): Promise<{ asset: FixedAsset | null; rowsScheduled: number; error?: string }> {
    const name = input.name?.trim();
    if (!name) return { asset: null, rowsScheduled: 0, error: 'A fixed asset needs a name.' };
    if (!input.assetAccountId) {
      return { asset: null, rowsScheduled: 0, error: 'Choose the asset account this asset sits in.' };
    }
    const cost = Number(input.cost);
    const salvage = Number(input.salvageValue ?? 0);
    const life = Math.trunc(Number(input.usefulLifeMonths));
    const inService = toIsoDate(input.inServiceDate);
    const validation = validateAssetFigures({ cost, salvage, life, inService });
    if (validation) return { asset: null, rowsScheduled: 0, error: validation };

    // Fill the two contra/expense accounts from settings when the caller omits them.
    const defaults = await resolveAccountDefaults();
    const accumAccount = input.accumDeprAccountId ?? defaults.accumulatedDepreciation;
    const expenseAccount = input.deprExpenseAccountId ?? defaults.depreciationExpense;
    if (!accumAccount) {
      return {
        asset: null,
        rowsScheduled: 0,
        error: 'No Accumulated Depreciation account is configured (settings.default_accounts).',
      };
    }
    if (!expenseAccount) {
      return {
        asset: null,
        rowsScheduled: 0,
        error: 'No Depreciation Expense account is configured (settings.default_accounts).',
      };
    }

    const { data, error } = await acct()
      .from('fixed_assets')
      .insert({
        name,
        asset_account_id: input.assetAccountId,
        accum_depr_account_id: accumAccount,
        depr_expense_account_id: expenseAccount,
        cost,
        salvage_value: salvage,
        useful_life_months: life,
        method: input.method ?? 'straight_line',
        in_service_date: inService,
        status: input.status ?? 'active',
      })
      .select('*')
      .single();
    if (error || !data) {
      return { asset: null, rowsScheduled: 0, error: error?.message ?? 'Failed to create the fixed asset.' };
    }

    const asset = mapFixedAssetRow(data as Row);
    // Build the straight-line schedule (DB integer-cents math). A generation failure is
    // surfaced but the asset itself was created — the caller can re-generate.
    const gen = await this.generateSchedule(asset.id);
    return { asset, rowsScheduled: gen.rowsWritten ?? 0, error: gen.error };
  },

  /**
   * Patch a fixed-asset header. If any figure that drives the schedule changes (cost,
   * salvage, life, in-service date, method), the UNPOSTED schedule is regenerated to match
   * — posted periods are never disturbed. Moves no money. Returns the updated asset and the
   * regenerated row count; on failure `error` carries the message.
   */
  async update(
    id: string,
    input: UpdateFixedAssetInput
  ): Promise<{ asset: FixedAsset | null; rowsScheduled: number; error?: string }> {
    const existing = await this.getById(id);
    if (!existing) return { asset: null, rowsScheduled: 0, error: 'Fixed asset not found.' };

    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) return { asset: null, rowsScheduled: 0, error: 'A fixed asset needs a name.' };
      patch.name = name;
    }
    if (input.assetAccountId !== undefined) patch.asset_account_id = input.assetAccountId;
    if (input.accumDeprAccountId !== undefined) patch.accum_depr_account_id = input.accumDeprAccountId;
    if (input.deprExpenseAccountId !== undefined) patch.depr_expense_account_id = input.deprExpenseAccountId;
    if (input.cost !== undefined) patch.cost = Number(input.cost);
    if (input.salvageValue !== undefined) patch.salvage_value = Number(input.salvageValue);
    if (input.usefulLifeMonths !== undefined) patch.useful_life_months = Math.trunc(Number(input.usefulLifeMonths));
    if (input.method !== undefined) patch.method = input.method;
    if (input.inServiceDate !== undefined) patch.in_service_date = toIsoDate(input.inServiceDate);
    if (input.status !== undefined) patch.status = input.status;

    if (Object.keys(patch).length === 0) {
      return { asset: existing, rowsScheduled: 0 };
    }

    // Validate the resulting figures (post-merge) so cost/salvage/life stay coherent.
    const merged = {
      cost: input.cost !== undefined ? Number(input.cost) : existing.cost,
      salvage: input.salvageValue !== undefined ? Number(input.salvageValue) : existing.salvageValue,
      life: input.usefulLifeMonths !== undefined ? Math.trunc(Number(input.usefulLifeMonths)) : existing.usefulLifeMonths,
      inService: input.inServiceDate !== undefined ? toIsoDate(input.inServiceDate) : existing.inServiceDate,
    };
    const validation = validateAssetFigures(merged);
    if (validation) return { asset: null, rowsScheduled: 0, error: validation };

    const { data, error } = await acct().from('fixed_assets').update(patch).eq('id', id).select('*').single();
    if (error || !data) {
      return { asset: null, rowsScheduled: 0, error: error?.message ?? 'Failed to update the fixed asset.' };
    }
    const asset = mapFixedAssetRow(data as Row);

    // Regenerate the unposted plan only when a schedule-driving figure moved.
    const scheduleChanged =
      input.cost !== undefined ||
      input.salvageValue !== undefined ||
      input.usefulLifeMonths !== undefined ||
      input.inServiceDate !== undefined ||
      input.method !== undefined;
    if (!scheduleChanged) return { asset, rowsScheduled: 0 };

    const gen = await this.generateSchedule(asset.id);
    return { asset, rowsScheduled: gen.rowsWritten ?? 0, error: gen.error };
  },

  /** Set just the lifecycle status (active → fully_depreciated → disposed). */
  async setStatus(id: string, status: FixedAssetStatus): Promise<{ asset: FixedAsset | null; error?: string }> {
    const { data, error } = await acct()
      .from('fixed_assets')
      .update({ status })
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) return { asset: null, error: error?.message ?? 'Failed to update the asset status.' };
    return { asset: mapFixedAssetRow(data as Row) };
  },

  /**
   * Delete a fixed asset. Its schedule rows cascade away (ON DELETE CASCADE); any posted
   * depreciation JEs survive (they are corrected via void/reverse, not by deleting the
   * asset). Returns a write-style result; on failure `error` carries the DB message.
   */
  async remove(id: string): Promise<{ ok: boolean; error?: string }> {
    const { error } = await acct().from('fixed_assets').delete().eq('id', id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  // ── Schedule generation + posting (the money path) ─────────────────────────────

  /**
   * (Re)generate an asset's straight-line schedule via accounting.generate_depreciation_schedule.
   * The RPC deletes only the asset's UNPOSTED rows and re-inserts the integer-cents plan
   * (remainder in the final period); posted rows are untouched. Posts no JE. Returns the
   * number of (unposted) rows written, or an error message.
   */
  async generateSchedule(fixedAssetId: string): Promise<GenerateScheduleResult> {
    const { data, error } = await acct().rpc('generate_depreciation_schedule', {
      p_asset_id: fixedAssetId,
    });
    if (error) return { rowsWritten: null, error: error.message };
    const n = typeof data === 'number' ? data : Number(data);
    return { rowsWritten: Number.isFinite(n) ? n : 0 };
  },

  /**
   * Post a SINGLE due depreciation schedule row via accounting.post_depreciation_row. Builds
   * the balanced Dr expense / Cr 1510 entry and posts it through accounting.post_journal_entry
   * (honoring the books-closed lock), stamping the row posted. Idempotent: an already-posted
   * row returns its existing journal_entry_id with no re-post. Returns the posted (or
   * pre-existing) JE id, or an error message (RLS denial, a closed-period rejection, …).
   */
  async postScheduleRow(scheduleId: string): Promise<{ journalEntryId: string | null; error?: string }> {
    const { data, error } = await acct().rpc('post_depreciation_row', {
      p_schedule_id: scheduleId,
    });
    if (error) return { journalEntryId: null, error: error.message };
    return { journalEntryId: data == null ? null : String(data) };
  },

  /**
   * Run depreciation for a whole period: post every DUE (unposted, period_date <= date) row
   * across all non-disposed assets, oldest-first, each as a balanced Dr expense / Cr 1510
   * entry — entirely inside accounting.run_depreciation_for_period (which posts through
   * accounting.post_journal_entry, honoring the books-closed lock). Idempotent: re-running a
   * period posts nothing for rows already posted. `date` defaults to today.
   *
   * Returns one result row per JE actually posted (zero-amount rows are consumed but produce
   * no row), plus the count and dollar total. On a DB rejection (RLS denial, or a row whose
   * period falls in a closed period) nothing is posted and `error` carries the message.
   */
  async runDepreciationForPeriod(date?: string): Promise<RunDepreciationResult> {
    const p_period_date = toIsoDate(date) ?? new Date().toISOString().slice(0, 10);
    const { data, error } = await acct().rpc('run_depreciation_for_period', { p_period_date });
    if (error) {
      return { periodDate: p_period_date, postedRows: [], postedCount: 0, totalAmount: 0, error: error.message };
    }

    const rows: RunDepreciationResultRow[] = rpcRows(data).map((r) => ({
      scheduleId: String(r.schedule_id ?? ''),
      fixedAssetId: String(r.fixed_asset_id ?? ''),
      journalEntryId: String(r.journal_entry_id ?? ''),
      amount: Number(r.amount) || 0,
    }));
    // Sum the dollar total in integer cents so it never drifts off floating-point error.
    const totalCents = rows.reduce((s, r) => s + Math.round(r.amount * 100), 0);
    return {
      periodDate: p_period_date,
      postedRows: rows,
      postedCount: rows.length,
      totalAmount: totalCents / 100,
    };
  },
};

/**
 * Validate the money/life figures shared by create + update. Returns an error message, or
 * null when valid. Mirrors the DB CHECK constraints (cost >= 0, salvage >= 0, salvage <=
 * cost, useful_life_months > 0) plus a parseable in-service date, so the UI gets a fast
 * clear message before the round-trip.
 */
function validateAssetFigures(params: {
  cost: number;
  salvage: number;
  life: number;
  inService: string | null;
}): string | null {
  const { cost, salvage, life, inService } = params;
  if (!Number.isFinite(cost) || cost < 0) return 'Cost must be zero or more.';
  if (!Number.isFinite(salvage) || salvage < 0) return 'Salvage value must be zero or more.';
  if (salvage > cost) return 'Salvage value cannot exceed cost.';
  if (!Number.isInteger(life) || life <= 0) return 'Useful life must be a whole number of months greater than zero.';
  if (!inService) return 'Choose the date the asset was placed in service.';
  return null;
}

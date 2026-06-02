import type {
  Dimension,
  DimensionType,
  NewDimensionInput,
  UpdateDimensionInput,
} from '../../../features/accounting/types';
import { acct } from './accountingClient';
import { mapDimensionRow, type Row } from './mappers';

/**
 * Reporting dimensions (accounting.dimensions): the small master of class / location /
 * department tags that can be stamped onto journal/invoice/bill lines (B2). Dimensions
 * move NO money — they are pure reporting tags, so this service has no posting path.
 *
 * Reads throw (React Query surfaces them). Writes return a result object whose `error`
 * carries the DB message — most usefully the `unique (dim_type, name)` violation when a
 * tag name is reused within a type — so the UI can show it inline.
 */
export const dimensionsService = {
  /** All dimensions (optionally including inactive), ordered by type then name. */
  async list(includeInactive = false): Promise<Dimension[]> {
    let query = acct()
      .from('dimensions')
      .select('*')
      .order('dim_type', { ascending: true })
      .order('name', { ascending: true });
    if (!includeInactive) query = query.eq('is_active', true);
    const { data, error } = await query;
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapDimensionRow);
  },

  /** Dimensions of a single type (e.g. all locations) for a picker. */
  async listByType(type: DimensionType, includeInactive = false): Promise<Dimension[]> {
    let query = acct()
      .from('dimensions')
      .select('*')
      .eq('dim_type', type)
      .order('name', { ascending: true });
    if (!includeInactive) query = query.eq('is_active', true);
    const { data, error } = await query;
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapDimensionRow);
  },

  async getById(id: string): Promise<Dimension | null> {
    const { data, error } = await acct()
      .from('dimensions')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    return mapDimensionRow(data as Row);
  },

  /** Create a dimension. Returns the row, or `{ dimension: null, error }` on failure. */
  async create(input: NewDimensionInput): Promise<{ dimension: Dimension | null; error?: string }> {
    const name = input.name?.trim();
    if (!name) return { dimension: null, error: 'A dimension needs a name.' };
    const { data, error } = await acct()
      .from('dimensions')
      .insert({
        dim_type: input.dimType,
        name,
        code: input.code?.trim() || null,
        parent_id: input.parentId ?? null,
      })
      .select('*')
      .single();
    if (error || !data) return { dimension: null, error: error?.message ?? 'Failed to create dimension.' };
    return { dimension: mapDimensionRow(data as Row) };
  },

  /**
   * Patch a dimension's name/code/parent/active flag. `dim_type` is intentionally NOT
   * updatable — re-typing a dimension would orphan the lines that reference it under
   * the type-match trigger; the UI deactivates and recreates instead.
   */
  async update(
    id: string,
    input: UpdateDimensionInput
  ): Promise<{ dimension: Dimension | null; error?: string }> {
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) return { dimension: null, error: 'A dimension needs a name.' };
      patch.name = name;
    }
    if (input.code !== undefined) patch.code = input.code?.trim() || null;
    if (input.parentId !== undefined) patch.parent_id = input.parentId;
    if (input.isActive !== undefined) patch.is_active = input.isActive;
    if (Object.keys(patch).length === 0) {
      return { dimension: await this.getById(id) };
    }
    const { data, error } = await acct()
      .from('dimensions')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) return { dimension: null, error: error?.message ?? 'Failed to update dimension.' };
    return { dimension: mapDimensionRow(data as Row) };
  },

  /**
   * Soft-delete: flip is_active to false. We never hard-delete — posted journal_lines
   * may reference the dimension (the FK is on delete set null, but keeping history
   * intact is preferable). Reactivate via update({ isActive: true }).
   */
  async deactivate(id: string): Promise<{ ok: boolean; error?: string }> {
    const { error } = await acct().from('dimensions').update({ is_active: false }).eq('id', id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },
};

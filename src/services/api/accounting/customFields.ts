import type {
  CustomFieldDef,
  CustomFieldEntityType,
  CustomFieldValue,
  CustomFieldValueInput,
  CustomFieldValueJson,
  CustomFieldWithValue,
  NewCustomFieldDefInput,
  UpdateCustomFieldDefInput,
} from '../../../features/accounting/types';
import {
  coerceCustomFieldValue,
  dataTypeUsesOptions,
  normalizeKey,
  normalizeOptions,
  sortDefs,
  validateCustomFieldValue,
} from '../../../features/accounting/customFields';
import { acct } from './accountingClient';
import { mapCustomFieldDefRow, mapCustomFieldValueRow, type Row } from './mappers';

/**
 * Custom fields on accounting entities (accounting.custom_field_defs +
 * accounting.custom_field_values, migration 019). An admin defines extra fields per
 * entity type (invoice/bill/customer/vendor/account/journal_entry); each entity row can
 * then carry a boxed-JSON value per active field.
 *
 * Custom fields are pure METADATA — they move NO money, so this service has NO posting
 * path: nothing here calls accounting.post_journal_entry, and per invariant G3 that path
 * is vacuous for metadata (exactly like the dimensions B2 and budgets D2 services). The
 * values live in their OWN table keyed by (entity_type, entity_id); creating/editing a
 * value never touches the host invoice/bill/customer/vendor row or its INSERT, so this is
 * purely additive and cannot break existing forms (G1).
 *
 * VALUE BOXING is delegated to the pure customFields helper (coerceCustomFieldValue /
 * validateCustomFieldValue) so every screen boxes a value identically; the service just
 * persists the canonical box (or deletes the row when the value is unset). The
 * (def_id, entity_id) unique constraint is the upsert target.
 *
 * Reads throw (React Query surfaces them). Writes return a result object whose `error`
 * carries the DB message (e.g. the `unique (entity_type, key)` violation when a key is
 * reused within an entity type) so the UI can show it inline.
 */
export const customFieldsService = {
  // ── Definitions (the admin-managed schema) ──────────────────────────────────

  /** All definitions (optionally including inactive), ordered by entity type then sort/label. */
  async listDefs(includeInactive = false): Promise<CustomFieldDef[]> {
    let query = acct()
      .from('custom_field_defs')
      .select('*')
      .order('entity_type', { ascending: true })
      .order('sort_order', { ascending: true })
      .order('label', { ascending: true });
    if (!includeInactive) query = query.eq('active', true);
    const { data, error } = await query;
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapCustomFieldDefRow);
  },

  /**
   * Definitions for a single entity type, in render order (sortDefs gives the stable
   * sort_order → label → key order the UI renders). Active-only by default — this is what
   * the host create/detail screens consume so a deactivated field never renders.
   */
  async listDefsForEntity(
    entityType: CustomFieldEntityType,
    includeInactive = false
  ): Promise<CustomFieldDef[]> {
    let query = acct().from('custom_field_defs').select('*').eq('entity_type', entityType);
    if (!includeInactive) query = query.eq('active', true);
    const { data, error } = await query;
    if (error) throw error;
    return sortDefs(((data ?? []) as Row[]).map(mapCustomFieldDefRow));
  },

  async getDefById(id: string): Promise<CustomFieldDef | null> {
    const { data, error } = await acct()
      .from('custom_field_defs')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    return mapCustomFieldDefRow(data as Row);
  },

  /**
   * Create a definition. The key is normalized to snake_case (so "PO Number" → "po_number")
   * and must be non-empty; options are cleaned + kept only for data_type='select'. Returns
   * the row, or `{ def: null, error }` on failure (incl. the unique (entity_type, key)
   * violation surfaced verbatim).
   */
  async createDef(
    input: NewCustomFieldDefInput
  ): Promise<{ def: CustomFieldDef | null; error?: string }> {
    const label = input.label?.trim();
    if (!label) return { def: null, error: 'A custom field needs a label.' };

    const key = normalizeKey(input.key ?? '');
    if (!key) return { def: null, error: 'A custom field needs a key (letters/numbers).' };

    const options = dataTypeUsesOptions(input.dataType) ? normalizeOptions(input.options) : [];
    if (dataTypeUsesOptions(input.dataType) && options.length === 0) {
      return { def: null, error: 'A select field needs at least one option.' };
    }

    const { data, error } = await acct()
      .from('custom_field_defs')
      .insert({
        entity_type: input.entityType,
        key,
        label,
        data_type: input.dataType,
        options,
        help_text: input.helpText?.trim() || null,
        sort_order: input.sortOrder ?? 0,
        active: input.active ?? true,
      })
      .select('*')
      .single();
    if (error || !data) return { def: null, error: error?.message ?? 'Failed to create custom field.' };
    return { def: mapCustomFieldDefRow(data as Row) };
  },

  /**
   * Patch a definition's label/options/help/sort/active. `entityType`, `key` and `dataType`
   * are intentionally NOT updatable — changing them would re-interpret or orphan existing
   * values (mirrors how dimensions forbid re-typing); the admin deactivates + recreates.
   * Options are re-cleaned when provided.
   */
  async updateDef(
    id: string,
    input: UpdateCustomFieldDefInput
  ): Promise<{ def: CustomFieldDef | null; error?: string }> {
    const patch: Record<string, unknown> = {};
    if (input.label !== undefined) {
      const label = input.label.trim();
      if (!label) return { def: null, error: 'A custom field needs a label.' };
      patch.label = label;
    }
    if (input.options !== undefined) patch.options = normalizeOptions(input.options);
    if (input.helpText !== undefined) patch.help_text = input.helpText?.trim() || null;
    if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder;
    if (input.active !== undefined) patch.active = input.active;

    if (Object.keys(patch).length === 0) {
      return { def: await this.getDefById(id) };
    }

    const { data, error } = await acct()
      .from('custom_field_defs')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) return { def: null, error: error?.message ?? 'Failed to update custom field.' };
    return { def: mapCustomFieldDefRow(data as Row) };
  },

  /** Set a definition's active flag (soft hide/show without deleting its values). */
  async setDefActive(id: string, active: boolean): Promise<{ ok: boolean; error?: string }> {
    const { error } = await acct().from('custom_field_defs').update({ active }).eq('id', id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  /** Soft-delete a definition (flip active=false). Reactivate via setDefActive(id, true). */
  async deactivateDef(id: string): Promise<{ ok: boolean; error?: string }> {
    return this.setDefActive(id, false);
  },

  /**
   * Hard-delete a definition AND its values (custom_field_values cascades via ON DELETE
   * CASCADE). Use sparingly — deactivate is preferred so historical values survive. Returns
   * a write-style result.
   */
  async removeDef(id: string): Promise<{ ok: boolean; error?: string }> {
    const { error } = await acct().from('custom_field_defs').delete().eq('id', id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  // ── Values (per-entity) ─────────────────────────────────────────────────────

  /** Raw value rows stored for one entity (newest-updated irrelevant — keyed by def). */
  async listValues(
    entityType: CustomFieldEntityType,
    entityId: string
  ): Promise<CustomFieldValue[]> {
    const { data, error } = await acct()
      .from('custom_field_values')
      .select('*')
      .eq('entity_type', entityType)
      .eq('entity_id', entityId);
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapCustomFieldValueRow);
  },

  /**
   * The render-ready list for an entity: every ACTIVE definition for the entity type,
   * paired with its current value (null when unset), in render order. This is the single
   * read the host create/detail screens use — drafts (no value rows yet) come back as all
   * defs with null values so the full field set is editable. Active-only by default so a
   * deactivated field never renders; pass includeInactive to surface historical values too.
   */
  async listForEntity(
    entityType: CustomFieldEntityType,
    entityId: string,
    includeInactive = false
  ): Promise<CustomFieldWithValue[]> {
    const [defs, values] = await Promise.all([
      this.listDefsForEntity(entityType, includeInactive),
      this.listValues(entityType, entityId),
    ]);
    const byDef = new Map<string, CustomFieldValueJson>();
    for (const v of values) byDef.set(v.defId, v.value);
    return defs.map((def) => ({ def, value: byDef.has(def.id) ? byDef.get(def.id)! : null }));
  },

  /**
   * Set ONE field's value on an entity. The raw value is validated+coerced against the def
   * (the canonical box); an invalid value is rejected with the def's message. A null/empty
   * coerced value DELETES the stored row ("unset"), so the table only ever holds set
   * values. A set value is UPSERTed on the (def_id, entity_id) unique key. The DB trigger
   * asserts the value's entity_type matches the def's, so a mismatched entityType is
   * rejected by the DB (surfaced as `error`).
   */
  async setValue(
    entityType: CustomFieldEntityType,
    entityId: string,
    defId: string,
    rawValue: CustomFieldValueJson
  ): Promise<{ ok: boolean; error?: string }> {
    const def = await this.getDefById(defId);
    if (!def) return { ok: false, error: 'Unknown custom field.' };
    if (def.entityType !== entityType) {
      return { ok: false, error: 'Custom field does not belong to this entity type.' };
    }

    const { valid, coerced, error: vErr } = validateCustomFieldValue(def, rawValue);
    if (!valid) return { ok: false, error: vErr ?? 'Invalid value.' };

    // Unset → delete the row (absent = unset). Idempotent if it never existed.
    if (coerced == null) {
      const { error } = await acct()
        .from('custom_field_values')
        .delete()
        .eq('def_id', defId)
        .eq('entity_id', entityId);
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    }

    const { error } = await acct()
      .from('custom_field_values')
      .upsert(
        {
          def_id: defId,
          entity_type: entityType,
          entity_id: entityId,
          value: coerced,
        },
        { onConflict: 'def_id,entity_id' }
      );
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  /**
   * Set MANY fields on one entity in a single save (the host form's custom-field section).
   * Each input is validated+coerced against its def; set values are upserted (one batch
   * upsert on the (def_id, entity_id) key) and unset values are deleted (one batch delete).
   * If ANY value fails validation NOTHING is written and the first error is returned, so a
   * partial save can't leave half the fields set. defs not present in `inputs` are left
   * untouched. Returns the number of set values written.
   */
  async setValues(
    entityType: CustomFieldEntityType,
    entityId: string,
    inputs: CustomFieldValueInput[]
  ): Promise<{ ok: boolean; saved: number; error?: string }> {
    if (inputs.length === 0) return { ok: true, saved: 0 };

    // Resolve only the defs referenced, so we can validate + assert entity_type.
    const defIds = Array.from(new Set(inputs.map((i) => i.defId)));
    const { data: defRows, error: defErr } = await acct()
      .from('custom_field_defs')
      .select('*')
      .in('id', defIds);
    if (defErr) return { ok: false, saved: 0, error: defErr.message };
    const defsById = new Map<string, CustomFieldDef>();
    for (const r of (defRows ?? []) as Row[]) {
      const d = mapCustomFieldDefRow(r);
      defsById.set(d.id, d);
    }

    const toUpsert: Array<{
      def_id: string;
      entity_type: CustomFieldEntityType;
      entity_id: string;
      value: CustomFieldValueJson;
    }> = [];
    const toDelete: string[] = [];

    for (const input of inputs) {
      const def = defsById.get(input.defId);
      if (!def) return { ok: false, saved: 0, error: `Unknown custom field ${input.defId}.` };
      if (def.entityType !== entityType) {
        return { ok: false, saved: 0, error: 'A custom field does not belong to this entity type.' };
      }
      const { valid, coerced, error: vErr } = validateCustomFieldValue(def, input.value);
      if (!valid) return { ok: false, saved: 0, error: vErr ?? 'Invalid value.' };
      if (coerced == null) toDelete.push(input.defId);
      else toUpsert.push({ def_id: input.defId, entity_type: entityType, entity_id: entityId, value: coerced });
    }

    // Delete the unset ones first (so flipping a value to empty clears it).
    if (toDelete.length > 0) {
      const { error } = await acct()
        .from('custom_field_values')
        .delete()
        .eq('entity_id', entityId)
        .in('def_id', toDelete);
      if (error) return { ok: false, saved: toUpsert.length, error: error.message };
    }

    if (toUpsert.length > 0) {
      const { error } = await acct()
        .from('custom_field_values')
        .upsert(toUpsert, { onConflict: 'def_id,entity_id' });
      if (error) return { ok: false, saved: 0, error: error.message };
    }

    return { ok: true, saved: toUpsert.length };
  },

  /**
   * Convenience boxing for a single raw value against a def id (without persisting). Used
   * by callers that want the canonical box before assembling a setValues batch. Returns
   * null when the def is unknown or the value is unset/invalid.
   */
  async coerce(defId: string, rawValue: CustomFieldValueJson): Promise<CustomFieldValueJson> {
    const def = await this.getDefById(defId);
    if (!def) return null;
    return coerceCustomFieldValue(def, rawValue);
  },
};

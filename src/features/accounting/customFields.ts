/**
 * Pure helpers for custom fields on accounting entities (D4).
 *
 * These have NO React/Supabase dependency so the coercion/validation/sort logic is
 * trivially unit-testable (see customFields.test.ts). They are the single source of
 * truth for turning a raw form input into the correctly-typed JSON box that lands in
 * accounting.custom_field_values.value (jsonb) — and for the inverse (boxed value →
 * display string) — so every screen that renders or edits a custom field boxes/unboxes
 * it identically.
 *
 * Custom fields move NO money (they are pure metadata), so nothing here posts a journal
 * entry — there is deliberately no posting/cents math in this file (per invariant G3,
 * vacuous for metadata, exactly like dimensions B2 / budgets D2).
 *
 * VALUE BOXING (mirrors the DB column semantics):
 *   text   → a trimmed JSON string ('' → null/unset)
 *   number → a finite JSON number  (non-numeric → invalid)
 *   date   → an ISO 'YYYY-MM-DD' JSON string (bad shape → invalid)
 *   boolean→ a JSON boolean        (anything falsy/absent → false)
 *   select → the chosen option's JSON string value (must be one of the def options)
 * A null/empty input always coerces to null = "unset" (the service deletes the row),
 * so the values table only ever holds set values.
 */
import type {
  CustomFieldDataType,
  CustomFieldDef,
  CustomFieldOption,
  CustomFieldValidationResult,
  CustomFieldValueJson,
} from './types';

/** True when `v` is a non-empty ISO calendar date `YYYY-MM-DD` that is a real day. */
export function isISODateString(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  // Reject impossible days (e.g. 2026-02-30) by round-tripping through UTC.
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/** True when a raw value is "empty" (unset): null, undefined, or an all-whitespace string. */
export function isEmptyValue(raw: unknown): boolean {
  return raw == null || (typeof raw === 'string' && raw.trim() === '');
}

/**
 * Validate + coerce a raw form value against a definition into the canonical JSON box.
 *
 * Returns { valid, coerced, error }:
 *  - An empty input is ALWAYS valid and coerces to null (= unset / delete the row),
 *    regardless of data type — custom fields are optional metadata.
 *  - Otherwise the value is coerced per the def's dataType; if it cannot be coerced the
 *    result is invalid with a human message and `coerced` falls back to null.
 *
 * Pure: no DB, no Date-from-local-clock for storage (dates stay ISO strings).
 */
export function validateCustomFieldValue(
  def: Pick<CustomFieldDef, 'dataType' | 'label' | 'options'>,
  raw: unknown
): CustomFieldValidationResult {
  // Unset is always allowed (optional field) → store nothing.
  if (isEmptyValue(raw)) return { valid: true, coerced: null };

  const label = def.label || 'This field';

  switch (def.dataType) {
    case 'text': {
      const s = String(raw).trim();
      return s === '' ? { valid: true, coerced: null } : { valid: true, coerced: s };
    }

    case 'number': {
      // Accept a number or a numeric string; reject anything non-finite.
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
      if (!Number.isFinite(n)) {
        return { valid: false, coerced: null, error: `${label} must be a number.` };
      }
      return { valid: true, coerced: n };
    }

    case 'date': {
      const s = String(raw).trim();
      if (!isISODateString(s)) {
        return { valid: false, coerced: null, error: `${label} must be a valid date.` };
      }
      return { valid: true, coerced: s };
    }

    case 'boolean': {
      return { valid: true, coerced: coerceBoolean(raw) };
    }

    case 'select': {
      const s = String(raw).trim();
      const allowed = (def.options ?? []).some((o) => o.value === s);
      if (!allowed) {
        return {
          valid: false,
          coerced: null,
          error: `${label}: "${s}" is not one of the choices.`,
        };
      }
      return { valid: true, coerced: s };
    }

    default: {
      // Unknown data type (shouldn't happen — DB CHECK constrains it). Be permissive:
      // store the trimmed string form rather than throwing.
      const s = String(raw).trim();
      return s === '' ? { valid: true, coerced: null } : { valid: true, coerced: s };
    }
  }
}

/**
 * Coerce a raw value to the canonical JSON box, discarding the validity flag/message.
 * Convenience for callers that have already validated (or that want best-effort boxing).
 * An invalid value coerces to null (unset) rather than throwing.
 */
export function coerceCustomFieldValue(
  def: Pick<CustomFieldDef, 'dataType' | 'label' | 'options'>,
  raw: unknown
): CustomFieldValueJson {
  return validateCustomFieldValue(def, raw).coerced;
}

/** Truthiness for the boolean data type (handles checkbox strings/numbers). */
function coerceBoolean(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  if (typeof raw === 'string') {
    const s = raw.trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'yes' || s === 'on';
  }
  return false;
}

/**
 * Format a boxed value for read-only display. boolean → 'Yes'/'No'; select → the option
 * LABEL (falling back to the raw value when the option was removed); number → its string;
 * text/date → the string; null/unset → '' (or `emptyText` when supplied).
 * Pure presentation — no locale Date construction (dates are already ISO strings).
 */
export function formatCustomFieldValue(
  def: Pick<CustomFieldDef, 'dataType' | 'options'>,
  value: CustomFieldValueJson,
  emptyText = ''
): string {
  if (value == null) return emptyText;

  switch (def.dataType) {
    case 'boolean':
      return coerceBoolean(value) ? 'Yes' : 'No';
    case 'select': {
      const match = (def.options ?? []).find((o) => o.value === String(value));
      return match ? match.label : String(value);
    }
    case 'number':
      return typeof value === 'number' ? String(value) : String(value);
    default:
      return String(value);
  }
}

/**
 * Stable render/display order for a set of defs: by sortOrder ascending, then label
 * (case-insensitive), then key — so ties are deterministic. Returns a NEW array (does
 * not mutate the input). The DB index is (entity_type, active, sort_order); this gives
 * the same primary order plus a stable tiebreak for equal sort_order.
 */
export function sortDefs<T extends Pick<CustomFieldDef, 'sortOrder' | 'label' | 'key'>>(
  defs: readonly T[]
): T[] {
  return [...defs].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    const byLabel = a.label.localeCompare(b.label, undefined, { sensitivity: 'accent' });
    if (byLabel !== 0) return byLabel;
    return a.key.localeCompare(b.key);
  });
}

/**
 * Normalize a free-typed key into the snake_case shape the unique (entity_type, key)
 * constraint expects: lowercased, non-alphanumerics → underscores, collapsed/trimmed
 * underscores. Used by the admin screen so an admin can type "PO Number" and get
 * "po_number". Empty/garbage input yields '' (the service rejects an empty key).
 */
export function normalizeKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
}

/** True only for the data type that uses the options choice list. */
export function dataTypeUsesOptions(dataType: CustomFieldDataType): boolean {
  return dataType === 'select';
}

/**
 * Clean a raw options list for persistence on a def: trim value/label, drop entries with
 * an empty value, de-duplicate by value (first wins), and default a missing label to the
 * value. Returns [] for non-select callers via dataTypeUsesOptions upstream, but is safe
 * to call regardless. Pure; returns a new array.
 */
export function normalizeOptions(
  options: readonly CustomFieldOption[] | undefined
): CustomFieldOption[] {
  if (!options || options.length === 0) return [];
  const seen = new Set<string>();
  const out: CustomFieldOption[] = [];
  for (const o of options) {
    const value = String(o?.value ?? '').trim();
    if (value === '' || seen.has(value)) continue;
    seen.add(value);
    const label = String(o?.label ?? '').trim() || value;
    out.push({ value, label });
  }
  return out;
}

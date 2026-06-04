import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { formatCustomFieldValue, validateCustomFieldValue } from '../customFields';
import { useEntityCustomFields } from '../hooks/useAccountingQueries';
import { useSaveCustomFieldValues } from '../hooks/useAccountingMutations';
import type {
  CustomFieldDef,
  CustomFieldEntityType,
  CustomFieldValueInput,
  CustomFieldValueJson,
  CustomFieldWithValue,
} from '../types';

const inputClass =
  'w-full rounded-sm border border-white/10 bg-background-dark px-2 py-1.5 text-white focus:border-primary focus:outline-none';

/**
 * Local edit-state for the section: one raw value per def id. We keep the *raw* form
 * value (string for text/date/select, number for number, boolean for boolean) and only
 * box it to the canonical JSON on save via validateCustomFieldValue. A def absent from
 * the map is treated as unset.
 */
type RawValues = Record<string, CustomFieldValueJson>;

/** Build the initial raw-value map from the loaded {def,value} pairs. */
function rawFromPairs(pairs: CustomFieldWithValue[]): RawValues {
  const out: RawValues = {};
  for (const { def, value } of pairs) out[def.id] = value;
  return out;
}

/** The control id for a field's input (stable, namespaced so two sections never collide). */
function fieldInputId(entityType: CustomFieldEntityType, defId: string): string {
  return `cf-${entityType}-${defId}`;
}

/**
 * A single custom-field editor, dispatched on the def's dataType. Emits the raw value
 * (not yet boxed) up to the section, which boxes/validates on save. Read-only mode just
 * renders the formatted value (used on a create screen before the entity exists, where
 * the values cannot be persisted yet).
 */
function CustomFieldInput({
  def,
  entityType,
  value,
  onChange,
  disabled,
}: {
  def: CustomFieldDef;
  entityType: CustomFieldEntityType;
  value: CustomFieldValueJson;
  onChange: (raw: CustomFieldValueJson) => void;
  disabled?: boolean;
}) {
  const id = fieldInputId(entityType, def.id);

  switch (def.dataType) {
    case 'boolean':
      return (
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            id={id}
            type="checkbox"
            checked={value === true}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
            className="size-4 accent-primary disabled:opacity-50"
          />
          {value === true ? 'Yes' : 'No'}
        </label>
      );

    case 'select':
      return (
        <select
          id={id}
          className={inputClass}
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        >
          <option value="">— None —</option>
          {def.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );

    case 'number':
      return (
        <input
          id={id}
          type="number"
          inputMode="decimal"
          className={inputClass}
          value={typeof value === 'number' ? value : ''}
          disabled={disabled}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw.trim() === '') {
              onChange(null);
              return;
            }
            const n = Number.parseFloat(raw);
            // Keep the raw string's intent: pass the number through, or the string so
            // validateCustomFieldValue can reject a non-numeric entry on save.
            onChange(Number.isFinite(n) ? n : raw);
          }}
          placeholder="0"
        />
      );

    case 'date':
      return (
        <input
          id={id}
          type="date"
          className={inputClass}
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        />
      );

    case 'text':
    default:
      return (
        <input
          id={id}
          className={inputClass}
          value={typeof value === 'string' ? value : value == null ? '' : String(value)}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
          placeholder="—"
        />
      );
  }
}

/** Field label + helper text + the dispatched editor (or a read-only value). */
function CustomFieldRow({
  pair,
  entityType,
  rawValue,
  onChange,
  readOnly,
  error,
}: {
  pair: CustomFieldWithValue;
  entityType: CustomFieldEntityType;
  rawValue: CustomFieldValueJson;
  onChange: (raw: CustomFieldValueJson) => void;
  readOnly?: boolean;
  error?: string;
}) {
  const { def } = pair;
  const id = fieldInputId(entityType, def.id);

  return (
    <div className="flex flex-col">
      <label htmlFor={id} className="mb-1 block text-sm font-bold text-slate-400">
        {def.label}
      </label>
      {readOnly ? (
        <p className="rounded-sm border border-white/5 bg-background-dark/60 px-2 py-1.5 text-sm text-slate-200">
          {formatCustomFieldValue(def, rawValue, '—')}
        </p>
      ) : (
        <CustomFieldInput def={def} entityType={entityType} value={rawValue} onChange={onChange} />
      )}
      {error ? (
        <p className="mt-1 text-xs text-red-400" role="alert">
          {error}
        </p>
      ) : (
        def.helpText && <p className="mt-1 text-xs text-slate-500">{def.helpText}</p>
      )}
    </div>
  );
}

interface CustomFieldsSectionProps {
  entityType: CustomFieldEntityType;
  /**
   * The host entity's id. When undefined (a draft not yet saved) the section either
   * renders nothing, or — if `defsWhenDraft` pairs are supplied — a read-only preview;
   * values cannot be persisted until the entity has an id.
   */
  entityId: string | undefined;
  /** Heading shown above the fields (defaults to "Custom fields"). */
  title?: string;
  /**
   * When true the section is display-only (no editors, no Save). Used on screens that
   * show an entity but should not edit its custom values inline.
   */
  readOnly?: boolean;
  /**
   * Optional preview pairs to render (read-only) when there is no `entityId` yet. The
   * host create screen can pass useCustomFieldDefs(entityType) mapped to {def, value:null}
   * so the user can see which fields exist before saving the draft.
   */
  draftPreview?: CustomFieldWithValue[];
}

/**
 * D4 — Additive custom-fields editor for one accounting entity (invoice/bill/customer/
 * vendor/account/journal_entry). Zero-footprint by design: it owns its OWN data (the
 * active definitions + this entity's values) via useEntityCustomFields and persists via
 * useSaveCustomFieldValues, so it can be dropped onto an existing screen WITHOUT changing
 * that screen's form or save path. Custom fields are pure metadata — saving them moves NO
 * money and posts NO journal entry, so the CPA/EA disclaimer is N/A here.
 *
 * It renders nothing at all when the entity type has no active definitions, so a host
 * screen that mounts it pays no visual cost until an admin defines a field.
 */
export function CustomFieldsSection({
  entityType,
  entityId,
  title = 'Custom fields',
  readOnly = false,
  draftPreview,
}: CustomFieldsSectionProps) {
  const { data: pairs = [], isPending, isError } = useEntityCustomFields(entityType, entityId);
  const saveValues = useSaveCustomFieldValues();

  // Local edit-state, seeded from the loaded values and re-seeded whenever they change
  // (e.g. after a save invalidates + refetches, or the entity id changes).
  const [raw, setRaw] = useState<RawValues>({});
  const [dirty, setDirty] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!entityId) return;
    setRaw(rawFromPairs(pairs));
    setDirty(false);
    setFieldErrors({});
    setFormError(null);
    // `pairs` is React Query's referentially-stable data, so this re-seeds only when the
    // entity changes or a save invalidates + refetches new values.
  }, [entityId, pairs]);

  const setField = (defId: string, value: CustomFieldValueJson) => {
    setRaw((prev) => ({ ...prev, [defId]: value }));
    setDirty(true);
    setSavedAt(null);
    setFieldErrors((prev) => {
      if (!prev[defId]) return prev;
      const next = { ...prev };
      delete next[defId];
      return next;
    });
  };

  const save = async () => {
    setFormError(null);
    const errors: Record<string, string> = {};
    const inputs: CustomFieldValueInput[] = [];

    // Validate every active def against its raw value, boxing to the canonical JSON.
    for (const { def } of pairs) {
      const rawValue = Object.prototype.hasOwnProperty.call(raw, def.id) ? raw[def.id] : null;
      const result = validateCustomFieldValue(def, rawValue);
      if (!result.valid) {
        errors[def.id] = result.error ?? 'Invalid value.';
        continue;
      }
      inputs.push({ defId: def.id, value: result.coerced });
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    if (!entityId) return;

    const res = await saveValues.mutateAsync({ entityType, entityId, values: inputs });
    if (!res.ok) {
      setFormError(res.error ?? 'Could not save the custom fields.');
      return;
    }
    setDirty(false);
    setFieldErrors({});
    setSavedAt(Date.now());
  };

  // ── Draft (no entity id yet): render a read-only preview if pairs were supplied. ──
  if (!entityId) {
    const preview = draftPreview ?? [];
    if (preview.length === 0) return null;
    return (
      <section className="flex flex-col gap-3">
        <SectionHeading title={title} />
        <p className="text-xs text-slate-500">
          These custom fields can be filled in after the draft is saved.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {preview.map((pair) => (
            <CustomFieldRow
              key={pair.def.id}
              pair={pair}
              entityType={entityType}
              rawValue={pair.value}
              onChange={() => {}}
              readOnly
            />
          ))}
        </div>
      </section>
    );
  }

  // ── Persisted entity: load + edit + save. Render nothing until we know there are
  //    defs (so a host screen with zero custom fields shows no empty section). ──
  if (isPending) {
    return (
      <section className="flex flex-col gap-2">
        <SectionHeading title={title} />
        <p className="text-sm text-slate-500">Loading custom fields…</p>
      </section>
    );
  }

  if (isError) {
    return (
      <section className="flex flex-col gap-2">
        <SectionHeading title={title} />
        <p className="text-sm text-red-400">Could not load custom fields.</p>
      </section>
    );
  }

  // No active definitions for this entity type → render nothing (zero footprint).
  if (pairs.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <SectionHeading title={title} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {pairs.map((pair) => (
          <CustomFieldRow
            key={pair.def.id}
            pair={pair}
            entityType={entityType}
            rawValue={
              Object.prototype.hasOwnProperty.call(raw, pair.def.id) ? raw[pair.def.id] : null
            }
            onChange={(v) => setField(pair.def.id, v)}
            readOnly={readOnly}
            error={fieldErrors[pair.def.id]}
          />
        ))}
      </div>

      {formError && (
        <p className="text-sm text-red-400" role="alert">
          {formError}
        </p>
      )}

      {!readOnly && (
        <div className="flex items-center justify-end gap-3">
          {savedAt && !dirty && (
            <span className="text-xs text-green-400">Custom fields saved.</span>
          )}
          <Button
            size="sm"
            variant="secondary"
            icon="save"
            onClick={save}
            disabled={!dirty || saveValues.isPending}
          >
            {saveValues.isPending ? 'Saving…' : 'Save custom fields'}
          </Button>
        </div>
      )}
    </section>
  );
}

/** Shared section heading matching the line-items / payments section style. */
function SectionHeading({ title }: { title: string }) {
  return (
    <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-400">
      <span className="material-symbols-outlined text-lg text-primary">tune</span>
      {title}
    </h2>
  );
}

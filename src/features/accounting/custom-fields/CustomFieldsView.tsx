import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { AccountingShell } from '../components/AccountingShell';
import { dataTypeUsesOptions, normalizeKey } from '../customFields';
import { useCustomFieldDefs } from '../hooks/useAccountingQueries';
import {
  useCreateCustomFieldDef,
  useSetCustomFieldDefActive,
  useUpdateCustomFieldDef,
} from '../hooks/useAccountingMutations';
import {
  CUSTOM_FIELD_DATA_TYPES,
  CUSTOM_FIELD_DATA_TYPE_LABELS,
  CUSTOM_FIELD_ENTITY_TYPES,
  CUSTOM_FIELD_ENTITY_TYPE_LABELS,
  type CustomFieldDataType,
  type CustomFieldDef,
  type CustomFieldEntityType,
  type CustomFieldOption,
  type NewCustomFieldDefInput,
} from '../types';

const inputClass =
  'w-full rounded-sm border border-white/10 bg-background-dark px-2 py-1.5 text-white focus:border-primary focus:outline-none';

/** Short caption shown above each entity-type section explaining what the fields extend. */
const ENTITY_HINT: Record<CustomFieldEntityType, string> = {
  invoice: 'Extra fields on invoices (e.g. PO number, project phase).',
  bill: 'Extra fields on vendor bills (e.g. approval code, cost center).',
  customer: 'Extra fields on customers (e.g. account manager, region).',
  vendor: 'Extra fields on vendors (e.g. W-9 on file, payment portal).',
  account: 'Extra fields on chart-of-accounts accounts (e.g. tax line mapping).',
  journal_entry: 'Extra fields on journal entries (e.g. source system reference).',
};

const ENTITY_ICON: Record<CustomFieldEntityType, string> = {
  invoice: 'receipt_long',
  bill: 'request_quote',
  customer: 'person',
  vendor: 'store',
  account: 'account_tree',
  journal_entry: 'menu_book',
};

interface DefDraft {
  key: string;
  label: string;
  dataType: CustomFieldDataType;
  options: CustomFieldOption[];
  helpText: string;
  sortOrder: number;
  active: boolean;
}

function draftFromDef(d: CustomFieldDef): DefDraft {
  return {
    key: d.key,
    label: d.label,
    dataType: d.dataType,
    options: d.options.length > 0 ? d.options : [],
    helpText: d.helpText ?? '',
    sortOrder: d.sortOrder,
    active: d.active,
  };
}

function emptyDraft(): DefDraft {
  return { key: '', label: '', dataType: 'text', options: [], helpText: '', sortOrder: 0, active: true };
}

/** Editor for the {value,label} choice list of a select field. */
function OptionsEditor({
  options,
  onChange,
}: {
  options: CustomFieldOption[];
  onChange: (next: CustomFieldOption[]) => void;
}) {
  const update = (i: number, patch: Partial<CustomFieldOption>) =>
    onChange(options.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  const add = () => onChange([...options, { value: '', label: '' }]);
  const remove = (i: number) => onChange(options.filter((_, idx) => idx !== i));

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-bold text-slate-400">Choices</span>
      {options.length === 0 && (
        <p className="text-xs text-slate-500">
          Add at least one choice. The value is stored; the label is shown.
        </p>
      )}
      {options.map((o, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            aria-label={`Choice ${i + 1} value`}
            className={inputClass}
            value={o.value}
            onChange={(e) => update(i, { value: e.target.value })}
            placeholder="value (stored)"
          />
          <input
            aria-label={`Choice ${i + 1} label`}
            className={inputClass}
            value={o.label}
            onChange={(e) => update(i, { label: e.target.value })}
            placeholder="label (shown)"
          />
          <button
            type="button"
            onClick={() => remove(i)}
            aria-label={`Remove choice ${i + 1}`}
            className="flex size-9 shrink-0 items-center justify-center rounded-sm text-slate-500 hover:bg-white/10 hover:text-red-400"
          >
            <span className="material-symbols-outlined text-lg">delete</span>
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="flex items-center gap-1 self-start text-sm font-semibold text-primary hover:text-primary-hover"
      >
        <span className="material-symbols-outlined text-lg">add</span>
        Add choice
      </button>
    </div>
  );
}

/**
 * Create / edit dialog for one custom field definition. `entityType` is fixed (the create
 * button names it). On edit, `key` and `dataType` are NOT editable — changing either would
 * re-interpret or orphan existing values (the service rejects it; the admin deactivates +
 * recreates instead), so they render read-only. The select-options editor only appears for
 * dataType='select'.
 */
function DefEditorModal({
  entityType,
  def,
  onClose,
}: {
  entityType: CustomFieldEntityType;
  def: CustomFieldDef | null;
  onClose: () => void;
}) {
  const create = useCreateCustomFieldDef();
  const update = useUpdateCustomFieldDef();
  const [draft, setDraft] = useState<DefDraft>(def ? draftFromDef(def) : emptyDraft());
  const [keyTouched, setKeyTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = def != null;
  const busy = create.isPending || update.isPending;
  const entityLabel = CUSTOM_FIELD_ENTITY_TYPE_LABELS[entityType];

  const patch = (p: Partial<DefDraft>) => setDraft((prev) => ({ ...prev, ...p }));

  // On create, auto-derive the snake_case key from the label until the admin edits the
  // key by hand. The normalized form is also what the service stores, so the preview is
  // exactly what will land in (entity_type, key).
  const onLabelChange = (label: string) => {
    setDraft((prev) => ({
      ...prev,
      label,
      key: !isEdit && !keyTouched ? normalizeKey(label) : prev.key,
    }));
  };

  const normalizedKey = normalizeKey(draft.key);
  const usesOptions = dataTypeUsesOptions(draft.dataType);

  const submit = async () => {
    setError(null);
    const label = draft.label.trim();
    if (!label) {
      setError('Give this field a label.');
      return;
    }

    if (isEdit) {
      const res = await update.mutateAsync({
        id: def.id,
        input: {
          label,
          options: usesOptions ? draft.options : [],
          helpText: draft.helpText.trim() || null,
          sortOrder: draft.sortOrder,
          active: draft.active,
        },
      });
      if (res.error || !res.def) {
        setError(res.error ?? 'Could not save the field.');
        return;
      }
    } else {
      if (!normalizedKey) {
        setError('Give this field a key (letters or numbers).');
        return;
      }
      if (usesOptions && draft.options.filter((o) => o.value.trim() !== '').length === 0) {
        setError('A select field needs at least one choice.');
        return;
      }
      const input: NewCustomFieldDefInput = {
        entityType,
        key: normalizedKey,
        label,
        dataType: draft.dataType,
        options: usesOptions ? draft.options : [],
        helpText: draft.helpText.trim() || null,
        sortOrder: draft.sortOrder,
        active: draft.active,
      };
      const res = await create.mutateAsync(input);
      if (res.error || !res.def) {
        setError(
          res.error?.includes('duplicate') || res.error?.includes('unique')
            ? `A field with key “${normalizedKey}” already exists on ${entityLabel.toLowerCase()}s.`
            : res.error ?? 'Could not create the field.'
        );
        return;
      }
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-sm border border-white/10 bg-card-dark p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">
            {isEdit ? `Edit ${entityLabel.toLowerCase()} field` : `New ${entityLabel.toLowerCase()} field`}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-sm text-slate-400 hover:bg-white/10 hover:text-white"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <FormField label="Label" htmlFor="cf-label" required hint="Shown on the form.">
            <input
              id="cf-label"
              className={inputClass}
              value={draft.label}
              onChange={(e) => onLabelChange(e.target.value)}
              placeholder="e.g. PO Number"
            />
          </FormField>

          <FormField
            label="Key"
            htmlFor="cf-key"
            hint={
              isEdit
                ? 'The key is fixed after creation (changing it would orphan values).'
                : 'Machine name (snake_case). Auto-filled from the label; edit if needed.'
            }
          >
            <input
              id="cf-key"
              className={`${inputClass} font-mono ${isEdit ? 'opacity-60' : ''}`}
              value={draft.key}
              disabled={isEdit}
              onChange={(e) => {
                setKeyTouched(true);
                patch({ key: e.target.value });
              }}
              placeholder="e.g. po_number"
            />
          </FormField>

          {!isEdit && draft.key.trim() !== '' && normalizedKey !== draft.key && (
            <p className="-mt-1 text-xs text-slate-500">
              Stored as <span className="font-mono text-slate-300">{normalizedKey || '(empty)'}</span>
            </p>
          )}

          <FormField
            label="Type"
            htmlFor="cf-type"
            hint={isEdit ? 'The type is fixed after creation.' : undefined}
          >
            <select
              id="cf-type"
              className={`${inputClass} ${isEdit ? 'opacity-60' : ''}`}
              value={draft.dataType}
              disabled={isEdit}
              onChange={(e) => patch({ dataType: e.target.value as CustomFieldDataType })}
            >
              {CUSTOM_FIELD_DATA_TYPES.map((t) => (
                <option key={t} value={t}>
                  {CUSTOM_FIELD_DATA_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </FormField>

          {usesOptions && (
            <OptionsEditor options={draft.options} onChange={(options) => patch({ options })} />
          )}

          <FormField label="Help text" htmlFor="cf-help" hint="Optional caption under the field.">
            <input
              id="cf-help"
              className={inputClass}
              value={draft.helpText}
              onChange={(e) => patch({ helpText: e.target.value })}
              placeholder="Optional"
            />
          </FormField>

          <FormField label="Sort order" htmlFor="cf-sort" hint="Lower numbers render first.">
            <input
              id="cf-sort"
              type="number"
              className={inputClass}
              value={draft.sortOrder}
              onChange={(e) => patch({ sortOrder: Number.parseInt(e.target.value, 10) || 0 })}
            />
          </FormField>

          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={draft.active}
              onChange={(e) => patch({ active: e.target.checked })}
              className="size-4 accent-primary"
            />
            Active (shown on forms)
          </label>

          {error && (
            <p className="text-sm text-red-400" role="alert">
              {error}
            </p>
          )}

          <div className="mt-1 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={busy}>
              {busy ? 'Saving…' : isEdit ? 'Save' : 'Add field'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DefRow({ def, onEdit }: { def: CustomFieldDef; onEdit: () => void }) {
  const setActive = useSetCustomFieldDefActive();
  const busy = setActive.isPending;

  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-sm ${def.active ? 'text-white' : 'text-slate-500'}`}>
          {def.label}
        </span>
        <span className="block text-xs text-slate-500">
          <span className="font-mono">{def.key}</span>
          {' · '}
          {CUSTOM_FIELD_DATA_TYPE_LABELS[def.dataType]}
          {def.dataType === 'select' && ` (${def.options.length})`}
          {!def.active && ' · inactive'}
        </span>
      </span>
      <button
        type="button"
        onClick={() => setActive.mutate({ id: def.id, active: !def.active })}
        disabled={busy}
        aria-label={def.active ? 'Deactivate' : 'Reactivate'}
        title={def.active ? 'Deactivate' : 'Reactivate'}
        className="flex size-9 items-center justify-center rounded-sm text-slate-400 hover:bg-white/10 hover:text-white disabled:opacity-40"
      >
        <span className="material-symbols-outlined text-lg">
          {def.active ? 'toggle_on' : 'toggle_off'}
        </span>
      </button>
      <button
        type="button"
        onClick={onEdit}
        disabled={busy}
        aria-label="Edit"
        className="flex size-9 items-center justify-center rounded-sm text-slate-400 hover:bg-white/10 hover:text-white disabled:opacity-40"
      >
        <span className="material-symbols-outlined text-lg">edit</span>
      </button>
    </div>
  );
}

function EntitySection({
  entityType,
  defs,
  onAdd,
  onEdit,
}: {
  entityType: CustomFieldEntityType;
  defs: CustomFieldDef[];
  onAdd: () => void;
  onEdit: (d: CustomFieldDef) => void;
}) {
  const label = CUSTOM_FIELD_ENTITY_TYPE_LABELS[entityType];
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-400">
          <span className="material-symbols-outlined text-lg text-primary">{ENTITY_ICON[entityType]}</span>
          {label}
          <span className="font-mono text-xs font-normal text-slate-500">({defs.length})</span>
        </h2>
        <Button size="sm" variant="secondary" icon="add" onClick={onAdd}>
          Add
        </Button>
      </div>

      {defs.length === 0 ? (
        <p className="rounded-sm border border-dashed border-white/15 px-3 py-4 text-center text-sm text-slate-500">
          No custom fields yet. {ENTITY_HINT[entityType]}
        </p>
      ) : (
        <div className="divide-y divide-white/5 overflow-hidden rounded-sm border border-white/10">
          {defs.map((d) => (
            <DefRow key={d.id} def={d} onEdit={() => onEdit(d)} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * D4 — Custom fields admin. Per-entity-type CRUD for the extra fields that can be attached
 * to accounting entities (invoice/bill/customer/vendor/account/journal_entry). The defs are
 * pure METADATA — defining a field moves NO money and posts NO journal entry, so the CPA/EA
 * disclaimer is N/A here (it belongs on tax/report/export surfaces). Grouped one section per
 * entity type; the "show inactive" toggle reveals deactivated fields so they can be
 * reactivated. Active fields render/edit additively on the matching host create/detail
 * screens via CustomFieldsSection without changing those screens' own forms.
 */
export default function CustomFieldsView() {
  const [showInactive, setShowInactive] = useState(false);
  // Pass no entity type so we get ALL defs across entity types for the admin grouping.
  const { data: defs = [], isPending, isError } = useCustomFieldDefs(undefined, showInactive);
  const [editing, setEditing] = useState<CustomFieldDef | null>(null);
  const [creatingType, setCreatingType] = useState<CustomFieldEntityType | null>(null);

  // Group the flat list by entity type, preserving the service's (entity_type, sort, label)
  // ordering. Within a type the defs already arrive sorted by sort_order then label.
  const byEntity = useMemo(() => {
    const map = {} as Record<CustomFieldEntityType, CustomFieldDef[]>;
    for (const t of CUSTOM_FIELD_ENTITY_TYPES) map[t] = [];
    for (const d of defs) map[d.entityType]?.push(d);
    return map;
  }, [defs]);

  return (
    <AccountingShell active="custom-fields" title="Custom fields">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-xl text-sm text-slate-400">
            Define extra fields per accounting entity. Active fields appear on the matching
            create and detail screens, where they can be filled in and saved alongside the
            record. They are metadata only — they never move money or post a journal entry.
          </p>
          <label className="flex shrink-0 items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="size-4 accent-primary"
            />
            Show inactive
          </label>
        </div>

        {isPending && <p className="text-slate-400">Loading custom fields…</p>}
        {isError && (
          <p className="text-red-400">
            Could not load custom fields. Confirm the accounting schema is exposed and you
            have an accounting role.
          </p>
        )}

        {!isPending && !isError && (
          <div className="flex flex-col gap-6">
            {CUSTOM_FIELD_ENTITY_TYPES.map((entityType) => (
              <EntitySection
                key={entityType}
                entityType={entityType}
                defs={byEntity[entityType]}
                onAdd={() => setCreatingType(entityType)}
                onEdit={(d) => setEditing(d)}
              />
            ))}
          </div>
        )}
      </div>

      {creatingType && (
        <DefEditorModal entityType={creatingType} def={null} onClose={() => setCreatingType(null)} />
      )}
      {editing && (
        <DefEditorModal
          entityType={editing.entityType}
          def={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </AccountingShell>
  );
}

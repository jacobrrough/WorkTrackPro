import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { AccountingShell } from '../components/AccountingShell';
import { useDimensions } from '../hooks/useAccountingQueries';
import {
  useCreateDimension,
  useDeactivateDimension,
  useUpdateDimension,
} from '../hooks/useAccountingMutations';
import {
  DIMENSION_TYPES,
  DIMENSION_TYPE_LABELS,
  DIMENSION_TYPE_LABELS_PLURAL,
  type Dimension,
  type DimensionType,
  type NewDimensionInput,
} from '../types';

const inputClass =
  'w-full rounded-lg border border-line bg-background-dark px-2 py-1.5 text-white focus:border-primary focus:outline-none';

/** A short caption explaining what each dimension kind slices for reporting. */
const TYPE_HINT: Record<DimensionType, string> = {
  class: 'Tag postings by line of business or program (e.g. Residential, Commercial).',
  location: 'Tag postings by site, branch, or region (e.g. Main Shop, North Yard).',
  department: 'Tag postings by team or function (e.g. Fabrication, Install, Admin).',
};

const TYPE_ICON: Record<DimensionType, string> = {
  class: 'sell',
  location: 'location_on',
  department: 'groups',
};

interface DimensionDraft {
  name: string;
  code: string;
  isActive: boolean;
}

function draftFromDimension(d: Dimension): DimensionDraft {
  return { name: d.name, code: d.code ?? '', isActive: d.isActive };
}

/**
 * Create / edit dialog for one dimension. `type` is fixed (the create button names it;
 * editing never re-types — the service rejects a dim_type change to avoid orphaning the
 * lines that reference it). On edit, the active toggle is the soft-delete reversal.
 */
function DimensionEditorModal({
  type,
  dimension,
  onClose,
}: {
  type: DimensionType;
  dimension: Dimension | null;
  onClose: () => void;
}) {
  const create = useCreateDimension();
  const update = useUpdateDimension();
  const [draft, setDraft] = useState<DimensionDraft>(
    dimension ? draftFromDimension(dimension) : { name: '', code: '', isActive: true }
  );
  const [error, setError] = useState<string | null>(null);

  const patch = (p: Partial<DimensionDraft>) => setDraft((prev) => ({ ...prev, ...p }));
  const busy = create.isPending || update.isPending;
  const label = DIMENSION_TYPE_LABELS[type];

  const submit = async () => {
    setError(null);
    const name = draft.name.trim();
    if (!name) {
      setError(`Give this ${label.toLowerCase()} a name.`);
      return;
    }
    if (dimension) {
      const res = await update.mutateAsync({
        id: dimension.id,
        input: { name, code: draft.code.trim() || null, isActive: draft.isActive },
      });
      if (res.error || !res.dimension) {
        setError(res.error ?? 'Could not save the dimension.');
        return;
      }
    } else {
      const input: NewDimensionInput = {
        dimType: type,
        name,
        code: draft.code.trim() || null,
      };
      const res = await create.mutateAsync(input);
      if (res.error || !res.dimension) {
        // The most common failure is the unique (type, name) violation.
        setError(
          res.error?.includes('duplicate') || res.error?.includes('unique')
            ? `A ${label.toLowerCase()} named “${name}” already exists.`
            : (res.error ?? 'Could not create the dimension.')
        );
        return;
      }
    }
    onClose();
  };

  return (
    <div className="app-modal-backdrop z-modal p-4">
      <div className="w-full max-w-md rounded-2xl border border-line bg-card-dark p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">
            {dimension ? `Edit ${label.toLowerCase()}` : `New ${label.toLowerCase()}`}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-overlay/10 hover:text-white"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <p className="mb-3 text-sm text-muted">{TYPE_HINT[type]}</p>

        <div className="flex flex-col gap-3">
          <FormField label="Name" htmlFor="dim-name" required>
            <input
              id="dim-name"
              className={inputClass}
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder={`e.g. ${label === 'Class' ? 'Residential' : label === 'Location' ? 'Main Shop' : 'Fabrication'}`}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
            />
          </FormField>

          <FormField
            label="Code"
            htmlFor="dim-code"
            hint="Optional short code shown in pickers and reports."
          >
            <input
              id="dim-code"
              className={inputClass}
              value={draft.code}
              onChange={(e) => patch({ code: e.target.value })}
              placeholder="e.g. RES"
            />
          </FormField>

          {dimension && (
            <label className="flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={draft.isActive}
                onChange={(e) => patch({ isActive: e.target.checked })}
                className="size-4 accent-primary"
              />
              Active (available to tag new lines)
            </label>
          )}

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
              {busy ? 'Saving…' : dimension ? 'Save' : `Add ${label.toLowerCase()}`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DimensionRow({ dimension, onEdit }: { dimension: Dimension; onEdit: () => void }) {
  const deactivate = useDeactivateDimension();
  const update = useUpdateDimension();
  const busy = deactivate.isPending || update.isPending;

  const onToggle = () => {
    if (dimension.isActive) {
      deactivate.mutate(dimension.id);
    } else {
      // Reactivate without opening the editor.
      update.mutate({ id: dimension.id, input: { isActive: true } });
    }
  };

  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-sm ${dimension.isActive ? 'text-white' : 'text-subtle'}`}
        >
          {dimension.name}
        </span>
        <span className="block text-xs text-subtle">
          {dimension.code ? <span className="font-mono">{dimension.code}</span> : 'No code'}
          {!dimension.isActive && ' · inactive'}
        </span>
      </span>
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        aria-label={dimension.isActive ? 'Deactivate' : 'Reactivate'}
        title={dimension.isActive ? 'Deactivate' : 'Reactivate'}
        className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-overlay/10 hover:text-white disabled:opacity-40"
      >
        <span className="material-symbols-outlined text-lg">
          {dimension.isActive ? 'toggle_on' : 'toggle_off'}
        </span>
      </button>
      <button
        type="button"
        onClick={onEdit}
        disabled={busy}
        aria-label="Edit"
        className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-overlay/10 hover:text-white disabled:opacity-40"
      >
        <span className="material-symbols-outlined text-lg">edit</span>
      </button>
    </div>
  );
}

function DimensionSection({
  type,
  dimensions,
  onAdd,
  onEdit,
}: {
  type: DimensionType;
  dimensions: Dimension[];
  onAdd: () => void;
  onEdit: (d: Dimension) => void;
}) {
  const plural = DIMENSION_TYPE_LABELS_PLURAL[type];
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted">
          <span className="material-symbols-outlined text-lg text-primary">{TYPE_ICON[type]}</span>
          {plural}
          <span className="font-mono text-xs font-normal text-subtle">({dimensions.length})</span>
        </h2>
        <Button size="sm" variant="secondary" icon="add" onClick={onAdd}>
          Add
        </Button>
      </div>

      {dimensions.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-sm text-subtle">
          No {plural.toLowerCase()} yet. {TYPE_HINT[type]}
        </p>
      ) : (
        <div className="divide-y divide-overlay/5 overflow-hidden rounded-lg border border-line">
          {dimensions.map((d) => (
            <DimensionRow key={d.id} dimension={d} onEdit={() => onEdit(d)} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * B2 — Reporting dimensions admin. CRUD for the class / location / department tags that
 * can be stamped onto journal/invoice/bill lines so postings can be sliced for
 * reporting. Pure master data: dimensions move NO money, so the CPA/EA disclaimer is N/A
 * here (it belongs on tax/report/export surfaces). Grouped one section per type; the
 * "show inactive" toggle reveals soft-deleted tags so they can be reactivated.
 */
export default function DimensionsView() {
  const [showInactive, setShowInactive] = useState(false);
  const { data: dimensions = [], isPending, isError } = useDimensions(showInactive);
  const [editing, setEditing] = useState<Dimension | null>(null);
  const [creatingType, setCreatingType] = useState<DimensionType | null>(null);

  // Group the flat list by type, preserving the service's (type, name) ordering.
  const byType = useMemo(() => {
    const map: Record<DimensionType, Dimension[]> = { class: [], location: [], department: [] };
    for (const d of dimensions) map[d.dimType].push(d);
    return map;
  }, [dimensions]);

  return (
    <AccountingShell active="dimensions" title="Dimensions">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-xl text-sm text-muted">
            Classes, locations, and departments are reporting tags you can attach to invoice, bill,
            and journal lines. They never move money — they slice the same postings so reports can
            be filtered by program, site, or team.
          </p>
          <label className="flex shrink-0 items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="size-4 accent-primary"
            />
            Show inactive
          </label>
        </div>

        {isPending && <p className="text-muted">Loading dimensions…</p>}
        {isError && (
          <p className="text-red-400">
            Could not load dimensions. Confirm the accounting schema is exposed and you have an
            accounting role.
          </p>
        )}

        {!isPending && !isError && (
          <div className="flex flex-col gap-6">
            {DIMENSION_TYPES.map((type) => (
              <DimensionSection
                key={type}
                type={type}
                dimensions={byType[type]}
                onAdd={() => setCreatingType(type)}
                onEdit={(d) => setEditing(d)}
              />
            ))}
          </div>
        )}
      </div>

      {creatingType && (
        <DimensionEditorModal
          type={creatingType}
          dimension={null}
          onClose={() => setCreatingType(null)}
        />
      )}
      {editing && (
        <DimensionEditorModal
          type={editing.dimType}
          dimension={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </AccountingShell>
  );
}

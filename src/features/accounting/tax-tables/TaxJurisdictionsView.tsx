import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FormField } from '@/components/ui/FormField';
import { taxJurisdictionsService } from '@/services/api/accounting';
import { AccountingShell } from '../components/AccountingShell';
import { TaxDisclaimer } from '../components/TaxDisclaimer';
import { useTaxCodes } from '../hooks/useAccountingQueries';
import { SETTINGS_BASE } from '../constants';
import type { TaxCode, TaxJurisdiction, UpdateTaxJurisdictionInput } from '../types';

const inputClass =
  'w-full rounded-sm border border-white/10 bg-background-dark px-2 py-1.5 text-white focus:border-primary focus:outline-none';

/** Blank draft for the "add a mapping" row. country defaults to US. */
const emptyDraft = (): UpdateTaxJurisdictionInput => ({
  country: 'US',
  state: '',
  county: '',
  city: '',
  zip: '',
  taxCodeId: '',
  priority: 0,
});

/** Human label for a tax code in the select (name + rate, like the invoice screen). */
function taxCodeLabel(t: TaxCode): string {
  return `${t.name}${t.isTaxable ? ` (${(t.rate * 100).toFixed(3)}%)` : ' (non-taxable)'}`;
}

/** A "—" placeholder for an unconstrained (wildcard) geography component. */
function geo(v: string | null): string {
  return v && v.trim() !== '' ? v : '—';
}

/** Specificity label so an admin reads at a glance which rules win. */
function specificityLabel(j: TaxJurisdiction): string {
  if (j.zip) return 'ZIP';
  if (j.city) return 'City';
  if (j.county) return 'County';
  if (j.state) return 'State';
  return 'Country';
}

/**
 * The add/edit form for one geography → tax-code mapping. Controlled; calls back with the
 * assembled input. Kept inline (no modal) so the screen stays simple — mirrors the other
 * lightweight settings panels.
 */
function JurisdictionForm({
  draft,
  taxCodes,
  busy,
  onChange,
  onSave,
  onCancel,
}: {
  draft: UpdateTaxJurisdictionInput;
  taxCodes: TaxCode[];
  busy: boolean;
  onChange: (patch: Partial<UpdateTaxJurisdictionInput>) => void;
  onSave: () => void;
  onCancel?: () => void;
}) {
  const canSave = !!draft.taxCodeId && !busy;
  return (
    <Card padding="lg" className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Country" htmlFor="jur-country">
          <input
            id="jur-country"
            className={inputClass}
            value={draft.country ?? 'US'}
            onChange={(e) => onChange({ country: e.target.value })}
            placeholder="US"
          />
        </FormField>
        <FormField label="State" htmlFor="jur-state" hint="2-letter code, e.g. CA">
          <input
            id="jur-state"
            className={inputClass}
            value={draft.state ?? ''}
            onChange={(e) => onChange({ state: e.target.value })}
            placeholder="CA"
          />
        </FormField>
        <FormField label="County" htmlFor="jur-county">
          <input
            id="jur-county"
            className={inputClass}
            value={draft.county ?? ''}
            onChange={(e) => onChange({ county: e.target.value })}
            placeholder="e.g. Los Angeles"
          />
        </FormField>
        <FormField label="City" htmlFor="jur-city">
          <input
            id="jur-city"
            className={inputClass}
            value={draft.city ?? ''}
            onChange={(e) => onChange({ city: e.target.value })}
            placeholder="Optional"
          />
        </FormField>
        <FormField label="ZIP" htmlFor="jur-zip" hint="Most specific match wins">
          <input
            id="jur-zip"
            className={inputClass}
            value={draft.zip ?? ''}
            onChange={(e) => onChange({ zip: e.target.value })}
            placeholder="e.g. 90001"
            inputMode="numeric"
          />
        </FormField>
        <FormField label="Tax code" htmlFor="jur-code" required>
          <select
            id="jur-code"
            className={inputClass}
            value={draft.taxCodeId ?? ''}
            onChange={(e) => onChange({ taxCodeId: e.target.value })}
          >
            <option value="">Select tax code…</option>
            {taxCodes.map((t) => (
              <option key={t.id} value={t.id}>
                {taxCodeLabel(t)}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Priority" htmlFor="jur-priority" hint="Higher wins a specificity tie">
          <input
            id="jur-priority"
            type="number"
            className={inputClass}
            value={String(draft.priority ?? 0)}
            onChange={(e) => onChange({ priority: Math.trunc(Number(e.target.value)) || 0 })}
          />
        </FormField>
      </div>
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
        <Button size="sm" icon="save" onClick={onSave} disabled={!canSave}>
          {busy ? 'Saving…' : draft.id ? 'Save changes' : 'Add mapping'}
        </Button>
      </div>
    </Card>
  );
}

/** One mapping row in the list: geography → code, with edit/remove. */
function JurisdictionRow({
  jurisdiction,
  codeName,
  onEdit,
  onRemove,
  removing,
}: {
  jurisdiction: TaxJurisdiction;
  codeName: string;
  onEdit: () => void;
  onRemove: () => void;
  removing: boolean;
}) {
  return (
    <div className="flex items-start gap-3 px-3 py-3">
      <span className="material-symbols-outlined text-muted">location_on</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-slate-500/15 px-2 py-0.5 text-[11px] font-semibold text-muted">
            {specificityLabel(jurisdiction)}
          </span>
          <span className="truncate font-semibold text-white">{codeName}</span>
        </div>
        <p className="mt-0.5 text-xs text-subtle">
          {geo(jurisdiction.country)} · {geo(jurisdiction.state)} · {geo(jurisdiction.county)} ·{' '}
          {geo(jurisdiction.city)} · {geo(jurisdiction.zip)}
          {jurisdiction.priority !== 0 ? ` · priority ${jurisdiction.priority}` : ''}
        </p>
      </div>
      <Button size="sm" variant="ghost" icon="edit" onClick={onEdit}>
        Edit
      </Button>
      <Button size="sm" variant="ghost" icon="delete" onClick={onRemove} disabled={removing}>
        Remove
      </Button>
    </div>
  );
}

/**
 * #13 — sales-tax RATE AUTOMATION management screen (ADVISORY-ONLY), under Settings.
 *
 * View/edit the geography → tax-code map that drives address-based auto-suggest on the
 * invoice/estimate create screens. A mapping points an address (country/state/county/city/zip)
 * at an EXISTING composite tax code — it never defines a rate, so the TAX-SYNC drift framework
 * keeps the underlying rates current. Nothing here moves money or posts a journal entry.
 *
 * Self-contained (loads via the service + local state, like the other lightweight settings
 * panels) so it carries no new query-cache wiring. The list is shown most-specific first,
 * matching the resolver's ordering.
 *
 * G9: carries the CPA/EA + representative-rates disclaimer, plus the explicit ZIP-level
 * accuracy caveat (a ZIP can straddle districts; rooftop/parcel accuracy is a future paid
 * provider upgrade — mentioned, not built).
 */
export default function TaxJurisdictionsView() {
  const navigate = useNavigate();
  const { data: taxCodes = [] } = useTaxCodes();

  const [rows, setRows] = useState<TaxJurisdiction[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<UpdateTaxJurisdictionInput>(emptyDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const codeNameById = useMemo(
    () => new Map(taxCodes.map((t) => [t.id, taxCodeLabel(t)])),
    [taxCodes]
  );

  const reload = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setRows(await taxJurisdictionsService.list());
    } catch {
      setLoadError(
        'Could not load the tax jurisdictions. Confirm the accounting schema is exposed.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    taxJurisdictionsService
      .list()
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch(() => {
        if (!cancelled)
          setLoadError(
            'Could not load the tax jurisdictions. Confirm the accounting schema is exposed.'
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const startEdit = (j: TaxJurisdiction) => {
    setFormError(null);
    setEditingId(j.id);
    setDraft({
      id: j.id,
      country: j.country,
      state: j.state ?? '',
      county: j.county ?? '',
      city: j.city ?? '',
      zip: j.zip ?? '',
      taxCodeId: j.taxCodeId,
      priority: j.priority,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(emptyDraft());
    setFormError(null);
  };

  const save = async () => {
    setFormError(null);
    if (!draft.taxCodeId) {
      setFormError('Pick a tax code for this mapping.');
      return;
    }
    setBusy(true);
    try {
      const saved = await taxJurisdictionsService.upsert(draft);
      if (!saved) {
        setFormError('Could not save the mapping. You may not have permission to edit tax data.');
        return;
      }
      await reload();
      cancelEdit();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setRemovingId(id);
    try {
      const ok = await taxJurisdictionsService.remove(id);
      if (ok) setRows((prev) => prev.filter((r) => r.id !== id));
      else
        setFormError('Could not remove the mapping. You may not have permission to edit tax data.');
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <AccountingShell active="settings" title="Sales-tax jurisdictions">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        {/* Prominent G9 disclaimer — representative rates + verify with a CPA/EA. */}
        <TaxDisclaimer representativeRates />

        <div className="flex items-start gap-2">
          <Button
            size="sm"
            variant="ghost"
            icon="arrow_back"
            onClick={() => navigate(SETTINGS_BASE)}
          >
            Settings
          </Button>
        </div>

        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold text-white">
            <span className="material-symbols-outlined text-primary">map</span>
            Sales-tax jurisdictions
          </h1>
          <p className="mt-1 text-sm text-muted">
            Map a customer&apos;s address to the sales-tax code to apply. When you pick a customer
            on a new invoice or estimate and haven&apos;t chosen a tax code yet, the most specific
            matching mapping is suggested automatically (you can always change it). A mapping points
            at an <span className="font-semibold text-muted">existing tax code</span> — it never
            creates a rate.
          </p>
          <p className="mt-2 rounded-sm border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-300">
            <span className="font-semibold">ZIP-level accuracy caveat:</span> a single ZIP code can
            span more than one taxing district, so a ZIP match is an approximation — verify with a
            CPA/EA. Rooftop/parcel-level accuracy (e.g. an Avalara-style provider) is a possible
            future upgrade and is not used here; all matching is from these internal tables.
          </p>
        </div>

        {/* Add / edit form */}
        <section>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">
            {editingId ? 'Edit mapping' : 'Add a mapping'}
          </h2>
          <JurisdictionForm
            draft={draft}
            taxCodes={taxCodes}
            busy={busy}
            onChange={(patch) => setDraft((prev) => ({ ...prev, ...patch }))}
            onSave={save}
            onCancel={editingId ? cancelEdit : undefined}
          />
          {formError && (
            <p className="mt-2 text-sm text-red-400" role="alert">
              {formError}
            </p>
          )}
        </section>

        {/* Existing mappings (most specific first). */}
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-base font-bold text-white">
            <span className="material-symbols-outlined text-primary">format_list_bulleted</span>
            Mappings
          </h2>
          <p className="mb-2 text-sm text-muted">
            Shown most specific first — that is also the order they are matched (ZIP, then city,
            then county, then state).
          </p>

          {loading && <p className="text-sm text-muted">Loading mappings…</p>}

          {!loading && loadError && (
            <div className="flex flex-col items-start gap-3 rounded-sm border border-red-500/30 bg-red-500/10 p-3">
              <p className="text-sm text-red-300">{loadError}</p>
              <Button size="sm" variant="secondary" icon="refresh" onClick={reload}>
                Retry
              </Button>
            </div>
          )}

          {!loading && !loadError && rows.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 rounded-sm border border-dashed border-white/15 px-6 py-12 text-center">
              <span className="material-symbols-outlined text-3xl text-subtle">map</span>
              <p className="font-bold text-white">No jurisdiction mappings yet</p>
              <p className="max-w-md text-sm text-muted">
                Add a mapping above to enable address-based tax-code suggestions on invoices and
                estimates.
              </p>
            </div>
          )}

          {!loading && !loadError && rows.length > 0 && (
            <Card padding="none" className="divide-y divide-white/5 overflow-hidden">
              {rows.map((j) => (
                <JurisdictionRow
                  key={j.id}
                  jurisdiction={j}
                  codeName={codeNameById.get(j.taxCodeId) ?? 'Unknown / inactive code'}
                  onEdit={() => startEdit(j)}
                  onRemove={() => remove(j.id)}
                  removing={removingId === j.id}
                />
              ))}
            </Card>
          )}
        </section>
      </div>
    </AccountingShell>
  );
}

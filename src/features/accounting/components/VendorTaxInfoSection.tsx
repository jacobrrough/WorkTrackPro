import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useVendorTaxInfo } from '../hooks/useAccountingQueries';
import { useUpsertVendorTaxInfo } from '../hooks/useAccountingMutations';
import { FEDERAL_ENTITY_TYPE_LABELS, type FederalEntityType } from '../types';

const inputClass =
  'w-full rounded-lg border border-line bg-background-dark px-2 py-1.5 text-white focus:border-primary focus:outline-none';

/** Local edit-state for the W-9 form (raw strings; boxed on save). */
interface FormState {
  legalName: string;
  taxId: string;
  addressLine: string;
  federalEntityType: '' | FederalEntityType;
  exempt: boolean;
}

const EMPTY_FORM: FormState = {
  legalName: '',
  taxId: '',
  addressLine: '',
  federalEntityType: '',
  exempt: false,
};

/**
 * Read a single-line address string out of the stored jsonb address object. The W-9 here
 * captures a simple one-line address (kept in the `line1` key) — richer structured address
 * editing is out of scope for the 1099 worklist. A non-string value degrades to ''.
 */
function addressLineOf(address: Record<string, unknown> | null): string {
  if (!address) return '';
  const line = address.line1;
  return typeof line === 'string' ? line : '';
}

/**
 * #12 — W-9 / tax-info editor for ONE vendor, modeled on CustomFieldsSection. Zero-footprint
 * and self-contained: it owns its OWN data (the vendor's accounting.vendor_tax_info record)
 * via useVendorTaxInfo and persists via useUpsertVendorTaxInfo, so it can be dropped onto an
 * existing vendor surface WITHOUT touching that screen's form or save path. It moves NO money
 * and posts NO journal entry — this is W-9 master data feeding the 1099-NEC worklist, so the
 * CPA/EA disclaimer is shown (the data is used to prepare a compliance figure).
 *
 * Renders nothing until a vendorId is known (e.g. a bill must have a vendor first).
 */
export function VendorTaxInfoSection({ vendorId }: { vendorId: string | undefined }) {
  const { data: info, isPending, isError } = useVendorTaxInfo(vendorId);
  const upsert = useUpsertVendorTaxInfo();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [dirty, setDirty] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Seed from the loaded record (and re-seed when it changes / after a save refetch).
  useEffect(() => {
    if (!vendorId) return;
    setForm(
      info
        ? {
            legalName: info.legalName ?? '',
            taxId: info.taxId ?? '',
            addressLine: addressLineOf(info.address),
            federalEntityType: info.federalEntityType ?? '',
            exempt: info.exempt,
          }
        : EMPTY_FORM
    );
    setDirty(false);
    setFormError(null);
  }, [vendorId, info]);

  if (!vendorId) return null;

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
    setSavedAt(null);
  };

  const save = async () => {
    if (!vendorId) return;
    setFormError(null);
    const addressLine = form.addressLine.trim();
    const res = await upsert.mutateAsync({
      vendorId,
      input: {
        legalName: form.legalName.trim() || null,
        taxId: form.taxId.trim() || null,
        address: addressLine ? { line1: addressLine } : null,
        federalEntityType: form.federalEntityType || null,
        exempt: form.exempt,
      },
    });
    if (!res.ok) {
      setFormError(res.error ?? 'Could not save the W-9 / tax info.');
      return;
    }
    setDirty(false);
    setSavedAt(Date.now());
  };

  return (
    <section className="flex flex-col gap-3">
      <SectionHeading />

      <p className="text-xs text-subtle">
        W-9 details used by the 1099-NEC worklist. This is master data — saving it moves no money
        and posts no journal entry. The Tax ID is sensitive (treat as PII).
      </p>

      {isPending ? (
        <p className="text-sm text-subtle">Loading tax info…</p>
      ) : isError ? (
        <p className="text-sm text-red-400">Could not load the vendor&rsquo;s tax info.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col">
              <label htmlFor="vti-legal-name" className="mb-1 block text-sm font-bold text-muted">
                Legal name (per W-9)
              </label>
              <input
                id="vti-legal-name"
                className={inputClass}
                value={form.legalName}
                onChange={(e) => setField('legalName', e.target.value)}
                placeholder="—"
              />
            </div>

            <div className="flex flex-col">
              <label htmlFor="vti-tax-id" className="mb-1 block text-sm font-bold text-muted">
                Tax ID (SSN / EIN)
              </label>
              <input
                id="vti-tax-id"
                className={inputClass}
                value={form.taxId}
                onChange={(e) => setField('taxId', e.target.value)}
                placeholder="—"
                autoComplete="off"
              />
            </div>

            <div className="flex flex-col sm:col-span-2">
              <label htmlFor="vti-address" className="mb-1 block text-sm font-bold text-muted">
                Address
              </label>
              <input
                id="vti-address"
                className={inputClass}
                value={form.addressLine}
                onChange={(e) => setField('addressLine', e.target.value)}
                placeholder="Street, city, state ZIP"
              />
            </div>

            <div className="flex flex-col">
              <label htmlFor="vti-entity-type" className="mb-1 block text-sm font-bold text-muted">
                Federal tax classification
              </label>
              <select
                id="vti-entity-type"
                className={inputClass}
                value={form.federalEntityType}
                onChange={(e) =>
                  setField('federalEntityType', e.target.value as '' | FederalEntityType)
                }
              >
                <option value="">— Not set —</option>
                {(Object.keys(FEDERAL_ENTITY_TYPE_LABELS) as FederalEntityType[]).map((t) => (
                  <option key={t} value={t}>
                    {FEDERAL_ENTITY_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-muted">
                <input
                  type="checkbox"
                  checked={form.exempt}
                  onChange={(e) => setField('exempt', e.target.checked)}
                  className="size-4 accent-primary"
                />
                Exempt from 1099 reporting
              </label>
            </div>
          </div>

          {formError && (
            <p className="text-sm text-red-400" role="alert">
              {formError}
            </p>
          )}

          <div className="flex items-center justify-end gap-3">
            {savedAt && !dirty && <span className="text-xs text-green-400">Tax info saved.</span>}
            <Button
              size="sm"
              variant="secondary"
              icon="save"
              onClick={save}
              disabled={!dirty || upsert.isPending}
            >
              {upsert.isPending ? 'Saving…' : 'Save tax info'}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

/** Section heading matching the custom-fields / attachments section style. */
function SectionHeading() {
  return (
    <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted">
      <span className="material-symbols-outlined text-lg text-primary">badge</span>
      W-9 / 1099 tax info
    </h2>
  );
}

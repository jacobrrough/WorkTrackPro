/**
 * Phase E — admin editor for the org's sales-document template, with a LIVE preview.
 *
 * Edits the optional `documentTemplate` blob persisted on organization_settings.branding (jsonb)
 * and saves it through the SAME path the rest of the branding uses: useSettings().updateSettings({
 * branding }). The blob is opaque to the core settings layer — `resolveTemplateConfig`
 * (./templateConfig) reads it defensively and fills every default at render time, so we only need
 * to write the keys the admin actually changed.
 *
 * Mounted inside the already-admin-gated Accounting Settings view; no extra guard is needed here.
 *
 * Scope: accentColor, footerText, showLogo, the three optional line columns (qty / unitPrice /
 * taxable), showMemo, and showNotes. sectionOrder is intentionally NOT edited here — per-document
 * section reordering is Phase F; the resolver applies the default order meanwhile.
 *
 * This file lives UNDER src/features/accounting, so importing ./templateConfig, ./SalesDocument and
 * the settings hook is fine. (The core service src/services/api/adminSettings.ts stays free of any
 * accounting import; it types the blob with its own self-contained BrandingDocumentTemplate.)
 */

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FormField } from '@/components/ui/FormField';
import { useSettings, type BrandingSettings } from '@/contexts/SettingsContext';
import SalesDocument from './SalesDocument';
import type { SalesDocumentData } from './salesDocumentTypes';
import {
  DEFAULT_ACCENT_COLOR,
  DEFAULT_DOCUMENT_TEMPLATE,
  resolveTemplateConfig,
  type DocumentTemplateSettings as DocumentTemplateDraft,
} from './templateConfig';

const inputClass =
  'w-full rounded-sm border border-white/10 bg-background-dark px-2 py-1.5 text-white focus:border-primary focus:outline-none';

const checkboxClass =
  'size-4 rounded border-white/20 bg-background-dark text-primary focus:ring-primary';

/**
 * Hardcoded, self-contained sample document used to drive the live preview. Kept small but
 * realistic (an invoice with two lines, a discount, tax, a partial payment, a memo and notes) so
 * every toggle the editor exposes — columns, memo, notes, footer, accent, logo — has something
 * to show. Money fields are dollars; the totals are internally consistent.
 */
const SAMPLE: SalesDocumentData = {
  kind: 'invoice',
  number: 'INV-1042',
  date: '2026-06-01',
  secondaryDate: '2026-07-01',
  terms: 'Net 30',
  statusLabel: 'Partially paid',
  status: 'partially_paid',
  customerName: 'Northgate Cabinetry, LLC',
  subtotal: 1850,
  discountTotal: 100,
  taxTotal: 148.75,
  total: 1898.75,
  amountPaid: 500,
  balanceDue: 1398.75,
  memo: 'Thank you for your business. Please reference the invoice number with your payment.',
  notes:
    'Installed upper and lower cabinets; finish carpentry to follow under a separate estimate.',
  lines: [
    {
      key: 'sample-1',
      id: null,
      description: 'Custom shaker cabinet doors (maple)',
      quantity: 10,
      unitPrice: 125,
      lineTotal: 1250,
      discount: 0,
      taxable: true,
      taxCodeId: null,
      partId: null,
    },
    {
      key: 'sample-2',
      id: null,
      description: 'On-site installation labor',
      quantity: 8,
      unitPrice: 75,
      lineTotal: 600,
      discount: 0,
      taxable: false,
      taxCodeId: null,
      partId: null,
    },
  ],
  layout: null,
};

/** Seed an editable draft from the persisted blob, defaulting every field so the controls are
 *  always controlled (no undefined → uncontrolled-input churn). */
function seedDraft(
  template: DocumentTemplateDraft | null | undefined
): Required<DocumentTemplateDraft> {
  const dt = template ?? {};
  const cols = dt.columns ?? {};
  return {
    accentColor:
      typeof dt.accentColor === 'string' && dt.accentColor.trim()
        ? dt.accentColor
        : DEFAULT_ACCENT_COLOR,
    footerText:
      typeof dt.footerText === 'string' ? dt.footerText : DEFAULT_DOCUMENT_TEMPLATE.footerText,
    showLogo: dt.showLogo !== false,
    columns: {
      qty: cols.qty !== false,
      unitPrice: cols.unitPrice !== false,
      taxable: cols.taxable !== false,
    },
    // sectionOrder is not edited here (Phase F); carry the persisted value through untouched so a
    // save never clobbers a per-template order the admin set elsewhere.
    sectionOrder: Array.isArray(dt.sectionOrder)
      ? dt.sectionOrder
      : DEFAULT_DOCUMENT_TEMPLATE.sectionOrder,
    showMemo: dt.showMemo !== false,
    showNotes: dt.showNotes !== false,
  };
}

/** A labeled checkbox row matching the dark-theme settings style used elsewhere in this view. */
function CheckboxRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className={`mt-0.5 ${checkboxClass}`}
      />
      <span>
        <span className="block text-sm font-medium text-white">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-subtle">{hint}</span>}
      </span>
    </label>
  );
}

/**
 * Document-template editor. Left: the controls. Right: a live <SalesDocument /> preview rendered
 * from the in-progress draft (resolved through the same resolveTemplateConfig the real documents
 * and the customer portal use), so what the admin sees is exactly what saves.
 */
export default function DocumentTemplateSettings() {
  const { settings, updateSettings } = useSettings();
  const branding = settings.branding;

  const [draft, setDraft] = useState<Required<DocumentTemplateDraft>>(() =>
    seedDraft(branding.documentTemplate)
  );
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Org settings hydrate asynchronously (useSettings loads them after mount). Re-seed the draft
  // from the server value when it arrives, but only while the admin has not started editing —
  // a `dirty` ref guards in-progress edits from being clobbered by the late hydration.
  const dirtyRef = useRef(false);
  const persistedTemplate = branding.documentTemplate;
  useEffect(() => {
    if (dirtyRef.current) return;
    setDraft(seedDraft(persistedTemplate));
    // Re-run when the persisted blob identity changes (hydration / external save).
  }, [persistedTemplate]);

  const markDirty = () => {
    dirtyRef.current = true;
    setSavedAt(null);
    setError(null);
  };

  const patch = (next: Partial<Required<DocumentTemplateDraft>>) => {
    markDirty();
    setDraft((prev) => ({ ...prev, ...next }));
  };

  const patchColumn = (key: keyof Required<DocumentTemplateDraft>['columns'], value: boolean) => {
    markDirty();
    setDraft((prev) => ({ ...prev, columns: { ...prev.columns, [key]: value } }));
  };

  const previewTemplate = resolveTemplateConfig({ ...branding, documentTemplate: draft });

  const save = async () => {
    setSaving(true);
    setError(null);
    // Persist via the shared branding path: merge the draft into the current branding so we never
    // drop the company name/address/logo. sanitizeBranding carries the documentTemplate blob
    // through opaquely; resolveTemplateConfig re-applies defaults on the next read.
    const nextBranding: BrandingSettings = { ...branding, documentTemplate: draft };
    const res = await updateSettings({ branding: nextBranding });
    setSaving(false);
    if (!res.success) {
      setError(res.error ?? 'Could not save the document template.');
      return;
    }
    dirtyRef.current = false;
    setSavedAt(Date.now());
  };

  return (
    <div>
      <h2 className="flex items-center gap-2 text-base font-bold text-white">
        <span className="material-symbols-outlined text-primary">description</span>
        Document template
      </h2>
      <p className="mt-1 text-sm text-muted">
        Style your invoices and estimates: accent color, footer, which line columns to show, and the
        optional memo / notes blocks. Changes preview live on the right and apply to every new and
        existing document once saved.
      </p>

      <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Controls */}
        <Card className="flex flex-col gap-5" padding="lg">
          <FormField
            label="Accent color"
            htmlFor="doc-accent"
            hint="Header title, the rule under it, and the footer divider."
          >
            <div className="flex items-center gap-3">
              <input
                id="doc-accent"
                type="color"
                value={draft.accentColor}
                onChange={(e) => patch({ accentColor: e.target.value })}
                className="size-9 cursor-pointer rounded-sm border border-white/10 bg-background-dark p-0.5"
                aria-label="Accent color"
              />
              <input
                type="text"
                value={draft.accentColor}
                onChange={(e) => patch({ accentColor: e.target.value })}
                className={inputClass}
                placeholder={DEFAULT_ACCENT_COLOR}
                aria-label="Accent color hex"
              />
            </div>
          </FormField>

          <FormField
            label="Footer text"
            htmlFor="doc-footer"
            hint="Shown centered at the bottom of the page. Leave blank to hide the footer."
          >
            <textarea
              id="doc-footer"
              className={`${inputClass} min-h-[72px] resize-y`}
              value={draft.footerText}
              onChange={(e) => patch({ footerText: e.target.value })}
              placeholder="e.g. Payment due within 30 days. Make checks payable to…"
            />
          </FormField>

          <div className="flex flex-col gap-3">
            <span className="text-sm font-bold text-muted">Logo</span>
            <CheckboxRow
              label="Show company logo"
              hint="Uses the logo uploaded in company branding. Has no effect until a logo is set."
              checked={draft.showLogo}
              onChange={(v) => patch({ showLogo: v })}
            />
          </div>

          <div className="flex flex-col gap-3">
            <span className="text-sm font-bold text-muted">Line-item columns</span>
            <CheckboxRow
              label="Quantity"
              checked={draft.columns.qty ?? true}
              onChange={(v) => patchColumn('qty', v)}
            />
            <CheckboxRow
              label="Unit price"
              checked={draft.columns.unitPrice ?? true}
              onChange={(v) => patchColumn('unitPrice', v)}
            />
            <CheckboxRow
              label="Taxable"
              checked={draft.columns.taxable ?? true}
              onChange={(v) => patchColumn('taxable', v)}
            />
          </div>

          <div className="flex flex-col gap-3">
            <span className="text-sm font-bold text-muted">Optional sections</span>
            <CheckboxRow
              label="Show memo"
              hint="The customer-facing memo block (only shows when a document has memo text)."
              checked={draft.showMemo}
              onChange={(v) => patch({ showMemo: v })}
            />
            <CheckboxRow
              label="Show notes"
              hint="The notes block (only shows when a document has notes)."
              checked={draft.showNotes}
              onChange={(v) => patch({ showNotes: v })}
            />
          </div>

          {error && (
            <p className="text-sm text-red-400" role="alert">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-3">
            {savedAt && !saving && <span className="text-xs text-green-400">Saved.</span>}
            <Button icon="save" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save template'}
            </Button>
          </div>
        </Card>

        {/* Live preview */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-subtle">
            Live preview
          </span>
          <div className="overflow-auto rounded-sm border border-white/10 bg-slate-200 p-3">
            <SalesDocument data={SAMPLE} template={previewTemplate} mode="read" />
          </div>
          <p className="text-xs text-subtle">
            Sample data — your real invoices and estimates use this style.
          </p>
        </div>
      </div>
    </div>
  );
}

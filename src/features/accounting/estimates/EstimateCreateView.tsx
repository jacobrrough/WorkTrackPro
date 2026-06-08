import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { jobService } from '@/services/api/jobs';
import { partsService } from '@/services/api/parts';
import { inventoryService } from '@/services/api/inventory';
import { adminSettingsService } from '@/services/api/adminSettings';
import { buildInvoiceLinesFromJob, taxJurisdictionsService } from '@/services/api/accounting';
import { AccountingShell } from '../components/AccountingShell';
import { CurrencyInput } from '../components/CurrencyInput';
import { TaxDisclaimer } from '../components/TaxDisclaimer';
import { useCustomers, useTaxCodes } from '../hooks/useAccountingQueries';
import { useCreateEstimateDraft } from '../hooks/useAccountingMutations';
import { computeInvoiceTotals } from '../posting';
import { formatMoney } from '../accountingViewModel';
import { ACCOUNTING_BASE } from '../constants';
import type { NewEstimateInput, NewEstimateLineInput } from '../types';

const inputClass =
  'w-full rounded-sm border border-white/10 bg-background-dark px-2 py-1.5 text-white focus:border-primary focus:outline-none';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

const emptyLine = (): NewEstimateLineInput => ({
  description: '',
  quantity: 1,
  unitPrice: 0,
  discount: 0,
  taxable: true,
});

/**
 * Resolve the header tax code to apply, with precedence: customer's preferred code, else the
 * address-based auto-suggestion (#13 — resolved from the customer's billing/shipping address),
 * else the org default code. Once the user has touched the Tax-code select we honor their raw
 * choice verbatim — including an explicit "No tax" (empty string) — so an intentional No-tax
 * selection is never re-seeded. `touched` distinguishes "the user has not chosen yet" (seed a
 * default) from "the user explicitly picked nothing". The address suggestion sits BELOW a
 * per-customer preferred code (an explicit customer setting wins) but ABOVE the org-wide
 * default, and is ADVISORY — the user can always override it.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function resolveEffectiveTaxCodeId(args: {
  rawTaxCodeId: string;
  touched: boolean;
  customerDefaultTaxCodeId: string | null | undefined;
  addressTaxCodeId?: string | null | undefined;
  orgDefaultTaxCodeId: string | null | undefined;
}): string {
  if (args.touched) return args.rawTaxCodeId;
  return args.customerDefaultTaxCodeId ?? args.addressTaxCodeId ?? args.orgDefaultTaxCodeId ?? '';
}

/**
 * Pull a job's parts/inventory/settings and build draft lines from the on-screen quote
 * (reuses buildInvoiceLinesFromJob -> calculatePartQuote, the same math the invoice
 * "from job" flow uses, so the estimate equals the on-screen quote). Reads public.* only.
 */
function FromJobDialog({
  taxCodeId,
  onClose,
  onLines,
}: {
  taxCodeId: string | null;
  onClose: () => void;
  onLines: (lines: NewEstimateLineInput[], jobId: string) => void;
}) {
  const [jobCode, setJobCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setError(null);
    const code = Number.parseInt(jobCode.trim(), 10);
    if (!Number.isFinite(code)) {
      setError('Enter a numeric job code.');
      return;
    }
    setBusy(true);
    try {
      const job = await jobService.getJobByCode(code);
      if (!job) {
        setError(`No job found with code ${code}.`);
        return;
      }
      const [parts, inventory, settings] = await Promise.all([
        partsService.getAllParts(),
        inventoryService.getAllInventory(),
        adminSettingsService.getOrganizationSettings(),
      ]);
      const lines = buildInvoiceLinesFromJob({
        job,
        parts,
        inventory,
        settings: {
          laborRate: settings?.laborRate ?? 0,
          cncRate: settings?.cncRate ?? 0,
          printer3DRate: settings?.printer3DRate ?? 0,
          materialMultiplier: settings?.materialUpcharge,
        },
        taxCodeId,
      });
      if (lines.length === 0) {
        setError('That job has no quotable parts or inventory to estimate.');
        return;
      }
      // NewInvoiceLineInput and NewEstimateLineInput are structurally identical.
      onLines(lines as NewEstimateLineInput[], job.id);
      onClose();
    } catch {
      setError('Could not load the job. Check the job code and your connection.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-sm border border-white/10 bg-card-dark p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">Build from a job</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-sm text-slate-400 hover:bg-white/10 hover:text-white"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <p className="mb-3 text-sm text-slate-400">
          Pulls the job&apos;s parts and inventory and prices them with the same quote calculator
          used on the job screen, so the estimate equals the on-screen quote.
        </p>
        <FormField label="Job code" htmlFor="from-job-code">
          <input
            id="from-job-code"
            className={inputClass}
            value={jobCode}
            onChange={(e) => setJobCode(e.target.value)}
            inputMode="numeric"
            placeholder="e.g. 1042"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void run();
            }}
          />
        </FormField>
        {error && (
          <p className="mt-2 text-sm text-red-400" role="alert">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={run} disabled={busy}>
            {busy ? 'Loading…' : 'Add lines'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function EstimateCreateView() {
  const navigate = useNavigate();
  const { data: customers = [], isPending: customersLoading } = useCustomers();
  const { data: taxCodes = [] } = useTaxCodes();
  const createDraft = useCreateEstimateDraft();

  const [customerId, setCustomerId] = useState('');
  const [estimateDate, setEstimateDate] = useState(todayISO());
  const [expiryDate, setExpiryDate] = useState('');
  const [terms, setTerms] = useState('');
  const [memo, setMemo] = useState('');
  const [taxCodeId, setTaxCodeId] = useState('');
  // Whether the user has explicitly chosen a header tax code (including "No tax").
  // Until then the effective code is seeded from the customer/org default.
  const [taxCodeTouched, setTaxCodeTouched] = useState(false);
  // #13 — tax code auto-suggested from the selected customer's billing/shipping address
  // (advisory; only used while the user has not chosen a code and the customer has no
  // preferred code). `addressSuggested` drives the subtle "auto-selected from address" hint.
  const [addressTaxCodeId, setAddressTaxCodeId] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [lines, setLines] = useState<NewEstimateLineInput[]>([emptyLine()]);
  const [showFromJob, setShowFromJob] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedCustomer = customers.find((c) => c.id === customerId);

  // The org-wide default tax code, used as the fallback seed below.
  const defaultTaxCode = useMemo(() => taxCodes.find((t) => t.isDefault) ?? null, [taxCodes]);

  // #13 — when a customer is selected and the user has not chosen a code AND the customer has
  // no preferred code, resolve a suggestion from the customer's billing/shipping address. This
  // is ADVISORY: it only PRE-FILLS the select (the derived precedence below slots it under a
  // per-customer code and above the org default); the user can always override. Resolution is
  // best-effort — any failure just leaves no suggestion. Cleared when the customer clears.
  useEffect(() => {
    let cancelled = false;
    setAddressTaxCodeId(null);
    if (!customerId || taxCodeTouched || selectedCustomer?.defaultTaxCodeId) return;
    taxJurisdictionsService
      .getCustomerAddress(customerId)
      .then((addr) => (addr ? taxJurisdictionsService.resolveForAddress(addr) : null))
      .then((codeId) => {
        // Only adopt a suggestion that is a currently-selectable tax code.
        if (cancelled || !codeId) return;
        if (taxCodes.some((t) => t.id === codeId)) setAddressTaxCodeId(codeId);
      })
      .catch(() => {
        /* advisory — ignore resolution errors */
      });
    return () => {
      cancelled = true;
    };
  }, [customerId, taxCodeTouched, selectedCustomer?.defaultTaxCodeId, taxCodes]);

  // Effective header tax code with precedence: customer's preferred code, else the
  // address-based suggestion (#13), else the org default — but only until the user explicitly
  // picks one (then their choice, including an intentional "No tax", is honored). Derived so it
  // cannot fight an explicit choice.
  const effectiveTaxCodeId = resolveEffectiveTaxCodeId({
    rawTaxCodeId: taxCodeId,
    touched: taxCodeTouched,
    customerDefaultTaxCodeId: selectedCustomer?.defaultTaxCodeId,
    addressTaxCodeId,
    orgDefaultTaxCodeId: defaultTaxCode?.id,
  });

  // True when the code currently shown came from the address auto-suggestion (not a user
  // choice, not a customer/org default) — drives the subtle "auto-selected from address" hint.
  const showAddressHint =
    !taxCodeTouched &&
    !selectedCustomer?.defaultTaxCodeId &&
    !!addressTaxCodeId &&
    effectiveTaxCodeId === addressTaxCodeId;

  const updateLine = (i: number, patch: Partial<NewEstimateLineInput>) =>
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (i: number) =>
    setLines((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));

  // Live totals — reuse the exact pure function the service uses so the on-screen total
  // equals the persisted estimate (and the invoice it converts into).
  const totals = useMemo(() => {
    const rateById = new Map(taxCodes.map((t) => [t.id, t.isTaxable ? t.rate : 0]));
    return computeInvoiceTotals({
      lines,
      defaultIncomeAccountId: null,
      headerTaxCodeId: effectiveTaxCodeId || null,
      taxRateByCode: (id) => (id ? (rateById.get(id) ?? 0) : 0),
      taxExempt: selectedCustomer?.taxExempt ?? false,
    });
  }, [lines, taxCodes, effectiveTaxCodeId, selectedCustomer]);

  const hasAmount = totals.totalCents > 0;

  const applyJobLines = (jobLines: NewEstimateLineInput[], newJobId: string) => {
    setJobId(newJobId);
    // Replace empty starter lines; otherwise append.
    setLines((prev) => {
      const meaningful = prev.filter(
        (l) => (l.description ?? '').trim() !== '' || (l.unitPrice ?? 0) > 0
      );
      return [...meaningful, ...jobLines];
    });
  };

  const submit = async () => {
    setError(null);
    if (!customerId) {
      setError('Select a customer for this estimate.');
      return;
    }
    const realLines = lines.filter(
      (l) => (l.quantity ?? 0) > 0 && ((l.unitPrice ?? 0) > 0 || (l.lineTotal ?? 0) > 0)
    );
    if (realLines.length === 0) {
      setError('Add at least one line with an amount.');
      return;
    }
    const input: NewEstimateInput = {
      customerId,
      jobId,
      estimateDate,
      expiryDate: expiryDate || null,
      terms: terms.trim() || null,
      taxCodeId: effectiveTaxCodeId || null,
      memo: memo.trim() || null,
      lines: realLines,
    };
    const res = await createDraft.mutateAsync({
      input,
      customerTaxExempt: selectedCustomer?.taxExempt ?? false,
    });
    if (res.error || !res.estimate) {
      setError(res.error ?? 'Could not create the estimate.');
      return;
    }
    navigate(`${ACCOUNTING_BASE}/estimates/${res.estimate.id}`);
  };

  const taxShown = totals.taxCents > 0 || taxCodes.length > 0;

  return (
    <AccountingShell active="estimates" title="New Estimate">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        {taxShown && <TaxDisclaimer />}

        {/* Header */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Customer" htmlFor="est-customer" required>
            <select
              id="est-customer"
              className={inputClass}
              value={customerId}
              onChange={(e) => {
                // The customer's preferred tax code is adopted automatically by
                // resolveEffectiveTaxCodeId while the user has not chosen one.
                setCustomerId(e.target.value);
              }}
              disabled={customersLoading}
            >
              <option value="">{customersLoading ? 'Loading…' : 'Select customer…'}</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName}
                  {c.taxExempt ? ' (tax-exempt)' : ''}
                </option>
              ))}
            </select>
          </FormField>

          <FormField
            label="Tax code"
            htmlFor="est-tax"
            hint="Applied to taxable lines without their own code"
          >
            <select
              id="est-tax"
              className={inputClass}
              value={effectiveTaxCodeId}
              onChange={(e) => {
                // Record an explicit choice (including "No tax" = '') so the default
                // is no longer seeded over the user's selection.
                setTaxCodeTouched(true);
                setTaxCodeId(e.target.value);
              }}
            >
              <option value="">{defaultTaxCode ? 'No tax' : 'None'}</option>
              {taxCodes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.isTaxable ? ` (${(t.rate * 100).toFixed(3)}%)` : ' (non-taxable)'}
                </option>
              ))}
            </select>
            {showAddressHint && (
              <p className="mt-1 flex items-center gap-1 text-xs text-amber-300">
                <span className="material-symbols-outlined text-sm">auto_fix_high</span>
                Auto-selected from the customer&apos;s address — verify before sending.
              </p>
            )}
          </FormField>

          <FormField label="Estimate date" htmlFor="est-date">
            <input
              id="est-date"
              type="date"
              className={inputClass}
              value={estimateDate}
              onChange={(e) => setEstimateDate(e.target.value)}
            />
          </FormField>

          <FormField label="Expires" htmlFor="est-expiry">
            <input
              id="est-expiry"
              type="date"
              className={inputClass}
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
            />
          </FormField>

          <FormField label="Terms" htmlFor="est-terms">
            <input
              id="est-terms"
              className={inputClass}
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              placeholder="e.g. Valid 30 days"
            />
          </FormField>

          <FormField label="Memo" htmlFor="est-memo">
            <input
              id="est-memo"
              className={inputClass}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="Optional note"
            />
          </FormField>
        </div>

        {/* Line items */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-400">Line items</h2>
            <Button size="sm" variant="secondary" icon="work" onClick={() => setShowFromJob(true)}>
              From job
            </Button>
          </div>

          <div className="hidden grid-cols-[1fr_70px_100px_90px_70px_32px] gap-2 px-1 pb-1 text-xs font-semibold uppercase text-slate-500 md:grid">
            <span>Description</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Unit price</span>
            <span className="text-right">Amount</span>
            <span className="text-center">Tax</span>
            <span />
          </div>

          <div className="space-y-2">
            {lines.map((line, i) => {
              const amount = totals.lines[i]?.netCents ?? 0;
              return (
                <div
                  key={i}
                  className="grid grid-cols-[1fr_60px_84px_32px] items-center gap-2 md:grid-cols-[1fr_70px_100px_90px_70px_32px]"
                >
                  <input
                    aria-label={`Line ${i + 1} description`}
                    className={`${inputClass} col-span-4 md:col-span-1`}
                    value={line.description ?? ''}
                    onChange={(e) => updateLine(i, { description: e.target.value })}
                    placeholder="Description"
                  />
                  <CurrencyInput
                    aria-label={`Line ${i + 1} quantity`}
                    value={line.quantity ?? 0}
                    onValueChange={(v) =>
                      // User-entered quantity supersedes any imported explicit lineTotal.
                      updateLine(i, { quantity: v, lineTotal: undefined })
                    }
                  />
                  <CurrencyInput
                    aria-label={`Line ${i + 1} unit price`}
                    value={line.unitPrice ?? 0}
                    onValueChange={(v) =>
                      // User-entered price supersedes any imported explicit lineTotal.
                      updateLine(i, { unitPrice: v, lineTotal: undefined })
                    }
                  />
                  <span className="hidden text-right font-mono text-sm tabular-nums text-slate-300 md:block">
                    {formatMoney(amount / 100)}
                  </span>
                  <label className="flex items-center justify-center">
                    <input
                      type="checkbox"
                      aria-label={`Line ${i + 1} taxable`}
                      checked={line.taxable !== false}
                      onChange={(e) => updateLine(i, { taxable: e.target.checked })}
                      className="size-4 rounded-sm border-white/20 bg-background-dark"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => removeLine(i)}
                    aria-label={`Remove line ${i + 1}`}
                    disabled={lines.length <= 1}
                    className="flex items-center justify-center rounded-sm text-slate-500 hover:bg-white/10 hover:text-red-400 disabled:opacity-30"
                  >
                    <span className="material-symbols-outlined text-lg">delete</span>
                  </button>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={addLine}
            className="mt-2 flex items-center gap-1 text-sm font-semibold text-primary hover:text-primary-hover"
          >
            <span className="material-symbols-outlined text-lg">add</span>
            Add line
          </button>
        </div>

        {/* Totals */}
        <div className="ml-auto w-full max-w-xs space-y-1 border-t border-white/10 pt-3 text-sm">
          <div className="flex justify-between text-slate-400">
            <span>Subtotal</span>
            <span className="font-mono tabular-nums text-slate-200">
              {formatMoney(totals.subtotalCents / 100)}
            </span>
          </div>
          <div className="flex justify-between text-slate-400">
            <span>Tax</span>
            <span className="font-mono tabular-nums text-slate-200">
              {formatMoney(totals.taxCents / 100)}
            </span>
          </div>
          <div className="flex justify-between border-t border-white/10 pt-1 text-base font-bold text-white">
            <span>Total</span>
            <span className="font-mono tabular-nums">{formatMoney(totals.totalCents / 100)}</span>
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-400" role="alert">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-white/10 pt-4">
          <Button variant="ghost" onClick={() => navigate(`${ACCOUNTING_BASE}/estimates`)}>
            Cancel
          </Button>
          <Button
            icon="save"
            onClick={submit}
            disabled={createDraft.isPending || !customerId || !hasAmount}
          >
            {createDraft.isPending ? 'Saving…' : 'Save draft'}
          </Button>
        </div>
      </div>

      {showFromJob && (
        <FromJobDialog
          taxCodeId={effectiveTaxCodeId || null}
          onClose={() => setShowFromJob(false)}
          onLines={applyJobLines}
        />
      )}
    </AccountingShell>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { jobService } from '@/services/api/jobs';
import { taxJurisdictionsService } from '@/services/api/accounting';
import { AccountingShell } from '../components/AccountingShell';
import { CustomFieldsSection } from '../components/CustomFieldsSection';
import { TaxDisclaimer } from '../components/TaxDisclaimer';
import SalesLineItemsEditor from '../documents/SalesLineItemsEditor';
import { SalesDocumentHeader } from '../documents/form/SalesDocumentHeader';
import { SalesDocumentTotalsPanel } from '../documents/form/SalesDocumentTotalsPanel';
import { SalesDocumentMessages } from '../documents/form/SalesDocumentMessages';
import { docInputClass } from '../documents/form/salesFormUi';
import { buildSalesLinesForJob } from '../documents/buildLinesForJob';
import { resolveEffectiveTaxCodeId } from '../documents/taxCode';
import { useCustomFieldDefs, useCustomers, useTaxCodes } from '../hooks/useAccountingQueries';
import { useCreateInvoiceDraft, useSendInvoice } from '../hooks/useAccountingMutations';
import { computeInvoiceTotals } from '../posting';
import { ACCOUNTING_BASE } from '../constants';
import type { NewInvoiceInput, NewInvoiceLineInput } from '../types';

const inputClass =
  'w-full rounded-lg border border-line bg-background-dark px-2 py-1.5 text-white focus:border-primary focus:outline-none';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

const emptyLine = (): NewInvoiceLineInput => ({
  description: '',
  quantity: 1,
  unitPrice: 0,
  discount: 0,
  taxable: true,
});

function FromJobDialog({
  taxCodeId,
  onClose,
  onLines,
}: {
  taxCodeId: string | null;
  onClose: () => void;
  onLines: (lines: NewInvoiceLineInput[], jobId: string, customerId: string | null) => void;
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
      const lines = await buildSalesLinesForJob(job, taxCodeId);
      if (lines.length === 0) {
        setError('That job has no quotable parts or inventory to invoice.');
        return;
      }
      // The job's linked customer rides along so the header pre-fills.
      onLines(lines, job.id, job.customerId ?? null);
      onClose();
    } catch {
      setError('Could not load the job. Check the job code and your connection.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-modal-backdrop z-[100] p-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-card-dark p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">Build from a job</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-overlay/10 hover:text-white"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <p className="mb-3 text-sm text-muted">
          Pulls the job&apos;s parts and inventory and prices them with the same quote calculator
          used on the job screen, so the invoice equals the on-screen quote.
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

export default function InvoiceCreateView() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { data: customers = [], isPending: customersLoading } = useCustomers();
  const { data: taxCodes = [] } = useTaxCodes();
  // Active invoice custom fields, shown read-only here as a preview — they become
  // editable on the invoice detail screen once the draft has an id (D4).
  const { data: customFieldDefs = [] } = useCustomFieldDefs('invoice');
  const createDraft = useCreateInvoiceDraft();
  const sendInvoice = useSendInvoice();
  const saving = createDraft.isPending || sendInvoice.isPending;

  const [customerId, setCustomerId] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(todayISO());
  const [dueDate, setDueDate] = useState('');
  const [terms, setTerms] = useState('');
  const [memo, setMemo] = useState('');
  const [notes, setNotes] = useState('');
  const [taxCodeId, setTaxCodeId] = useState('');
  // Whether the user has explicitly chosen a header tax code (including "No tax").
  // Until then the effective code is seeded from the customer/org default.
  const [taxCodeTouched, setTaxCodeTouched] = useState(false);
  // #13 — tax code auto-suggested from the selected customer's billing/shipping address
  // (advisory; only used while the user has not chosen a code and the customer has no
  // preferred code). `addressSuggested` drives the subtle "auto-selected from address" hint.
  const [addressTaxCodeId, setAddressTaxCodeId] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [lines, setLines] = useState<NewInvoiceLineInput[]>([emptyLine()]);
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
  // cannot fight an explicit choice or loop, unlike a setState-on-change effect.
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

  // Live totals — reuse the exact pure function the service uses so the on-screen
  // total equals the persisted invoice. A line dropping its explicit lineTotal (from
  // a job import) once the user edits qty/price is fine: computeInvoiceTotals handles
  // both shapes.
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

  const applyJobLines = (
    jobLines: NewInvoiceLineInput[],
    newJobId: string,
    newCustomerId: string | null
  ) => {
    setJobId(newJobId);
    // Pre-fill the job's customer — but never fight a choice the user already made.
    if (newCustomerId) setCustomerId((prev) => prev || newCustomerId);
    if (jobLines.length === 0) return;
    // Replace empty starter lines; otherwise append.
    setLines((prev) => {
      const meaningful = prev.filter(
        (l) => (l.description ?? '').trim() !== '' || (l.unitPrice ?? 0) > 0
      );
      return [...meaningful, ...jobLines];
    });
  };

  // Deep link from a job page (…/invoices/new?jobId=<id>): load that job once and
  // pre-fill its customer + quoted lines, exactly like the "From job" dialog.
  const prefillJobId = searchParams.get('jobId');
  const [prefillDone, setPrefillDone] = useState(false);
  useEffect(() => {
    if (!prefillJobId || prefillDone) return;
    setPrefillDone(true);
    (async () => {
      const job = await jobService.getJobById(prefillJobId);
      if (!job) return;
      const jobLines = await buildSalesLinesForJob(job, null).catch(
        () => [] as NewInvoiceLineInput[]
      );
      applyJobLines(jobLines, job.id, job.customerId ?? null);
    })().catch(() => {
      /* best-effort prefill — the form still works empty */
    });
  }, [prefillJobId, prefillDone]);

  const submit = async () => {
    setError(null);
    if (!customerId) {
      setError('Select a customer for this invoice.');
      return;
    }
    const realLines = lines.filter(
      (l) => (l.quantity ?? 0) > 0 && ((l.unitPrice ?? 0) > 0 || (l.lineTotal ?? 0) > 0)
    );
    if (realLines.length === 0) {
      setError('Add at least one line with an amount.');
      return;
    }
    const input: NewInvoiceInput = {
      customerId,
      jobId,
      invoiceDate,
      dueDate: dueDate || null,
      terms: terms.trim() || null,
      taxCodeId: effectiveTaxCodeId || null,
      memo: memo.trim() || null,
      notes: notes.trim() || null,
      lines: realLines,
    };
    const res = await createDraft.mutateAsync({
      input,
      customerTaxExempt: selectedCustomer?.taxExempt ?? false,
    });
    if (res.error || !res.invoice) {
      setError(res.error ?? 'Could not create the invoice.');
      return;
    }
    // Save = finalized: assign the number (done by the DB trigger on insert) AND post the revenue
    // entry now. If posting fails (e.g. default accounts unconfigured), the invoice is left as a
    // numbered draft to retry Send from its detail page — so we navigate either way.
    try {
      await sendInvoice.mutateAsync(res.invoice.id);
    } catch {
      /* lands as a numbered draft to retry */
    }
    navigate(`${ACCOUNTING_BASE}/invoices/${res.invoice.id}`);
  };

  const taxShown = totals.taxCents > 0 || taxCodes.length > 0;

  return (
    <AccountingShell active="invoices" title="New Invoice">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        {taxShown && <TaxDisclaimer />}

        <SalesDocumentHeader
          kind="invoice"
          docNumber={null}
          customerSlot={
            <select
              id="invoice-customer"
              className={docInputClass}
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
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
          }
          primaryDateLabel="Invoice date"
          primaryDate={invoiceDate}
          onPrimaryDate={setInvoiceDate}
          secondaryDateLabel="Due date"
          secondaryDate={dueDate}
          onSecondaryDate={setDueDate}
          terms={terms}
          onTerms={setTerms}
        />

        <SalesLineItemsEditor
          lines={lines}
          onChange={setLines}
          lineAmountsCents={totals.lines.map((l) => l.netCents)}
          headerAction={
            <Button size="sm" variant="secondary" icon="work" onClick={() => setShowFromJob(true)}>
              From job
            </Button>
          }
        />

        <div className="grid gap-4 lg:grid-cols-2">
          <SalesDocumentMessages
            kind="invoice"
            notes={notes}
            onNotes={setNotes}
            memo={memo}
            onMemo={setMemo}
          >
            {/* Additive custom-fields preview (D4). Read-only until the draft is saved;
                values are entered/saved on the invoice detail screen. */}
            {customFieldDefs.length > 0 && (
              <CustomFieldsSection
                entityType="invoice"
                entityId={undefined}
                draftPreview={customFieldDefs.map((def) => ({ def, value: null }))}
              />
            )}
          </SalesDocumentMessages>
          <SalesDocumentTotalsPanel
            kind="invoice"
            totals={totals}
            taxCodes={taxCodes}
            taxCodeId={effectiveTaxCodeId}
            onTaxCodeId={(v) => {
              // Record an explicit choice (including "No tax" = '') so the default
              // is no longer seeded over the user's selection.
              setTaxCodeTouched(true);
              setTaxCodeId(v);
            }}
            hasDefaultTaxCode={!!defaultTaxCode}
            taxExempt={selectedCustomer?.taxExempt ?? false}
            hint={
              showAddressHint ? (
                <p className="flex items-center gap-1 text-xs text-amber-300">
                  <span className="material-symbols-outlined text-sm">auto_fix_high</span>
                  Auto-selected from the customer&apos;s address — verify before sending.
                </p>
              ) : undefined
            }
          />
        </div>

        {error && (
          <p className="text-sm text-red-400" role="alert">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button variant="ghost" onClick={() => navigate(`${ACCOUNTING_BASE}/invoices`)}>
            Cancel
          </Button>
          <Button icon="save" onClick={submit} disabled={saving || !customerId || !hasAmount}>
            {saving ? 'Saving…' : 'Save invoice'}
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

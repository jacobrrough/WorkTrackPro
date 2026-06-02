import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { jobService } from '@/services/api/jobs';
import { partsService } from '@/services/api/parts';
import { inventoryService } from '@/services/api/inventory';
import { adminSettingsService } from '@/services/api/adminSettings';
import { buildInvoiceLinesFromJob } from '@/services/api/accounting';
import { AccountingShell } from '../components/AccountingShell';
import { CurrencyInput } from '../components/CurrencyInput';
import { CustomFieldsSection } from '../components/CustomFieldsSection';
import { TaxDisclaimer } from '../components/TaxDisclaimer';
import { useCustomFieldDefs, useCustomers, useTaxCodes } from '../hooks/useAccountingQueries';
import { useCreateInvoiceDraft } from '../hooks/useAccountingMutations';
import { computeInvoiceTotals } from '../posting';
import { formatMoney } from '../accountingViewModel';
import { ACCOUNTING_BASE } from '../constants';
import type { NewInvoiceInput, NewInvoiceLineInput } from '../types';

const inputClass =
  'w-full rounded-sm border border-white/10 bg-background-dark px-2 py-1.5 text-white focus:border-primary focus:outline-none';

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

/**
 * Pull a job's parts/inventory/settings and build draft lines from the on-screen
 * quote (reuses buildInvoiceLinesFromJob -> calculatePartQuote). Reads public.* only.
 */
function FromJobDialog({
  taxCodeId,
  onClose,
  onLines,
}: {
  taxCodeId: string | null;
  onClose: () => void;
  onLines: (lines: NewInvoiceLineInput[], jobId: string) => void;
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
        setError('That job has no quotable parts or inventory to invoice.');
        return;
      }
      onLines(lines, job.id);
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
  const { data: customers = [], isPending: customersLoading } = useCustomers();
  const { data: taxCodes = [] } = useTaxCodes();
  // Active invoice custom fields, shown read-only here as a preview — they become
  // editable on the invoice detail screen once the draft has an id (D4).
  const { data: customFieldDefs = [] } = useCustomFieldDefs('invoice');
  const createDraft = useCreateInvoiceDraft();

  const [customerId, setCustomerId] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(todayISO());
  const [dueDate, setDueDate] = useState('');
  const [terms, setTerms] = useState('');
  const [memo, setMemo] = useState('');
  const [taxCodeId, setTaxCodeId] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [lines, setLines] = useState<NewInvoiceLineInput[]>([emptyLine()]);
  const [showFromJob, setShowFromJob] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedCustomer = customers.find((c) => c.id === customerId);

  // Default the header tax code to the customer's preferred code, else the default code.
  const defaultTaxCode = useMemo(
    () => taxCodes.find((t) => t.isDefault) ?? null,
    [taxCodes]
  );

  const updateLine = (i: number, patch: Partial<NewInvoiceLineInput>) =>
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (i: number) =>
    setLines((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));

  // Live totals — reuse the exact pure function the service uses so the on-screen
  // total equals the persisted invoice. A line dropping its explicit lineTotal (from
  // a job import) once the user edits qty/price is fine: computeInvoiceTotals handles
  // both shapes.
  const totals = useMemo(() => {
    const rateById = new Map(taxCodes.map((t) => [t.id, t.isTaxable ? t.rate : 0]));
    return computeInvoiceTotals({
      lines,
      defaultIncomeAccountId: null,
      headerTaxCodeId: taxCodeId || null,
      taxRateByCode: (id) => (id ? rateById.get(id) ?? 0 : 0),
      taxExempt: selectedCustomer?.taxExempt ?? false,
    });
  }, [lines, taxCodes, taxCodeId, selectedCustomer]);

  const hasAmount = totals.totalCents > 0;

  const applyJobLines = (jobLines: NewInvoiceLineInput[], newJobId: string) => {
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
      taxCodeId: taxCodeId || null,
      memo: memo.trim() || null,
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
    navigate(`${ACCOUNTING_BASE}/invoices/${res.invoice.id}`);
  };

  const taxShown = totals.taxCents > 0 || taxCodes.length > 0;

  return (
    <AccountingShell active="invoices" title="New Invoice">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        {taxShown && <TaxDisclaimer />}

        {/* Header */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Customer" htmlFor="inv-customer" required>
            <select
              id="inv-customer"
              className={inputClass}
              value={customerId}
              onChange={(e) => {
                const id = e.target.value;
                setCustomerId(id);
                const cust = customers.find((c) => c.id === id);
                // Adopt the customer's default tax code if the header is still unset.
                if (cust?.defaultTaxCodeId && !taxCodeId) setTaxCodeId(cust.defaultTaxCodeId);
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

          <FormField label="Tax code" htmlFor="inv-tax" hint="Applied to taxable lines without their own code">
            <select
              id="inv-tax"
              className={inputClass}
              value={taxCodeId}
              onChange={(e) => setTaxCodeId(e.target.value)}
            >
              <option value="">{defaultTaxCode ? 'No tax' : 'None'}</option>
              {taxCodes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.isTaxable ? ` (${(t.rate * 100).toFixed(3)}%)` : ' (non-taxable)'}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="Invoice date" htmlFor="inv-date">
            <input
              id="inv-date"
              type="date"
              className={inputClass}
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
            />
          </FormField>

          <FormField label="Due date" htmlFor="inv-due">
            <input
              id="inv-due"
              type="date"
              className={inputClass}
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </FormField>

          <FormField label="Terms" htmlFor="inv-terms">
            <input
              id="inv-terms"
              className={inputClass}
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              placeholder="e.g. Net 30"
            />
          </FormField>

          <FormField label="Memo" htmlFor="inv-memo">
            <input
              id="inv-memo"
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
                    onValueChange={(v) => updateLine(i, { quantity: v })}
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

        {/* Additive custom-fields preview (D4). Read-only until the draft is saved;
            values are entered/saved on the invoice detail screen. Renders nothing when
            no invoice custom fields are defined, so the create form is unchanged. */}
        {customFieldDefs.length > 0 && (
          <CustomFieldsSection
            entityType="invoice"
            entityId={undefined}
            draftPreview={customFieldDefs.map((def) => ({ def, value: null }))}
          />
        )}

        {error && (
          <p className="text-sm text-red-400" role="alert">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-white/10 pt-4">
          <Button variant="ghost" onClick={() => navigate(`${ACCOUNTING_BASE}/invoices`)}>
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
          taxCodeId={taxCodeId || null}
          onClose={() => setShowFromJob(false)}
          onLines={applyJobLines}
        />
      )}
    </AccountingShell>
  );
}

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { AccountingShell } from '../components/AccountingShell';
import { AccountPicker } from '../components/AccountPicker';
import { CurrencyInput } from '../components/CurrencyInput';
import { CustomFieldsSection } from '../components/CustomFieldsSection';
import { TaxDisclaimer } from '../components/TaxDisclaimer';
import { useCustomFieldDefs, useVendors } from '../hooks/useAccountingQueries';
import { useCreateBillDraft } from '../hooks/useAccountingMutations';
import { computeBillTotals } from '../posting';
import { formatMoney } from '../accountingViewModel';
import { ACCOUNTING_BASE } from '../constants';
import type { NewBillInput, NewBillLineInput } from '../types';

const inputClass =
  'w-full rounded-sm border border-white/10 bg-background-dark px-2 py-1.5 text-white focus:border-primary focus:outline-none';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

const emptyLine = (): NewBillLineInput => ({
  accountId: null,
  description: '',
  quantity: 1,
  unitCost: 0,
});

export default function BillCreateView() {
  const navigate = useNavigate();
  const { data: vendors = [], isPending: vendorsLoading } = useVendors();
  // Active bill custom fields, shown read-only here as a preview — they become editable
  // on the bill detail screen once the draft has an id (D4).
  const { data: customFieldDefs = [] } = useCustomFieldDefs('bill');
  const createDraft = useCreateBillDraft();

  const [vendorId, setVendorId] = useState('');
  const [billNumber, setBillNumber] = useState('');
  const [billDate, setBillDate] = useState(todayISO());
  const [dueDate, setDueDate] = useState('');
  const [terms, setTerms] = useState('');
  const [memo, setMemo] = useState('');
  const [taxTotal, setTaxTotal] = useState(0);
  const [lines, setLines] = useState<NewBillLineInput[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);

  const selectedVendor = vendors.find((v) => v.id === vendorId);

  const updateLine = (i: number, patch: Partial<NewBillLineInput>) =>
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (i: number) =>
    setLines((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));

  // Live totals — reuse the exact pure function the service uses so the on-screen
  // total equals the persisted bill. The display only needs subtotal/tax/total, so the
  // debit-account resolution (which happens server-side on post) is irrelevant here.
  const totals = useMemo(
    () =>
      computeBillTotals({
        lines,
        resolveDebitAccount: () => null,
        taxTotal,
      }),
    [lines, taxTotal]
  );

  const hasAmount = totals.totalCents > 0;

  const submit = async () => {
    setError(null);
    if (!vendorId) {
      setError('Select a vendor for this bill.');
      return;
    }
    const realLines = lines.filter(
      (l) => (l.quantity ?? 0) > 0 && ((l.unitCost ?? 0) > 0 || (l.lineTotal ?? 0) > 0)
    );
    if (realLines.length === 0) {
      setError('Add at least one line with an amount.');
      return;
    }
    const input: NewBillInput = {
      vendorId,
      billNumber: billNumber.trim() || null,
      billDate,
      dueDate: dueDate || null,
      terms: terms.trim() || null,
      taxTotal: taxTotal > 0 ? taxTotal : 0,
      memo: memo.trim() || null,
      lines: realLines,
    };
    const res = await createDraft.mutateAsync(input);
    if (res.error || !res.bill) {
      setError(res.error ?? 'Could not create the bill.');
      return;
    }
    navigate(`${ACCOUNTING_BASE}/bills/${res.bill.id}`);
  };

  return (
    <AccountingShell active="bills" title="New Bill">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <TaxDisclaimer />

        {/* Header */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Vendor" htmlFor="bill-vendor" required>
            <select
              id="bill-vendor"
              className={inputClass}
              value={vendorId}
              onChange={(e) => setVendorId(e.target.value)}
              disabled={vendorsLoading}
            >
              <option value="">{vendorsLoading ? 'Loading…' : 'Select vendor…'}</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.displayName}
                  {v.is1099 ? ' (1099)' : ''}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="Bill number" htmlFor="bill-number" hint="The vendor's invoice / reference #">
            <input
              id="bill-number"
              className={inputClass}
              value={billNumber}
              onChange={(e) => setBillNumber(e.target.value)}
              placeholder="Optional"
            />
          </FormField>

          <FormField label="Bill date" htmlFor="bill-date">
            <input
              id="bill-date"
              type="date"
              className={inputClass}
              value={billDate}
              onChange={(e) => setBillDate(e.target.value)}
            />
          </FormField>

          <FormField label="Due date" htmlFor="bill-due">
            <input
              id="bill-due"
              type="date"
              className={inputClass}
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </FormField>

          <FormField label="Terms" htmlFor="bill-terms">
            <input
              id="bill-terms"
              className={inputClass}
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              placeholder="e.g. Net 30"
            />
          </FormField>

          <FormField label="Memo" htmlFor="bill-memo">
            <input
              id="bill-memo"
              className={inputClass}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="Optional note"
            />
          </FormField>
        </div>

        {/* Line items */}
        <div>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-400">
            Line items
          </h2>

          <div className="hidden grid-cols-[1fr_1fr_70px_100px_90px_32px] gap-2 px-1 pb-1 text-xs font-semibold uppercase text-slate-500 md:grid">
            <span>Expense account</span>
            <span>Description</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Unit cost</span>
            <span className="text-right">Amount</span>
            <span />
          </div>

          <div className="space-y-2">
            {lines.map((line, i) => {
              const amount = totals.lines[i]?.netCents ?? 0;
              return (
                <div
                  key={i}
                  className="grid grid-cols-[1fr_60px_84px_32px] items-center gap-2 md:grid-cols-[1fr_1fr_70px_100px_90px_32px]"
                >
                  <AccountPicker
                    ariaLabel={`Line ${i + 1} expense account`}
                    className="col-span-4 md:col-span-1"
                    value={line.accountId ?? ''}
                    onChange={(id) => updateLine(i, { accountId: id || null })}
                  />
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
                    aria-label={`Line ${i + 1} unit cost`}
                    value={line.unitCost ?? 0}
                    onValueChange={(v) =>
                      // User-entered cost supersedes any explicit lineTotal.
                      updateLine(i, { unitCost: v, lineTotal: undefined })
                    }
                  />
                  <span className="hidden text-right font-mono text-sm tabular-nums text-slate-300 md:block">
                    {formatMoney(amount / 100)}
                  </span>
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
          <p className="mt-1 text-xs text-slate-500">
            Leave the account blank to use{' '}
            {selectedVendor?.defaultExpenseAccountId
              ? "the vendor's default expense account"
              : 'the default operating-expenses account'}
            .
          </p>
        </div>

        {/* Totals */}
        <div className="ml-auto w-full max-w-xs space-y-1 border-t border-white/10 pt-3 text-sm">
          <div className="flex justify-between text-slate-400">
            <span>Subtotal</span>
            <span className="font-mono tabular-nums text-slate-200">
              {formatMoney(totals.subtotalCents / 100)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 text-slate-400">
            <label htmlFor="bill-tax" className="shrink-0">
              Tax
            </label>
            <div className="w-28">
              <CurrencyInput
                id="bill-tax"
                aria-label="Bill tax"
                value={taxTotal}
                onValueChange={setTaxTotal}
              />
            </div>
          </div>
          <div className="flex justify-between border-t border-white/10 pt-1 text-base font-bold text-white">
            <span>Total</span>
            <span className="font-mono tabular-nums">{formatMoney(totals.totalCents / 100)}</span>
          </div>
        </div>

        {/* Additive custom-fields preview (D4). Read-only until the draft is saved;
            values are entered/saved on the bill detail screen. Renders nothing when no
            bill custom fields are defined, so the create form is unchanged. */}
        {customFieldDefs.length > 0 && (
          <CustomFieldsSection
            entityType="bill"
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
          <Button variant="ghost" onClick={() => navigate(`${ACCOUNTING_BASE}/bills`)}>
            Cancel
          </Button>
          <Button
            icon="save"
            onClick={submit}
            disabled={createDraft.isPending || !vendorId || !hasAmount}
          >
            {createDraft.isPending ? 'Saving…' : 'Save draft'}
          </Button>
        </div>
      </div>
    </AccountingShell>
  );
}

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { AccountingShell } from '../components/AccountingShell';
import { AccountPicker } from '../components/AccountPicker';
import { CurrencyInput } from '../components/CurrencyInput';
import { TaxDisclaimer } from '../components/TaxDisclaimer';
import { useVendors } from '../hooks/useAccountingQueries';
import { useCreatePurchaseOrderDraft } from '../hooks/useAccountingMutations';
import { computePurchaseOrderTotals } from '@/services/api/accounting';
import { formatMoney } from '../accountingViewModel';
import { PURCHASE_ORDERS_BASE } from '../constants';
import type { NewPurchaseOrderInput, NewPurchaseOrderLineInput } from '../types';

const inputClass =
  'w-full rounded-sm border border-white/10 bg-background-dark px-2 py-1.5 text-white focus:border-primary focus:outline-none';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

const emptyLine = (): NewPurchaseOrderLineInput => ({
  accountId: null,
  description: '',
  quantityOrdered: 1,
  unitCost: 0,
});

export default function POCreateView() {
  const navigate = useNavigate();
  const { data: vendors = [], isPending: vendorsLoading } = useVendors();
  const createDraft = useCreatePurchaseOrderDraft();

  const [vendorId, setVendorId] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [orderDate, setOrderDate] = useState(todayISO());
  const [expectedDate, setExpectedDate] = useState('');
  const [memo, setMemo] = useState('');
  const [taxTotal, setTaxTotal] = useState(0);
  const [lines, setLines] = useState<NewPurchaseOrderLineInput[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);

  const updateLine = (i: number, patch: Partial<NewPurchaseOrderLineInput>) =>
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (i: number) =>
    setLines((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));

  // Live totals — reuse the exact pure function the service uses so the on-screen total
  // equals the persisted PO (and the bill it converts into).
  const totals = useMemo(() => computePurchaseOrderTotals(lines, taxTotal), [lines, taxTotal]);
  const hasAmount = totals.totalCents > 0;

  const submit = async () => {
    setError(null);
    if (!vendorId) {
      setError('Select a vendor for this purchase order.');
      return;
    }
    const realLines = lines.filter(
      (l) => (l.quantityOrdered ?? 0) > 0 && ((l.unitCost ?? 0) > 0 || (l.lineTotal ?? 0) > 0)
    );
    if (realLines.length === 0) {
      setError('Add at least one line with a quantity and cost.');
      return;
    }
    const input: NewPurchaseOrderInput = {
      vendorId,
      poNumber: poNumber.trim() || null,
      orderDate,
      expectedDate: expectedDate || null,
      taxTotal: taxTotal > 0 ? taxTotal : 0,
      memo: memo.trim() || null,
      lines: realLines,
    };
    const res = await createDraft.mutateAsync(input);
    if (res.error || !res.purchaseOrder) {
      setError(res.error ?? 'Could not create the purchase order.');
      return;
    }
    navigate(`${PURCHASE_ORDERS_BASE}/${res.purchaseOrder.id}`);
  };

  return (
    <AccountingShell active="purchase-orders" title="New Purchase Order">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <TaxDisclaimer />

        {/* Header */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Vendor" htmlFor="po-vendor" required>
            <select
              id="po-vendor"
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

          <FormField label="PO number" htmlFor="po-number" hint="Your reference #">
            <input
              id="po-number"
              className={inputClass}
              value={poNumber}
              onChange={(e) => setPoNumber(e.target.value)}
              placeholder="Optional"
            />
          </FormField>

          <FormField label="Order date" htmlFor="po-date">
            <input
              id="po-date"
              type="date"
              className={inputClass}
              value={orderDate}
              onChange={(e) => setOrderDate(e.target.value)}
            />
          </FormField>

          <FormField label="Expected date" htmlFor="po-expected">
            <input
              id="po-expected"
              type="date"
              className={inputClass}
              value={expectedDate}
              onChange={(e) => setExpectedDate(e.target.value)}
            />
          </FormField>

          <FormField label="Memo" htmlFor="po-memo">
            <input
              id="po-memo"
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
            <span>Expense / asset account</span>
            <span>Description</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Unit cost</span>
            <span className="text-right">Amount</span>
            <span />
          </div>

          <div className="space-y-2">
            {lines.map((line, i) => {
              const amount = Math.max(
                0,
                Math.round((line.quantityOrdered || 0) * (line.unitCost || 0) * 100)
              );
              return (
                <div
                  key={i}
                  className="grid grid-cols-[1fr_60px_84px_32px] items-center gap-2 md:grid-cols-[1fr_1fr_70px_100px_90px_32px]"
                >
                  <AccountPicker
                    ariaLabel={`Line ${i + 1} account`}
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
                    value={line.quantityOrdered ?? 0}
                    onValueChange={(v) =>
                      updateLine(i, { quantityOrdered: v, lineTotal: undefined })
                    }
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
            Pick the GL account each line will expense (or capitalize) to. The line carries onto the
            bill when you convert this PO.
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
            <label htmlFor="po-tax" className="shrink-0">
              Tax
            </label>
            <div className="w-28">
              <CurrencyInput
                id="po-tax"
                aria-label="Purchase order tax"
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

        {error && (
          <p className="text-sm text-red-400" role="alert">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-white/10 pt-4">
          <Button variant="ghost" onClick={() => navigate(PURCHASE_ORDERS_BASE)}>
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

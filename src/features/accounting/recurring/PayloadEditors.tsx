import { useMemo } from 'react';
import { FormField } from '@/components/ui/FormField';
import { CurrencyInput } from '../components/CurrencyInput';
import { AccountPicker } from '../components/AccountPicker';
import { LineDimensionFields } from './LineDimensionFields';
import { emptyBillLine, emptyInvoiceLine, emptyJournalLine } from './recurringFormat';
import { useCustomers, useTaxCodes, useVendors } from '../hooks/useAccountingQueries';
import { formatMoney, toCents } from '../accountingViewModel';
import type {
  LineDimensions,
  RecurringBillLine,
  RecurringBillPayload,
  RecurringInvoiceLine,
  RecurringInvoicePayload,
  RecurringJournalLine,
  RecurringJournalPayload,
} from '../types';

const inputClass =
  'w-full rounded-lg border border-line bg-background-dark px-2 py-1.5 text-white focus:border-primary focus:outline-none';

/** Remove-line button shared by every editor (disabled when only one line remains). */
function RemoveLineButton({
  index,
  count,
  onRemove,
}: {
  index: number;
  count: number;
  onRemove: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label={`Remove line ${index + 1}`}
      disabled={count <= 1}
      className="flex items-center justify-center rounded-lg text-subtle hover:bg-overlay/10 hover:text-red-400 disabled:opacity-30"
    >
      <span className="material-symbols-outlined text-lg">delete</span>
    </button>
  );
}

function AddLineButton({ onAdd }: { onAdd: () => void }) {
  return (
    <button
      type="button"
      onClick={onAdd}
      className="mt-1 flex items-center gap-1 text-sm font-semibold text-primary hover:text-primary-hover"
    >
      <span className="material-symbols-outlined text-lg">add</span>
      Add line
    </button>
  );
}

// ── Invoice payload editor ──────────────────────────────────────────────────────
export function InvoicePayloadEditor({
  payload,
  onChange,
}: {
  payload: RecurringInvoicePayload;
  onChange: (p: RecurringInvoicePayload) => void;
}) {
  const { data: customers = [], isPending: customersLoading } = useCustomers();
  const { data: taxCodes = [] } = useTaxCodes();

  const setHeader = (patch: Partial<RecurringInvoicePayload>) => onChange({ ...payload, ...patch });
  const setLine = (i: number, patch: Partial<RecurringInvoiceLine>) =>
    onChange({
      ...payload,
      lines: payload.lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)),
    });
  const setLineDims = (i: number, patch: Partial<LineDimensions>) => setLine(i, patch);
  const addLine = () => onChange({ ...payload, lines: [...payload.lines, emptyInvoiceLine()] });
  const removeLine = (i: number) =>
    onChange({
      ...payload,
      lines: payload.lines.length > 1 ? payload.lines.filter((_, idx) => idx !== i) : payload.lines,
    });

  const grossCents = useMemo(
    () =>
      payload.lines.reduce((sum, l) => {
        const gross =
          l.lineTotal != null
            ? l.lineTotal
            : (l.quantity ?? 0) * (l.unitPrice ?? 0) - (l.discount ?? 0);
        return sum + toCents(gross);
      }, 0),
    [payload.lines]
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Customer" htmlFor="rec-customer" required>
          <select
            id="rec-customer"
            className={inputClass}
            value={payload.customerId ?? ''}
            onChange={(e) => setHeader({ customerId: e.target.value })}
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
          htmlFor="rec-taxcode"
          hint="Applied to taxable lines without their own code"
        >
          <select
            id="rec-taxcode"
            className={inputClass}
            value={payload.taxCodeId ?? ''}
            onChange={(e) => setHeader({ taxCodeId: e.target.value || null })}
          >
            <option value="">No tax</option>
            {taxCodes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.isTaxable ? ` (${(t.rate * 100).toFixed(3)}%)` : ' (non-taxable)'}
              </option>
            ))}
          </select>
        </FormField>

        <FormField label="Due in (days)" htmlFor="rec-duein" hint="Days after each generation date">
          <input
            id="rec-duein"
            type="number"
            min={0}
            className={`${inputClass} text-right`}
            value={payload.dueInDays ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              setHeader({ dueInDays: v === '' ? null : Math.max(0, Number.parseInt(v, 10) || 0) });
            }}
            placeholder="e.g. 30"
          />
        </FormField>

        <FormField label="Memo" htmlFor="rec-memo">
          <input
            id="rec-memo"
            className={inputClass}
            value={payload.memo ?? ''}
            onChange={(e) => setHeader({ memo: e.target.value || null })}
            placeholder="Optional note on each invoice"
          />
        </FormField>
      </div>

      <LineEditorFrame title="Invoice lines" total={grossCents}>
        {payload.lines.map((line, i) => (
          <div
            key={i}
            className="flex flex-col gap-2 rounded-lg border border-line/60 bg-overlay/[0.02] p-2"
          >
            <div className="grid grid-cols-[1fr_60px_84px_32px] items-center gap-2">
              <input
                aria-label={`Line ${i + 1} description`}
                className={inputClass}
                value={line.description ?? ''}
                onChange={(e) => setLine(i, { description: e.target.value })}
                placeholder="Description"
              />
              <CurrencyInput
                aria-label={`Line ${i + 1} quantity`}
                value={line.quantity ?? 0}
                onValueChange={(v) => setLine(i, { quantity: v })}
              />
              <CurrencyInput
                aria-label={`Line ${i + 1} unit price`}
                value={line.unitPrice ?? 0}
                onValueChange={(v) => setLine(i, { unitPrice: v, lineTotal: undefined })}
              />
              <RemoveLineButton
                index={i}
                count={payload.lines.length}
                onRemove={() => removeLine(i)}
              />
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs text-muted">
                <input
                  type="checkbox"
                  aria-label={`Line ${i + 1} taxable`}
                  checked={line.taxable !== false}
                  onChange={(e) => setLine(i, { taxable: e.target.checked })}
                  className="size-4 accent-primary"
                />
                Taxable
              </label>
            </div>
            <LineDimensionFields dims={line} onChange={(p) => setLineDims(i, p)} index={i} />
          </div>
        ))}
        <AddLineButton onAdd={addLine} />
      </LineEditorFrame>
    </div>
  );
}

// ── Bill payload editor ─────────────────────────────────────────────────────────
export function BillPayloadEditor({
  payload,
  onChange,
}: {
  payload: RecurringBillPayload;
  onChange: (p: RecurringBillPayload) => void;
}) {
  const { data: vendors = [], isPending: vendorsLoading } = useVendors();

  const setHeader = (patch: Partial<RecurringBillPayload>) => onChange({ ...payload, ...patch });
  const setLine = (i: number, patch: Partial<RecurringBillLine>) =>
    onChange({
      ...payload,
      lines: payload.lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)),
    });
  const setLineDims = (i: number, patch: Partial<LineDimensions>) => setLine(i, patch);
  const addLine = () => onChange({ ...payload, lines: [...payload.lines, emptyBillLine()] });
  const removeLine = (i: number) =>
    onChange({
      ...payload,
      lines: payload.lines.length > 1 ? payload.lines.filter((_, idx) => idx !== i) : payload.lines,
    });

  const grossCents = useMemo(() => {
    const lines = payload.lines.reduce((sum, l) => {
      const gross = l.lineTotal != null ? l.lineTotal : (l.quantity ?? 0) * (l.unitCost ?? 0);
      return sum + toCents(gross);
    }, 0);
    return lines + toCents(payload.taxTotal ?? 0);
  }, [payload.lines, payload.taxTotal]);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Vendor" htmlFor="rec-vendor" required>
          <select
            id="rec-vendor"
            className={inputClass}
            value={payload.vendorId ?? ''}
            onChange={(e) => setHeader({ vendorId: e.target.value })}
            disabled={vendorsLoading}
          >
            <option value="">{vendorsLoading ? 'Loading…' : 'Select vendor…'}</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.displayName}
              </option>
            ))}
          </select>
        </FormField>

        <FormField
          label="Due in (days)"
          htmlFor="rec-bduein"
          hint="Days after each generation date"
        >
          <input
            id="rec-bduein"
            type="number"
            min={0}
            className={`${inputClass} text-right`}
            value={payload.dueInDays ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              setHeader({ dueInDays: v === '' ? null : Math.max(0, Number.parseInt(v, 10) || 0) });
            }}
            placeholder="e.g. 30"
          />
        </FormField>

        <FormField
          label="Tax total"
          htmlFor="rec-btax"
          hint="Header sales/use tax in dollars (bills tax at the header)"
        >
          <CurrencyInput
            id="rec-btax"
            value={payload.taxTotal ?? 0}
            onValueChange={(v) => setHeader({ taxTotal: v })}
          />
        </FormField>

        <FormField label="Memo" htmlFor="rec-bmemo">
          <input
            id="rec-bmemo"
            className={inputClass}
            value={payload.memo ?? ''}
            onChange={(e) => setHeader({ memo: e.target.value || null })}
            placeholder="Optional note on each bill"
          />
        </FormField>
      </div>

      <LineEditorFrame title="Bill lines" total={grossCents}>
        {payload.lines.map((line, i) => (
          <div
            key={i}
            className="flex flex-col gap-2 rounded-lg border border-line/60 bg-overlay/[0.02] p-2"
          >
            <div className="grid grid-cols-[1fr_60px_84px_32px] items-center gap-2">
              <input
                aria-label={`Line ${i + 1} description`}
                className={inputClass}
                value={line.description ?? ''}
                onChange={(e) => setLine(i, { description: e.target.value })}
                placeholder="Description"
              />
              <CurrencyInput
                aria-label={`Line ${i + 1} quantity`}
                value={line.quantity ?? 0}
                onValueChange={(v) => setLine(i, { quantity: v })}
              />
              <CurrencyInput
                aria-label={`Line ${i + 1} unit cost`}
                value={line.unitCost ?? 0}
                onValueChange={(v) => setLine(i, { unitCost: v, lineTotal: undefined })}
              />
              <RemoveLineButton
                index={i}
                count={payload.lines.length}
                onRemove={() => removeLine(i)}
              />
            </div>
            <FormField label="Expense account" htmlFor={`rec-bacct-${i}`} className="!mb-0">
              <AccountPicker
                id={`rec-bacct-${i}`}
                ariaLabel={`Line ${i + 1} expense account`}
                value={line.accountId ?? ''}
                onChange={(id) => setLine(i, { accountId: id || null })}
              />
            </FormField>
            <LineDimensionFields dims={line} onChange={(p) => setLineDims(i, p)} index={i} />
          </div>
        ))}
        <AddLineButton onAdd={addLine} />
      </LineEditorFrame>
    </div>
  );
}

// ── Journal payload editor ──────────────────────────────────────────────────────
export function JournalPayloadEditor({
  payload,
  onChange,
}: {
  payload: RecurringJournalPayload;
  onChange: (p: RecurringJournalPayload) => void;
}) {
  const setLine = (i: number, patch: Partial<RecurringJournalLine>) =>
    onChange({
      ...payload,
      lines: payload.lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)),
    });
  const setLineDims = (i: number, patch: Partial<LineDimensions>) => setLine(i, patch);
  const addLine = () => onChange({ ...payload, lines: [...payload.lines, emptyJournalLine()] });
  const removeLine = (i: number) =>
    onChange({
      ...payload,
      lines: payload.lines.length > 1 ? payload.lines.filter((_, idx) => idx !== i) : payload.lines,
    });

  const { debitCents, creditCents } = useMemo(() => {
    let d = 0;
    let c = 0;
    for (const l of payload.lines) {
      d += toCents(l.debit ?? 0);
      c += toCents(l.credit ?? 0);
    }
    return { debitCents: d, creditCents: c };
  }, [payload.lines]);
  const diffCents = debitCents - creditCents;
  const balanced = diffCents === 0 && debitCents > 0;

  return (
    <div className="flex flex-col gap-3">
      <FormField label="Memo" htmlFor="rec-jmemo">
        <input
          id="rec-jmemo"
          className={inputClass}
          value={payload.memo ?? ''}
          onChange={(e) => onChange({ ...payload, memo: e.target.value || null })}
          placeholder="Optional note on each entry"
        />
      </FormField>

      <div>
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">Journal lines</h3>
        <p className="mb-2 text-xs text-subtle">
          Enter an explicit debit or credit per account (not both). Total debits must equal total
          credits — the entry posts through the same balance-enforced ledger as a manual journal
          entry.
        </p>

        <div className="flex flex-col gap-2">
          {payload.lines.map((line, i) => (
            <div
              key={i}
              className="flex flex-col gap-2 rounded-lg border border-line/60 bg-overlay/[0.02] p-2"
            >
              <div className="grid grid-cols-[1fr_84px_84px_32px] items-center gap-2">
                <AccountPicker
                  ariaLabel={`Line ${i + 1} account`}
                  value={line.accountId}
                  onChange={(id) => setLine(i, { accountId: id })}
                />
                <CurrencyInput
                  aria-label={`Line ${i + 1} debit`}
                  value={line.debit ?? 0}
                  onValueChange={(v) => setLine(i, { debit: v, credit: v > 0 ? 0 : line.credit })}
                />
                <CurrencyInput
                  aria-label={`Line ${i + 1} credit`}
                  value={line.credit ?? 0}
                  onValueChange={(v) => setLine(i, { credit: v, debit: v > 0 ? 0 : line.debit })}
                />
                <RemoveLineButton
                  index={i}
                  count={payload.lines.length}
                  onRemove={() => removeLine(i)}
                />
              </div>
              <input
                aria-label={`Line ${i + 1} memo`}
                className={inputClass}
                value={line.lineMemo ?? ''}
                onChange={(e) => setLine(i, { lineMemo: e.target.value || null })}
                placeholder="Line memo (optional)"
              />
              <LineDimensionFields dims={line} onChange={(p) => setLineDims(i, p)} index={i} />
            </div>
          ))}
        </div>

        <AddLineButton onAdd={addLine} />

        {/* Live balance indicator */}
        <div className="mt-3 flex items-center justify-between rounded-lg border border-line bg-overlay/5 px-3 py-2 text-sm">
          <span className="flex items-center gap-4">
            <span className="text-muted">
              Debits{' '}
              <span className="font-mono tabular-nums text-white">
                {formatMoney(debitCents / 100)}
              </span>
            </span>
            <span className="text-muted">
              Credits{' '}
              <span className="font-mono tabular-nums text-white">
                {formatMoney(creditCents / 100)}
              </span>
            </span>
          </span>
          {balanced ? (
            <span className="flex items-center gap-1 font-semibold text-emerald-400">
              <span className="material-symbols-outlined text-lg">check_circle</span>
              Balanced
            </span>
          ) : (
            <span className="flex items-center gap-1 font-semibold text-amber-400">
              <span className="material-symbols-outlined text-lg">warning</span>
              {debitCents === 0
                ? 'Enter amounts'
                : `Off by ${formatMoney(Math.abs(diffCents) / 100)}`}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Shared frame around a line list: titled header + a gross-total footer. */
function LineEditorFrame({
  title,
  total,
  children,
}: {
  title: string;
  total: number;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wide text-muted">{title}</h3>
        <span className="text-sm text-muted">
          Lines total{' '}
          <span className="font-mono tabular-nums text-white">{formatMoney(total / 100)}</span>
        </span>
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

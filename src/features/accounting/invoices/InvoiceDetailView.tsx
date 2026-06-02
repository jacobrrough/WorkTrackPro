import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { AccountingShell } from '../components/AccountingShell';
import { LedgerTable } from '../components/LedgerTable';
import { CurrencyInput } from '../components/CurrencyInput';
import { CustomFieldsSection } from '../components/CustomFieldsSection';
import { TaxDisclaimer } from '../components/TaxDisclaimer';
import { useInvoice, useInvoicePayments } from '../hooks/useAccountingQueries';
import {
  useRecordPayment,
  useSendInvoice,
  useVoidInvoice,
} from '../hooks/useAccountingMutations';
import { formatMoney } from '../accountingViewModel';
import { ACCOUNTING_BASE } from '../constants';
import {
  INVOICE_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  type Invoice,
  type InvoiceLine,
  type InvoiceStatus,
  type PaymentMethod,
} from '../types';

const inputClass =
  'w-full rounded-sm border border-white/10 bg-background-dark px-2 py-1.5 text-white focus:border-primary focus:outline-none';

const STATUS_STYLES: Record<InvoiceStatus, string> = {
  draft: 'bg-white/10 text-slate-300',
  sent: 'bg-sky-500/15 text-sky-400',
  partially_paid: 'bg-amber-500/15 text-amber-400',
  paid: 'bg-green-500/15 text-green-400',
  void: 'bg-red-500/15 text-red-400',
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function sortedLines(lines: InvoiceLine[] | undefined): InvoiceLine[] {
  return [...(lines ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Dialog to record a customer payment fully applied to this one invoice. */
function RecordPaymentModal({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const recordPayment = useRecordPayment();
  const [amount, setAmount] = useState(invoice.balanceDue);
  const [paymentDate, setPaymentDate] = useState(todayISO());
  const [method, setMethod] = useState<PaymentMethod>('check');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);

  const overBalance = amount > invoice.balanceDue + 0.005;

  const submit = async () => {
    setError(null);
    if (amount <= 0) {
      setError('Enter a payment amount greater than zero.');
      return;
    }
    if (overBalance) {
      setError(
        `Amount exceeds the balance due (${formatMoney(invoice.balanceDue)}). Phase A applies each payment fully to its invoice.`
      );
      return;
    }
    const res = await recordPayment.mutateAsync({
      customerId: invoice.customerId,
      paymentDate,
      amount,
      method,
      reference: reference.trim() || null,
      applications: [{ invoiceId: invoice.id, amountApplied: amount }],
    });
    if (res.error || !res.payment) {
      setError(res.error ?? 'Could not record the payment.');
      return;
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-sm border border-white/10 bg-card-dark p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">Record Payment</h2>
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
          Balance due{' '}
          <span className="font-mono font-bold text-white">{formatMoney(invoice.balanceDue)}</span>.
          Posts a balanced receipt entry (Dr Cash / Cr Accounts Receivable).
        </p>

        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Amount" htmlFor="pay-amount" required>
              <CurrencyInput
                id="pay-amount"
                aria-label="Payment amount"
                value={amount}
                onValueChange={setAmount}
              />
            </FormField>
            <FormField label="Date" htmlFor="pay-date">
              <input
                id="pay-date"
                type="date"
                className={inputClass}
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
              />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Method" htmlFor="pay-method">
              <select
                id="pay-method"
                className={inputClass}
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethod)}
              >
                {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABELS[m]}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Reference" htmlFor="pay-ref" hint="Check # or txn id">
              <input
                id="pay-ref"
                className={inputClass}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Optional"
              />
            </FormField>
          </div>

          {error && (
            <p className="text-sm text-red-400" role="alert">
              {error}
            </p>
          )}

          <div className="mt-1 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={recordPayment.isPending || amount <= 0 || overBalance}>
              {recordPayment.isPending ? 'Recording…' : 'Record payment'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function InvoiceDetailView() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const navigate = useNavigate();
  const { data: invoice, isPending, isError } = useInvoice(invoiceId);
  const { data: payments = [] } = useInvoicePayments(invoiceId);
  const sendInvoice = useSendInvoice();
  const voidInvoice = useVoidInvoice();
  const [showPayment, setShowPayment] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const onSend = async () => {
    if (!invoice) return;
    setActionError(null);
    const res = await sendInvoice.mutateAsync(invoice.id);
    if (res.error) setActionError(res.error);
  };

  const onVoid = async () => {
    if (!invoice) return;
    const reason = window.prompt('Reason for voiding this invoice?');
    if (reason == null) return;
    setActionError(null);
    const res = await voidInvoice.mutateAsync({ id: invoice.id, reason: reason.trim() || 'Voided' });
    if (!res.ok) setActionError(res.error ?? 'Could not void the invoice.');
  };

  const lines = sortedLines(invoice?.lines);
  const canSend = invoice?.status === 'draft';
  const canPay =
    invoice != null &&
    (invoice.status === 'sent' || invoice.status === 'partially_paid') &&
    invoice.balanceDue > 0;
  const canVoid = invoice != null && invoice.status !== 'void' && invoice.amountPaid === 0;
  const taxShown = (invoice?.taxTotal ?? 0) > 0;

  return (
    <AccountingShell
      active="invoices"
      title={invoice ? `Invoice ${invoice.invoiceNumber ?? 'Draft'}` : 'Invoice'}
      actions={
        invoice ? (
          <div className="flex gap-2">
            {canSend && (
              <Button size="sm" icon="send" onClick={onSend} disabled={sendInvoice.isPending}>
                {sendInvoice.isPending ? 'Sending…' : 'Send'}
              </Button>
            )}
            {canPay && (
              <Button size="sm" icon="payments" onClick={() => setShowPayment(true)}>
                Record payment
              </Button>
            )}
            {canVoid && (
              <Button size="sm" variant="danger" onClick={onVoid} disabled={voidInvoice.isPending}>
                {voidInvoice.isPending ? 'Voiding…' : 'Void'}
              </Button>
            )}
          </div>
        ) : undefined
      }
    >
      {isPending && <p className="text-slate-400">Loading invoice…</p>}
      {isError && <p className="text-red-400">Could not load this invoice.</p>}
      {!isPending && !isError && !invoice && <p className="text-slate-400">Invoice not found.</p>}

      {invoice && (
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {taxShown && <TaxDisclaimer />}

          {/* Status + meta */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span
              className={`rounded-sm px-2 py-0.5 text-xs font-semibold uppercase ${STATUS_STYLES[invoice.status]}`}
            >
              {INVOICE_STATUS_LABELS[invoice.status]}
            </span>
            <span className="text-sm text-slate-400">
              Customer <span className="text-white">{invoice.customerName || invoice.customerId}</span>
            </span>
            <span className="text-sm text-slate-400">
              Date <span className="text-white">{invoice.invoiceDate}</span>
            </span>
            {invoice.dueDate && (
              <span className="text-sm text-slate-400">
                Due <span className="text-white">{invoice.dueDate}</span>
              </span>
            )}
            {invoice.terms && (
              <span className="text-sm text-slate-400">
                Terms <span className="text-white">{invoice.terms}</span>
              </span>
            )}
          </div>

          {invoice.memo && <p className="text-white">{invoice.memo}</p>}

          {/* Line items */}
          <LedgerTable
            columns={[
              { label: 'Description' },
              { label: 'Qty', align: 'right' },
              { label: 'Unit price', align: 'right' },
              { label: 'Amount', align: 'right' },
            ]}
          >
            {lines.map((l) => (
              <tr key={l.id} className="border-t border-white/5">
                <td className="px-3 py-2 text-white">{l.description || '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-300">{l.quantity}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-300">
                  {formatMoney(l.unitPrice)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-200">
                  {formatMoney(l.lineTotal)}
                </td>
              </tr>
            ))}
            {lines.length === 0 && (
              <tr className="border-t border-white/5">
                <td className="px-3 py-2 text-slate-500" colSpan={4}>
                  No line items.
                </td>
              </tr>
            )}
          </LedgerTable>

          {/* Totals */}
          <div className="ml-auto w-full max-w-xs space-y-1 text-sm">
            <div className="flex justify-between text-slate-400">
              <span>Subtotal</span>
              <span className="font-mono tabular-nums text-slate-200">
                {formatMoney(invoice.subtotal)}
              </span>
            </div>
            {invoice.discountTotal > 0 && (
              <div className="flex justify-between text-slate-400">
                <span>Discount</span>
                <span className="font-mono tabular-nums text-slate-200">
                  −{formatMoney(invoice.discountTotal)}
                </span>
              </div>
            )}
            <div className="flex justify-between text-slate-400">
              <span>Tax</span>
              <span className="font-mono tabular-nums text-slate-200">
                {formatMoney(invoice.taxTotal)}
              </span>
            </div>
            <div className="flex justify-between border-t border-white/10 pt-1 text-base font-bold text-white">
              <span>Total</span>
              <span className="font-mono tabular-nums">{formatMoney(invoice.total)}</span>
            </div>
            {invoice.amountPaid > 0 && (
              <div className="flex justify-between text-green-400">
                <span>Paid</span>
                <span className="font-mono tabular-nums">−{formatMoney(invoice.amountPaid)}</span>
              </div>
            )}
            <div className="flex justify-between text-base font-bold text-white">
              <span>Balance due</span>
              <span className="font-mono tabular-nums">{formatMoney(invoice.balanceDue)}</span>
            </div>
          </div>

          {/* Posted journal entry link */}
          {invoice.journalEntryId && (
            <button
              type="button"
              onClick={() =>
                navigate(`${ACCOUNTING_BASE}/journal/${invoice.journalEntryId}`)
              }
              className="flex items-center gap-1 self-start text-sm font-semibold text-primary hover:text-primary-hover"
            >
              <span className="material-symbols-outlined text-lg">menu_book</span>
              View revenue journal entry
            </button>
          )}

          {/* Payment history */}
          {payments.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-400">
                Payments
              </h2>
              <div className="divide-y divide-white/5 overflow-hidden rounded-sm border border-white/10">
                {payments.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="w-24 shrink-0 text-slate-400">{p.paymentDate}</span>
                    <span className="flex-1 truncate text-white">
                      {PAYMENT_METHOD_LABELS[p.method]}
                      {p.reference ? ` · ${p.reference}` : ''}
                    </span>
                    <span className="shrink-0 font-mono tabular-nums text-green-400">
                      {formatMoney(p.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {actionError && (
            <p className="text-sm text-red-400" role="alert">
              {actionError}
            </p>
          )}

          {/* Additive custom fields (D4). Renders nothing when no invoice custom fields
              are defined; otherwise edits/saves them into accounting.custom_field_values
              without touching this invoice's own record. */}
          <CustomFieldsSection entityType="invoice" entityId={invoice.id} />
        </div>
      )}

      {showPayment && invoice && (
        <RecordPaymentModal invoice={invoice} onClose={() => setShowPayment(false)} />
      )}
    </AccountingShell>
  );
}

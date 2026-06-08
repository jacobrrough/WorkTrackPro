import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { AccountingShell } from '../components/AccountingShell';
import { LIST_CONTAINER, LIST_HEADER, LIST_ROW } from '../components/listRowStyles';
import { useInvoices } from '../hooks/useAccountingQueries';
import { formatMoney } from '../accountingViewModel';
import { ACCOUNTING_BASE } from '../constants';
import { INVOICE_STATUS_LABELS, type Invoice, type InvoiceStatus } from '../types';

const STATUS_STYLES: Record<InvoiceStatus, string> = {
  draft: 'bg-white/10 text-slate-300',
  sent: 'bg-sky-500/15 text-sky-400',
  partially_paid: 'bg-amber-500/15 text-amber-400',
  paid: 'bg-green-500/15 text-green-400',
  void: 'bg-red-500/15 text-red-400',
};

function StatusPill({ status }: { status: InvoiceStatus }) {
  return (
    <span
      className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase ${STATUS_STYLES[status]}`}
    >
      {INVOICE_STATUS_LABELS[status]}
    </span>
  );
}

function InvoiceRow({ invoice, onOpen }: { invoice: Invoice; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className={LIST_ROW}>
      <span className="w-24 shrink-0 truncate font-mono text-xs text-slate-500">
        {invoice.invoiceNumber || 'Draft'}
      </span>
      <span className="w-24 shrink-0 text-sm text-slate-400">{invoice.invoiceDate}</span>
      <span className="flex-1 truncate text-white">
        {invoice.customerName || invoice.customerId}
      </span>
      <span className="hidden w-28 shrink-0 text-right font-mono text-sm tabular-nums text-slate-400 sm:block">
        {formatMoney(invoice.total)}
      </span>
      <span className="w-28 shrink-0 text-right font-mono text-sm tabular-nums text-slate-200">
        {formatMoney(invoice.balanceDue)}
      </span>
      <StatusPill status={invoice.status} />
    </button>
  );
}

export default function InvoicesView() {
  const navigate = useNavigate();
  const { data: invoices = [], isPending, isError } = useInvoices();

  return (
    <AccountingShell
      active="invoices"
      title="Invoices"
      actions={
        <Button size="sm" icon="add" onClick={() => navigate(`${ACCOUNTING_BASE}/invoices/new`)}>
          New invoice
        </Button>
      }
    >
      {isPending && <p className="text-slate-400">Loading invoices…</p>}
      {isError && (
        <p className="text-red-400">
          Could not load invoices. Confirm the accounting schema is exposed and you have an
          accounting role.
        </p>
      )}

      {!isPending && !isError && invoices.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-sm border border-dashed border-white/15 px-6 py-16 text-center">
          <span className="material-symbols-outlined text-4xl text-slate-500">receipt_long</span>
          <p className="text-lg font-bold text-white">No invoices yet</p>
          <p className="max-w-sm text-sm text-slate-400">
            Create an invoice from a job or from scratch. Sending it posts a balanced revenue entry
            to the general ledger.
          </p>
          <Button size="sm" icon="add" onClick={() => navigate(`${ACCOUNTING_BASE}/invoices/new`)}>
            New invoice
          </Button>
        </div>
      )}

      {invoices.length > 0 && (
        <>
          <div className={LIST_HEADER}>
            <span className="w-24 shrink-0">Number</span>
            <span className="w-24 shrink-0">Date</span>
            <span className="flex-1">Customer</span>
            <span className="w-28 shrink-0 text-right">Total</span>
            <span className="w-28 shrink-0 text-right">Balance</span>
            <span className="w-[58px] shrink-0" />
          </div>
          <div className={LIST_CONTAINER}>
            {invoices.map((inv) => (
              <InvoiceRow
                key={inv.id}
                invoice={inv}
                onOpen={() => navigate(`${ACCOUNTING_BASE}/invoices/${inv.id}`)}
              />
            ))}
          </div>
        </>
      )}
    </AccountingShell>
  );
}

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { AccountingShell } from '../components/AccountingShell';
import { LIST_CONTAINER, LIST_HEADER, LIST_ROW } from '../components/listRowStyles';
import { useInvoices } from '../hooks/useAccountingQueries';
import { formatMoney } from '../accountingViewModel';
import { ACCOUNTING_BASE } from '../constants';
import { INVOICE_STATUS_LABELS, type Invoice, type InvoiceStatus } from '../types';
import {
  DocumentFilterBar,
  applyDocFilters,
  initialDocFilters,
  type DocFilters,
  type DocStatusOption,
} from '../components/DocumentFilterBar';

const STATUS_STYLES: Record<InvoiceStatus, string> = {
  draft: 'bg-overlay/10 text-muted',
  sent: 'bg-sky-500/15 text-sky-400',
  partially_paid: 'bg-amber-500/15 text-amber-400',
  paid: 'bg-green-500/15 text-green-400',
  void: 'bg-red-500/15 text-red-400',
};

function StatusPill({ status }: { status: InvoiceStatus }) {
  return (
    <span
      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase ${STATUS_STYLES[status]}`}
    >
      {INVOICE_STATUS_LABELS[status]}
    </span>
  );
}

/** Compact "open the linked job" affordance (stops row-click navigation). */
function JobCell({ jobId }: { jobId: string | null }) {
  if (!jobId) {
    return <span className="hidden w-14 shrink-0 text-center text-xs text-subtle md:block">—</span>;
  }
  return (
    <Link
      to={`/app/jobs/${jobId}`}
      onClick={(e) => e.stopPropagation()}
      className="hidden w-14 shrink-0 items-center justify-center gap-0.5 text-xs font-semibold text-primary hover:underline md:flex"
      title="Open the linked job"
    >
      <span className="material-symbols-outlined text-sm">work</span>
      Job
    </Link>
  );
}

function InvoiceRow({ invoice, onOpen }: { invoice: Invoice; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className={LIST_ROW}>
      <span className="w-24 shrink-0 truncate font-mono text-xs text-subtle">
        {invoice.invoiceNumber || 'Draft'}
      </span>
      <span className="w-24 shrink-0 text-sm text-muted">{invoice.invoiceDate}</span>
      <span className="flex-1 truncate text-white">
        {invoice.customerName || invoice.customerId}
      </span>
      <JobCell jobId={invoice.jobId} />
      <span className="hidden w-28 shrink-0 text-right font-mono text-sm tabular-nums text-muted sm:block">
        {formatMoney(invoice.total)}
      </span>
      <span className="w-28 shrink-0 text-right font-mono text-sm tabular-nums text-white">
        {formatMoney(invoice.balanceDue)}
      </span>
      <StatusPill status={invoice.status} />
    </button>
  );
}

const STATUS_OPTIONS: DocStatusOption[] = [
  { value: 'active', label: 'Active (hide voided)' },
  { value: 'all', label: 'All' },
  { value: 'draft', label: INVOICE_STATUS_LABELS.draft },
  { value: 'sent', label: INVOICE_STATUS_LABELS.sent },
  { value: 'partially_paid', label: INVOICE_STATUS_LABELS.partially_paid },
  { value: 'paid', label: INVOICE_STATUS_LABELS.paid },
  { value: 'void', label: INVOICE_STATUS_LABELS.void },
];

export default function InvoicesView() {
  const navigate = useNavigate();
  const { data: invoices = [], isPending, isError } = useInvoices();
  const [filters, setFilters] = useState<DocFilters>(() => initialDocFilters('active'));

  const filtered = useMemo(
    () =>
      applyDocFilters(invoices, filters, {
        number: (i) => i.invoiceNumber,
        party: (i) => i.customerName ?? i.customerId,
        date: (i) => i.invoiceDate,
        status: (i) => i.status,
      }),
    [invoices, filters]
  );

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
      {isPending && <p className="text-muted">Loading invoices…</p>}
      {isError && (
        <p className="text-red-400">
          Could not load invoices. Confirm the accounting schema is exposed and you have an
          accounting role.
        </p>
      )}

      {!isPending && !isError && invoices.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-line px-6 py-16 text-center">
          <span className="material-symbols-outlined text-4xl text-subtle">receipt_long</span>
          <p className="text-lg font-bold text-white">No invoices yet</p>
          <p className="max-w-sm text-sm text-muted">
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
          <DocumentFilterBar
            filters={filters}
            onChange={setFilters}
            statusOptions={STATUS_OPTIONS}
            searchPlaceholder="Search number or customer…"
            resultCount={filtered.length}
            totalCount={invoices.length}
          />
          <div className={LIST_HEADER}>
            <span className="w-24 shrink-0">Number</span>
            <span className="w-24 shrink-0">Date</span>
            <span className="flex-1">Customer</span>
            <span className="hidden w-14 shrink-0 text-center md:block">Job</span>
            <span className="w-28 shrink-0 text-right">Total</span>
            <span className="w-28 shrink-0 text-right">Balance</span>
            <span className="w-[58px] shrink-0" />
          </div>
          <div className={LIST_CONTAINER}>
            {filtered.map((inv) => (
              <InvoiceRow
                key={inv.id}
                invoice={inv}
                onOpen={() => navigate(`${ACCOUNTING_BASE}/invoices/${inv.id}`)}
              />
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-subtle">
                No invoices match this filter.
              </p>
            )}
          </div>
        </>
      )}
    </AccountingShell>
  );
}

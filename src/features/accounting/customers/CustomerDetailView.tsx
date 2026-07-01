import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { AccountingShell } from '../components/AccountingShell';
import { LIST_CONTAINER, LIST_HEADER, LIST_ROW } from '../components/listRowStyles';
import {
  useCustomer,
  useInvoicesByCustomer,
  useEstimatesByCustomer,
  usePaymentsByCustomer,
} from '../hooks/useAccountingQueries';
import { useUpdateCustomer } from '../hooks/useAccountingMutations';
import { formatMoney } from '../accountingViewModel';
import { formatCustomerAddress } from '@/services/api/accounting';
import { ACCOUNTING_BASE, ESTIMATES_BASE } from '../constants';
import EditCustomerDrawer from './EditCustomerDrawer';
import {
  INVOICE_STATUS_LABELS,
  ESTIMATE_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  type EstimateStatus,
  type InvoiceStatus,
} from '../types';

const INVOICE_STATUS_STYLES: Record<InvoiceStatus, string> = {
  draft: 'bg-overlay/10 text-muted',
  sent: 'bg-sky-500/15 text-sky-400',
  partially_paid: 'bg-amber-500/15 text-amber-400',
  paid: 'bg-green-500/15 text-green-400',
  void: 'bg-red-500/15 text-red-400',
};

const ESTIMATE_STATUS_STYLES: Record<EstimateStatus, string> = {
  draft: 'bg-overlay/10 text-muted',
  sent: 'bg-sky-500/15 text-sky-400',
  accepted: 'bg-green-500/15 text-green-400',
  declined: 'bg-red-500/15 text-red-400',
  expired: 'bg-amber-500/15 text-amber-400',
  converted: 'bg-violet-500/15 text-violet-400',
};

const PAYMENT_STATUS_STYLE = 'bg-green-500/15 text-green-400';

function StatCard({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-line bg-background-dark/40 px-4 py-3">
      <span className="text-xs font-semibold uppercase tracking-wide text-subtle">{label}</span>
      <span
        className={`truncate font-mono text-base font-bold tabular-nums ${tone ?? 'text-white'}`}
      >
        {value}
      </span>
    </div>
  );
}

/** One transaction type. 'all' is the default tab (no filter). */
type TxnTypeFilter = 'all' | 'invoice' | 'estimate' | 'payment';

const TYPE_OPTIONS: { value: TxnTypeFilter; label: string }[] = [
  { value: 'all', label: 'All transactions' },
  { value: 'invoice', label: 'Invoices' },
  { value: 'estimate', label: 'Estimates' },
  { value: 'payment', label: 'Payments' },
];

/** Singular type label shown in each transaction row's Type cell. */
const TYPE_LABEL: Record<Exclude<TxnTypeFilter, 'all'>, string> = {
  invoice: 'Invoice',
  estimate: 'Estimate',
  payment: 'Payment',
};

/** A labeled key/value cell for the QuickBooks-style customer info card (label over value). */
function InfoField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-subtle">{label}</span>
      <span className="break-words text-sm text-white">{value || '—'}</span>
    </div>
  );
}

/** One entry in the "New transaction" menu. */
interface NewTransactionItem {
  label: string;
  icon: string;
  onSelect: () => void;
}

/**
 * A single "New transaction ▾" button that opens a small menu of create actions (New invoice,
 * New estimate, …) — replaces the row of separate New-X buttons. Closes on outside click or Esc.
 */
function NewTransactionMenu({ items }: { items: NewTransactionItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <Button
        size="sm"
        icon="add"
        variant="secondary"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        New transaction
        <span className="material-symbols-outlined text-base">expand_more</span>
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-lg border border-line bg-background-dark shadow-lg"
        >
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-white hover:bg-overlay/[0.06]"
            >
              <span className="material-symbols-outlined text-base text-muted">{it.icon}</span>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Notes block that clamps long notes to two lines behind a Show more / Show less toggle. */
function CustomerNotes({ notes }: { notes: string | null }) {
  const [expanded, setExpanded] = useState(false);
  // Heuristic for "needs a toggle": long text or several lines (avoids measuring layout).
  const isLong = !!notes && (notes.length > 140 || (notes.match(/\n/g)?.length ?? 0) >= 2);
  return (
    <div className="flex flex-col gap-1 border-t border-line pt-3">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-subtle">Notes</span>
      {notes ? (
        <>
          <p
            className={`whitespace-pre-wrap text-sm text-muted ${
              !expanded && isLong ? 'line-clamp-2' : ''
            }`}
          >
            {notes}
          </p>
          {isLong && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="self-start text-xs font-semibold text-primary hover:text-primary-hover"
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </>
      ) : (
        <span className="text-sm italic text-subtle">No notes</span>
      )}
    </div>
  );
}

/** A single row in the unified transaction table — invoice, estimate, or payment flattened. */
interface TxnRow {
  id: string;
  type: Exclude<TxnTypeFilter, 'all'>;
  date: string;
  number: string;
  /** Signed amount: payments are negative (they reduce the balance), like QuickBooks. */
  amount: number;
  /** Open balance — invoices only; null for estimates/payments. */
  balance: number | null;
  statusLabel: string;
  statusStyle: string;
  href: string;
}

type SortKey = 'date' | 'amount';

/**
 * One customer's complete AR picture, modeled after QuickBooks: a labeled info card, an
 * open-balance summary, and a single transaction list spanning the customer's invoices,
 * estimates, and payments. Chrome-style tabs (All / Invoices / Estimates / Payments, each with
 * a count) switch the list in place — no scrolling past one section to reach another — and the
 * Date / Amount columns sort. Everything is scoped by customer_id via the useXByCustomer hooks;
 * the open balance is derived client-side from the (non-void) invoices.
 */
export default function CustomerDetailView() {
  const { customerId } = useParams<{ customerId: string }>();
  const navigate = useNavigate();
  const { data: customer, isPending, isError } = useCustomer(customerId);
  const { data: invoices = [] } = useInvoicesByCustomer(customerId);
  const { data: estimates = [] } = useEstimatesByCustomer(customerId);
  const { data: payments = [] } = usePaymentsByCustomer(customerId);
  const updateCustomer = useUpdateCustomer();

  const [editing, setEditing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<TxnTypeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const summary = useMemo(() => {
    const live = invoices.filter((i) => i.status !== 'void');
    const openBalance = live.reduce((s, i) => s + i.balanceDue, 0);
    const invoiced = live.reduce((s, i) => s + i.total, 0);
    const paid = payments.reduce((s, p) => s + p.amount, 0);
    const openCount = live.filter((i) => i.balanceDue > 0.005).length;
    return { openBalance, invoiced, paid, openCount };
  }, [invoices, payments]);

  // Flatten the three sources into one row shape so a single sorted/filtered table can render them.
  const allRows = useMemo<TxnRow[]>(() => {
    const invoiceRows: TxnRow[] = invoices.map((inv) => ({
      id: inv.id,
      type: 'invoice',
      date: inv.invoiceDate,
      number: inv.invoiceNumber || 'Draft',
      amount: inv.total,
      balance: inv.balanceDue,
      statusLabel: INVOICE_STATUS_LABELS[inv.status],
      statusStyle: INVOICE_STATUS_STYLES[inv.status],
      href: `${ACCOUNTING_BASE}/invoices/${inv.id}`,
    }));
    const estimateRows: TxnRow[] = estimates.map((est) => ({
      id: est.id,
      type: 'estimate',
      date: est.estimateDate,
      number: est.estimateNumber || 'Draft',
      amount: est.total,
      balance: null,
      statusLabel: ESTIMATE_STATUS_LABELS[est.status],
      statusStyle: ESTIMATE_STATUS_STYLES[est.status],
      href: `${ESTIMATES_BASE}/${est.id}`,
    }));
    const paymentRows: TxnRow[] = payments.map((p) => {
      // Payments have no standalone screen; deep-link to the first invoice it was applied to.
      const appliedInvoiceId = p.applications?.[0]?.invoiceId;
      return {
        id: p.id,
        type: 'payment',
        date: p.paymentDate,
        number: PAYMENT_METHOD_LABELS[p.method] + (p.reference ? ` · ${p.reference}` : ''),
        amount: -p.amount,
        balance: null,
        statusLabel: 'Payment',
        statusStyle: PAYMENT_STATUS_STYLE,
        href: appliedInvoiceId ? `${ACCOUNTING_BASE}/invoices/${appliedInvoiceId}` : '',
      };
    });
    return [...invoiceRows, ...estimateRows, ...paymentRows];
  }, [invoices, estimates, payments]);

  // Rows for the active type tab (before the status filter) — also the source for status options.
  const typeRows = useMemo(
    () => (typeFilter === 'all' ? allRows : allRows.filter((r) => r.type === typeFilter)),
    [allRows, typeFilter]
  );

  // Distinct statuses present in the current tab, e.g. Converted / Sent / Declined for estimates.
  const statusOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of typeRows) if (!seen.has(r.statusLabel)) seen.set(r.statusLabel, r.statusLabel);
    return [...seen.keys()].sort((a, b) => a.localeCompare(b));
  }, [typeRows]);

  const rows = useMemo(() => {
    const filtered =
      statusFilter === 'all' ? typeRows : typeRows.filter((r) => r.statusLabel === statusFilter);
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortKey === 'amount') return (a.amount - b.amount) * dir;
      // date: ISO strings compare lexicographically; tie-break keeps it stable-ish by number.
      if (a.date === b.date) return a.number.localeCompare(b.number) * dir;
      return (a.date < b.date ? -1 : 1) * dir;
    });
  }, [typeRows, statusFilter, sortKey, sortDir]);

  // The "Total" shown above the table mirrors QuickBooks: the sum of the visible rows' amounts.
  const visibleTotal = useMemo(() => rows.reduce((s, r) => s + r.amount, 0), [rows]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const sortCaret = (key: SortKey) => (sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');

  return (
    <AccountingShell active="customers" title={customer?.displayName || 'Customer'}>
      {isPending && <p className="text-muted">Loading customer…</p>}
      {isError && <p className="text-red-400">Could not load this customer.</p>}
      {!isPending && !isError && !customer && <p className="text-muted">Customer not found.</p>}

      {customer && (
        <div className="mx-auto flex max-w-5xl flex-col gap-5">
          {/* QuickBooks-style customer info card: prominent name, labeled fields, notes */}
          <div className="flex flex-col gap-4 rounded-lg border border-line bg-background-dark/40 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h2 className="text-2xl font-bold text-white">
                  {customer.displayName || customer.companyName || 'Customer'}
                </h2>
                {customer.taxExempt && (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold uppercase text-amber-400">
                    Tax exempt
                  </span>
                )}
                {!customer.isActive && (
                  <span className="rounded-full bg-overlay/10 px-2 py-0.5 text-xs font-semibold uppercase text-muted">
                    Inactive
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" icon="edit" onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant={customer.isActive ? 'ghost' : 'secondary'}
                  icon={customer.isActive ? 'person_off' : 'person'}
                  disabled={updateCustomer.isPending}
                  onClick={async () => {
                    setActionError(null);
                    const res = await updateCustomer.mutateAsync({
                      id: customer.id,
                      input: { isActive: !customer.isActive },
                    });
                    if (res.error || !res.customer) {
                      setActionError(res.error ?? 'Could not update the customer.');
                    }
                  }}
                >
                  {updateCustomer.isPending
                    ? 'Saving…'
                    : customer.isActive
                      ? 'Make inactive'
                      : 'Make active'}
                </Button>
              </div>
            </div>
            {actionError && (
              <p className="text-sm text-red-400" role="alert">
                {actionError}
              </p>
            )}
            <div className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3">
              <InfoField label="Company" value={customer.companyName} />
              <InfoField label="Contact" value={customer.contactName} />
              <InfoField
                label="Billing address"
                value={formatCustomerAddress(customer.billingAddress)}
              />
              <InfoField label="Email" value={customer.email} />
              <InfoField label="Phone" value={customer.phone} />
              <InfoField label="Terms" value={customer.terms} />
              {customer.shippingAddress && (
                <InfoField
                  label="Shipping address"
                  value={formatCustomerAddress(customer.shippingAddress)}
                />
              )}
            </div>
            <CustomerNotes notes={customer.notes} />
          </div>

          {editing && <EditCustomerDrawer customer={customer} onClose={() => setEditing(false)} />}

          {/* AR summary */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="Open balance"
              value={formatMoney(summary.openBalance)}
              tone={summary.openBalance > 0.005 ? 'text-amber-400' : 'text-green-400'}
            />
            <StatCard label="Open invoices" value={String(summary.openCount)} />
            <StatCard label="Invoiced" value={formatMoney(summary.invoiced)} />
            <StatCard label="Paid" value={formatMoney(summary.paid)} tone="text-green-400" />
          </div>

          {/* Unified transaction list with Chrome-tab-style type switcher */}
          <section className="flex flex-col gap-2">
            <div className="flex flex-wrap items-end justify-between gap-2 border-b border-line">
              <div className="flex items-end gap-1" role="tablist" aria-label="Transaction type">
                {TYPE_OPTIONS.map((o) => {
                  const active = typeFilter === o.value;
                  const count =
                    o.value === 'all'
                      ? allRows.length
                      : allRows.filter((r) => r.type === o.value).length;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => {
                        setTypeFilter(o.value);
                        setStatusFilter('all');
                      }}
                      className={`-mb-px flex items-center gap-2 rounded-t-md border px-3 py-2 text-sm font-semibold transition-colors ${
                        active
                          ? 'border-line border-b-background-dark bg-background-dark/40 text-white'
                          : 'border-transparent text-muted hover:text-white'
                      }`}
                    >
                      {o.label}
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                          active ? 'bg-primary/20 text-primary' : 'bg-overlay/10 text-muted'
                        }`}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2 pb-1.5">
                <NewTransactionMenu
                  items={[
                    {
                      label: 'New invoice',
                      icon: 'receipt_long',
                      onSelect: () => navigate(`${ACCOUNTING_BASE}/invoices/new`),
                    },
                    {
                      label: 'New estimate',
                      icon: 'request_quote',
                      onSelect: () => navigate(`${ESTIMATES_BASE}/new`),
                    },
                  ]}
                />
              </div>
            </div>

            {/* Status filter + running total of whatever is currently shown (QuickBooks-style). */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-background-dark/40 px-4 py-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-semibold uppercase tracking-wide text-subtle">Status</span>
                <select
                  aria-label="Filter by status"
                  className="rounded-lg border border-line bg-background-dark px-2 py-1 text-sm text-white focus:border-primary focus:outline-none"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="all">All statuses</option>
                  {statusOptions.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              {/* A total only reads cleanly within one type; on "All" it would mix invoice,
                  estimate, and payment amounts into a meaningless figure, so hide it there. */}
              {typeFilter !== 'all' && (
                <div className="flex items-center gap-2">
                  <span className="font-semibold uppercase tracking-wide text-subtle">Total</span>
                  <span className="font-mono text-base font-bold tabular-nums text-white">
                    {formatMoney(visibleTotal)}
                  </span>
                </div>
              )}
            </div>

            {rows.length === 0 ? (
              <p className="px-3 py-4 text-sm text-subtle">No transactions for this customer.</p>
            ) : (
              <>
                <div className={LIST_HEADER}>
                  <button
                    type="button"
                    onClick={() => toggleSort('date')}
                    className="w-24 shrink-0 text-left uppercase hover:text-muted"
                  >
                    Date{sortCaret('date')}
                  </button>
                  <span className="w-20 shrink-0">Type</span>
                  <span className="flex-1">Number</span>
                  <button
                    type="button"
                    onClick={() => toggleSort('amount')}
                    className="hidden w-28 shrink-0 text-right uppercase hover:text-muted sm:block"
                  >
                    Amount{sortCaret('amount')}
                  </button>
                  <span className="w-28 shrink-0 text-right">Balance</span>
                  <span className="w-20 shrink-0" />
                </div>
                <div className={LIST_CONTAINER}>
                  {rows.map((row) => (
                    <button
                      key={`${row.type}-${row.id}`}
                      type="button"
                      onClick={() => row.href && navigate(row.href)}
                      disabled={!row.href}
                      className={`${LIST_ROW} ${row.href ? '' : 'cursor-default'}`}
                    >
                      <span className="w-24 shrink-0 text-sm text-muted">{row.date}</span>
                      <span className="w-20 shrink-0 text-xs uppercase tracking-wide text-subtle">
                        {TYPE_LABEL[row.type]}
                      </span>
                      <span className="flex-1 truncate font-mono text-xs text-muted">
                        {row.number}
                      </span>
                      <span
                        className={`hidden w-28 shrink-0 text-right font-mono text-sm tabular-nums sm:block ${
                          row.amount < 0 ? 'text-green-400' : 'text-white'
                        }`}
                      >
                        {formatMoney(row.amount)}
                      </span>
                      <span className="w-28 shrink-0 text-right font-mono text-sm tabular-nums text-white">
                        {row.balance == null ? '—' : formatMoney(row.balance)}
                      </span>
                      <span
                        className={`w-20 shrink-0 rounded-full px-1.5 py-0.5 text-center text-[10px] font-semibold uppercase ${row.statusStyle}`}
                      >
                        {row.statusLabel}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </AccountingShell>
  );
}

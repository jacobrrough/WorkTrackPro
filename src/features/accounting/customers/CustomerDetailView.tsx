import { useMemo } from 'react';
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
import { formatMoney } from '../accountingViewModel';
import { ACCOUNTING_BASE, ESTIMATES_BASE } from '../constants';
import {
  INVOICE_STATUS_LABELS,
  ESTIMATE_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  type EstimateStatus,
  type InvoiceStatus,
} from '../types';

const INVOICE_STATUS_STYLES: Record<InvoiceStatus, string> = {
  draft: 'bg-white/10 text-slate-300',
  sent: 'bg-sky-500/15 text-sky-400',
  partially_paid: 'bg-amber-500/15 text-amber-400',
  paid: 'bg-green-500/15 text-green-400',
  void: 'bg-red-500/15 text-red-400',
};

const ESTIMATE_STATUS_STYLES: Record<EstimateStatus, string> = {
  draft: 'bg-white/10 text-slate-300',
  sent: 'bg-sky-500/15 text-sky-400',
  accepted: 'bg-green-500/15 text-green-400',
  declined: 'bg-red-500/15 text-red-400',
  expired: 'bg-amber-500/15 text-amber-400',
  converted: 'bg-violet-500/15 text-violet-400',
};

function StatCard({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-sm border border-white/10 bg-background-dark/40 px-4 py-3">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <span className={`font-mono text-lg font-bold tabular-nums ${tone ?? 'text-white'}`}>
        {value}
      </span>
    </div>
  );
}

/**
 * One customer's complete AR picture: contact card, an open-balance summary, and the customer's
 * own invoices, estimates, and payments. Everything is scoped by customer_id via the
 * useXByCustomer hooks; the open balance is derived client-side from the (non-void) invoices.
 */
export default function CustomerDetailView() {
  const { customerId } = useParams<{ customerId: string }>();
  const navigate = useNavigate();
  const { data: customer, isPending, isError } = useCustomer(customerId);
  const { data: invoices = [] } = useInvoicesByCustomer(customerId);
  const { data: estimates = [] } = useEstimatesByCustomer(customerId);
  const { data: payments = [] } = usePaymentsByCustomer(customerId);

  const summary = useMemo(() => {
    const live = invoices.filter((i) => i.status !== 'void');
    const openBalance = live.reduce((s, i) => s + i.balanceDue, 0);
    const invoiced = live.reduce((s, i) => s + i.total, 0);
    const paid = payments.reduce((s, p) => s + p.amount, 0);
    const openCount = live.filter((i) => i.balanceDue > 0.005).length;
    return { openBalance, invoiced, paid, openCount };
  }, [invoices, payments]);

  return (
    <AccountingShell active="customers" title={customer?.displayName || 'Customer'}>
      {isPending && <p className="text-slate-400">Loading customer…</p>}
      {isError && <p className="text-red-400">Could not load this customer.</p>}
      {!isPending && !isError && !customer && <p className="text-slate-400">Customer not found.</p>}

      {customer && (
        <div className="mx-auto flex max-w-5xl flex-col gap-5">
          {/* Contact card */}
          <div className="flex flex-col gap-3 rounded-sm border border-white/10 bg-background-dark/40 p-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <h2 className="text-xl font-bold text-white">
                {customer.displayName || customer.companyName || 'Customer'}
              </h2>
              {customer.taxExempt && (
                <span className="rounded-sm bg-amber-500/15 px-2 py-0.5 text-xs font-semibold uppercase text-amber-400">
                  Tax exempt
                </span>
              )}
              {!customer.isActive && (
                <span className="rounded-sm bg-white/10 px-2 py-0.5 text-xs font-semibold uppercase text-slate-400">
                  Inactive
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm text-slate-400 sm:grid-cols-2">
              {customer.companyName && (
                <span>
                  Company <span className="text-slate-200">{customer.companyName}</span>
                </span>
              )}
              {customer.contactName && (
                <span>
                  Contact <span className="text-slate-200">{customer.contactName}</span>
                </span>
              )}
              {customer.email && (
                <span>
                  Email <span className="text-slate-200">{customer.email}</span>
                </span>
              )}
              {customer.phone && (
                <span>
                  Phone <span className="text-slate-200">{customer.phone}</span>
                </span>
              )}
              {customer.terms && (
                <span>
                  Terms <span className="text-slate-200">{customer.terms}</span>
                </span>
              )}
            </div>
            {customer.notes && <p className="text-sm text-slate-400">{customer.notes}</p>}
          </div>

          {/* AR summary */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              label="Open balance"
              value={formatMoney(summary.openBalance)}
              tone={summary.openBalance > 0.005 ? 'text-amber-400' : 'text-green-400'}
            />
            <StatCard label="Open invoices" value={String(summary.openCount)} />
            <StatCard label="Invoiced" value={formatMoney(summary.invoiced)} />
            <StatCard label="Paid" value={formatMoney(summary.paid)} tone="text-green-400" />
          </div>

          {/* Invoices */}
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-wide text-slate-400">Invoices</h3>
              <Button
                size="sm"
                icon="add"
                variant="secondary"
                onClick={() => navigate(`${ACCOUNTING_BASE}/invoices/new`)}
              >
                New invoice
              </Button>
            </div>
            {invoices.length === 0 ? (
              <p className="px-3 py-4 text-sm text-slate-500">No invoices for this customer.</p>
            ) : (
              <>
                <div className={LIST_HEADER}>
                  <span className="w-24 shrink-0">Number</span>
                  <span className="w-24 shrink-0">Date</span>
                  <span className="flex-1" />
                  <span className="hidden w-28 shrink-0 text-right sm:block">Total</span>
                  <span className="w-28 shrink-0 text-right">Balance</span>
                  <span className="w-20 shrink-0" />
                </div>
                <div className={LIST_CONTAINER}>
                  {invoices.map((inv) => (
                    <button
                      key={inv.id}
                      type="button"
                      onClick={() => navigate(`${ACCOUNTING_BASE}/invoices/${inv.id}`)}
                      className={LIST_ROW}
                    >
                      <span className="w-24 shrink-0 truncate font-mono text-xs text-slate-500">
                        {inv.invoiceNumber || 'Draft'}
                      </span>
                      <span className="w-24 shrink-0 text-sm text-slate-400">
                        {inv.invoiceDate}
                      </span>
                      <span className="flex-1" />
                      <span className="hidden w-28 shrink-0 text-right font-mono text-sm tabular-nums text-slate-400 sm:block">
                        {formatMoney(inv.total)}
                      </span>
                      <span className="w-28 shrink-0 text-right font-mono text-sm tabular-nums text-slate-200">
                        {formatMoney(inv.balanceDue)}
                      </span>
                      <span
                        className={`w-20 shrink-0 rounded-sm px-1.5 py-0.5 text-center text-[10px] font-semibold uppercase ${INVOICE_STATUS_STYLES[inv.status]}`}
                      >
                        {INVOICE_STATUS_LABELS[inv.status]}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>

          {/* Estimates */}
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-wide text-slate-400">
                Estimates
              </h3>
              <Button
                size="sm"
                icon="add"
                variant="secondary"
                onClick={() => navigate(`${ESTIMATES_BASE}/new`)}
              >
                New estimate
              </Button>
            </div>
            {estimates.length === 0 ? (
              <p className="px-3 py-4 text-sm text-slate-500">No estimates for this customer.</p>
            ) : (
              <div className={LIST_CONTAINER}>
                {estimates.map((est) => (
                  <button
                    key={est.id}
                    type="button"
                    onClick={() => navigate(`${ESTIMATES_BASE}/${est.id}`)}
                    className={LIST_ROW}
                  >
                    <span className="w-24 shrink-0 truncate font-mono text-xs text-slate-500">
                      {est.estimateNumber || 'Draft'}
                    </span>
                    <span className="w-24 shrink-0 text-sm text-slate-400">{est.estimateDate}</span>
                    <span className="flex-1" />
                    <span className="w-28 shrink-0 text-right font-mono text-sm tabular-nums text-slate-200">
                      {formatMoney(est.total)}
                    </span>
                    <span
                      className={`w-20 shrink-0 rounded-sm px-1.5 py-0.5 text-center text-[10px] font-semibold uppercase ${ESTIMATE_STATUS_STYLES[est.status]}`}
                    >
                      {ESTIMATE_STATUS_LABELS[est.status]}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* Payments (display only — no standalone payment screen). */}
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-bold uppercase tracking-wide text-slate-400">Payments</h3>
            {payments.length === 0 ? (
              <p className="px-3 py-4 text-sm text-slate-500">
                No payments recorded for this customer.
              </p>
            ) : (
              <div className={LIST_CONTAINER}>
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
            )}
          </section>
        </div>
      )}
    </AccountingShell>
  );
}

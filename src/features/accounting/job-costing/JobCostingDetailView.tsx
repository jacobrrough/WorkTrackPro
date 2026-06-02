import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { AccountingShell } from '../components/AccountingShell';
import { LedgerTable } from '../components/LedgerTable';
import {
  useJobBills,
  useJobCostingDetail,
  useJobInvoices,
} from '../hooks/useAccountingQueries';
import { marginPct } from '../jobCosting';
import { formatMoney } from '../accountingViewModel';
import { ACCOUNTING_BASE, JOB_COSTING_BASE } from '../constants';
import {
  BILL_STATUS_LABELS,
  INVOICE_STATUS_LABELS,
  type Bill,
  type BillStatus,
  type Invoice,
  type InvoiceStatus,
  type JobCostingRow,
} from '../types';

/**
 * B1 — per-job profitability detail. Header from useJobCostingDetail (the same
 * v_job_costing row as the dashboard), a link out to the operational job page, and
 * two read-only drill-down tables: the job's invoices (useJobInvoices) and bills
 * (useJobBills). No money moves on this surface.
 *
 * Caveat (same as the dashboard): labor cost is an estimate and revenue includes
 * non-void drafts. Bills are listed for context — the view's material cost comes
 * from consumed inventory, not from bills — so they are captioned accordingly.
 */

const INVOICE_STATUS_STYLES: Record<InvoiceStatus, string> = {
  draft: 'bg-white/10 text-slate-300',
  sent: 'bg-sky-500/15 text-sky-400',
  partially_paid: 'bg-amber-500/15 text-amber-400',
  paid: 'bg-green-500/15 text-green-400',
  void: 'bg-red-500/15 text-red-400',
};

const BILL_STATUS_STYLES: Record<BillStatus, string> = {
  draft: 'bg-white/10 text-slate-300',
  open: 'bg-sky-500/15 text-sky-400',
  partially_paid: 'bg-amber-500/15 text-amber-400',
  paid: 'bg-green-500/15 text-green-400',
  void: 'bg-red-500/15 text-red-400',
};

function StatusPill({ label, className }: { label: string; className: string }) {
  return (
    <span className={`rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase ${className}`}>
      {label}
    </span>
  );
}

/** One labeled figure in the summary strip. `tone` colors the value for margin. */
function StatCard({
  label,
  children,
  tone = 'default',
}: {
  label: string;
  children: ReactNode;
  tone?: 'default' | 'good' | 'bad';
}) {
  const valueColor =
    tone === 'good' ? 'text-green-400' : tone === 'bad' ? 'text-red-400' : 'text-white';
  return (
    <div className="rounded-sm border border-white/10 bg-card-dark p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 font-mono text-lg font-bold tabular-nums ${valueColor}`}>{children}</p>
    </div>
  );
}

function SummaryCards({ row }: { row: JobCostingRow }) {
  const pct = marginPct(row);
  const marginTone = row.margin < 0 ? 'bad' : row.margin > 0 ? 'good' : 'default';
  const hours = row.laborMinutes / 60;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      <StatCard label="Revenue">{formatMoney(row.revenue)}</StatCard>
      <StatCard label="Material cost">{formatMoney(row.materialCost)}</StatCard>
      <StatCard label="Labor cost (est.)">{formatMoney(row.laborCost)}</StatCard>
      <StatCard label="Margin" tone={marginTone}>
        {formatMoney(row.margin)}
      </StatCard>
      <StatCard label="Margin %" tone={marginTone}>
        {pct === null ? '—' : `${pct.toFixed(1)}%`}
      </StatCard>
      <StatCard label="Labor hours">{hours.toFixed(1)}</StatCard>
    </div>
  );
}

function InvoicesTable({ invoices, onOpen }: { invoices: Invoice[]; onOpen: (id: string) => void }) {
  return (
    <LedgerTable
      columns={[
        { label: 'Invoice' },
        { label: 'Date' },
        { label: 'Status' },
        { label: 'Total', align: 'right' },
        { label: 'Balance', align: 'right' },
      ]}
    >
      {invoices.map((inv) => (
        <tr
          key={inv.id}
          onClick={() => onOpen(inv.id)}
          className="cursor-pointer border-t border-white/5 hover:bg-white/5"
        >
          <td className="px-3 py-2 font-mono text-xs text-slate-400">
            {inv.invoiceNumber || 'Draft'}
          </td>
          <td className="px-3 py-2 text-slate-400">{inv.invoiceDate}</td>
          <td className="px-3 py-2">
            <StatusPill
              label={INVOICE_STATUS_LABELS[inv.status]}
              className={INVOICE_STATUS_STYLES[inv.status]}
            />
          </td>
          <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-300">
            {formatMoney(inv.total)}
          </td>
          <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-200">
            {formatMoney(inv.balanceDue)}
          </td>
        </tr>
      ))}
    </LedgerTable>
  );
}

function BillsTable({ bills, onOpen }: { bills: Bill[]; onOpen: (id: string) => void }) {
  return (
    <LedgerTable
      columns={[
        { label: 'Bill' },
        { label: 'Vendor' },
        { label: 'Date' },
        { label: 'Status' },
        { label: 'Total', align: 'right' },
        { label: 'Balance', align: 'right' },
      ]}
    >
      {bills.map((bill) => (
        <tr
          key={bill.id}
          onClick={() => onOpen(bill.id)}
          className="cursor-pointer border-t border-white/5 hover:bg-white/5"
        >
          <td className="px-3 py-2 font-mono text-xs text-slate-400">{bill.billNumber || 'Draft'}</td>
          <td className="px-3 py-2 text-white">{bill.vendorName || bill.vendorId}</td>
          <td className="px-3 py-2 text-slate-400">{bill.billDate}</td>
          <td className="px-3 py-2">
            <StatusPill
              label={BILL_STATUS_LABELS[bill.status]}
              className={BILL_STATUS_STYLES[bill.status]}
            />
          </td>
          <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-300">
            {formatMoney(bill.total)}
          </td>
          <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-200">
            {formatMoney(bill.balanceDue)}
          </td>
        </tr>
      ))}
    </LedgerTable>
  );
}

export default function JobCostingDetailView() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const { data: row, isPending, isError } = useJobCostingDetail(jobId);
  const { data: invoices = [], isPending: invoicesPending } = useJobInvoices(jobId);
  const { data: bills = [], isPending: billsPending } = useJobBills(jobId);

  return (
    <AccountingShell
      active="job-costing"
      title={row ? row.name : 'Job costing'}
      actions={
        jobId ? (
          <Button
            size="sm"
            variant="secondary"
            icon="open_in_new"
            iconPosition="right"
            onClick={() => navigate(`/app/jobs/${jobId}`)}
          >
            Open job
          </Button>
        ) : undefined
      }
    >
      {isPending && <p className="text-slate-400">Loading job costing…</p>}
      {isError && <p className="text-red-400">Could not load this job&apos;s costing.</p>}
      {!isPending && !isError && !row && (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-slate-400">
            No costing found for this job. It may have no logged labor, materials, or invoices yet.
          </p>
          <Button size="sm" variant="ghost" icon="arrow_back" onClick={() => navigate(JOB_COSTING_BASE)}>
            Back to job costing
          </Button>
        </div>
      )}

      {row && (
        <div className="mx-auto flex max-w-3xl flex-col gap-5">
          {/* Header: job identity + status */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {row.jobCode && (
              <span className="font-mono text-sm text-slate-500">{row.jobCode}</span>
            )}
            {row.status && (
              <span className="text-sm text-slate-400">
                Status <span className="text-white">{row.status}</span>
              </span>
            )}
          </div>

          <SummaryCards row={row} />

          <p className="text-xs leading-relaxed text-slate-500">
            Labor cost is an estimate (worked minutes ÷ 60 × the org labor rate). Revenue counts
            every non-void invoice, including unsent drafts.
          </p>

          {/* Invoices drill-down */}
          <section>
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-400">
              Invoices
            </h2>
            {invoicesPending && <p className="text-sm text-slate-500">Loading invoices…</p>}
            {!invoicesPending && invoices.length === 0 && (
              <p className="rounded-sm border border-dashed border-white/10 px-3 py-4 text-sm text-slate-500">
                No invoices billed to this job.
              </p>
            )}
            {invoices.length > 0 && (
              <InvoicesTable
                invoices={invoices}
                onOpen={(id) => navigate(`${ACCOUNTING_BASE}/invoices/${id}`)}
              />
            )}
          </section>

          {/* Bills drill-down */}
          <section>
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-400">Bills</h2>
            {billsPending && <p className="text-sm text-slate-500">Loading bills…</p>}
            {!billsPending && bills.length === 0 && (
              <p className="rounded-sm border border-dashed border-white/10 px-3 py-4 text-sm text-slate-500">
                No bills charged to this job.
              </p>
            )}
            {bills.length > 0 && (
              <BillsTable bills={bills} onOpen={(id) => navigate(`${ACCOUNTING_BASE}/bills/${id}`)} />
            )}
            {bills.length > 0 && (
              <p className="mt-1.5 text-xs text-slate-500">
                Bills are shown for context. The material cost above is derived from consumed
                inventory, not from these bills.
              </p>
            )}
          </section>
        </div>
      )}
    </AccountingShell>
  );
}

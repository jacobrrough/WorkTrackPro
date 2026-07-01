import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Job } from '@/core/types';
import { customersService } from '@/services/api/accounting/customers';
import { proposalsService } from '@/services/api/proposals';
import { useCustomers, useJobEstimates, useJobInvoices } from '../hooks/useAccountingQueries';
import { formatMoney } from '../accountingViewModel';
import { ACCOUNTING_BASE, ACCOUNTING_QUERY_KEYS, ESTIMATES_BASE } from '../constants';
import {
  ESTIMATE_STATUS_LABELS,
  INVOICE_STATUS_LABELS,
  type EstimateStatus,
  type InvoiceStatus,
} from '../types';
import LinkExistingDocsDrawer from './LinkExistingDocsDrawer';

/**
 * The job's BILLING panel — the unification surface on JobDetail. Shows the job's
 * customer, its linked estimates and invoices with live status, deep links into the
 * accounting module, and "create estimate/invoice for this job" actions that arrive
 * pre-filled (…/new?jobId=<id>).
 *
 * Lives in the accounting module and is mounted LAZILY from JobDetail behind
 * ACCOUNTING_BUILD_ENABLED && canViewJobFinancials(isAdmin) — a flag-off build
 * contains none of this code, and workers never see money.
 *
 * Legacy free-text references (EST#/INV#/RFQ#/OWR# typed on old jobs) render
 * read-only as "imported references" — real linked documents are the source of
 * truth going forward.
 */

const ESTIMATE_STATUS_STYLES: Record<EstimateStatus, string> = {
  draft: 'bg-overlay/10 text-muted',
  sent: 'bg-sky-500/15 text-sky-400',
  accepted: 'bg-emerald-500/15 text-emerald-400',
  declined: 'bg-red-500/15 text-red-400',
  expired: 'bg-amber-500/15 text-amber-400',
  converted: 'bg-purple-500/15 text-purple-300',
};

const INVOICE_STATUS_STYLES: Record<InvoiceStatus, string> = {
  draft: 'bg-overlay/10 text-muted',
  sent: 'bg-sky-500/15 text-sky-400',
  partially_paid: 'bg-amber-500/15 text-amber-400',
  paid: 'bg-emerald-500/15 text-emerald-400',
  void: 'bg-red-500/15 text-red-400',
};

function StatusPill({ label, className }: { label: string; className: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${className}`}>
      {label}
    </span>
  );
}

export default function JobBillingPanel({ job }: { job: Job }) {
  const queryClient = useQueryClient();
  const { data: customers = [] } = useCustomers(true);
  const { data: estimates = [], isPending: estimatesPending } = useJobEstimates(job.id);
  const { data: invoices = [], isPending: invoicesPending } = useJobInvoices(job.id);
  const [bridgeBusy, setBridgeBusy] = useState(false);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [showLink, setShowLink] = useState(false);

  const customer = job.customerId ? customers.find((c) => c.id === job.customerId) : undefined;

  // The inbound lead that created this job — offered as a one-click customer bridge
  // while the job has no customer.
  const { data: proposal } = useQuery({
    queryKey: ['job', job.id, 'proposal'] as const,
    queryFn: () => proposalsService.getByLinkedJob(job.id),
    enabled: !job.customerId,
    staleTime: 5 * 60 * 1000,
  });

  const handleBridge = async () => {
    if (!proposal) return;
    setBridgeBusy(true);
    setBridgeError(null);
    const res = await customersService.ensureFromProposal(proposal.id);
    if (res.customerId) {
      // The RPC linked the job server-side; refresh the job + customer caches.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['job', job.id] }),
        queryClient.invalidateQueries({ queryKey: ['jobs'] }),
        queryClient.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.customers }),
      ]);
    } else {
      setBridgeError(res.error ?? 'Could not create the customer.');
    }
    setBridgeBusy(false);
  };

  const legacyRefs = [
    job.estNumber ? `EST ${job.estNumber}` : null,
    job.invNumber ? `INV ${job.invNumber}` : null,
    job.rfqNumber ? `RFQ ${job.rfqNumber}` : null,
    job.owrNumber ? `OWR ${job.owrNumber}` : null,
  ].filter(Boolean) as string[];

  // Billing roll-up derived from the already-fetched invoices — mirrors the server-side
  // sync_job_paid_from_invoice trigger so an auto-'paid' job is legible here. "Paid" ⇔ at least
  // one non-void, positive-total invoice AND no non-void invoice still carrying a balance.
  const billableInvoices = invoices.filter((i) => i.status !== 'void' && i.total > 0);
  const openInvoices = invoices.filter((i) => i.status !== 'void' && i.balanceDue > 0);
  const totalDue = invoices.reduce(
    (sum, i) => (i.status !== 'void' ? sum + Math.max(0, i.balanceDue) : sum),
    0
  );
  const billingRollup: { label: string; tone: string } = invoicesPending
    ? { label: 'Loading…', tone: 'text-subtle' }
    : billableInvoices.length === 0
      ? { label: 'Not invoiced', tone: 'text-subtle' }
      : openInvoices.length === 0
        ? { label: 'Paid', tone: 'text-emerald-400' }
        : {
            label: `${formatMoney(totalDue)} due across ${openInvoices.length} invoice${
              openInvoices.length === 1 ? '' : 's'
            }`,
            tone: 'text-amber-300',
          };

  return (
    <section className="rounded-lg border border-line bg-surface-2/60 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted">
          <span className="material-symbols-outlined text-base text-primary">request_quote</span>
          Billing
        </h3>
        <div className="flex flex-wrap gap-2">
          <Link
            to={`${ESTIMATES_BASE}/new?jobId=${job.id}`}
            className="flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs font-semibold text-white hover:bg-overlay/10"
          >
            <span className="material-symbols-outlined text-sm">add</span>
            New estimate
          </Link>
          <Link
            to={`${ACCOUNTING_BASE}/invoices/new?jobId=${job.id}`}
            className="flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs font-semibold text-white hover:bg-overlay/10"
          >
            <span className="material-symbols-outlined text-sm">add</span>
            New invoice
          </Link>
          <button
            type="button"
            onClick={() => setShowLink(true)}
            className="flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs font-semibold text-white hover:bg-overlay/10"
          >
            <span className="material-symbols-outlined text-sm">add_link</span>
            Link existing
          </button>
        </div>
      </div>

      {/* Billing roll-up — mirrors the auto-paid trigger; explains a job that reads "Paid". */}
      <p className="mb-3 flex items-center gap-2 text-sm">
        <span className="text-muted">Billing:</span>
        <span className={`font-semibold ${billingRollup.tone}`}>{billingRollup.label}</span>
      </p>

      {/* Customer */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">Customer:</span>
        {customer ? (
          <span className="font-semibold text-white">{customer.displayName}</span>
        ) : job.customerId ? (
          <span className="font-semibold text-white">(linked customer)</span>
        ) : (
          <>
            <span className="italic text-subtle">none linked</span>
            {proposal && (
              <button
                type="button"
                onClick={handleBridge}
                disabled={bridgeBusy}
                className="flex items-center gap-1 rounded-full border border-primary/40 px-2 py-0.5 text-xs font-semibold text-primary hover:bg-primary/10 disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-sm">person_add</span>
                {bridgeBusy ? 'Creating…' : `Create customer from lead (${proposal.contactName})`}
              </button>
            )}
          </>
        )}
      </div>
      {bridgeError && (
        <p className="mb-2 text-xs text-red-400" role="alert">
          {bridgeError}
        </p>
      )}

      {/* Estimates */}
      <div className="mb-3">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-subtle">Estimates</p>
        {estimatesPending ? (
          <p className="text-xs text-subtle">Loading…</p>
        ) : estimates.length === 0 ? (
          <p className="text-xs italic text-subtle">No estimates yet.</p>
        ) : (
          <ul className="space-y-1">
            {estimates.map((e) => (
              <li key={e.id}>
                <Link
                  to={`${ESTIMATES_BASE}/${e.id}`}
                  className="flex flex-wrap items-center gap-2 rounded-lg px-1 py-0.5 text-sm text-white hover:bg-overlay/5"
                >
                  <span className="font-semibold text-white">{e.estimateNumber ?? 'Estimate'}</span>
                  <span className="text-xs text-muted">{e.estimateDate}</span>
                  <StatusPill
                    label={ESTIMATE_STATUS_LABELS[e.status]}
                    className={ESTIMATE_STATUS_STYLES[e.status]}
                  />
                  <span className="ml-auto font-mono text-xs tabular-nums text-muted">
                    {formatMoney(e.total)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Invoices */}
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-subtle">Invoices</p>
        {invoicesPending ? (
          <p className="text-xs text-subtle">Loading…</p>
        ) : invoices.length === 0 ? (
          <p className="text-xs italic text-subtle">No invoices yet.</p>
        ) : (
          <ul className="space-y-1">
            {invoices.map((inv) => (
              <li key={inv.id}>
                <Link
                  to={`${ACCOUNTING_BASE}/invoices/${inv.id}`}
                  className="flex flex-wrap items-center gap-2 rounded-lg px-1 py-0.5 text-sm text-white hover:bg-overlay/5"
                >
                  <span className="font-semibold text-white">{inv.invoiceNumber ?? 'Invoice'}</span>
                  <span className="text-xs text-muted">{inv.invoiceDate}</span>
                  <StatusPill
                    label={INVOICE_STATUS_LABELS[inv.status]}
                    className={INVOICE_STATUS_STYLES[inv.status]}
                  />
                  <span className="ml-auto font-mono text-xs tabular-nums text-muted">
                    {formatMoney(inv.total)}
                    {inv.balanceDue > 0 && inv.status !== 'void' && (
                      <span className="text-amber-300"> · {formatMoney(inv.balanceDue)} due</span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Legacy free-text references (read-only; real documents above are authoritative) */}
      {legacyRefs.length > 0 && (
        <p className="mt-3 border-t border-line pt-2 text-[11px] text-subtle">
          Imported references: {legacyRefs.join(' · ')}
        </p>
      )}

      {showLink && <LinkExistingDocsDrawer job={job} onClose={() => setShowLink(false)} />}
    </section>
  );
}

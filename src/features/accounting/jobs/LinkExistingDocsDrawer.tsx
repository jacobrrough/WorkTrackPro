import { useMemo, useState } from 'react';
import type { Job } from '@/core/types';
import { Button } from '@/components/ui/Button';
import { AccountingDrawer } from '../components/AccountingDrawer';
import { useEstimates, useInvoices } from '../hooks/useAccountingQueries';
import { useSetEstimateJob, useSetInvoiceJob } from '../hooks/useAccountingMutations';
import { formatMoney } from '../accountingViewModel';
import { ESTIMATE_STATUS_LABELS, INVOICE_STATUS_LABELS } from '../types';

/**
 * The job side of job linking: a drawer launched from JobBillingPanel that lists EXISTING
 * estimates and invoices and lets an admin attach (or move) one onto this job. Complements
 * JobLinkControl (the document side) — same setJob mutations, opposite entry point. The job's
 * customer's documents float to the top so the common case is one click.
 *
 * Documents already on THIS job are omitted (the panel above already lists them). A document
 * linked to a DIFFERENT job is still offered, tagged "On another job", and attaching it MOVES
 * it here (job_id is single-valued). Linking moves no money — it only sets job_id.
 */

const MAX_VISIBLE = 60;

interface DocRow {
  kind: 'invoice' | 'estimate';
  id: string;
  number: string | null;
  customerName: string | null;
  customerId: string;
  date: string;
  total: number;
  statusLabel: string;
  jobId: string | null;
}

export default function LinkExistingDocsDrawer({
  job,
  onClose,
}: {
  job: Job;
  onClose: () => void;
}) {
  const { data: invoices = [], isPending: invPending } = useInvoices();
  const { data: estimates = [], isPending: estPending } = useEstimates();
  const setInvoiceJob = useSetInvoiceJob();
  const setEstimateJob = useSetEstimateJob();
  const [query, setQuery] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loading = invPending || estPending;

  const rows = useMemo<DocRow[]>(() => {
    const all: DocRow[] = [
      ...invoices.map((i) => ({
        kind: 'invoice' as const,
        id: i.id,
        number: i.invoiceNumber,
        customerName: i.customerName ?? null,
        customerId: i.customerId,
        date: i.invoiceDate,
        total: i.total,
        statusLabel: INVOICE_STATUS_LABELS[i.status],
        jobId: i.jobId,
      })),
      ...estimates.map((e) => ({
        kind: 'estimate' as const,
        id: e.id,
        number: e.estimateNumber,
        customerName: e.customerName ?? null,
        customerId: e.customerId,
        date: e.estimateDate,
        total: e.total,
        statusLabel: ESTIMATE_STATUS_LABELS[e.status],
        jobId: e.jobId,
      })),
    ];
    // Already-on-this-job docs are listed in the panel above — drop them here.
    let pool = all.filter((d) => d.jobId !== job.id);
    const q = query.trim().toLowerCase();
    if (q) {
      pool = pool.filter(
        (d) =>
          (d.number ?? '').toLowerCase().includes(q) ||
          (d.customerName ?? '').toLowerCase().includes(q)
      );
    }
    // This job's customer first, then newest date.
    return pool.sort((a, b) => {
      const aMine = job.customerId && a.customerId === job.customerId ? 0 : 1;
      const bMine = job.customerId && b.customerId === job.customerId ? 0 : 1;
      if (aMine !== bMine) return aMine - bMine;
      return (b.date ?? '').localeCompare(a.date ?? '');
    });
  }, [invoices, estimates, query, job.id, job.customerId]);

  const visible = rows.slice(0, MAX_VISIBLE);
  const truncated = rows.length > MAX_VISIBLE;

  const attach = async (row: DocRow) => {
    setError(null);
    setSavingId(row.id);
    const res =
      row.kind === 'invoice'
        ? await setInvoiceJob.mutateAsync({ id: row.id, jobId: job.id })
        : await setEstimateJob.mutateAsync({ id: row.id, jobId: job.id });
    setSavingId(null);
    if (!res.ok) setError(res.error ?? 'Could not link the document.');
    // On success the lists invalidate and the row drops out (it is now on this job).
  };

  return (
    <AccountingDrawer
      open
      onClose={onClose}
      title={`Link existing to job #${job.jobCode}`}
      width="lg"
      footer={
        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            Done
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">
          Attach an existing estimate or invoice to job{' '}
          <span className="font-semibold text-white">#{job.jobCode}</span>.
          {job.customerId ? ' This job’s customer’s documents are listed first.' : ''}
        </p>

        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by number or customer…"
          aria-label="Search documents"
          className="w-full rounded-lg border border-line bg-background-dark px-2 py-1.5 text-sm text-white focus:border-primary focus:outline-none"
        />

        {error && (
          <p className="text-xs text-red-400" role="alert">
            {error}
          </p>
        )}

        {loading ? (
          <p className="text-sm text-subtle">Loading documents…</p>
        ) : visible.length === 0 ? (
          <p className="text-sm italic text-subtle">No matching documents to link.</p>
        ) : (
          <ul className="divide-y divide-white/5 overflow-hidden rounded-lg border border-line">
            {visible.map((d) => (
              <li key={`${d.kind}-${d.id}`} className="flex items-center gap-3 px-3 py-2">
                <span
                  className={`material-symbols-outlined text-base ${
                    d.kind === 'invoice' ? 'text-sky-400' : 'text-violet-400'
                  }`}
                  title={d.kind === 'invoice' ? 'Invoice' : 'Estimate'}
                >
                  {d.kind === 'invoice' ? 'receipt_long' : 'description'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold text-white">
                      {d.number ?? (d.kind === 'invoice' ? 'Invoice' : 'Estimate')}
                    </span>
                    <span className="shrink-0 text-[11px] uppercase tracking-wide text-subtle">
                      {d.statusLabel}
                    </span>
                    {d.jobId && (
                      <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
                        On another job
                      </span>
                    )}
                  </div>
                  <div className="truncate text-xs text-muted">
                    {d.customerName ?? '—'} · {d.date}
                  </div>
                </div>
                <span className="shrink-0 font-mono text-xs tabular-nums text-muted">
                  {formatMoney(d.total)}
                </span>
                <button
                  type="button"
                  onClick={() => void attach(d)}
                  disabled={savingId != null}
                  className="shrink-0 rounded-lg border border-primary/40 px-2 py-1 text-xs font-semibold text-primary hover:bg-primary/10 disabled:opacity-50"
                >
                  {savingId === d.id ? 'Linking…' : d.jobId ? 'Move here' : 'Attach'}
                </button>
              </li>
            ))}
          </ul>
        )}

        {truncated && (
          <p className="text-xs text-subtle">
            Showing the first {MAX_VISIBLE}. Search by number or customer to narrow the list.
          </p>
        )}
      </div>
    </AccountingDrawer>
  );
}

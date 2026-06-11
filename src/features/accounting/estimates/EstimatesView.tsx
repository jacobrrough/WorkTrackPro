import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { AccountingShell } from '../components/AccountingShell';
import { useEstimates } from '../hooks/useAccountingQueries';
import { formatMoney } from '../accountingViewModel';
import { ACCOUNTING_BASE } from '../constants';
import { ESTIMATE_STATUS_LABELS, type Estimate, type EstimateStatus } from '../types';

const STATUS_STYLES: Record<EstimateStatus, string> = {
  draft: 'bg-white/10 text-slate-300',
  sent: 'bg-sky-500/15 text-sky-400',
  accepted: 'bg-green-500/15 text-green-400',
  declined: 'bg-red-500/15 text-red-400',
  expired: 'bg-amber-500/15 text-amber-400',
  converted: 'bg-violet-500/15 text-violet-400',
};

function StatusPill({ status }: { status: EstimateStatus }) {
  return (
    <span
      className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase ${STATUS_STYLES[status]}`}
    >
      {ESTIMATE_STATUS_LABELS[status]}
    </span>
  );
}

/** Compact "open the linked job" affordance (stops row-click navigation). */
function JobCell({ jobId }: { jobId: string | null }) {
  if (!jobId) {
    return (
      <span className="hidden w-14 shrink-0 text-center text-xs text-slate-600 md:block">—</span>
    );
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

function EstimateRow({ estimate, onOpen }: { estimate: Estimate; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-white/5"
    >
      <span className="w-24 shrink-0 truncate font-mono text-xs text-slate-500">
        {estimate.estimateNumber || 'Draft'}
      </span>
      <span className="w-24 shrink-0 text-sm text-slate-400">{estimate.estimateDate}</span>
      <span className="flex-1 truncate text-white">
        {estimate.customerName || estimate.customerId}
      </span>
      <JobCell jobId={estimate.jobId} />
      <span className="hidden w-28 shrink-0 text-right text-sm text-slate-400 sm:block">
        {estimate.expiryDate || '—'}
      </span>
      <span className="w-28 shrink-0 text-right font-mono text-sm tabular-nums text-slate-200">
        {formatMoney(estimate.total)}
      </span>
      <StatusPill status={estimate.status} />
    </button>
  );
}

type JobFilter = 'all' | 'with-job' | 'without-job';

export default function EstimatesView() {
  const navigate = useNavigate();
  const { data: estimates = [], isPending, isError } = useEstimates();
  const [jobFilter, setJobFilter] = useState<JobFilter>('all');

  const filtered = useMemo(() => {
    if (jobFilter === 'with-job') return estimates.filter((e) => e.jobId);
    if (jobFilter === 'without-job') return estimates.filter((e) => !e.jobId);
    return estimates;
  }, [estimates, jobFilter]);

  return (
    <AccountingShell
      active="estimates"
      title="Estimates"
      actions={
        <Button size="sm" icon="add" onClick={() => navigate(`${ACCOUNTING_BASE}/estimates/new`)}>
          New estimate
        </Button>
      }
    >
      {isPending && <p className="text-slate-400">Loading estimates…</p>}
      {isError && (
        <p className="text-red-400">
          Could not load estimates. Confirm the accounting schema is exposed and you have an
          accounting role.
        </p>
      )}

      {!isPending && !isError && estimates.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-sm border border-dashed border-white/15 px-6 py-16 text-center">
          <span className="material-symbols-outlined text-4xl text-slate-500">description</span>
          <p className="text-lg font-bold text-white">No estimates yet</p>
          <p className="max-w-sm text-sm text-slate-400">
            Create a quote from a job or from scratch. Accepting it converts the estimate into a
            draft invoice you can send.
          </p>
          <Button size="sm" icon="add" onClick={() => navigate(`${ACCOUNTING_BASE}/estimates/new`)}>
            New estimate
          </Button>
        </div>
      )}

      {estimates.length > 0 && (
        <>
          <div className="mb-2 flex justify-end">
            <select
              aria-label="Filter by job link"
              className="rounded-sm border border-white/10 bg-background-dark px-2 py-1 text-xs text-slate-300"
              value={jobFilter}
              onChange={(e) => setJobFilter(e.target.value as JobFilter)}
            >
              <option value="all">All estimates</option>
              <option value="with-job">Linked to a job</option>
              <option value="without-job">No job link</option>
            </select>
          </div>
          <div className="hidden items-center gap-3 px-3 pb-1 text-xs font-semibold uppercase text-slate-500 sm:flex">
            <span className="w-24 shrink-0">Number</span>
            <span className="w-24 shrink-0">Date</span>
            <span className="flex-1">Customer</span>
            <span className="hidden w-14 shrink-0 text-center md:block">Job</span>
            <span className="w-28 shrink-0 text-right">Expires</span>
            <span className="w-28 shrink-0 text-right">Total</span>
            <span className="w-[58px] shrink-0" />
          </div>
          <div className="divide-y divide-white/5 overflow-hidden rounded-sm border border-white/10">
            {filtered.map((est) => (
              <EstimateRow
                key={est.id}
                estimate={est}
                onOpen={() => navigate(`${ACCOUNTING_BASE}/estimates/${est.id}`)}
              />
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-slate-500">
                No estimates match this filter.
              </p>
            )}
          </div>
        </>
      )}
    </AccountingShell>
  );
}

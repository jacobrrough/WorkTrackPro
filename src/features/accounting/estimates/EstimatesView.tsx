import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { AccountingShell } from '../components/AccountingShell';
import { useEstimates } from '../hooks/useAccountingQueries';
import { formatMoney } from '../accountingViewModel';
import { ACCOUNTING_BASE } from '../constants';
import { ESTIMATE_STATUS_LABELS, type Estimate, type EstimateStatus } from '../types';
import {
  DocumentFilterBar,
  applyDocFilters,
  initialDocFilters,
  type DocFilters,
  type DocStatusOption,
} from '../components/DocumentFilterBar';

const STATUS_STYLES: Record<EstimateStatus, string> = {
  draft: 'bg-overlay/10 text-muted',
  sent: 'bg-sky-500/15 text-sky-400',
  accepted: 'bg-green-500/15 text-green-400',
  declined: 'bg-red-500/15 text-red-400',
  expired: 'bg-amber-500/15 text-amber-400',
  converted: 'bg-violet-500/15 text-violet-400',
};

function StatusPill({ status }: { status: EstimateStatus }) {
  return (
    <span
      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase ${STATUS_STYLES[status]}`}
    >
      {ESTIMATE_STATUS_LABELS[status]}
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

function EstimateRow({ estimate, onOpen }: { estimate: Estimate; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-overlay/5"
    >
      <span className="w-24 shrink-0 truncate font-mono text-xs text-subtle">
        {estimate.estimateNumber || 'Draft'}
      </span>
      <span className="w-24 shrink-0 text-sm text-muted">{estimate.estimateDate}</span>
      <span className="flex-1 truncate text-white">
        {estimate.customerName || estimate.customerId}
      </span>
      <JobCell jobId={estimate.jobId} />
      <span className="hidden w-28 shrink-0 text-right text-sm text-muted sm:block">
        {estimate.expiryDate || '—'}
      </span>
      <span className="w-28 shrink-0 text-right font-mono text-sm tabular-nums text-white">
        {formatMoney(estimate.total)}
      </span>
      <StatusPill status={estimate.status} />
    </button>
  );
}

const STATUS_OPTIONS: DocStatusOption[] = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: ESTIMATE_STATUS_LABELS.draft },
  { value: 'sent', label: ESTIMATE_STATUS_LABELS.sent },
  { value: 'accepted', label: ESTIMATE_STATUS_LABELS.accepted },
  { value: 'declined', label: ESTIMATE_STATUS_LABELS.declined },
  { value: 'expired', label: ESTIMATE_STATUS_LABELS.expired },
  { value: 'converted', label: ESTIMATE_STATUS_LABELS.converted },
];

export default function EstimatesView() {
  const navigate = useNavigate();
  const { data: estimates = [], isPending, isError } = useEstimates();
  const [filters, setFilters] = useState<DocFilters>(() => initialDocFilters('all'));

  const filtered = useMemo(
    () =>
      applyDocFilters(estimates, filters, {
        number: (e) => e.estimateNumber,
        party: (e) => e.customerName ?? e.customerId,
        date: (e) => e.estimateDate,
        status: (e) => e.status,
      }),
    [estimates, filters]
  );

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
      {isPending && <p className="text-muted">Loading estimates…</p>}
      {isError && (
        <p className="text-red-400">
          Could not load estimates. Confirm the accounting schema is exposed and you have an
          accounting role.
        </p>
      )}

      {!isPending && !isError && estimates.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-line px-6 py-16 text-center">
          <span className="material-symbols-outlined text-4xl text-subtle">description</span>
          <p className="text-lg font-bold text-white">No estimates yet</p>
          <p className="max-w-sm text-sm text-muted">
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
          <DocumentFilterBar
            filters={filters}
            onChange={setFilters}
            statusOptions={STATUS_OPTIONS}
            searchPlaceholder="Search number or customer…"
            resultCount={filtered.length}
            totalCount={estimates.length}
          />
          <div className="hidden items-center gap-3 px-3 pb-1 text-xs font-semibold uppercase text-subtle sm:flex">
            <span className="w-24 shrink-0">Number</span>
            <span className="w-24 shrink-0">Date</span>
            <span className="flex-1">Customer</span>
            <span className="hidden w-14 shrink-0 text-center md:block">Job</span>
            <span className="w-28 shrink-0 text-right">Expires</span>
            <span className="w-28 shrink-0 text-right">Total</span>
            <span className="w-[58px] shrink-0" />
          </div>
          <div className="divide-y divide-overlay/5 overflow-hidden rounded-lg border border-line">
            {filtered.map((est) => (
              <EstimateRow
                key={est.id}
                estimate={est}
                onOpen={() => navigate(`${ACCOUNTING_BASE}/estimates/${est.id}`)}
              />
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-subtle">
                No estimates match this filter.
              </p>
            )}
          </div>
        </>
      )}
    </AccountingShell>
  );
}

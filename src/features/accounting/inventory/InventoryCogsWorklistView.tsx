import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { AccountingShell } from '../components/AccountingShell';
import { TaxDisclaimer } from '../components/TaxDisclaimer';
import { LedgerTable } from '../components/LedgerTable';
import { useConsumableJobs, useJobCogsEvents } from '../hooks/useAccountingQueries';
import { useConsumeJobCogs } from '../hooks/useAccountingMutations';
import { ACCOUNTING_BASE, INVENTORY_BASE } from '../constants';
import { formatMoney, formatQty, formatEventDate } from './inventoryFormat';
import type { ConsumableJob, ConsumeJobCogsResult } from '../types';

/**
 * B3 — COGS work list. The jobs that have CONSUMED stock (public.jobs.consumed_at IS NOT
 * NULL), each flagged costed/uncosted. Posting a job's COGS is the money path: it calls
 * accounting.consume_job_cogs, which FIFO-depletes the open cost layers oldest-first and
 * posts ONE balanced journal entry — Dr 5000 Cost of Goods Sold / Cr 1300 Inventory Asset —
 * recording an immutable consumption event per consumed item. This surface triggers
 * financial postings, so it carries the CPA/EA disclaimer (G9).
 *
 * Three outcomes after a post, surfaced inline (no phantom cost is ever booked):
 *   • costed  → a balanced COGS entry was posted (or already existed) → link to the JE.
 *   • uncosted → nothing was costable (e.g. opening stock received outside a bill, so no
 *     FIFO layer exists). The job is badged so it can be given an opening cost layer later.
 *   • error → the DB rejected it (RLS, missing default 5000/1300 mapping, an unbalanced
 *     entry) → the message is shown in red.
 */

/** Status badge for a job's costing state. */
function CostBadge({ job, result }: { job: ConsumableJob; result?: ConsumeJobCogsResult }) {
  // A fresh uncosted result wins over the (stale) list flag until the list refetches.
  if (result?.error) {
    return (
      <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-semibold text-red-300">
        Error
      </span>
    );
  }
  if (result?.uncosted) {
    return (
      <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-300">
        Uncosted
      </span>
    );
  }
  if (job.costed || result?.costed) {
    return (
      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-300">
        Costed
      </span>
    );
  }
  return (
    <span className="rounded-full bg-slate-500/15 px-2 py-0.5 text-xs font-semibold text-slate-400">
      Needs costing
    </span>
  );
}

/** The per-job COGS event drill-down (mounted only when a row is expanded). */
function JobCogsEvents({ jobId }: { jobId: string }) {
  const { data: events = [], isPending, isError } = useJobCogsEvents(jobId);

  if (isPending) return <p className="px-3 py-2 text-xs text-slate-500">Loading COGS events…</p>;
  if (isError)
    return <p className="px-3 py-2 text-xs text-red-400">Could not load this job&apos;s COGS events.</p>;
  if (events.length === 0)
    return (
      <p className="px-3 py-2 text-xs text-slate-500">
        No COGS events recorded for this job yet.
      </p>
    );

  return (
    <div className="p-2">
      <LedgerTable
        columns={[
          { label: 'Consumed' },
          { label: 'Qty', align: 'right' },
          { label: 'COGS', align: 'right' },
        ]}
      >
        {events.map((ev) => (
          <tr key={ev.id} className="border-t border-white/5">
            <td className="px-3 py-1.5 text-slate-400">{formatEventDate(ev.consumedAt)}</td>
            <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-300">
              {formatQty(ev.qty)}
            </td>
            <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-200">
              {formatMoney(ev.cost)}
            </td>
          </tr>
        ))}
      </LedgerTable>
    </div>
  );
}

function JobRow({
  job,
  result,
  posting,
  expanded,
  onPost,
  onToggleExpand,
}: {
  job: ConsumableJob;
  result?: ConsumeJobCogsResult;
  posting: boolean;
  expanded: boolean;
  onPost: () => void;
  onToggleExpand: () => void;
}) {
  const navigate = useNavigate();
  // The JE to link to: a freshly posted one, else the one the list already knows about.
  const journalEntryId = result?.journalEntryId ?? job.journalEntryId;
  const isCosted = job.costed || result?.costed;

  return (
    <div className="flex flex-col gap-2 rounded-sm border border-white/10 bg-card-dark p-3">
      <div className="flex items-start gap-3">
        <span className="material-symbols-outlined mt-0.5 text-xl text-primary">work</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate(`/app/jobs/${job.jobId}`)}
              className="truncate text-left text-base font-bold text-white hover:text-primary"
              title="Open the operational job"
            >
              {job.name || 'Untitled job'}
            </button>
            <CostBadge job={job} result={result} />
          </div>
          <p className="text-xs text-slate-500">
            {job.jobCode && <span className="font-mono">{job.jobCode} · </span>}
            Consumed {formatEventDate(job.consumedAt)}
            {job.status && <span> · {job.status}</span>}
          </p>
        </div>
      </div>

      {/* Result feedback for a job we just posted */}
      {result && (
        <div className="rounded-sm border border-white/5 bg-background-dark px-3 py-2 text-xs">
          {result.error ? (
            <span className="text-red-300">{result.error}</span>
          ) : result.uncosted ? (
            <span className="text-amber-300">
              Nothing was costable — this job&apos;s stock has no open FIFO cost layer (it was likely
              opening stock received outside a bill). No journal entry was posted. Seed an opening cost
              layer to cost it.
            </span>
          ) : (
            <span className="text-emerald-300">
              Posted a balanced COGS entry (Dr 5000 / Cr 1300).
            </span>
          )}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-white/5 pt-2">
        {isCosted && (
          <Button
            size="sm"
            variant="ghost"
            icon={expanded ? 'expand_less' : 'expand_more'}
            onClick={onToggleExpand}
          >
            {expanded ? 'Hide events' : 'View events'}
          </Button>
        )}
        {isCosted && journalEntryId && (
          <Button
            size="sm"
            variant="ghost"
            icon="open_in_new"
            iconPosition="right"
            onClick={() => navigate(`${ACCOUNTING_BASE}/journal/${journalEntryId}`)}
          >
            View JE
          </Button>
        )}
        {!isCosted && (
          <Button size="sm" icon="post_add" onClick={onPost} disabled={posting}>
            {posting ? 'Posting…' : 'Post COGS'}
          </Button>
        )}
      </div>

      {isCosted && expanded && <JobCogsEvents jobId={job.jobId} />}
    </div>
  );
}

export default function InventoryCogsWorklistView() {
  const navigate = useNavigate();
  const { data: jobs = [], isPending, isError } = useConsumableJobs();
  const consume = useConsumeJobCogs();
  // Per-job last-post result and which job's events are expanded.
  const [results, setResults] = useState<Record<string, ConsumeJobCogsResult>>({});
  const [postingId, setPostingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Split into the actionable list (needs costing) and the already-costed list. A fresh
  // "costed" result promotes a job across the divide before the list query refetches.
  const { pending, costed } = useMemo(() => {
    const isCosted = (j: ConsumableJob) => j.costed || results[j.jobId]?.costed === true;
    return {
      pending: jobs.filter((j) => !isCosted(j)),
      costed: jobs.filter((j) => isCosted(j)),
    };
  }, [jobs, results]);

  const postJob = async (job: ConsumableJob) => {
    setPostingId(job.jobId);
    try {
      const result = await consume.mutateAsync(job.jobId);
      setResults((prev) => ({ ...prev, [job.jobId]: result }));
    } finally {
      setPostingId(null);
    }
  };

  const toggleExpand = (jobId: string) =>
    setExpandedId((prev) => (prev === jobId ? null : jobId));

  return (
    <AccountingShell
      active="inventory"
      title="COGS work list"
      actions={
        <Button
          size="sm"
          variant="secondary"
          icon="inventory_2"
          onClick={() => navigate(INVENTORY_BASE)}
        >
          Valuation
        </Button>
      }
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <TaxDisclaimer />

        <p className="text-sm text-slate-400">
          Jobs that have consumed stock. Posting a job&apos;s COGS relieves the FIFO-consumed cost
          from inventory to Cost of Goods Sold with one balanced journal entry — Dr 5000 / Cr 1300 —
          and records a consumption event. Posting is idempotent: a job already costed is left
          unchanged.
        </p>

        {isPending && <p className="text-slate-400">Loading the COGS work list…</p>}
        {isError && (
          <p className="text-red-400">
            Could not load the work list. Confirm the accounting schema is exposed and you have an
            accounting role.
          </p>
        )}

        {!isPending && !isError && jobs.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 rounded-sm border border-dashed border-white/15 px-6 py-16 text-center">
            <span className="material-symbols-outlined text-4xl text-slate-500">checklist</span>
            <p className="text-lg font-bold text-white">No consumed jobs to cost</p>
            <p className="max-w-md text-sm text-slate-400">
              When a job consumes inventory in the app, it appears here so its cost can be relieved to
              COGS. Nothing has consumed stock yet.
            </p>
          </div>
        )}

        {/* Needs costing */}
        {!isPending && !isError && pending.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-bold uppercase tracking-wide text-amber-300">
              Needs costing · {pending.length}
            </h2>
            {pending.map((job) => (
              <JobRow
                key={job.jobId}
                job={job}
                result={results[job.jobId]}
                posting={postingId === job.jobId && consume.isPending}
                expanded={expandedId === job.jobId}
                onPost={() => postJob(job)}
                onToggleExpand={() => toggleExpand(job.jobId)}
              />
            ))}
          </section>
        )}

        {/* Already costed */}
        {!isPending && !isError && costed.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-400">
              Costed · {costed.length}
            </h2>
            {costed.map((job) => (
              <JobRow
                key={job.jobId}
                job={job}
                result={results[job.jobId]}
                posting={postingId === job.jobId && consume.isPending}
                expanded={expandedId === job.jobId}
                onPost={() => postJob(job)}
                onToggleExpand={() => toggleExpand(job.jobId)}
              />
            ))}
          </section>
        )}

        {!isPending && !isError && jobs.length > 0 && pending.length === 0 && (
          <p className="rounded-sm border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-300">
            All consumed jobs have their COGS posted.
          </p>
        )}
      </div>
    </AccountingShell>
  );
}

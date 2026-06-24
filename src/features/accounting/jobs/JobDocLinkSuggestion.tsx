import { useEffect, useState } from 'react';
import { useEstimateByNumber, useInvoiceByNumber } from '../hooks/useAccountingQueries';
import { useSetEstimateJob, useSetInvoiceJob } from '../hooks/useAccountingMutations';

/**
 * When an EST#/INV# is typed on the job card, resolve it to the REAL estimate / invoice and offer
 * to LINK that document to this job (sets the doc's job_id, so it appears in the job's billing
 * panel + job costing). Reuses the same resolve (findByNumber) and link (setJob) paths the
 * accounting module already uses elsewhere.
 *
 * Mounted only when accounting is built in (lazily, behind ACCOUNTING_BUILD_ENABLED in JobDetail),
 * so a flag-off build carries none of this. A number that doesn't resolve renders nothing — no
 * suggestion, no noise.
 */

/** Debounce a fast-changing value (each keystroke) so we don't query on every character. */
function useDebounced<T>(value: T, ms = 400): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

type Match = { id: string; status: string; jobId: string | null; customerName: string | null };

function SuggestionRow({
  kind,
  label,
  match,
  jobId,
  pending,
  onLink,
}: {
  kind: 'estimate' | 'invoice';
  label: string;
  match: Match;
  jobId: string;
  pending: boolean;
  onLink: () => void;
}) {
  const linkedHere = match.jobId === jobId;
  const linkedElsewhere = !!match.jobId && match.jobId !== jobId;
  return (
    <div className="flex items-center gap-2 rounded border border-primary/30 bg-primary/10 px-2 py-1.5 text-xs">
      <span className="material-symbols-outlined text-sm text-primary">link</span>
      <span className="min-w-0 truncate text-white">
        Matched {kind} <span className="font-semibold">{label}</span>
        {match.customerName ? ` · ${match.customerName}` : ''}
      </span>
      {linkedHere ? (
        <span className="ml-auto shrink-0 font-semibold text-green-400">Linked to this job ✓</span>
      ) : (
        <button
          type="button"
          onClick={onLink}
          disabled={pending}
          className="ml-auto shrink-0 rounded bg-primary/20 px-2 py-1 font-semibold text-primary hover:bg-primary/30 disabled:opacity-50"
        >
          {pending ? 'Linking…' : linkedElsewhere ? 'Re-link to this job' : 'Link to this job'}
        </button>
      )}
    </div>
  );
}

export default function JobDocLinkSuggestion({
  jobId,
  estNumber,
  invNumber,
}: {
  jobId: string;
  estNumber?: string | null;
  invNumber?: string | null;
}) {
  const est = useEstimateByNumber(useDebounced(estNumber?.trim() || ''));
  const inv = useInvoiceByNumber(useDebounced(invNumber?.trim() || ''));
  const setEstJob = useSetEstimateJob();
  const setInvJob = useSetInvoiceJob();

  if (!est.data && !inv.data) return null;

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {est.data && (
        <SuggestionRow
          kind="estimate"
          label={`EST #${estNumber?.trim()}`}
          match={est.data}
          jobId={jobId}
          pending={setEstJob.isPending}
          onLink={() => setEstJob.mutate({ id: est.data!.id, jobId })}
        />
      )}
      {inv.data && (
        <SuggestionRow
          kind="invoice"
          label={`INV# ${invNumber?.trim()}`}
          match={inv.data}
          jobId={jobId}
          pending={setInvJob.isPending}
          onLink={() => setInvJob.mutate({ id: inv.data!.id, jobId })}
        />
      )}
    </div>
  );
}

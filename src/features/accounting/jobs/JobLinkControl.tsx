import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { jobService, type JobPickerOption } from '@/services/api/jobs';
import { useSetEstimateJob, useSetInvoiceJob } from '../hooks/useAccountingMutations';

/**
 * The document side of job linking: a compact "Job" row on an invoice/estimate detail screen
 * that shows the currently-linked job (a deep link to /app/jobs/:id) and lets an admin attach,
 * change or unlink the job via a searchable picker — at ANY status. The link is a pure
 * organizational tag (no JE, no money) so this is offered on sent/paid documents too, which is
 * the whole point: filing the CURRENT estimates/invoices against the right job after the fact.
 *
 * Both useSetInvoiceJob / useSetEstimateJob share the same { id, jobId } signature, so this one
 * control serves both document kinds. It loads a LIGHTWEIGHT job list (jobService.listForPicker)
 * keyed ['jobs','picker'] — never the heavy full-expand jobs query.
 */

const MAX_RESULTS = 25;

function jobLabel(job: JobPickerOption): string {
  return job.name ? `#${job.jobCode} · ${job.name}` : `#${job.jobCode}`;
}

export default function JobLinkControl({
  documentType,
  documentId,
  currentJobId,
  customerId,
  canEdit = true,
}: {
  documentType: 'invoice' | 'estimate';
  documentId: string;
  currentJobId: string | null;
  /** The document's customer — its jobs float to the top of the picker before any search. */
  customerId?: string | null;
  /** Hide the attach/change/unlink affordances (e.g. a voided invoice). */
  canEdit?: boolean;
}) {
  const { data: jobs = [], isPending: jobsPending } = useQuery({
    queryKey: ['jobs', 'picker'] as const,
    queryFn: () => jobService.listForPicker(),
    staleTime: 60_000,
  });
  const setInvoiceJob = useSetInvoiceJob();
  const setEstimateJob = useSetEstimateJob();
  const mutation = documentType === 'invoice' ? setInvoiceJob : setEstimateJob;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = `job-link-${documentType}-${documentId}`;

  const currentJob = currentJobId ? jobs.find((j) => j.id === currentJobId) : undefined;

  const results = useMemo<JobPickerOption[]>(() => {
    const q = query.trim().toLowerCase();
    if (q) {
      return jobs
        .filter((j) => String(j.jobCode).includes(q) || j.name.toLowerCase().includes(q))
        .slice(0, MAX_RESULTS);
    }
    // No search term yet: surface this document's customer's jobs first, then the rest.
    if (customerId) {
      const mine = jobs.filter((j) => j.customerId === customerId);
      const rest = jobs.filter((j) => j.customerId !== customerId);
      return [...mine, ...rest].slice(0, MAX_RESULTS);
    }
    return jobs.slice(0, MAX_RESULTS);
  }, [jobs, query, customerId]);

  const apply = async (jobId: string | null) => {
    setError(null);
    const res = await mutation.mutateAsync({ id: documentId, jobId });
    if (!res.ok) {
      setError(res.error ?? 'Could not update the job link.');
      return;
    }
    setOpen(false);
    setQuery('');
    setActiveIndex(-1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((p) => (p < results.length - 1 ? p + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((p) => (p > 0 ? p - 1 : results.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < results.length) void apply(results[activeIndex].id);
    }
  };

  const openPicker = () => {
    setError(null);
    setOpen((v) => !v);
    // Focus the search after it mounts.
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  return (
    <section className="rounded-sm border border-white/10 bg-background-dark/40 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="material-symbols-outlined text-base text-primary">work</span>
        <span className="text-sm text-slate-400">Job</span>
        {currentJob ? (
          <Link
            to={`/app/jobs/${currentJob.id}`}
            className="text-sm font-semibold text-primary hover:text-primary-hover"
          >
            {jobLabel(currentJob)}
          </Link>
        ) : currentJobId ? (
          // Linked, but the lightweight list hasn't resolved a label yet (still loading).
          <Link
            to={`/app/jobs/${currentJobId}`}
            className="text-sm font-semibold text-primary hover:text-primary-hover"
          >
            {jobsPending ? 'Linked job…' : 'View linked job'}
          </Link>
        ) : (
          <span className="text-sm italic text-slate-500">Not linked to a job</span>
        )}

        {canEdit && (
          <div className="ml-auto flex items-center gap-2">
            {currentJobId && (
              <button
                type="button"
                onClick={() => void apply(null)}
                disabled={mutation.isPending}
                className="rounded-sm border border-white/15 px-2 py-1 text-xs font-semibold text-slate-300 hover:bg-white/10 disabled:opacity-50"
              >
                Unlink
              </button>
            )}
            <button
              type="button"
              onClick={openPicker}
              disabled={mutation.isPending}
              className="flex items-center gap-1 rounded-sm border border-white/15 px-2 py-1 text-xs font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-sm">
                {currentJobId ? 'swap_horiz' : 'add_link'}
              </span>
              {mutation.isPending ? 'Saving…' : currentJobId ? 'Change' : 'Link to job'}
            </button>
          </div>
        )}
      </div>

      {open && canEdit && (
        <div className="relative mt-2">
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls={listboxId}
            aria-autocomplete="list"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(-1);
            }}
            onKeyDown={onKeyDown}
            placeholder={jobsPending ? 'Loading jobs…' : 'Search jobs by number or name…'}
            className="w-full rounded-sm border border-white/10 bg-background-dark px-2 py-1.5 text-sm text-white focus:border-primary focus:outline-none"
          />
          {results.length > 0 && (
            <ul
              id={listboxId}
              role="listbox"
              className="mt-1 max-h-60 overflow-y-auto rounded-sm border border-white/10 bg-[#1a1122]"
            >
              {results.map((j, i) => (
                <li key={j.id} role="option" aria-selected={i === activeIndex}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => void apply(j.id)}
                    onMouseEnter={() => setActiveIndex(i)}
                    className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm ${
                      i === activeIndex ? 'bg-primary/20' : 'hover:bg-white/5'
                    } ${j.id === currentJobId ? 'text-primary' : 'text-white'}`}
                  >
                    <span className="truncate">{jobLabel(j)}</span>
                    {j.id === currentJobId && (
                      <span className="shrink-0 text-xs text-slate-400">current</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!jobsPending && query.trim() !== '' && results.length === 0 && (
            <p className="mt-1 text-xs text-slate-500">No jobs match “{query.trim()}”.</p>
          )}
        </div>
      )}

      {error && (
        <p className="mt-2 text-xs text-red-400" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

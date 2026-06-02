import type { UseQueryResult } from '@tanstack/react-query';
import { LedgerTable } from '../components/LedgerTable';
import { AGING_BUCKETS, AGING_BUCKET_LABELS, type AgingReport } from '../types';
import { ReportPage } from './ReportPage';
import { asOfToday } from './reportFormat';
import { agingDocument } from './reportDocuments';
import { MoneyCell, ReportEmpty, ReportError, ReportLoading } from './ReportStates';

interface AgingViewProps {
  kind: 'ar' | 'ap';
  query: UseQueryResult<AgingReport>;
}

/**
 * Shared body for the A/R and A/P aging reports — open documents bucketed by how
 * overdue they are, plus a per-bucket summary. Aging is point-in-time (as of today,
 * from the DB views) so there is no date filter. `kind` swaps the labels/columns.
 */
export function AgingView({ kind, query }: AgingViewProps) {
  const { data, isPending, isError } = query;
  const isAr = kind === 'ar';
  const title = isAr ? 'A/R Aging' : 'A/P Aging';
  const partyHeader = isAr ? 'Customer' : 'Vendor';
  const docHeader = isAr ? 'Invoice' : 'Bill';
  const emptyNote = isAr
    ? 'No open customer invoices. Sent invoices with a balance due appear here, bucketed by age.'
    : 'No open vendor bills. Posted bills with a balance due appear here, bucketed by age.';

  const hasRows = !!data && data.rows.length > 0;

  return (
    <ReportPage
      title={title}
      subtitle={asOfToday()}
      buildDocument={() => (data ? agingDocument(data, kind) : null)}
      exportDisabled={!hasRows}
    >
      {isPending && <ReportLoading />}
      {isError && <ReportError />}
      {!isPending && !isError && data && !hasRows && (
        <ReportEmpty icon={isAr ? 'request_quote' : 'payments'} note={emptyNote} />
      )}

      {!isPending && !isError && data && hasRows && (
        <>
          {/* Bucket summary cards */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {AGING_BUCKETS.map((b) => (
              <div
                key={b}
                className="rounded-sm border border-white/10 bg-card-dark p-2 text-center"
              >
                <p className="text-[10px] font-semibold uppercase text-slate-500">
                  {AGING_BUCKET_LABELS[b]}
                </p>
                <p className="font-mono text-sm font-bold tabular-nums text-slate-200">
                  {data.summary.byBucket[b].toLocaleString('en-US', {
                    style: 'currency',
                    currency: 'USD',
                  })}
                </p>
              </div>
            ))}
            <div className="rounded-sm border border-primary/30 bg-primary/10 p-2 text-center">
              <p className="text-[10px] font-semibold uppercase text-primary">Total</p>
              <p className="font-mono text-sm font-bold tabular-nums text-white">
                {data.summary.total.toLocaleString('en-US', {
                  style: 'currency',
                  currency: 'USD',
                })}
              </p>
            </div>
          </div>

          {/* Open-item detail */}
          <LedgerTable
            columns={[
              { label: docHeader },
              { label: partyHeader },
              { label: 'Due' },
              { label: 'Days', align: 'right' },
              { label: 'Bucket' },
              { label: 'Balance', align: 'right' },
            ]}
          >
            {data.rows.map((r) => (
              <tr key={r.documentId} className="border-t border-white/5">
                <td className="px-3 py-2 font-mono text-xs text-slate-400">
                  {r.documentNumber || '—'}
                </td>
                <td className="px-3 py-2 text-white">{r.partyName || r.partyId}</td>
                <td className="px-3 py-2 text-slate-400">{r.dueDate ?? r.documentDate}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-300">
                  {r.daysOverdue > 0 ? r.daysOverdue : '—'}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded-sm px-1.5 py-0.5 text-[10px] font-semibold ${
                      r.bucket === 'current'
                        ? 'bg-white/10 text-slate-300'
                        : r.bucket === '90+'
                          ? 'bg-red-500/15 text-red-400'
                          : 'bg-amber-500/15 text-amber-400'
                    }`}
                  >
                    {AGING_BUCKET_LABELS[r.bucket]}
                  </span>
                </td>
                <MoneyCell amount={r.balanceDue} />
              </tr>
            ))}
            <tr className="border-t border-white/10 bg-white/5">
              <td className="px-3 py-2 font-bold text-white" colSpan={5}>
                Total outstanding
              </td>
              <MoneyCell amount={data.summary.total} strong />
            </tr>
          </LedgerTable>
        </>
      )}
    </ReportPage>
  );
}

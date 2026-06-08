import { Link, useParams, useSearchParams } from 'react-router-dom';
import { LedgerTable } from '../components/LedgerTable';
import { ACCOUNTING_BASE } from '../constants';
import { useAccountLedger } from '../hooks/useAccountingQueries';
import type { DateRange } from '../types';
import { DateRangeFilter } from './DateRangeFilter';
import { ReportPage } from './ReportPage';
import { describeRange } from './reportFormat';
import { accountLedgerDocument } from './reportDocuments';
import { MoneyCell, ReportEmpty, ReportError, ReportLoading } from './ReportStates';

/**
 * #3 — General-ledger account register. Every POSTED journal line for one account in the
 * selected entry-date window, with an opening-balance row, a running natural-signed
 * balance per line, and a closing-balance total. Each row's entry number links into the
 * journal entry. The date range lives in the URL query string (`?from=&to=`) so the
 * register is bookmarkable and the report drill-down links can pre-set the window.
 */
export default function AccountLedgerView() {
  const { accountId } = useParams<{ accountId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  // The URL query string is the source of truth for the window (absent bounds = all-time).
  const range: DateRange = {
    from: searchParams.get('from') || null,
    to: searchParams.get('to') || null,
  };

  const setRange = (next: DateRange) => {
    const params = new URLSearchParams(searchParams);
    if (next.from) params.set('from', next.from);
    else params.delete('from');
    if (next.to) params.set('to', next.to);
    else params.delete('to');
    setSearchParams(params, { replace: true });
  };

  const { data, isPending, isError } = useAccountLedger(accountId, range);

  const hasRows = !!data && data.lines.length > 0;
  const title = data
    ? `${data.accountNumber ? `${data.accountNumber} · ` : ''}${data.accountName}`
    : 'General Ledger';

  return (
    <ReportPage
      title={title}
      subtitle={describeRange(range)}
      filter={<DateRangeFilter value={range} onChange={setRange} />}
      buildDocument={() => (data ? accountLedgerDocument(data) : null)}
      exportDisabled={!data}
    >
      {isPending && <ReportLoading />}
      {isError && <ReportError />}
      {!isPending && !isError && data && !hasRows && (
        <ReportEmpty
          icon="menu_book"
          note="No posted transactions for this account in the selected period. Widen the date range or post some activity."
        />
      )}

      {!isPending && !isError && data && (
        <LedgerTable
          columns={[
            { label: 'Date' },
            { label: 'Entry #' },
            { label: 'Memo' },
            { label: 'Debit', align: 'right' },
            { label: 'Credit', align: 'right' },
            { label: 'Balance', align: 'right' },
          ]}
        >
          {/* Opening balance carried in from before the window start. */}
          <tr className="border-t border-white/5 bg-white/[0.03]">
            <td className="px-3 py-2 text-slate-400" colSpan={5}>
              Opening balance
            </td>
            <MoneyCell amount={data.openingBalance} />
          </tr>

          {data.lines.map((l, i) => (
            <tr key={`${l.entryId}-${i}`} className="border-t border-white/5">
              <td className="px-3 py-2 text-slate-300">{l.date}</td>
              <td className="px-3 py-2">
                <Link
                  to={`${ACCOUNTING_BASE}/journal/${l.entryId}`}
                  className="font-mono text-xs text-primary underline-offset-2 hover:underline"
                >
                  #{l.entryNumber}
                </Link>
              </td>
              <td className="px-3 py-2 text-slate-300">{l.memo ?? ''}</td>
              <MoneyCell amount={l.debit} />
              <MoneyCell amount={l.credit} />
              <MoneyCell amount={l.balance} />
            </tr>
          ))}

          {/* Period totals: gross debits and credits posted in the window. */}
          <tr className="border-t border-white/10 bg-white/5">
            <td className="px-3 py-2 font-bold text-white" colSpan={3}>
              Period totals
            </td>
            <MoneyCell amount={data.totalDebit} strong />
            <MoneyCell amount={data.totalCredit} strong />
            <td className="px-3 py-2" />
          </tr>
          <tr className="border-t border-white/10 bg-white/5">
            <td className="px-3 py-2 font-bold text-white" colSpan={5}>
              Closing balance
            </td>
            <MoneyCell amount={data.closingBalance} strong />
          </tr>
        </LedgerTable>
      )}
    </ReportPage>
  );
}

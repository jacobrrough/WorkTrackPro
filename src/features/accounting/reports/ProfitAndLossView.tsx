import { useState } from 'react';
import { LedgerTable } from '../components/LedgerTable';
import { useProfitAndLoss } from '../hooks/useAccountingQueries';
import type { DateRange, ReportLine } from '../types';
import { AccountLink } from './AccountLink';
import { DateRangeFilter } from './DateRangeFilter';
import { ReportPage } from './ReportPage';
import { describeRange, formatAccounting } from './reportFormat';
import { profitAndLossDocument } from './reportDocuments';
import {
  MoneyCell,
  ReportEmpty,
  ReportError,
  ReportLoading,
  SectionHeaderRow,
  SubtotalRow,
} from './ReportStates';

function AccountRow({ line, range }: { line: ReportLine; range: DateRange }) {
  return (
    <tr className="border-t border-line/60">
      <td className="px-3 py-2">
        <AccountLink
          accountId={line.accountId}
          accountNumber={line.accountNumber}
          name={line.name}
          range={range}
        />
      </td>
      <MoneyCell amount={line.amount} />
    </tr>
  );
}

/**
 * Profit & Loss — income (shown positive) minus expenses (shown positive) over the
 * selected period equals net income. Asset/liability/equity accounts are excluded.
 * Defaults to year-to-date so the first view is a meaningful period, not all-time.
 */
export default function ProfitAndLossView() {
  const [range, setRange] = useState<DateRange>(() => {
    const now = new Date();
    return {
      from: new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10),
      to: now.toISOString().slice(0, 10),
    };
  });
  const { data, isPending, isError } = useProfitAndLoss(range);

  const hasRows = !!data && (data.income.lines.length > 0 || data.expense.lines.length > 0);

  return (
    <ReportPage
      title="Profit & Loss"
      subtitle={describeRange(range)}
      filter={<DateRangeFilter value={range} onChange={setRange} />}
      buildDocument={() => (data ? profitAndLossDocument(data) : null)}
      exportDisabled={!hasRows}
    >
      {isPending && <ReportLoading />}
      {isError && <ReportError />}
      {!isPending && !isError && data && !hasRows && (
        <ReportEmpty
          icon="trending_up"
          note="No posted income or expense activity in this period. Send an invoice, post a bill, or widen the date range."
        />
      )}

      {!isPending && !isError && data && hasRows && (
        <>
          <LedgerTable columns={[{ label: 'Account' }, { label: 'Amount', align: 'right' }]}>
            <SectionHeaderRow title="Income" span={2} />
            {data.income.lines.map((l) => (
              <AccountRow key={l.accountId} line={l} range={range} />
            ))}
            {data.income.lines.length === 0 && (
              <tr className="border-t border-line/60">
                <td className="px-3 py-2 text-subtle" colSpan={2}>
                  No income accounts with activity.
                </td>
              </tr>
            )}
            <SubtotalRow label="Total income" amount={data.totalIncome} colSpan={1} />

            <SectionHeaderRow title="Expenses" span={2} />
            {data.expense.lines.map((l) => (
              <AccountRow key={l.accountId} line={l} range={range} />
            ))}
            {data.expense.lines.length === 0 && (
              <tr className="border-t border-line/60">
                <td className="px-3 py-2 text-subtle" colSpan={2}>
                  No expense accounts with activity.
                </td>
              </tr>
            )}
            <SubtotalRow label="Total expenses" amount={data.totalExpense} colSpan={1} />
          </LedgerTable>

          {/* Net income callout */}
          <div className="ml-auto flex w-full max-w-xs items-center justify-between rounded-lg border border-line bg-white/5 px-3 py-2">
            <span className="font-bold text-white">Net income</span>
            <span
              className={`font-mono text-base font-bold tabular-nums ${
                data.netIncome < 0 ? 'text-red-400' : 'text-green-400'
              }`}
            >
              {formatAccounting(data.netIncome)}
            </span>
          </div>
        </>
      )}
    </ReportPage>
  );
}

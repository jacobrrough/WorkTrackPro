import { useState } from 'react';
import { LedgerTable } from '../components/LedgerTable';
import { useBalanceSheet } from '../hooks/useAccountingQueries';
import type { DateRange, ReportLine } from '../types';
import { AccountLink } from './AccountLink';
import { DateRangeFilter } from './DateRangeFilter';
import { ReportPage } from './ReportPage';
import { describeRange } from './reportFormat';
import { balanceSheetDocument } from './reportDocuments';
import {
  BalancedBadge,
  MoneyCell,
  ReportEmpty,
  ReportError,
  ReportLoading,
  SectionHeaderRow,
  SubtotalRow,
} from './ReportStates';

function AccountRow({ line, range }: { line: ReportLine; range: DateRange }) {
  return (
    <tr className="border-t border-white/5">
      <td className="px-3 py-2">
        {/* The synthetic "Net income" line (sentinel id) renders as plain, non-clickable text. */}
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
 * Balance Sheet — assets = liabilities + equity, as of the period end. Period net
 * income is folded into equity as a computed "Net income" line (a presentation
 * figure, not a posted entry). Only the "as of" date matters since balances are
 * cumulative, so the filter is in as-of mode.
 */
export default function BalanceSheetView() {
  // Default the "as of" date to today (open-ended start = since inception).
  const [range, setRange] = useState<DateRange>(() => ({
    from: null,
    to: new Date().toISOString().slice(0, 10),
  }));
  const { data, isPending, isError } = useBalanceSheet(range);

  const hasRows =
    !!data &&
    (data.assets.lines.length > 0 ||
      data.liabilities.lines.length > 0 ||
      data.equity.lines.length > 0);

  const status = data ? (
    <BalancedBadge
      balanced={data.balanced}
      label={data.balanced ? 'In balance' : `Off by ${Math.abs(data.difference).toFixed(2)}`}
    />
  ) : undefined;

  return (
    <ReportPage
      title="Balance Sheet"
      subtitle={describeRange(range)}
      status={status}
      filter={<DateRangeFilter value={range} onChange={setRange} asOfOnly />}
      buildDocument={() => (data ? balanceSheetDocument(data) : null)}
      exportDisabled={!hasRows}
    >
      {isPending && <ReportLoading />}
      {isError && <ReportError />}
      {!isPending && !isError && data && !hasRows && (
        <ReportEmpty
          icon="account_balance"
          note="No posted balances as of this date. Post some activity or pick a later as-of date."
        />
      )}

      {!isPending && !isError && data && hasRows && (
        <>
          <LedgerTable columns={[{ label: 'Account' }, { label: 'Amount', align: 'right' }]}>
            <SectionHeaderRow title="Assets" span={2} />
            {data.assets.lines.map((l) => (
              <AccountRow key={l.accountId} line={l} range={range} />
            ))}
            <SubtotalRow label="Total assets" amount={data.totalAssets} colSpan={1} />

            <SectionHeaderRow title="Liabilities" span={2} />
            {data.liabilities.lines.map((l) => (
              <AccountRow key={l.accountId} line={l} range={range} />
            ))}
            <SubtotalRow label="Total liabilities" amount={data.totalLiabilities} colSpan={1} />

            <SectionHeaderRow title="Equity" span={2} />
            {data.equity.lines.map((l) => (
              // The synthetic net-income line has a sentinel id, still unique.
              <AccountRow key={l.accountId} line={l} range={range} />
            ))}
            <SubtotalRow label="Total equity" amount={data.totalEquity} colSpan={1} />
          </LedgerTable>

          {/* Accounting-equation check */}
          <div className="ml-auto w-full max-w-xs space-y-1 text-sm">
            <div className="flex justify-between text-muted">
              <span>Total assets</span>
              <span className="font-mono tabular-nums text-white">
                {data.totalAssets.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
              </span>
            </div>
            <div className="flex justify-between border-b border-white/10 pb-1 text-muted">
              <span>Liabilities + equity</span>
              <span className="font-mono tabular-nums text-white">
                {(data.totalLiabilities + data.totalEquity).toLocaleString('en-US', {
                  style: 'currency',
                  currency: 'USD',
                })}
              </span>
            </div>
            <div className="flex justify-between pt-1 font-bold text-white">
              <span>Difference</span>
              <span className="font-mono tabular-nums">
                {data.difference.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
              </span>
            </div>
          </div>
        </>
      )}
    </ReportPage>
  );
}

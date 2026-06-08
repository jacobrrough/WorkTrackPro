import { useState } from 'react';
import { LedgerTable } from '../components/LedgerTable';
import { useCashFlowStatement } from '../hooks/useAccountingQueries';
import type { DateRange, ReportLine, ReportSection } from '../types';
import { AccountLink } from './AccountLink';
import { DateRangeFilter } from './DateRangeFilter';
import { ReportPage } from './ReportPage';
import { describeRange } from './reportFormat';
import { cashFlowStatementDocument } from './reportDocuments';
import {
  BalancedBadge,
  MoneyCell,
  ReportEmpty,
  ReportError,
  ReportLoading,
  SectionHeaderRow,
  SubtotalRow,
} from './ReportStates';

/** One activity-section line. Real accounts drill into the GL register; net income does not. */
function CashFlowRow({ line, range }: { line: ReportLine; range: DateRange }) {
  return (
    <tr className="border-t border-white/5">
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

function ActivitySection({
  section,
  subtotalLabel,
  subtotal,
  range,
}: {
  section: ReportSection;
  subtotalLabel: string;
  subtotal: number;
  range: DateRange;
}) {
  return (
    <>
      <SectionHeaderRow title={section.title} span={2} />
      {section.lines.map((l, i) => (
        <CashFlowRow key={`${l.accountId}-${i}`} line={l} range={range} />
      ))}
      {section.lines.length === 0 && (
        <tr className="border-t border-white/5">
          <td className="px-3 py-2 text-slate-500" colSpan={2}>
            No activity in this section.
          </td>
        </tr>
      )}
      <SubtotalRow label={subtotalLabel} amount={subtotal} colSpan={1} />
    </>
  );
}

/**
 * #5 — Statement of Cash Flows (indirect method). Net income, adjusted by the period
 * change in each non-cash balance-sheet account, classified into Operating / Investing /
 * Financing. The implied net change in cash must tie to the actual change in the cash
 * accounts (the BalancedBadge asserts it). This is a PERIOD statement, so the filter is a
 * from–to window (defaulting to year-to-date), not an as-of date.
 */
export default function CashFlowStatementView() {
  const [range, setRange] = useState<DateRange>(() => {
    const now = new Date();
    return {
      from: new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10),
      to: now.toISOString().slice(0, 10),
    };
  });
  const { data, isPending, isError } = useCashFlowStatement(range);

  const hasRows =
    !!data &&
    (data.operating.lines.length > 0 ||
      data.investing.lines.length > 0 ||
      data.financing.lines.length > 0 ||
      data.netIncome !== 0 ||
      data.cashChange !== 0);

  const status = data ? (
    <BalancedBadge
      balanced={data.balanced}
      label={data.balanced ? 'Reconciled' : `Off by ${Math.abs(data.difference).toFixed(2)}`}
    />
  ) : undefined;

  return (
    <ReportPage
      title="Statement of Cash Flows"
      subtitle={describeRange(range)}
      status={status}
      filter={<DateRangeFilter value={range} onChange={setRange} />}
      buildDocument={() => (data ? cashFlowStatementDocument(data) : null)}
      exportDisabled={!data}
    >
      {isPending && <ReportLoading />}
      {isError && <ReportError />}
      {!isPending && !isError && data && !hasRows && (
        <ReportEmpty
          icon="water_drop"
          note="No posted activity in this period. Post some entries or widen the date range."
        />
      )}

      {!isPending && !isError && data && hasRows && (
        <>
          <LedgerTable columns={[{ label: 'Item' }, { label: 'Amount', align: 'right' }]}>
            <ActivitySection
              section={data.operating}
              subtotalLabel="Net cash from operating activities"
              subtotal={data.netOperating}
              range={range}
            />
            <ActivitySection
              section={data.investing}
              subtotalLabel="Net cash from investing activities"
              subtotal={data.netInvesting}
              range={range}
            />
            <ActivitySection
              section={data.financing}
              subtotalLabel="Net cash from financing activities"
              subtotal={data.netFinancing}
              range={range}
            />
          </LedgerTable>

          {/* Reconciliation: implied net change vs. the actual change in cash accounts. */}
          <div className="ml-auto w-full max-w-xs space-y-1 text-sm">
            <div className="flex justify-between text-slate-400">
              <span>Net change in cash</span>
              <span className="font-mono tabular-nums text-slate-200">
                {data.netChangeInCash.toLocaleString('en-US', {
                  style: 'currency',
                  currency: 'USD',
                })}
              </span>
            </div>
            <div className="flex justify-between border-b border-white/10 pb-1 text-slate-400">
              <span>Change in cash accounts</span>
              <span className="font-mono tabular-nums text-slate-200">
                {data.cashChange.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
              </span>
            </div>
            <div className="flex justify-between pt-1 font-bold text-white">
              <span>Difference</span>
              <span className="font-mono tabular-nums">
                {data.difference.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
              </span>
            </div>
          </div>

          {!data.balanced && (
            <div
              className="rounded-sm border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-300"
              role="note"
            >
              <span className="font-bold">This statement does not reconcile.</span> The change
              implied by the three activity sections does not match the actual change in the cash
              accounts. An account is likely missing its cash-flow classification (look for an
              “unclassified — review” line above) or a cash account is mis-tagged.
            </div>
          )}
        </>
      )}
    </ReportPage>
  );
}

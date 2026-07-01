import { useState } from 'react';
import { LedgerTable } from '../components/LedgerTable';
import { useTrialBalance } from '../hooks/useAccountingQueries';
import type { DateRange } from '../types';
import { AccountLink } from './AccountLink';
import { DateRangeFilter } from './DateRangeFilter';
import { ReportPage } from './ReportPage';
import { describeRange } from './reportFormat';
import { trialBalanceDocument } from './reportDocuments';
import { BalancedBadge, MoneyCell, ReportEmpty, ReportError, ReportLoading } from './ReportStates';

/**
 * Trial Balance — every posted account's signed balance, with the agreeing grand
 * debit/credit totals. The date-range filter scopes which posted entries roll in
 * (all-time when cleared). A debit-natural net shows in the Debit column, a credit-
 * natural net in the Credit column, so the two totals tie.
 */
export default function TrialBalanceView() {
  const [range, setRange] = useState<DateRange>({});
  const { data, isPending, isError } = useTrialBalance(range);

  const status = data ? (
    <BalancedBadge
      balanced={data.balanced}
      label={data.balanced ? 'In balance' : `Off by ${Math.abs(data.difference).toFixed(2)}`}
    />
  ) : undefined;

  return (
    <ReportPage
      title="Trial Balance"
      subtitle={describeRange(range)}
      status={status}
      filter={<DateRangeFilter value={range} onChange={setRange} />}
      buildDocument={() => (data ? trialBalanceDocument(data) : null)}
      exportDisabled={!data || data.rows.length === 0}
    >
      {isPending && <ReportLoading />}
      {isError && <ReportError />}
      {!isPending && !isError && data && data.rows.length === 0 && (
        <ReportEmpty
          icon="balance"
          note="No posted journal activity falls in this period. Post an entry or widen the date range."
        />
      )}

      {!isPending && !isError && data && data.rows.length > 0 && (
        <LedgerTable
          columns={[
            { label: 'Account' },
            { label: 'Debit', align: 'right' },
            { label: 'Credit', align: 'right' },
          ]}
        >
          {data.rows.map((r) => {
            // A positive signed balance is a net debit; negative is a net credit.
            const debit = r.balance > 0 ? r.balance : 0;
            const credit = r.balance < 0 ? -r.balance : 0;
            return (
              <tr key={r.accountId} className="border-t border-line/60">
                <td className="px-3 py-2">
                  <AccountLink
                    accountId={r.accountId}
                    accountNumber={r.accountNumber}
                    name={r.name}
                    range={range}
                  />
                </td>
                <MoneyCell amount={debit} />
                <MoneyCell amount={credit} />
              </tr>
            );
          })}
          <tr className="border-t border-line bg-white/5">
            <td className="px-3 py-2 font-bold text-white">Total</td>
            <MoneyCell amount={data.totalDebit} strong />
            <MoneyCell amount={data.totalCredit} strong />
          </tr>
        </LedgerTable>
      )}
    </ReportPage>
  );
}

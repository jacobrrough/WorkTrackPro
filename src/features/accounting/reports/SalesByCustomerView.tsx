import { useState } from 'react';
import { LedgerTable } from '../components/LedgerTable';
import { useSalesByCustomer } from '../hooks/useAccountingQueries';
import type { DateRange } from '../types';
import { DateRangeFilter } from './DateRangeFilter';
import { ReportPage } from './ReportPage';
import { describeRange } from './reportFormat';
import { salesByCustomerDocument } from './reportDocuments';
import { MoneyCell, ReportEmpty, ReportError, ReportLoading } from './ReportStates';

/**
 * #4 — Sales by Customer. Non-void invoice revenue (pre-tax line totals) grouped by
 * customer, ranked by revenue. Drafts are included so the figure matches the operational
 * pipeline; voided invoices are excluded. Defaults to all-time.
 */
export default function SalesByCustomerView() {
  const [range, setRange] = useState<DateRange>({});
  const { data, isPending, isError } = useSalesByCustomer(range);

  const hasRows = !!data && data.rows.length > 0;

  return (
    <ReportPage
      title="Sales by Customer"
      subtitle={describeRange(range)}
      filter={<DateRangeFilter value={range} onChange={setRange} />}
      buildDocument={() => (data ? salesByCustomerDocument(data) : null)}
      exportDisabled={!hasRows}
    >
      {isPending && <ReportLoading />}
      {isError && <ReportError />}
      {!isPending && !isError && data && !hasRows && (
        <ReportEmpty
          icon="groups"
          note="No invoices fall in this period. Send an invoice or widen the date range."
        />
      )}

      {!isPending && !isError && data && hasRows && (
        <LedgerTable
          columns={[
            { label: 'Customer' },
            { label: 'Lines', align: 'right' },
            { label: 'Sales', align: 'right' },
          ]}
        >
          {data.rows.map((r) => (
            <tr key={r.customerId ?? '__uncategorized__'} className="border-t border-line/60">
              <td className="px-3 py-2 text-white">{r.customerName}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-muted">
                {r.invoiceCount}
              </td>
              <MoneyCell amount={r.amount} />
            </tr>
          ))}
          <tr className="border-t border-line bg-white/5">
            <td className="px-3 py-2 font-bold text-white" colSpan={2}>
              Total sales
            </td>
            <MoneyCell amount={data.total} strong />
          </tr>
        </LedgerTable>
      )}
    </ReportPage>
  );
}

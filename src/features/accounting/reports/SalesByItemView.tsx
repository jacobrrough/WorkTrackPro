import { useState } from 'react';
import { LedgerTable } from '../components/LedgerTable';
import { useSalesByItem } from '../hooks/useAccountingQueries';
import type { DateRange } from '../types';
import { DateRangeFilter } from './DateRangeFilter';
import { ReportPage } from './ReportPage';
import { describeRange } from './reportFormat';
import { salesByItemDocument } from './reportDocuments';
import { MoneyCell, ReportEmpty, ReportError, ReportLoading } from './ReportStates';

/**
 * #4 — Sales by Item. Non-void invoice revenue (pre-tax line totals) grouped by the
 * line's item, ranked by revenue. Invoice lines with no item group under "Uncategorized"
 * (surfaced, not dropped). Defaults to all-time.
 */
export default function SalesByItemView() {
  const [range, setRange] = useState<DateRange>({});
  const { data, isPending, isError } = useSalesByItem(range);

  const hasRows = !!data && data.rows.length > 0;

  return (
    <ReportPage
      title="Sales by Item"
      subtitle={describeRange(range)}
      filter={<DateRangeFilter value={range} onChange={setRange} />}
      buildDocument={() => (data ? salesByItemDocument(data) : null)}
      exportDisabled={!hasRows}
    >
      {isPending && <ReportLoading />}
      {isError && <ReportError />}
      {!isPending && !isError && data && !hasRows && (
        <ReportEmpty
          icon="category"
          note="No invoice lines fall in this period. Send an invoice or widen the date range."
        />
      )}

      {!isPending && !isError && data && hasRows && (
        <LedgerTable
          columns={[
            { label: 'Item' },
            { label: 'Lines', align: 'right' },
            { label: 'Sales', align: 'right' },
          ]}
        >
          {data.rows.map((r) => (
            <tr key={r.itemId ?? '__uncategorized__'} className="border-t border-white/5">
              <td className="px-3 py-2 text-white">{r.itemName}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-400">
                {r.lineCount}
              </td>
              <MoneyCell amount={r.amount} />
            </tr>
          ))}
          <tr className="border-t border-white/10 bg-white/5">
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

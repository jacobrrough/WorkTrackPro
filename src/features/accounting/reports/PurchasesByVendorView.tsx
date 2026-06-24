import { useState } from 'react';
import { LedgerTable } from '../components/LedgerTable';
import { usePurchasesByVendor } from '../hooks/useAccountingQueries';
import type { DateRange } from '../types';
import { DateRangeFilter } from './DateRangeFilter';
import { ReportPage } from './ReportPage';
import { describeRange } from './reportFormat';
import { purchasesByVendorDocument } from './reportDocuments';
import { MoneyCell, ReportEmpty, ReportError, ReportLoading } from './ReportStates';

/**
 * #4 — Purchases by Vendor. Non-void bill spend (line totals) grouped by vendor, ranked
 * by spend. Drafts are included so the figure matches the operational pipeline; voided
 * bills are excluded. Defaults to all-time.
 */
export default function PurchasesByVendorView() {
  const [range, setRange] = useState<DateRange>({});
  const { data, isPending, isError } = usePurchasesByVendor(range);

  const hasRows = !!data && data.rows.length > 0;

  return (
    <ReportPage
      title="Purchases by Vendor"
      subtitle={describeRange(range)}
      filter={<DateRangeFilter value={range} onChange={setRange} />}
      buildDocument={() => (data ? purchasesByVendorDocument(data) : null)}
      exportDisabled={!hasRows}
    >
      {isPending && <ReportLoading />}
      {isError && <ReportError />}
      {!isPending && !isError && data && !hasRows && (
        <ReportEmpty
          icon="local_shipping"
          note="No bills fall in this period. Enter a bill or widen the date range."
        />
      )}

      {!isPending && !isError && data && hasRows && (
        <LedgerTable
          columns={[
            { label: 'Vendor' },
            { label: 'Lines', align: 'right' },
            { label: 'Purchases', align: 'right' },
          ]}
        >
          {data.rows.map((r) => (
            <tr key={r.vendorId ?? '__uncategorized__'} className="border-t border-white/5">
              <td className="px-3 py-2 text-white">{r.vendorName}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-muted">
                {r.billCount}
              </td>
              <MoneyCell amount={r.amount} />
            </tr>
          ))}
          <tr className="border-t border-white/10 bg-white/5">
            <td className="px-3 py-2 font-bold text-white" colSpan={2}>
              Total purchases
            </td>
            <MoneyCell amount={data.total} strong />
          </tr>
        </LedgerTable>
      )}
    </ReportPage>
  );
}

import { useState } from 'react';
import { LedgerTable } from '../components/LedgerTable';
import { formatMoney } from '../accountingViewModel';
import { useSalesTaxLiability } from '../hooks/useAccountingQueries';
import type { DateRange, SalesTaxAgencyLine } from '../types';
import { DateRangeFilter } from './DateRangeFilter';
import { ReportPage } from './ReportPage';
import { describeRange } from './reportFormat';
import { salesTaxLiabilityDocument } from './reportDocuments';
import { MoneyCell, ReportEmpty, ReportError, ReportLoading } from './ReportStates';

/**
 * C1 — Sales-Tax Liability report (REPORTING ONLY: no e-filing, no money movement).
 *
 * Tax COLLECTED is the net credit to the 2200 "Sales Tax Payable" account on POSTED
 * journal entries in the selected window, grouped by tax agency/jurisdiction through
 * each source invoice's tax code. The CDTFA-style summary shows gross / taxable /
 * non-taxable sales and the total tax due. Every figure ties back to the posted ledger;
 * any collected tax that cannot be tied to a source invoice/agency is surfaced in the
 * highlighted "Unattributed / review" row — never guessed (the C1 stop-condition).
 *
 * If reconciliation fails (the per-agency tax does not sum back to the posted total) a
 * prominent banner says so rather than presenting an unreconciled number as fact.
 *
 * G9: ReportPage shows the disclaimer with the "Representative rates only." caveat, and
 * the PDF/CSV export embeds the same wording (salesTaxLiabilityDocument).
 */

/** A decimal rate (0.0725) as a percent string ("7.25%"); em-dash for the 0-rate bucket. */
function rateLabel(rate: number): string {
  if (!Number.isFinite(rate) || rate === 0) return '—';
  return `${parseFloat((rate * 100).toFixed(4))}%`;
}

/** One compact figure tile for the CDTFA-style summary band. */
function SummaryTile({
  label,
  amount,
  emphasize = false,
}: {
  label: string;
  amount: number;
  emphasize?: boolean;
}) {
  return (
    <div
      className={`flex flex-col gap-0.5 rounded-sm border p-3 ${
        emphasize ? 'border-primary/30 bg-primary/5' : 'border-white/10 bg-card-dark'
      }`}
    >
      <span className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
      <span
        className={`font-mono text-lg tabular-nums ${
          emphasize ? 'font-bold text-white' : 'text-white'
        }`}
      >
        {formatMoney(amount)}
      </span>
    </div>
  );
}

export default function SalesTaxLiabilityView() {
  const [range, setRange] = useState<DateRange>({});
  const { data, isPending, isError } = useSalesTaxLiability(range);

  const hasRows = !!data && data.agencies.length > 0;
  // A report exports as soon as the liability account resolved (even an all-zero period
  // is meaningful), so only gate export while there is genuinely no data object.
  const exportDisabled = !data;

  return (
    <ReportPage
      title="Sales-Tax Liability"
      subtitle={describeRange(range)}
      filter={<DateRangeFilter value={range} onChange={setRange} />}
      buildDocument={() => (data ? salesTaxLiabilityDocument(data) : null)}
      exportDisabled={exportDisabled}
      disclaimerRepresentativeRates
    >
      {isPending && <ReportLoading />}
      {isError && <ReportError />}

      {!isPending && !isError && data && (
        <>
          {/* Reconciliation failure — the figures could not be fully tied to the ledger. */}
          {!data.reconciled && (
            <div
              className="rounded-sm border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300"
              role="alert"
            >
              <span className="font-bold">Reconciliation failed.</span> The per-agency tax does not
              sum back to the posted total (off by{' '}
              <span className="font-mono">{formatMoney(data.reconciliationDifference)}</span>). Do
              not rely on these figures — investigate the 2200 Sales Tax Payable postings before
              filing.
            </div>
          )}

          {/* No liability account configured → nothing can be tied back. */}
          {!data.liabilityAccountId && (
            <div
              className="rounded-sm border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-300"
              role="note"
            >
              <span className="font-bold">No Sales Tax Payable account configured.</span> Set the
              “Sales tax payable” default account (or add a 2200 account) so collected tax can be
              summed and attributed.
            </div>
          )}

          {/* Unattributed tax present, but the report still reconciles → review, not failure. */}
          {data.reconciled && data.unattributedTax !== 0 && (
            <div
              className="rounded-sm border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-300"
              role="note"
            >
              <span className="font-bold">
                {formatMoney(data.unattributedTax)} of collected tax is unattributed.
              </span>{' '}
              It posted to Sales Tax Payable but could not be tied to a source invoice/agency
              (manual entries, voided/edited sources, or tax codes with no agency). It is listed in
              the highlighted “Unattributed / review” row below — verify it before filing.
            </div>
          )}

          {/* CDTFA-style summary band. */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <SummaryTile label="Gross sales" amount={data.grossSales} />
            <SummaryTile label="Taxable sales" amount={data.taxableSales} />
            <SummaryTile label="Non-taxable" amount={data.nonTaxableSales} />
            <SummaryTile label="Tax collected" amount={data.taxCollected} emphasize />
          </div>

          {!hasRows ? (
            <ReportEmpty
              icon="receipt_long"
              note="No sales tax was collected in this period. Post a taxed invoice or widen the date range."
            />
          ) : (
            <>
              <LedgerTable
                columns={[
                  { label: 'Agency / jurisdiction' },
                  { label: 'Rate', align: 'right' },
                  { label: 'Taxable sales', align: 'right' },
                  { label: 'Non-taxable', align: 'right' },
                  { label: 'Tax collected', align: 'right' },
                ]}
              >
                {data.agencies.map((a) => (
                  <AgencyRow key={a.agencyId} agency={a} />
                ))}
                <tr className="border-t border-white/10 bg-white/5">
                  <td className="px-3 py-2 font-bold text-white" colSpan={4}>
                    Total tax collected
                  </td>
                  <MoneyCell amount={data.taxCollected} strong />
                </tr>
              </LedgerTable>

              <p className="text-xs text-subtle">
                Per-agency taxable and non-taxable figures are the sales subject to each agency on a
                taxed invoice; an invoice taxed by several agencies counts its base toward each, so
                these columns are <span className="font-semibold">not</span> additive across rows.
                The summary band above counts each invoice once.
              </p>
            </>
          )}
        </>
      )}
    </ReportPage>
  );
}

/** One agency row; the unattributed/review bucket is amber-highlighted so it stands out. */
function AgencyRow({ agency }: { agency: SalesTaxAgencyLine }) {
  if (agency.isUnattributed) {
    return (
      <tr className="border-t border-amber-500/30 bg-amber-500/10">
        <td className="px-3 py-2 font-semibold text-amber-300">
          <span className="material-symbols-outlined mr-1 align-middle text-sm">warning</span>
          {agency.agencyName}
        </td>
        <td className="px-3 py-2 text-right font-mono tabular-nums text-amber-300/70">—</td>
        <td className="px-3 py-2 text-right font-mono tabular-nums text-amber-300/70">—</td>
        <td className="px-3 py-2 text-right font-mono tabular-nums text-amber-300/70">—</td>
        <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums text-amber-300">
          {formatMoney(agency.taxCollected)}
        </td>
      </tr>
    );
  }
  return (
    <tr className="border-t border-white/5">
      <td className="px-3 py-2 text-white">{agency.agencyName}</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums text-muted">
        {rateLabel(agency.rate)}
      </td>
      <MoneyCell amount={agency.taxableSales} />
      <MoneyCell amount={agency.nonTaxableSales} />
      <MoneyCell amount={agency.taxCollected} />
    </tr>
  );
}

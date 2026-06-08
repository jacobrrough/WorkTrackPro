import { useState } from 'react';
import { LedgerTable } from '../components/LedgerTable';
import { formatMoney } from '../accountingViewModel';
import { use1099Totals } from '../hooks/useAccountingQueries';
import type { Form1099Row } from '../types';
import { ReportPage } from './ReportPage';
import { form1099WorklistDocument } from './reportDocuments';
import { MoneyCell, ReportEmpty, ReportError, ReportLoading } from './ReportStates';

/**
 * #12 — 1099-NEC worklist (ADVISORY / COMPLIANCE ONLY: no e-file, no money movement).
 *
 * For a chosen calendar year this lists every vendor flagged 1099 whose POSTED, non-card
 * payments total AT OR OVER the $600 1099-NEC threshold, ranked by amount. Each row shows
 * the vendor, its W-9 legal name, whether a Tax ID is on file (the actual TIN is never
 * shown), the payment count and the total. A "W-9 incomplete" badge flags any reportable
 * vendor missing a legal name + TIN so an admin can chase the W-9 before filing season.
 *
 * Card / third-party-network payments are EXCLUDED here: those are reported on a 1099-K by
 * the card processor / TPSO, not on the payer's 1099-NEC (the read-model drops method='card').
 * Vendors below the threshold are summed into a "below threshold excluded" note rather than
 * listed. The figures tie to the posted vendor-payment ledger; this is a worklist to help
 * prepare 1099s, NOT a filing — there is no e-file (out of scope, no paid provider).
 *
 * G9: ReportPage shows the disclaimer, and the PDF/CSV export embeds the same notice plus
 * the card-exclusion / no-e-file caveat (form1099WorklistDocument).
 */

/** The current calendar year; the default selection (last year is also offered for filing season). */
function currentYear(): number {
  return new Date().getFullYear();
}

/** A small year picker: the current year and the previous four, newest first. */
function YearPicker({ value, onChange }: { value: number; onChange: (year: number) => void }) {
  const now = currentYear();
  const years = [now, now - 1, now - 2, now - 3, now - 4];
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-sm border border-white/10 bg-card-dark p-3">
      <label className="flex items-center gap-2 text-sm font-semibold text-slate-400">
        Tax year
        <select
          aria-label="Tax year"
          className="rounded-sm border border-white/10 bg-background-dark px-2 py-1.5 text-sm text-white focus:border-primary focus:outline-none"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </label>
      <span className="text-xs text-slate-500">
        Calendar-year totals of posted, non-card vendor payments.
      </span>
    </div>
  );
}

export default function Form1099WorklistView() {
  const [year, setYear] = useState<number>(currentYear());
  const { data, isPending, isError } = use1099Totals(year);

  const hasRows = !!data && data.rows.length > 0;
  // Export as soon as the report resolved (an all-clear year is still meaningful); only
  // gate while there is genuinely no data object.
  const exportDisabled = !data;

  return (
    <ReportPage
      title="1099-NEC Worklist"
      subtitle={`Calendar year ${year} · vendors at or over ${data ? formatMoney(data.thresholdAmount) : '$600.00'}`}
      filter={<YearPicker value={year} onChange={setYear} />}
      buildDocument={() => (data ? form1099WorklistDocument(data) : null)}
      exportDisabled={exportDisabled}
    >
      {isPending && <ReportLoading />}
      {isError && <ReportError />}

      {!isPending && !isError && data && (
        <>
          {/* What this report is and what it deliberately leaves out. */}
          <div
            className="rounded-sm border border-white/10 bg-card-dark p-3 text-xs text-slate-400"
            role="note"
          >
            Lists vendors marked <span className="font-semibold text-slate-200">1099</span> whose
            posted payments for {year} reach the{' '}
            <span className="font-mono text-slate-200">{formatMoney(data.thresholdAmount)}</span>{' '}
            1099-NEC threshold.{' '}
            <span className="font-semibold text-slate-200">
              Card / third-party-network payments are excluded
            </span>{' '}
            — those are reported on a 1099-K by the processor, not on your 1099-NEC. This is a
            preparation worklist, not a filing; <span className="font-semibold">no e-file</span> is
            included.
          </div>

          {/* Incomplete-W-9 warning: reportable vendors missing legal name + TIN. */}
          {data.incompleteCount > 0 && (
            <div
              className="rounded-sm border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-300"
              role="alert"
            >
              <span className="font-bold">
                {data.incompleteCount} reportable vendor{data.incompleteCount === 1 ? '' : 's'}{' '}
                still need a complete W-9.
              </span>{' '}
              A 1099-NEC needs the payee&rsquo;s legal name and TIN. Record the missing W-9 details
              on each vendor (open a bill for the vendor to edit its tax info) before filing.
            </div>
          )}

          {!hasRows ? (
            <ReportEmpty
              icon="badge"
              note={`No 1099 vendor reached the ${formatMoney(data.thresholdAmount)} threshold for ${year}. Mark a vendor as 1099 and record its payments, or choose another year.`}
            />
          ) : (
            <LedgerTable
              columns={[
                { label: 'Vendor' },
                { label: 'Legal name' },
                { label: 'Tax ID?', align: 'right' },
                { label: 'Payments', align: 'right' },
                { label: 'Amount', align: 'right' },
              ]}
            >
              {data.rows.map((r) => (
                <Worklist1099Row key={r.vendorId} row={r} />
              ))}
              <tr className="border-t border-white/10 bg-white/5">
                <td className="px-3 py-2 font-bold text-white" colSpan={4}>
                  Total reportable
                </td>
                <MoneyCell amount={data.reportableTotal} strong />
              </tr>
            </LedgerTable>
          )}

          {/* Below-threshold disclosure: summed, not listed. */}
          {data.belowThresholdCount > 0 && (
            <p className="text-xs text-slate-500">
              {data.belowThresholdCount} 1099 vendor
              {data.belowThresholdCount === 1 ? '' : 's'} below the{' '}
              {formatMoney(data.thresholdAmount)} threshold ({formatMoney(data.belowThresholdTotal)}{' '}
              total) {data.belowThresholdCount === 1 ? 'is' : 'are'} excluded from the worklist.
            </p>
          )}
        </>
      )}
    </ReportPage>
  );
}

/** One reportable-vendor row; an incomplete W-9 is flagged inline. */
function Worklist1099Row({ row }: { row: Form1099Row }) {
  return (
    <tr className="border-t border-white/5">
      <td className="px-3 py-2 text-white">
        {row.vendorName || row.vendorId}
        {row.exempt && (
          <span className="ml-2 rounded-sm bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-300">
            Exempt
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-slate-300">
        {row.legalName || <span className="text-amber-400">— missing —</span>}
      </td>
      <td className="px-3 py-2 text-right">
        {row.hasTaxId ? (
          <span className="text-green-400">Yes</span>
        ) : (
          <span className="text-amber-400">No</span>
        )}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-slate-400">{row.paymentCount}</td>
      <MoneyCell amount={row.amount} />
    </tr>
  );
}

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LedgerTable } from '../components/LedgerTable';
import { CurrencyInput } from '../components/CurrencyInput';
import { useCashFlowForecast } from '../hooks/useAccountingQueries';
import { formatMoney } from '../accountingViewModel';
import { BUDGETS_BASE } from '../constants';
import { ReportPage } from '../reports/ReportPage';
import { cashFlowForecastDocument } from '../reports/reportDocuments';
import { MoneyCell, ReportEmpty, ReportError, ReportLoading } from '../reports/ReportStates';

/** Horizon options for the projection (monthly buckets). */
const HORIZONS = [3, 6, 12, 24] as const;

/** First-of-current-month ISO, used as the forecast's start month. */
function currentMonthStartIso(): string {
  const now = new Date();
  const mm = now.getMonth() + 1;
  return `${now.getFullYear()}-${mm < 10 ? `0${mm}` : mm}-01`;
}

/** A small KPI card for the summary strip. */
function SummaryCard({
  label,
  amount,
  accent,
}: {
  label: string;
  amount: number;
  accent?: 'in' | 'out' | 'end';
}) {
  const valueCls =
    accent === 'in'
      ? 'text-emerald-300'
      : accent === 'out'
        ? 'text-red-300'
        : amount < 0
          ? 'text-red-400'
          : 'text-white';
  return (
    <div className="rounded-2xl border border-line bg-card-dark p-2 text-center">
      <p className="text-[10px] font-semibold uppercase text-subtle">{label}</p>
      <p className={`font-mono text-sm font-bold tabular-nums ${valueCls}`}>
        {formatMoney(amount)}
      </p>
    </div>
  );
}

/**
 * D2 — Cash-flow forecast. Projects the opening cash position forward across N monthly
 * buckets using open AR (cash in, by invoice due date) minus open AP (cash out, by bill due
 * date). Documents past-due or undated land in the first bucket; anything past the horizon
 * folds into the last. The opening balance is user-supplied (enter your current cash/bank
 * position) since the books' cash account isn't assumed here.
 *
 * Renders inside ReportPage for the mandatory G9 disclaimer and PDF/CSV export
 * (cashFlowForecastDocument). This is a projection from currently-open documents — it books
 * no journal entry and reads only open balances.
 */
export default function CashFlowForecastView() {
  const navigate = useNavigate();
  const [months, setMonths] = useState<number>(6);
  const [openingBalance, setOpeningBalance] = useState<number>(0);
  const startMonth = useMemo(() => currentMonthStartIso(), []);

  const { data, isPending, isError } = useCashFlowForecast({ startMonth, months, openingBalance });

  const hasActivity =
    !!data && (data.totalInflow !== 0 || data.totalOutflow !== 0 || data.openingBalance !== 0);

  const filter = (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-card-dark p-3">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted">Horizon</span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Forecast horizon">
            {HORIZONS.map((h) => {
              const active = h === months;
              return (
                <button
                  key={h}
                  type="button"
                  onClick={() => setMonths(h)}
                  aria-pressed={active}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                    active
                      ? 'bg-primary text-on-accent'
                      : 'bg-white/5 text-muted hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {h} mo
                </button>
              );
            })}
          </div>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted">Opening cash balance</span>
          <CurrencyInput
            aria-label="Opening cash balance"
            value={openingBalance}
            onValueChange={setOpeningBalance}
            className="w-40"
          />
        </label>
      </div>
      <p className="text-xs text-subtle">
        Enter your current cash / bank balance as the starting position — find it on the Balance
        Sheet or in Banking. Inflows are open customer invoices; outflows are open vendor bills,
        each bucketed by its due date.
      </p>
    </div>
  );

  return (
    <ReportPage
      title="Cash-Flow Forecast"
      subtitle={`${months}-month projection from ${startMonth}`}
      filter={filter}
      buildDocument={() => (data ? cashFlowForecastDocument(data) : null)}
      exportDisabled={!data}
    >
      {/* Back to the budgets section (ReportPage's own back-link returns to reports). */}
      <button
        type="button"
        onClick={() => navigate(BUDGETS_BASE)}
        className="self-start text-sm font-semibold text-muted hover:text-white"
      >
        All budgets
      </button>

      {isPending && <ReportLoading />}
      {isError && (
        <ReportError message="Could not load the cash-flow forecast. Confirm the accounting schema is exposed and you have an accounting role." />
      )}

      {!isPending && !isError && data && !hasActivity && (
        <ReportEmpty
          icon="waterfall_chart"
          note="No open receivables or payables to project, and no opening balance entered. Enter an opening balance above, or send invoices / post bills with a balance due."
        />
      )}

      {!isPending && !isError && data && hasActivity && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <SummaryCard label="Opening" amount={data.openingBalance} />
            <SummaryCard label="Expected in" amount={data.totalInflow} accent="in" />
            <SummaryCard label="Expected out" amount={data.totalOutflow} accent="out" />
            <SummaryCard label="Projected end" amount={data.endingBalance} accent="end" />
          </div>

          <LedgerTable
            columns={[
              { label: 'Period' },
              { label: 'Inflow', align: 'right' },
              { label: 'Outflow', align: 'right' },
              { label: 'Net', align: 'right' },
              { label: 'Running balance', align: 'right' },
            ]}
          >
            {data.periods.map((p) => (
              <tr key={p.periodStart} className="border-t border-line/60">
                <td className="px-3 py-2 text-white">{p.label}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-emerald-300">
                  {p.inflow !== 0 ? formatMoney(p.inflow) : '—'}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-red-300">
                  {p.outflow !== 0 ? formatMoney(p.outflow) : '—'}
                </td>
                <MoneyCell amount={p.net} />
                <td
                  className={`px-3 py-2 text-right font-mono font-semibold tabular-nums ${
                    p.runningBalance < 0 ? 'text-red-400' : 'text-white'
                  }`}
                >
                  {formatMoney(p.runningBalance)}
                </td>
              </tr>
            ))}
            <tr className="border-t border-line bg-white/5">
              <td className="px-3 py-2 font-bold text-white">Horizon total</td>
              <MoneyCell amount={data.totalInflow} strong />
              <MoneyCell amount={data.totalOutflow} strong />
              <MoneyCell amount={data.totalInflow - data.totalOutflow} strong />
              <td
                className={`px-3 py-2 text-right font-mono font-bold tabular-nums ${
                  data.endingBalance < 0 ? 'text-red-400' : 'text-white'
                }`}
              >
                {formatMoney(data.endingBalance)}
              </td>
            </tr>
          </LedgerTable>

          {data.periods.some((p) => p.runningBalance < 0) && (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-300">
              <span className="font-bold">Heads up:</span> the projected cash balance goes negative
              in at least one period. Consider the timing of receivables and payables.
            </p>
          )}
        </>
      )}
    </ReportPage>
  );
}

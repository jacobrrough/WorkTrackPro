import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { LedgerTable } from '../components/LedgerTable';
import { useBudgetVsActual } from '../hooks/useAccountingQueries';
import { formatMoney } from '../accountingViewModel';
import { BUDGETS_BASE, budgetEditorPath } from '../constants';
import { ReportPage } from '../reports/ReportPage';
import { budgetVsActualDocument } from '../reports/reportDocuments';
import { MoneyCell, ReportEmpty, ReportError, ReportLoading } from '../reports/ReportStates';
import { BUDGET_MONTH_LABELS, BUDGET_MONTHS, type BudgetVsActualRow } from '../types';

/** Variance cell: green when favorable-looking (actual ≥ budget), red when under. */
function VarianceCell({ amount }: { amount: number }) {
  const positive = amount > 0;
  const negative = amount < 0;
  return (
    <td
      className={`px-3 py-2 text-right font-mono tabular-nums ${
        positive ? 'text-emerald-400' : negative ? 'text-red-400' : 'text-slate-300'
      }`}
    >
      {formatMoney(amount)}
    </td>
  );
}

/** The expandable per-month detail for a single account row. */
function MonthlyDetail({ row }: { row: BudgetVsActualRow }) {
  return (
    <tr className="bg-white/[0.02]">
      <td colSpan={4} className="px-3 py-2">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="text-slate-500">
                <th className="px-2 py-1 text-left font-semibold">Month</th>
                {BUDGET_MONTHS.map((m) => (
                  <th key={m} className="px-2 py-1 text-right font-semibold">
                    {BUDGET_MONTH_LABELS[m]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="px-2 py-1 text-left text-slate-400">Budget</td>
                {row.budgetMonthly.map((v, i) => (
                  <td key={i} className="px-2 py-1 text-right font-mono tabular-nums text-slate-400">
                    {formatMoney(v)}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="px-2 py-1 text-left text-slate-400">Actual</td>
                {row.actualMonthly.map((v, i) => (
                  <td key={i} className="px-2 py-1 text-right font-mono tabular-nums text-slate-300">
                    {formatMoney(v)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </td>
    </tr>
  );
}

function AccountRow({ row }: { row: BudgetVsActualRow }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className="border-t border-white/5">
        <td className="px-3 py-2 text-white">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1 text-left hover:text-primary"
            aria-expanded={open}
          >
            <span className="material-symbols-outlined text-base text-slate-500">
              {open ? 'expand_more' : 'chevron_right'}
            </span>
            {row.accountNumber ? (
              <span className="mr-1 font-mono text-xs text-slate-500">{row.accountNumber}</span>
            ) : null}
            {row.accountName}
          </button>
        </td>
        <MoneyCell amount={row.budget} />
        <MoneyCell amount={row.actual} />
        <VarianceCell amount={row.variance} />
      </tr>
      {open && <MonthlyDetail row={row} />}
    </>
  );
}

/**
 * D2 — Budget-vs-Actual report. For the selected budget's fiscal year, every account that
 * has a budget line or posted actuals is shown with its annual budget, its actual (computed
 * from POSTED journal lines on the SAME basis as the trial balance, so it ties out) and the
 * variance (actual − budget). Each row expands to the 12-month budget/actual detail.
 *
 * Renders inside ReportPage, which supplies the mandatory G9 "Not certified tax software…"
 * disclaimer and the PDF/CSV export (budgetVsActualDocument). Read-only — nothing posts.
 */
export default function BudgetVsActualView() {
  const { budgetId } = useParams<{ budgetId: string }>();
  const navigate = useNavigate();
  const { data, isPending, isError } = useBudgetVsActual(budgetId);

  const subtitle = data ? `${data.budgetName} · FY ${data.fiscalYear}` : 'Budget vs Actual';
  const hasRows = !!data && data.rows.length > 0;

  const status = data ? (
    <span className="text-xs text-slate-400">
      Actuals are posted journal activity for FY {data.fiscalYear} — the same basis as the trial
      balance.
    </span>
  ) : undefined;

  return (
    <ReportPage
      title="Budget vs Actual"
      subtitle={subtitle}
      status={status}
      buildDocument={() => (data ? budgetVsActualDocument(data) : null)}
      exportDisabled={!hasRows}
    >
      {/* Budget-aware navigation (ReportPage's own back-link returns to the reports index). */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(BUDGETS_BASE)}
          className="text-sm font-semibold text-slate-400 hover:text-white"
        >
          All budgets
        </button>
        {budgetId && (
          <button
            type="button"
            onClick={() => navigate(budgetEditorPath(budgetId))}
            className="text-sm font-semibold text-primary hover:text-primary-hover"
          >
            Edit this budget
          </button>
        )}
      </div>

      {isPending && <ReportLoading />}
      {isError && <ReportError message="Could not load Budget vs Actual. The budget may have been deleted, or the accounting schema is not exposed for your role." />}
      {!isPending && !isError && data && !hasRows && (
        <ReportEmpty
          icon="savings"
          note="This budget has no planned amounts and no posted activity for its fiscal year. Add budget lines in the editor, or post journal activity, then check back."
        />
      )}

      {!isPending && !isError && data && hasRows && (
        <LedgerTable
          columns={[
            { label: 'Account' },
            { label: 'Budget', align: 'right' },
            { label: 'Actual', align: 'right' },
            { label: 'Variance', align: 'right' },
          ]}
        >
          {data.rows.map((row) => (
            <AccountRow key={row.accountId} row={row} />
          ))}
          <tr className="border-t border-white/10 bg-white/5">
            <td className="px-3 py-2 font-bold text-white">Total</td>
            <MoneyCell amount={data.totalBudget} strong />
            <MoneyCell amount={data.totalActual} strong />
            <VarianceCell amount={data.totalVariance} />
          </tr>
        </LedgerTable>
      )}
    </ReportPage>
  );
}

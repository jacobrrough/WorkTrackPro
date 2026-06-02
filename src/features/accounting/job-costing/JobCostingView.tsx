import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AccountingShell } from '../components/AccountingShell';
import { useJobCosting } from '../hooks/useAccountingQueries';
import { marginPct, sortJobCosting, totalJobCosting } from '../jobCosting';
import { formatMoney } from '../accountingViewModel';
import { JOB_COSTING_BASE } from '../constants';
import type { JobCostingRow, JobCostingSortKey, SortDirection } from '../types';

/**
 * B1 — Job-costing dashboard. A read-only, sortable list of per-job profitability
 * sourced from `accounting.v_job_costing` (no money moves here). Reuses the dark
 * theme + AccountingShell; the table mirrors LedgerTable's styling but adds
 * clickable, sortable headers (LedgerTable's column API is label-only). Sorting and
 * the margin-% / totals math live in the pure ../jobCosting helpers (integer cents).
 *
 * Two captions per the API lane's notes: labor cost is an estimate, and revenue
 * counts non-void invoices (drafts included). Job costing is operational
 * profitability, not a tax/report-export surface, so the CPA/EA disclaimer is N/A.
 */

interface Column {
  key: JobCostingSortKey;
  label: string;
  align: 'left' | 'right';
  /** Numeric columns default to descending on first click; text to ascending. */
  numeric: boolean;
}

const COLUMNS: Column[] = [
  { key: 'name', label: 'Job', align: 'left', numeric: false },
  { key: 'status', label: 'Status', align: 'left', numeric: false },
  { key: 'revenue', label: 'Revenue', align: 'right', numeric: true },
  { key: 'materialCost', label: 'Material', align: 'right', numeric: true },
  { key: 'laborCost', label: 'Labor', align: 'right', numeric: true },
  { key: 'margin', label: 'Margin', align: 'right', numeric: true },
  { key: 'marginPct', label: 'Margin %', align: 'right', numeric: true },
];

/** Right-aligned, tabular money cell; negatives turn red (matches the report tables). */
function MoneyCell({ amount, strong = false }: { amount: number; strong?: boolean }) {
  const negative = amount < 0;
  return (
    <td
      className={`px-3 py-2 text-right font-mono tabular-nums ${
        strong ? 'font-bold text-white' : negative ? 'text-red-400' : 'text-slate-200'
      }`}
    >
      {formatMoney(amount)}
    </td>
  );
}

/** Margin % cell: em-dash when undefined (zero revenue), red when negative. */
function MarginPctCell({ value, strong = false }: { value: number | null; strong?: boolean }) {
  if (value === null) {
    return <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-500">—</td>;
  }
  const negative = value < 0;
  return (
    <td
      className={`px-3 py-2 text-right font-mono tabular-nums ${
        strong ? 'font-bold text-white' : negative ? 'text-red-400' : 'text-slate-200'
      }`}
    >
      {value.toFixed(1)}%
    </td>
  );
}

export default function JobCostingView() {
  const navigate = useNavigate();
  const { data: rows = [], isPending, isError } = useJobCosting();
  const [sortKey, setSortKey] = useState<JobCostingSortKey>('margin');
  const [direction, setDirection] = useState<SortDirection>('desc');

  const sorted = useMemo(
    () => sortJobCosting(rows, sortKey, direction),
    [rows, sortKey, direction]
  );
  const totals = useMemo(() => totalJobCosting(rows), [rows]);

  const onSort = (col: Column) => {
    if (col.key === sortKey) {
      setDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(col.key);
      setDirection(col.numeric ? 'desc' : 'asc');
    }
  };

  const openJob = (row: JobCostingRow) => navigate(`${JOB_COSTING_BASE}/${row.jobId}`);

  return (
    <AccountingShell active="job-costing" title="Job costing">
      {isPending && <p className="text-slate-400">Loading job costing…</p>}
      {isError && (
        <p className="text-red-400">
          Could not load job costing. Confirm the accounting schema is exposed and you have an
          accounting role.
        </p>
      )}

      {!isPending && !isError && rows.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-sm border border-dashed border-white/15 px-6 py-16 text-center">
          <span className="material-symbols-outlined text-4xl text-slate-500">query_stats</span>
          <p className="text-lg font-bold text-white">No job costing yet</p>
          <p className="max-w-sm text-sm text-slate-400">
            Profitability appears here once a job has logged labor, consumed materials, or been
            invoiced. Each row compares a job&apos;s revenue against its material and labor cost.
          </p>
        </div>
      )}

      {!isPending && !isError && rows.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-slate-400">
            Per-job profitability: revenue minus material and labor cost. Tap a column to sort, or a
            row to drill into a job&apos;s invoices and bills.
          </p>

          <div className="overflow-x-auto rounded-sm border border-white/10">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/5 text-slate-400">
                  {COLUMNS.map((c) => {
                    const isActive = c.key === sortKey;
                    return (
                      <th
                        key={c.key}
                        aria-sort={
                          isActive ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'
                        }
                        className={`px-3 py-2 font-semibold ${c.align === 'right' ? 'text-right' : 'text-left'}`}
                      >
                        <button
                          type="button"
                          onClick={() => onSort(c)}
                          className={`inline-flex items-center gap-1 hover:text-white ${
                            c.align === 'right' ? 'flex-row-reverse' : ''
                          } ${isActive ? 'text-white' : ''}`}
                        >
                          <span>{c.label}</span>
                          <span className="material-symbols-outlined text-sm leading-none">
                            {isActive
                              ? direction === 'asc'
                                ? 'arrow_upward'
                                : 'arrow_downward'
                              : 'unfold_more'}
                          </span>
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => (
                  <tr
                    key={row.jobId}
                    onClick={() => openJob(row)}
                    className="cursor-pointer border-t border-white/5 hover:bg-white/5"
                  >
                    <td className="px-3 py-2">
                      <span className="block truncate font-medium text-white">{row.name}</span>
                      {row.jobCode && (
                        <span className="block font-mono text-xs text-slate-500">
                          {row.jobCode}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-300">{row.status ?? '—'}</td>
                    <MoneyCell amount={row.revenue} />
                    <MoneyCell amount={row.materialCost} />
                    <MoneyCell amount={row.laborCost} />
                    <MoneyCell amount={row.margin} />
                    <MarginPctCell value={marginPct(row)} />
                  </tr>
                ))}
                {/* Grand totals (blended margin %), summed in integer cents. */}
                <tr className="border-t border-white/10 bg-white/5">
                  <td className="px-3 py-2 font-bold text-white" colSpan={2}>
                    {sorted.length} {sorted.length === 1 ? 'job' : 'jobs'}
                  </td>
                  <MoneyCell amount={totals.revenue} strong />
                  <MoneyCell amount={totals.materialCost} strong />
                  <MoneyCell amount={totals.laborCost} strong />
                  <MoneyCell amount={totals.margin} strong />
                  <MarginPctCell value={totals.marginPct} strong />
                </tr>
              </tbody>
            </table>
          </div>

          <p className="text-xs leading-relaxed text-slate-500">
            <span className="font-semibold text-slate-400">How these are figured:</span> Labor cost
            is an estimate (worked minutes ÷ 60 × the org labor rate); authoritative costing lives
            in each job&apos;s quote. Revenue counts every non-void invoice — including unsent
            drafts — so it can exceed sent or paid revenue.
          </p>
        </div>
      )}
    </AccountingShell>
  );
}

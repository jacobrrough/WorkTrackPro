import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { AccountingShell } from '../components/AccountingShell';
import { CurrencyInput } from '../components/CurrencyInput';
import { useBudgetGrid } from '../hooks/useAccountingQueries';
import { useSaveBudgetLines } from '../hooks/useAccountingMutations';
import { formatMoney, toCents } from '../accountingViewModel';
import { BUDGETS_BASE, budgetVsActualPath } from '../constants';
import { BVA_TYPE_ORDER } from '../reports/budgetMath';
import {
  ACCOUNT_TYPE_LABELS,
  BUDGET_MONTH_LABELS,
  BUDGET_MONTHS,
  BUDGET_STATUS_LABELS,
  type AccountType,
  type BudgetCellInput,
  type BudgetGridRow,
} from '../types';

/** Local editable state: accountId -> 12 dollar amounts (index 0 = Jan … 11 = Dec). */
type CellMap = Map<string, number[]>;

/** Seed the editable map from the server grid rows (dense 12-slot dollar arrays). */
function seedCells(rows: BudgetGridRow[]): CellMap {
  const map: CellMap = new Map();
  for (const row of rows) {
    // Copy so edits never mutate the query cache's array.
    map.set(row.accountId, [...row.monthly]);
  }
  return map;
}

/** Σ a 12-slot dollar array in integer cents, returned as dollars (G6: no float sums). */
function sumDollars(values: number[]): number {
  let cents = 0;
  for (const v of values) cents += toCents(v);
  return cents / 100;
}

/** Sortable account-number compare (nulls last), matching the report ordering. */
function byAccountNumber(a: BudgetGridRow, b: BudgetGridRow): number {
  return (a.accountNumber ?? '').localeCompare(b.accountNumber ?? '');
}

/**
 * D2 — Budget editor grid. Renders every active chart account as a row of 12 monthly
 * CurrencyInputs for the selected budget's fiscal year, with live per-row, per-month and
 * grand totals. Saving replaces the budget's lines with exactly the non-zero cells (a
 * cleared cell is simply not persisted) via useSaveBudgetLines — budgets move no money, so
 * nothing here posts a journal entry. Accounts are grouped by type (income/expense first)
 * to mirror how the statements read.
 */
export default function BudgetEditorView() {
  const { budgetId } = useParams<{ budgetId: string }>();
  const navigate = useNavigate();
  const { data: grid, isPending, isError } = useBudgetGrid(budgetId);
  const saveLines = useSaveBudgetLines();

  const [cells, setCells] = useState<CellMap>(new Map());
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // (Re)seed local state whenever fresh grid data arrives. Keyed on the budget id +
  // a cheap signature of the row totals so an external refetch (e.g. after save) resets
  // the dirty flag, but typing does not clobber itself.
  const seedSignature = useMemo(() => {
    if (!grid) return '';
    return grid.rows.map((r) => `${r.accountId}:${r.total}`).join('|');
  }, [grid]);

  useEffect(() => {
    if (!grid) return;
    setCells(seedCells(grid.rows));
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [budgetId, seedSignature]);

  // Group + order the rows by account type (income/expense first) then account number.
  const grouped = useMemo(() => {
    if (!grid) return [] as { type: AccountType; rows: BudgetGridRow[] }[];
    const byType = new Map<AccountType, BudgetGridRow[]>();
    for (const row of grid.rows) {
      const list = byType.get(row.accountType) ?? [];
      list.push(row);
      byType.set(row.accountType, list);
    }
    return BVA_TYPE_ORDER.filter((t) => byType.has(t)).map((type) => ({
      type,
      rows: (byType.get(type) ?? []).slice().sort(byAccountNumber),
    }));
  }, [grid]);

  // Live totals from the editable cells (all summed in cents).
  const { monthlyTotals, grandTotal } = useMemo(() => {
    const months = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    let grandCents = 0;
    for (const values of cells.values()) {
      for (let i = 0; i < 12; i++) {
        const c = toCents(values[i] ?? 0);
        months[i] += c;
        grandCents += c;
      }
    }
    return {
      monthlyTotals: months.map((c) => c / 100),
      grandTotal: grandCents / 100,
    };
  }, [cells]);

  const setCell = (accountId: string, monthIdx: number, value: number) => {
    setCells((prev) => {
      const next = new Map(prev);
      const row = next.get(accountId) ?? [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      const copy = [...row];
      copy[monthIdx] = value;
      next.set(accountId, copy);
      return next;
    });
    setDirty(true);
    setSavedAt(null);
  };

  const onSave = async () => {
    if (!budgetId) return;
    setSaveError(null);
    const flat: BudgetCellInput[] = [];
    for (const [accountId, values] of cells.entries()) {
      for (let i = 0; i < 12; i++) {
        const amount = values[i] ?? 0;
        if (toCents(amount) !== 0) {
          flat.push({ accountId, periodMonth: i + 1, amount });
        }
      }
    }
    const result = await saveLines.mutateAsync({ budgetId, cells: flat });
    if (!result.ok) {
      setSaveError(result.error ?? 'Could not save the budget. Check your accounting role.');
      return;
    }
    setDirty(false);
    setSavedAt(Date.now());
  };

  const onReset = () => {
    if (!grid) return;
    setCells(seedCells(grid.rows));
    setDirty(false);
    setSaveError(null);
    setSavedAt(null);
  };

  const budget = grid?.budget;

  return (
    <AccountingShell
      active="budgets"
      title={budget ? budget.name : 'Budget'}
      actions={
        budget ? (
          <Button
            size="sm"
            variant="secondary"
            icon="analytics"
            onClick={() => navigate(budgetVsActualPath(budget.id))}
          >
            vs Actual
          </Button>
        ) : undefined
      }
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <button
          type="button"
          onClick={() => navigate(BUDGETS_BASE)}
          className="flex items-center gap-1 self-start text-sm font-semibold text-muted hover:text-white"
        >
          <span className="material-symbols-outlined text-lg">arrow_back</span>
          All budgets
        </button>

        {isPending && <p className="text-muted">Loading budget…</p>}
        {isError && (
          <p className="text-red-400" role="alert">
            Could not load this budget. It may have been deleted, or the accounting schema is not
            exposed for your role.
          </p>
        )}

        {!isPending && !isError && grid && (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-white">{grid.budget.name}</h2>
                <p className="text-sm text-muted">
                  FY {grid.budget.fiscalYear} · {BUDGET_STATUS_LABELS[grid.budget.status]} · planned
                  amounts by account and month
                </p>
              </div>
              <div className="flex items-center gap-2">
                {savedAt && !dirty && (
                  <span className="flex items-center gap-1 text-xs font-semibold text-emerald-400">
                    <span className="material-symbols-outlined text-sm">check_circle</span>
                    Saved
                  </span>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onReset}
                  disabled={!dirty || saveLines.isPending}
                >
                  Reset
                </Button>
                <Button
                  size="sm"
                  icon="save"
                  onClick={onSave}
                  disabled={!dirty || saveLines.isPending}
                >
                  {saveLines.isPending ? 'Saving…' : 'Save budget'}
                </Button>
              </div>
            </div>

            {saveError && (
              <p
                className="rounded-sm border border-red-500/30 bg-red-500/10 p-2 text-sm text-red-300"
                role="alert"
              >
                {saveError}
              </p>
            )}

            {grid.rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 rounded-sm border border-dashed border-white/15 px-6 py-16 text-center">
                <span className="material-symbols-outlined text-4xl text-subtle">account_tree</span>
                <p className="text-lg font-bold text-white">No accounts to budget</p>
                <p className="max-w-sm text-sm text-muted">
                  There are no active accounts in the chart of accounts. Add accounts first, then
                  return here to enter planned amounts.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-sm border border-white/10">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/5 text-muted">
                      <th className="sticky left-0 z-10 bg-app-2 px-3 py-2 text-left font-semibold">
                        Account
                      </th>
                      {BUDGET_MONTHS.map((m) => (
                        <th key={m} className="px-2 py-2 text-right font-semibold">
                          {BUDGET_MONTH_LABELS[m]}
                        </th>
                      ))}
                      <th className="px-3 py-2 text-right font-semibold">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grouped.map((group) => (
                      <BudgetTypeGroup
                        key={group.type}
                        type={group.type}
                        rows={group.rows}
                        cells={cells}
                        onCellChange={setCell}
                      />
                    ))}
                    {/* Grand totals row */}
                    <tr className="border-t border-white/10 bg-white/5">
                      <td className="sticky left-0 z-10 bg-surface px-3 py-2 font-bold text-white">
                        All accounts
                      </td>
                      {monthlyTotals.map((t, i) => (
                        <td
                          key={i}
                          className="px-2 py-2 text-right font-mono text-xs font-bold tabular-nums text-white"
                        >
                          {formatMoney(t)}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right font-mono text-sm font-bold tabular-nums text-white">
                        {formatMoney(grandTotal)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            <p className="text-xs text-subtle">
              Cleared (zero) cells are not stored — only the non-zero plan is saved. Totals update
              as you type; click <span className="font-semibold text-muted">Save budget</span> to
              persist.
            </p>
          </>
        )}
      </div>
    </AccountingShell>
  );
}

/** A labeled section of account rows for one account type. */
function BudgetTypeGroup({
  type,
  rows,
  cells,
  onCellChange,
}: {
  type: AccountType;
  rows: BudgetGridRow[];
  cells: CellMap;
  onCellChange: (accountId: string, monthIdx: number, value: number) => void;
}) {
  // Per-month subtotal for the group (in cents → dollars).
  const subtotalMonthly = useMemo(() => {
    const months = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (const row of rows) {
      const values = cells.get(row.accountId);
      if (!values) continue;
      for (let i = 0; i < 12; i++) months[i] += toCents(values[i] ?? 0);
    }
    return months.map((c) => c / 100);
  }, [rows, cells]);

  const groupTotal = sumDollars(subtotalMonthly);

  return (
    <>
      <tr className="bg-white/[0.03]">
        <td
          className="sticky left-0 z-10 bg-app-2 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-muted"
          colSpan={14}
        >
          {ACCOUNT_TYPE_LABELS[type]}
        </td>
      </tr>
      {rows.map((row) => {
        const values = cells.get(row.accountId) ?? row.monthly;
        const rowTotal = sumDollars(values);
        return (
          <tr key={row.accountId} className="border-t border-white/5">
            <td className="sticky left-0 z-10 bg-background-dark px-3 py-1.5 text-white">
              {row.accountNumber ? (
                <span className="mr-2 font-mono text-xs text-subtle">{row.accountNumber}</span>
              ) : null}
              {row.accountName}
            </td>
            {BUDGET_MONTHS.map((m, i) => (
              <td key={m} className="px-1 py-1">
                <CurrencyInput
                  aria-label={`${row.accountName} ${BUDGET_MONTH_LABELS[m]}`}
                  value={values[i] ?? 0}
                  onValueChange={(v) => onCellChange(row.accountId, i, v)}
                  className="min-w-[5.5rem] text-xs"
                />
              </td>
            ))}
            <td className="px-3 py-1.5 text-right font-mono text-xs tabular-nums text-muted">
              {formatMoney(rowTotal)}
            </td>
          </tr>
        );
      })}
      {/* Group subtotal */}
      <tr className="border-t border-white/5 bg-white/[0.02]">
        <td className="sticky left-0 z-10 bg-app-2 px-3 py-1.5 text-right text-xs font-semibold text-muted">
          {ACCOUNT_TYPE_LABELS[type]} subtotal
        </td>
        {subtotalMonthly.map((t, i) => (
          <td
            key={i}
            className="px-2 py-1.5 text-right font-mono text-[11px] tabular-nums text-muted"
          >
            {formatMoney(t)}
          </td>
        ))}
        <td className="px-3 py-1.5 text-right font-mono text-xs font-semibold tabular-nums text-muted">
          {formatMoney(groupTotal)}
        </td>
      </tr>
    </>
  );
}

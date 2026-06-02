import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { AccountingShell } from '../components/AccountingShell';
import { useBudgets } from '../hooks/useAccountingQueries';
import {
  useCreateBudget,
  useDeleteBudget,
  useSetBudgetStatus,
} from '../hooks/useAccountingMutations';
import {
  budgetEditorPath,
  budgetVsActualPath,
  cashFlowForecastPath,
} from '../constants';
import {
  BUDGET_STATUS_LABELS,
  BUDGET_STATUSES,
  type Budget,
  type BudgetStatus,
  type NewBudgetInput,
} from '../types';

const inputClass =
  'w-full rounded-sm border border-white/10 bg-background-dark px-2 py-1.5 text-white focus:border-primary focus:outline-none';

/** Lifecycle pill — grey draft, green active, slate archived. */
function StatusBadge({ status }: { status: BudgetStatus }) {
  const cls =
    status === 'active'
      ? 'bg-emerald-500/15 text-emerald-300'
      : status === 'draft'
        ? 'bg-amber-500/15 text-amber-300'
        : 'bg-slate-500/15 text-slate-400';
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>
      {BUDGET_STATUS_LABELS[status]}
    </span>
  );
}

/** Dialog to create a new budget (a named plan for a fiscal year). */
function NewBudgetModal({ onClose }: { onClose: (createdId?: string) => void }) {
  const createBudget = useCreateBudget();
  const currentYear = new Date().getFullYear();
  const [name, setName] = useState('');
  const [fiscalYear, setFiscalYear] = useState(currentYear);
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Give the budget a name.');
      return;
    }
    const input: NewBudgetInput = {
      name: trimmed,
      fiscalYear,
      description: description.trim() || null,
    };
    const result = await createBudget.mutateAsync(input);
    if (!result.budget) {
      setError(result.error ?? 'Could not create the budget. Check your accounting role.');
      return;
    }
    onClose(result.budget.id);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-sm border border-white/10 bg-card-dark p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">New budget</h2>
          <button
            type="button"
            onClick={() => onClose()}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-sm text-slate-400 hover:bg-white/10 hover:text-white"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <p className="mb-3 text-sm text-slate-400">
          A budget is a plan for one fiscal year. After creating it, fill in the monthly amounts per
          account in the editor grid.
        </p>

        <div className="flex flex-col gap-3">
          <FormField label="Name" htmlFor="budget-name" required>
            <input
              id="budget-name"
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Operating budget"
            />
          </FormField>

          <FormField
            label="Fiscal year"
            htmlFor="budget-fy"
            required
            hint="The calendar year this plan covers."
          >
            <input
              id="budget-fy"
              type="number"
              inputMode="numeric"
              min={2000}
              max={2100}
              step={1}
              className={inputClass}
              value={fiscalYear}
              onChange={(e) => {
                const n = Number.parseInt(e.target.value, 10);
                setFiscalYear(Number.isFinite(n) ? n : currentYear);
              }}
            />
          </FormField>

          <FormField label="Description" htmlFor="budget-desc" hint="Optional">
            <input
              id="budget-desc"
              className={inputClass}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional note"
            />
          </FormField>

          {error && (
            <p className="text-sm text-red-400" role="alert">
              {error}
            </p>
          )}

          <div className="mt-1 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onClose()}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={createBudget.isPending || !name.trim()}>
              {createBudget.isPending ? 'Creating…' : 'Create budget'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function BudgetCard({ budget }: { budget: Budget }) {
  const navigate = useNavigate();
  const setStatus = useSetBudgetStatus();
  const deleteBudget = useDeleteBudget();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = setStatus.isPending || deleteBudget.isPending;

  const onDelete = async () => {
    setError(null);
    const result = await deleteBudget.mutateAsync(budget.id);
    if (!result.ok) {
      setError(result.error ?? 'Could not delete the budget.');
      setConfirmDelete(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-sm border border-white/10 bg-card-dark p-3">
      <div className="flex items-start gap-3">
        <span className="material-symbols-outlined mt-0.5 text-xl text-primary">savings</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate(budgetEditorPath(budget.id))}
              className="truncate text-left text-base font-bold text-white hover:text-primary"
            >
              {budget.name}
            </button>
            <StatusBadge status={budget.status} />
          </div>
          <p className="text-xs text-slate-400">
            FY {budget.fiscalYear}
            {budget.description ? ` · ${budget.description}` : ''}
          </p>
        </div>
      </div>

      {/* Status switcher */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-slate-500">Status:</span>
        {BUDGET_STATUSES.map((s) => {
          const active = budget.status === s;
          return (
            <button
              key={s}
              type="button"
              disabled={busy || active}
              onClick={() => setStatus.mutate({ id: budget.id, status: s })}
              aria-pressed={active}
              className={`rounded-sm px-2 py-0.5 font-semibold transition-colors disabled:cursor-default ${
                active
                  ? 'bg-primary text-white'
                  : 'bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white disabled:opacity-50'
              }`}
            >
              {BUDGET_STATUS_LABELS[s]}
            </button>
          );
        })}
      </div>

      {error && (
        <p className="text-xs text-red-400" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/5 pt-2">
        {confirmDelete ? (
          <>
            <span className="mr-auto text-xs text-slate-400">Delete this budget and its lines?</span>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" variant="danger" icon="delete" onClick={onDelete} disabled={busy}>
              {deleteBudget.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              variant="ghost"
              icon="delete"
              onClick={() => setConfirmDelete(true)}
              disabled={busy}
            >
              Delete
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon="analytics"
              onClick={() => navigate(budgetVsActualPath(budget.id))}
              disabled={busy}
            >
              Budget vs Actual
            </Button>
            <Button
              size="sm"
              icon="edit"
              onClick={() => navigate(budgetEditorPath(budget.id))}
              disabled={busy}
            >
              Edit grid
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * D2 — Budgets index. Lists every saved budget (newest fiscal year first) with its
 * lifecycle status, a create dialog, and per-budget links into the editor grid and the
 * Budget-vs-Actual report. The cash-flow forecast is budget-independent (it projects from
 * open AR/AP), so it gets its own top-level entry here. Budgets move no money — nothing on
 * this surface posts a journal entry.
 */
export default function BudgetsView() {
  const navigate = useNavigate();
  const { data: budgets = [], isPending, isError } = useBudgets();
  const [showCreate, setShowCreate] = useState(false);

  const sorted = useMemo(() => budgets, [budgets]);

  return (
    <AccountingShell
      active="budgets"
      title="Budgets"
      actions={
        <Button size="sm" icon="add" onClick={() => setShowCreate(true)}>
          New budget
        </Button>
      }
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <p className="text-sm text-slate-400">
          Plan monthly amounts per account for a fiscal year, then compare your plan against posted
          actuals. Budgets are planning artifacts — saving one posts no journal entry.
        </p>

        {/* Cash-flow forecast — independent of any single budget */}
        <button
          type="button"
          onClick={() => navigate(cashFlowForecastPath())}
          className="flex items-center gap-3 rounded-sm border border-white/10 bg-card-dark px-3 py-2.5 text-left hover:border-primary/30"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-primary/15 text-primary">
            <span className="material-symbols-outlined text-lg">waterfall_chart</span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-white">Cash-flow forecast</span>
            <span className="block text-xs text-slate-500">
              Project cash in from open invoices minus cash out for open bills, by due date.
            </span>
          </span>
          <span className="material-symbols-outlined text-slate-600">chevron_right</span>
        </button>

        {isPending && <p className="text-slate-400">Loading budgets…</p>}
        {isError && (
          <p className="text-red-400">
            Could not load budgets. Confirm the accounting schema is exposed and you have an
            accounting role.
          </p>
        )}

        {!isPending && !isError && sorted.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 rounded-sm border border-dashed border-white/15 px-6 py-16 text-center">
            <span className="material-symbols-outlined text-4xl text-slate-500">savings</span>
            <p className="text-lg font-bold text-white">No budgets yet</p>
            <p className="max-w-sm text-sm text-slate-400">
              Create a budget for a fiscal year, then enter your planned monthly amounts per account.
              Budget-vs-Actual will compare it to your posted journal activity.
            </p>
            <Button size="sm" icon="add" onClick={() => setShowCreate(true)}>
              New budget
            </Button>
          </div>
        )}

        {!isPending && !isError && sorted.length > 0 && (
          <div className="flex flex-col gap-3">
            {sorted.map((budget) => (
              <BudgetCard key={budget.id} budget={budget} />
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <NewBudgetModal
          onClose={(createdId) => {
            setShowCreate(false);
            // Jump straight into the editor for a freshly created budget.
            if (createdId) navigate(budgetEditorPath(createdId));
          }}
        />
      )}
    </AccountingShell>
  );
}

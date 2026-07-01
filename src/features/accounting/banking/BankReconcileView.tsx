import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { AccountingShell } from '../components/AccountingShell';
import { CurrencyInput } from '../components/CurrencyInput';
import { useBankAccount, useReconciliations } from '../hooks/useAccountingQueries';
import { useCreateReconciliation } from '../hooks/useAccountingMutations';
import { formatMoney } from '../accountingViewModel';
import { BANKING_BASE } from '../constants';
import type { NewReconciliationInput, Reconciliation } from '../types';

const inputClass =
  'w-full rounded-lg border border-line bg-background-dark px-2 py-1.5 text-white focus:border-primary focus:outline-none';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Dialog to start a reconciliation. Beginning balance chains from the prior one. */
function NewReconciliationModal({
  bankAccountId,
  onClose,
  onCreated,
}: {
  bankAccountId: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const create = useCreateReconciliation();
  const [statementDate, setStatementDate] = useState(todayISO());
  const [endingBalance, setEndingBalance] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!statementDate) {
      setError('Choose the statement date.');
      return;
    }
    const input: NewReconciliationInput = {
      bankAccountId,
      statementDate,
      statementEndingBalance: endingBalance,
    };
    const res = await create.mutateAsync(input);
    if (res.error || !res.reconciliation) {
      setError(res.error ?? 'Could not start the reconciliation.');
      return;
    }
    onCreated(res.reconciliation.id);
  };

  return (
    <div className="app-modal-backdrop z-modal p-4">
      <div className="w-full max-w-md rounded-2xl border border-line bg-card-dark p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">Start Reconciliation</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-overlay/10 hover:text-white"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <p className="mb-3 text-sm text-muted">
          Enter the closing date and ending balance from your statement. The beginning balance is
          carried over from your last completed reconciliation.
        </p>

        <div className="flex flex-col gap-3">
          <FormField label="Statement date" htmlFor="rec-date" required>
            <input
              id="rec-date"
              type="date"
              className={inputClass}
              value={statementDate}
              onChange={(e) => setStatementDate(e.target.value)}
            />
          </FormField>
          <FormField
            label="Statement ending balance"
            htmlFor="rec-ending"
            hint="The closing balance printed on the statement."
          >
            <CurrencyInput
              id="rec-ending"
              aria-label="Statement ending balance"
              value={endingBalance}
              onValueChange={setEndingBalance}
            />
          </FormField>

          {error && (
            <p className="text-sm text-red-400" role="alert">
              {error}
            </p>
          )}

          <div className="mt-1 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={create.isPending || !statementDate}>
              {create.isPending ? 'Starting…' : 'Start'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReconciliationRow({ rec, onOpen }: { rec: Reconciliation; onOpen: () => void }) {
  const done = rec.status === 'completed';
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-overlay/5"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-overlay/5 text-muted">
        <span className="material-symbols-outlined text-lg">
          {done ? 'check_circle' : 'balance'}
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-white">
          Statement {rec.statementDate}
        </span>
        <span className="block truncate text-xs text-subtle">
          Ending{' '}
          {rec.statementEndingBalance == null ? '—' : formatMoney(rec.statementEndingBalance)}
        </span>
      </span>
      <span
        className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
          done ? 'bg-green-500/15 text-green-400' : 'bg-sky-500/15 text-sky-400'
        }`}
      >
        {done ? 'Completed' : 'In progress'}
      </span>
      <span className="material-symbols-outlined text-subtle">chevron_right</span>
    </button>
  );
}

export default function BankReconcileView() {
  const { bankAccountId } = useParams<{ bankAccountId: string }>();
  const navigate = useNavigate();
  const { data: account } = useBankAccount(bankAccountId);
  const { data: reconciliations = [], isPending, isError } = useReconciliations(bankAccountId);
  const [showCreate, setShowCreate] = useState(false);

  const openDetail = (id: string) => navigate(`${BANKING_BASE}/${bankAccountId}/reconcile/${id}`);

  return (
    <AccountingShell
      active="banking"
      title="Reconcile"
      actions={
        bankAccountId ? (
          <Button size="sm" icon="add" onClick={() => setShowCreate(true)}>
            New reconciliation
          </Button>
        ) : undefined
      }
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <button
          type="button"
          onClick={() => navigate(`${BANKING_BASE}/${bankAccountId}`)}
          className="flex items-center gap-1 self-start text-sm font-semibold text-muted hover:text-white"
        >
          <span className="material-symbols-outlined text-lg">arrow_back</span>
          {account ? account.name : 'Back to account'}
        </button>

        <p className="text-sm text-muted">
          Reconcile your books to a bank statement: mark each transaction that appears on the
          statement as cleared until the difference reaches 0.00, then complete it. Reconciling does
          not post entries — it confirms what already posted.
        </p>

        {isPending && <p className="text-muted">Loading reconciliations…</p>}
        {isError && <p className="text-red-400">Could not load reconciliations.</p>}

        {!isPending && !isError && reconciliations.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-line px-6 py-16 text-center">
            <span className="material-symbols-outlined text-4xl text-subtle">balance</span>
            <p className="text-lg font-bold text-white">No reconciliations yet</p>
            <p className="max-w-sm text-sm text-muted">
              Start a reconciliation with your statement’s closing date and ending balance to begin
              matching transactions.
            </p>
            {bankAccountId && (
              <Button size="sm" icon="add" onClick={() => setShowCreate(true)}>
                New reconciliation
              </Button>
            )}
          </div>
        )}

        {reconciliations.length > 0 && (
          <div className="divide-y divide-overlay/5 overflow-hidden rounded-lg border border-line">
            {reconciliations.map((rec) => (
              <ReconciliationRow key={rec.id} rec={rec} onOpen={() => openDetail(rec.id)} />
            ))}
          </div>
        )}
      </div>

      {showCreate && bankAccountId && (
        <NewReconciliationModal
          bankAccountId={bankAccountId}
          onClose={() => setShowCreate(false)}
          onCreated={(id) => {
            setShowCreate(false);
            openDetail(id);
          }}
        />
      )}
    </AccountingShell>
  );
}

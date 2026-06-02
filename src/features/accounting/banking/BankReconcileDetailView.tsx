import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { AccountingShell } from '../components/AccountingShell';
import {
  useBankTransactions,
  useReconciliation,
  useReconciliationSummary,
} from '../hooks/useAccountingQueries';
import {
  useCompleteReconciliation,
  useSetTransactionCleared,
} from '../hooks/useAccountingMutations';
import { formatMoney } from '../accountingViewModel';
import { BANKING_BASE } from '../constants';
import type { BankTransaction, ReconciliationSummary } from '../types';
import { SignedAmount, TxnStatusPill } from './bankingFormat';

/** A summary stat tile (beginning / cleared / ending / difference). */
function Stat({
  label,
  children,
  emphasis,
}: {
  label: string;
  children: ReactNode;
  emphasis?: 'good' | 'bad';
}) {
  const tone =
    emphasis === 'good' ? 'text-green-400' : emphasis === 'bad' ? 'text-amber-400' : 'text-white';
  return (
    <div className="rounded-sm border border-white/10 bg-card-dark px-3 py-2">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`font-mono text-base font-bold tabular-nums ${tone}`}>{children}</div>
    </div>
  );
}

function SummaryPanel({ summary }: { summary: ReconciliationSummary }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Stat label="Beginning">{formatMoney(summary.beginningBalance)}</Stat>
      <Stat label={`Cleared (${summary.clearedCount})`}>{formatMoney(summary.clearedAmount)}</Stat>
      <Stat label="Statement end">{formatMoney(summary.statementEndingBalance)}</Stat>
      <Stat label="Difference" emphasis={summary.reconciled ? 'good' : 'bad'}>
        {formatMoney(summary.difference)}
      </Stat>
    </div>
  );
}

function ClearableRow({
  txn,
  reconciliationId,
  locked,
}: {
  txn: BankTransaction;
  reconciliationId: string;
  locked: boolean;
}) {
  const setCleared = useSetTransactionCleared();
  const [error, setError] = useState<string | null>(null);

  // Cleared into THIS reconciliation. (Rows cleared into another statement are filtered out upstream.)
  const cleared = txn.reconciliationId === reconciliationId;

  const onToggle = async () => {
    setError(null);
    const res = await setCleared.mutateAsync({
      reconciliationId,
      bankTransactionId: txn.id,
      cleared: !cleared,
    });
    if (!res.ok) setError(res.error ?? 'Could not update.');
  };

  return (
    <div className="flex flex-col gap-1 px-3 py-2.5">
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={cleared}
          disabled={locked || setCleared.isPending}
          onChange={onToggle}
          aria-label={`Clear ${txn.description ?? 'transaction'}`}
          className="size-4 shrink-0 accent-primary disabled:opacity-40"
        />
        <span className="w-20 shrink-0 text-xs text-slate-500">{txn.txnDate}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-white">
          {txn.description || txn.merchant || 'Transaction'}
        </span>
        <TxnStatusPill status={txn.status} />
        <SignedAmount amount={txn.amount} className="w-28 shrink-0 text-right text-sm" />
      </label>
      {error && (
        <p className="pl-7 text-xs text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export default function BankReconcileDetailView() {
  const { bankAccountId, reconciliationId } = useParams<{
    bankAccountId: string;
    reconciliationId: string;
  }>();
  const navigate = useNavigate();

  const {
    data: rec,
    isPending: recLoading,
    isError: recError,
  } = useReconciliation(reconciliationId);
  const { data: summary } = useReconciliationSummary(reconciliationId);
  // All transactions for the account; we surface those clearable against this statement.
  const { data: allTxns = [], isPending: txnsLoading } = useBankTransactions(bankAccountId);
  const complete = useCompleteReconciliation();
  const [completeError, setCompleteError] = useState<string | null>(null);

  const locked = rec?.status === 'completed';

  // Clearable here = excludes excluded rows and rows already cleared into a DIFFERENT
  // reconciliation. Cleared-into-this-one rows stay so they can be unchecked.
  const rows = useMemo(
    () =>
      allTxns.filter((t) => {
        if (t.status === 'excluded') return false;
        if (t.reconciliationId && t.reconciliationId !== reconciliationId) return false;
        return true;
      }),
    [allTxns, reconciliationId]
  );

  const onComplete = async () => {
    if (!reconciliationId) return;
    setCompleteError(null);
    const res = await complete.mutateAsync(reconciliationId);
    if (res.error) setCompleteError(res.error);
  };

  const canComplete = !locked && summary?.reconciled === true;

  return (
    <AccountingShell
      active="banking"
      title={rec ? `Reconcile ${rec.statementDate}` : 'Reconcile'}
      actions={
        rec && !locked ? (
          <Button
            size="sm"
            icon="check_circle"
            onClick={onComplete}
            disabled={!canComplete || complete.isPending}
          >
            {complete.isPending ? 'Completing…' : 'Complete'}
          </Button>
        ) : undefined
      }
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <button
          type="button"
          onClick={() => navigate(`${BANKING_BASE}/${bankAccountId}/reconcile`)}
          className="flex items-center gap-1 self-start text-sm font-semibold text-slate-400 hover:text-white"
        >
          <span className="material-symbols-outlined text-lg">arrow_back</span>
          Reconciliations
        </button>

        {recLoading && <p className="text-slate-400">Loading reconciliation…</p>}
        {recError && <p className="text-red-400">Could not load this reconciliation.</p>}
        {!recLoading && !recError && !rec && (
          <p className="text-slate-400">Reconciliation not found.</p>
        )}

        {rec && (
          <>
            {locked && (
              <div className="rounded-sm border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-300">
                This reconciliation is complete and locked. Transactions cleared against it are
                shown below.
              </div>
            )}

            {summary && <SummaryPanel summary={summary} />}

            {summary && !locked && (
              <p className={`text-sm ${summary.reconciled ? 'text-green-400' : 'text-slate-400'}`}>
                {summary.reconciled
                  ? 'Balanced — the difference is 0.00. You can complete this reconciliation.'
                  : `Clear transactions until the difference is 0.00 (currently ${formatMoney(
                      summary.difference
                    )}).`}
              </p>
            )}

            {/* Clearable transactions */}
            {txnsLoading && <p className="text-slate-400">Loading transactions…</p>}

            {!txnsLoading && rows.length === 0 && (
              <div className="rounded-sm border border-dashed border-white/15 px-6 py-12 text-center text-sm text-slate-400">
                No transactions are available to clear for this account. Import and accept
                transactions first.
              </div>
            )}

            {rows.length > 0 && (
              <div className="divide-y divide-white/5 overflow-hidden rounded-sm border border-white/10">
                {rows.map((txn) => (
                  <ClearableRow
                    key={txn.id}
                    txn={txn}
                    reconciliationId={reconciliationId as string}
                    locked={locked}
                  />
                ))}
              </div>
            )}

            {completeError && (
              <p className="text-sm text-red-400" role="alert">
                {completeError}
              </p>
            )}
          </>
        )}
      </div>
    </AccountingShell>
  );
}

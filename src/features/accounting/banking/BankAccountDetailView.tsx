import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { AccountingShell } from '../components/AccountingShell';
import { AccountPicker } from '../components/AccountPicker';
import { useBankAccount, useBankTransactions } from '../hooks/useAccountingQueries';
import {
  useAcceptBankTransaction,
  useApplyRulesToUnreviewed,
  useCategorizeBankTransaction,
  useSetBankTransactionExcluded,
  useUnmatchBankTransaction,
} from '../hooks/useAccountingMutations';
import type { BankTransactionFilter } from '@/services/api/accounting';
import { ACCOUNTING_BASE, BANKING_BASE } from '../constants';
import {
  BANK_ACCOUNT_TYPE_LABELS,
  BANK_TXN_STATUS_LABELS,
  type BankTransaction,
  type BankTransactionStatus,
} from '../types';
import { SignedAmount, TxnStatusPill } from './bankingFormat';

type StatusTab = 'all' | BankTransactionStatus;

const STATUS_TABS: { key: StatusTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unreviewed', label: BANK_TXN_STATUS_LABELS.unreviewed },
  { key: 'categorized', label: BANK_TXN_STATUS_LABELS.categorized },
  { key: 'matched', label: BANK_TXN_STATUS_LABELS.matched },
  { key: 'excluded', label: BANK_TXN_STATUS_LABELS.excluded },
];

/**
 * One register row. Handles its own inline category selection + accept so the picker
 * state is local. Posting (accept) routes through the balanced-JE mutation; matched
 * rows expose a link to the posted entry and an unmatch action.
 */
function TransactionRow({ txn }: { txn: BankTransaction }) {
  const navigate = useNavigate();
  const categorize = useCategorizeBankTransaction();
  const accept = useAcceptBankTransaction();
  const unmatch = useUnmatchBankTransaction();
  const setExcluded = useSetBankTransactionExcluded();

  const [category, setCategory] = useState(txn.categoryAccountId ?? '');
  const [error, setError] = useState<string | null>(null);

  const busy =
    categorize.isPending || accept.isPending || unmatch.isPending || setExcluded.isPending;

  const onAccept = async () => {
    setError(null);
    if (!category) {
      setError('Choose a category account first.');
      return;
    }
    const res = await accept.mutateAsync({ id: txn.id, categoryAccountId: category });
    if (res.error) setError(res.error);
  };

  const onSaveCategory = async () => {
    setError(null);
    const res = await categorize.mutateAsync({
      id: txn.id,
      categoryAccountId: category || null,
    });
    if (res.error) setError(res.error);
  };

  const onUnmatch = async () => {
    setError(null);
    const res = await unmatch.mutateAsync({ id: txn.id });
    if (res.error) setError(res.error);
    else setCategory(res.transaction?.categoryAccountId ?? '');
  };

  const onToggleExcluded = async (excluded: boolean) => {
    setError(null);
    const res = await setExcluded.mutateAsync({ id: txn.id, excluded });
    if (res.error) setError(res.error);
  };

  /** Jump to the rules screen with a rule pre-filled from this txn + its chosen category. */
  const onMakeRule = () => {
    navigate(`${BANKING_BASE}/${txn.bankAccountId}/rules`, {
      state: {
        suggested: {
          matchField: txn.merchant ? 'merchant' : 'description',
          matchOp: 'contains',
          matchValue: (txn.merchant || txn.description || '').trim(),
          setAccountId: category,
          scopeAll: false,
        },
      },
    });
  };

  const isMatched = txn.status === 'matched';
  const isExcluded = txn.status === 'excluded';
  const dirty = (category || null) !== (txn.categoryAccountId ?? null);

  return (
    <div className="flex flex-col gap-2 px-3 py-3">
      {/* Top line: date, description, amount, status */}
      <div className="flex items-start gap-3">
        <span className="w-20 shrink-0 pt-0.5 text-xs text-subtle">{txn.txnDate}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-white">
            {txn.description || txn.merchant || 'Transaction'}
          </span>
          {txn.merchant && txn.description && (
            <span className="block truncate text-xs text-subtle">{txn.merchant}</span>
          )}
        </span>
        <SignedAmount amount={txn.amount} className="shrink-0 pt-0.5 text-sm" />
        <span className="shrink-0 pt-0.5">
          <TxnStatusPill status={txn.status} />
        </span>
      </div>

      {/* Action line: category picker + accept/unmatch/exclude */}
      <div className="flex flex-wrap items-center gap-2 pl-20">
        {isMatched ? (
          <>
            <span className="text-sm text-muted">
              Posted to <span className="text-white">{txn.categoryAccountName ?? 'category'}</span>
            </span>
            {txn.matchedJournalEntryId && (
              <button
                type="button"
                onClick={() => navigate(`${ACCOUNTING_BASE}/journal/${txn.matchedJournalEntryId}`)}
                className="flex items-center gap-1 text-sm font-semibold text-primary hover:text-primary-hover"
              >
                <span className="material-symbols-outlined text-base">menu_book</span>
                Journal entry
              </button>
            )}
            <button
              type="button"
              onClick={onUnmatch}
              disabled={busy}
              className="flex items-center gap-1 text-sm font-semibold text-muted hover:text-amber-400 disabled:opacity-40"
            >
              <span className="material-symbols-outlined text-base">undo</span>
              {unmatch.isPending ? 'Unmatching…' : 'Unmatch'}
            </button>
          </>
        ) : isExcluded ? (
          <>
            <span className="text-sm text-subtle">Excluded from the books.</span>
            <button
              type="button"
              onClick={() => onToggleExcluded(false)}
              disabled={busy}
              className="flex items-center gap-1 text-sm font-semibold text-muted hover:text-white disabled:opacity-40"
            >
              <span className="material-symbols-outlined text-base">restore_from_trash</span>
              Restore
            </button>
          </>
        ) : (
          <>
            <div className="min-w-[12rem] flex-1">
              <AccountPicker
                ariaLabel={`Category for ${txn.description ?? 'transaction'}`}
                value={category}
                onChange={setCategory}
              />
            </div>
            {dirty && (
              <Button size="sm" variant="secondary" onClick={onSaveCategory} disabled={busy}>
                {categorize.isPending ? 'Saving…' : 'Save'}
              </Button>
            )}
            <Button size="sm" icon="check" onClick={onAccept} disabled={busy || !category}>
              {accept.isPending ? 'Posting…' : 'Accept'}
            </Button>
            {category && (
              <button
                type="button"
                onClick={onMakeRule}
                disabled={busy}
                title="Create a rule that auto-categorizes transactions like this"
                className="flex items-center gap-1 text-sm font-semibold text-muted hover:text-primary disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-base">rule_folder</span>
                Make a rule
              </button>
            )}
            <button
              type="button"
              onClick={() => onToggleExcluded(true)}
              disabled={busy}
              aria-label="Exclude transaction"
              className="flex size-9 items-center justify-center rounded-lg text-subtle hover:bg-white/10 hover:text-amber-400 disabled:opacity-40"
            >
              <span className="material-symbols-outlined text-lg">block</span>
            </button>
          </>
        )}
      </div>

      {error && (
        <p className="pl-20 text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export default function BankAccountDetailView() {
  const { bankAccountId } = useParams<{ bankAccountId: string }>();
  const navigate = useNavigate();
  const {
    data: account,
    isPending: accountLoading,
    isError: accountError,
  } = useBankAccount(bankAccountId);
  const [tab, setTab] = useState<StatusTab>('all');
  const applyRules = useApplyRulesToUnreviewed();
  const [ruleMsg, setRuleMsg] = useState<string | null>(null);

  const onRunRules = async () => {
    if (!bankAccountId) return;
    setRuleMsg(null);
    const res = await applyRules.mutateAsync(bankAccountId);
    if (res.error) {
      setRuleMsg(`Rules ran with an error: ${res.error}`);
    } else {
      setRuleMsg(
        res.categorized === 0
          ? 'No unreviewed transactions matched a rule.'
          : `Categorized ${res.categorized} transaction${res.categorized === 1 ? '' : 's'} by rule.`
      );
    }
  };

  const filter: BankTransactionFilter = useMemo(
    () => (tab === 'all' ? {} : { status: tab }),
    [tab]
  );
  const {
    data: transactions = [],
    isPending: txnsLoading,
    isError: txnsError,
  } = useBankTransactions(bankAccountId, filter);

  const reviewCount = transactions.filter(
    (t) => t.status === 'unreviewed' || t.status === 'categorized'
  ).length;

  return (
    <AccountingShell
      active="banking"
      title={account ? account.name : 'Bank account'}
      actions={
        bankAccountId ? (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              icon="bolt"
              onClick={onRunRules}
              disabled={applyRules.isPending}
            >
              {applyRules.isPending ? 'Running…' : 'Run rules'}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon="rule"
              onClick={() => navigate(`${BANKING_BASE}/${bankAccountId}/rules`)}
            >
              Rules
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon="balance"
              onClick={() => navigate(`${BANKING_BASE}/${bankAccountId}/reconcile`)}
            >
              Reconcile
            </Button>
            <Button
              size="sm"
              icon="upload_file"
              onClick={() => navigate(`${BANKING_BASE}/${bankAccountId}/import`)}
            >
              Import
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        {accountLoading && <p className="text-muted">Loading account…</p>}
        {accountError && <p className="text-red-400">Could not load this bank account.</p>}
        {!accountLoading && !accountError && !account && (
          <p className="text-muted">Bank account not found.</p>
        )}

        {account && (
          <>
            {/* Account meta */}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <span className="text-muted">
                GL account{' '}
                {account.glAccountName ? (
                  <span className="text-white">
                    {account.glAccountNumber ? `${account.glAccountNumber} · ` : ''}
                    {account.glAccountName}
                  </span>
                ) : (
                  <span className="text-red-400">not linked</span>
                )}
              </span>
              {account.accountType && (
                <span className="text-muted">
                  Type{' '}
                  <span className="text-white">
                    {BANK_ACCOUNT_TYPE_LABELS[account.accountType]}
                  </span>
                </span>
              )}
              {account.lastReconciledAt && (
                <span className="text-muted">
                  Last reconciled <span className="text-white">{account.lastReconciledAt}</span>
                </span>
              )}
              {reviewCount > 0 && (
                <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-xs font-semibold text-sky-400">
                  {reviewCount} to review
                </span>
              )}
            </div>

            {!account.accountId && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                This bank account is not linked to a general-ledger account, so transactions cannot
                be posted. Link one before accepting transactions.
              </div>
            )}

            {ruleMsg && (
              <div
                className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-2 text-sm text-sky-300"
                role="status"
              >
                {ruleMsg}
              </div>
            )}

            {/* Status filter tabs */}
            <nav className="flex gap-1 overflow-x-auto" aria-label="Filter transactions">
              {STATUS_TABS.map((t) => {
                const isActive = t.key === tab;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTab(t.key)}
                    aria-current={isActive ? 'true' : undefined}
                    className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                      isActive
                        ? 'bg-primary text-on-accent'
                        : 'text-muted hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </nav>

            {/* Transactions */}
            {txnsLoading && <p className="text-muted">Loading transactions…</p>}
            {txnsError && (
              <p className="text-red-400">Could not load transactions for this account.</p>
            )}

            {!txnsLoading && !txnsError && transactions.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-line px-6 py-16 text-center">
                <span className="material-symbols-outlined text-4xl text-subtle">receipt_long</span>
                <p className="text-lg font-bold text-white">
                  {tab === 'all' ? 'No transactions yet' : `No ${tab} transactions`}
                </p>
                {tab === 'all' && (
                  <>
                    <p className="max-w-sm text-sm text-muted">
                      Import a CSV, OFX, or QFX statement to bring transactions in. Rules will
                      auto-categorize what they match; you review and accept the rest.
                    </p>
                    <Button
                      size="sm"
                      icon="upload_file"
                      onClick={() => navigate(`${BANKING_BASE}/${bankAccountId}/import`)}
                    >
                      Import statement
                    </Button>
                  </>
                )}
              </div>
            )}

            {transactions.length > 0 && (
              <div className="divide-y divide-white/5 overflow-hidden rounded-lg border border-line">
                {transactions.map((txn) => (
                  <TransactionRow key={txn.id} txn={txn} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </AccountingShell>
  );
}

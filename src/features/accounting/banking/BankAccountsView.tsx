import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { AccountingShell } from '../components/AccountingShell';
import { AccountPicker } from '../components/AccountPicker';
import { CurrencyInput } from '../components/CurrencyInput';
import { useBankAccounts } from '../hooks/useAccountingQueries';
import { useCreateBankAccount } from '../hooks/useAccountingMutations';
import { formatMoney } from '../accountingViewModel';
import { BANKING_BASE } from '../constants';
import {
  BANK_ACCOUNT_TYPE_LABELS,
  type BankAccount,
  type BankAccountType,
  type NewBankAccountInput,
} from '../types';

const inputClass =
  'w-full rounded-lg border border-line bg-background-dark px-2 py-1.5 text-white focus:border-primary focus:outline-none';

const BANK_ACCOUNT_TYPES = Object.keys(BANK_ACCOUNT_TYPE_LABELS) as BankAccountType[];

/** Dialog to create a bank/credit-card account linked to a GL cash account. */
function NewBankAccountModal({ onClose }: { onClose: () => void }) {
  const createAccount = useCreateBankAccount();
  const [name, setName] = useState('');
  const [accountId, setAccountId] = useState('');
  const [accountType, setAccountType] = useState<BankAccountType>('checking');
  const [institution, setInstitution] = useState('');
  const [mask, setMask] = useState('');
  const [openingBalance, setOpeningBalance] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!name.trim()) {
      setError('Give the bank account a name.');
      return;
    }
    if (!accountId) {
      setError('Link a general-ledger cash or credit-card account.');
      return;
    }
    const input: NewBankAccountInput = {
      name: name.trim(),
      accountId,
      accountType,
      institution: institution.trim() || null,
      mask: mask.trim() || null,
      currentBalance: openingBalance,
    };
    const created = await createAccount.mutateAsync(input);
    if (!created) {
      setError('Could not create the bank account. Check your accounting role and try again.');
      return;
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl border border-line bg-card-dark p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">New Bank Account</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-white/10 hover:text-white"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <p className="mb-3 text-sm text-muted">
          A bank account wraps a general-ledger cash or credit-card account. Every imported
          transaction you accept posts against that GL account.
        </p>

        <div className="flex flex-col gap-3">
          <FormField label="Name" htmlFor="ba-name" required>
            <input
              id="ba-name"
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Operating Checking"
            />
          </FormField>

          <FormField
            label="General-ledger account"
            htmlFor="ba-gl"
            required
            hint="The cash / credit-card account this feed posts to."
          >
            <AccountPicker
              id="ba-gl"
              ariaLabel="General-ledger account"
              value={accountId}
              onChange={setAccountId}
            />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Type" htmlFor="ba-type">
              <select
                id="ba-type"
                className={inputClass}
                value={accountType}
                onChange={(e) => setAccountType(e.target.value as BankAccountType)}
              >
                {BANK_ACCOUNT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {BANK_ACCOUNT_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Last 4" htmlFor="ba-mask" hint="Masked number">
              <input
                id="ba-mask"
                className={inputClass}
                value={mask}
                onChange={(e) => setMask(e.target.value)}
                placeholder="••1234"
              />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Institution" htmlFor="ba-inst">
              <input
                id="ba-inst"
                className={inputClass}
                value={institution}
                onChange={(e) => setInstitution(e.target.value)}
                placeholder="Optional"
              />
            </FormField>
            <FormField label="Opening balance" htmlFor="ba-bal" hint="Display only">
              <CurrencyInput
                id="ba-bal"
                aria-label="Opening balance"
                value={openingBalance}
                onValueChange={setOpeningBalance}
              />
            </FormField>
          </div>

          {error && (
            <p className="text-sm text-red-400" role="alert">
              {error}
            </p>
          )}

          <div className="mt-1 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={createAccount.isPending || !name.trim() || !accountId}
            >
              {createAccount.isPending ? 'Creating…' : 'Create account'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function BankAccountRow({ account, onOpen }: { account: BankAccount; onOpen: () => void }) {
  const glLabel = account.glAccountName
    ? `${account.glAccountNumber ? `${account.glAccountNumber} · ` : ''}${account.glAccountName}`
    : 'No GL account linked';
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-white/5"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
        <span className="material-symbols-outlined text-lg">
          {account.accountType === 'credit_card' ? 'credit_card' : 'account_balance'}
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-white">{account.name}</span>
        <span className="block truncate text-xs text-subtle">
          {account.institution ? `${account.institution} · ` : ''}
          {account.accountType ? BANK_ACCOUNT_TYPE_LABELS[account.accountType] : 'Account'}
          {account.mask ? ` · ${account.mask}` : ''}
          {' — '}
          {glLabel}
        </span>
      </span>
      {!account.accountId && (
        <span className="shrink-0 rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-400">
          No GL
        </span>
      )}
      <span className="hidden w-28 shrink-0 text-right font-mono text-sm tabular-nums text-muted sm:block">
        {formatMoney(account.currentBalance)}
      </span>
      <span className="material-symbols-outlined text-subtle">chevron_right</span>
    </button>
  );
}

export default function BankAccountsView() {
  const navigate = useNavigate();
  const { data: accounts = [], isPending, isError } = useBankAccounts();
  const [showCreate, setShowCreate] = useState(false);

  return (
    <AccountingShell
      active="banking"
      title="Banking"
      actions={
        <Button size="sm" icon="add" onClick={() => setShowCreate(true)}>
          Add account
        </Button>
      }
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <p className="text-sm text-muted">
          Import bank and credit-card statements (CSV / OFX / QFX), auto-categorize with rules, post
          balanced entries, and reconcile to a statement balance.{' '}
          <span className="text-subtle">Plaid auto-sync is not enabled — import is manual.</span>
        </p>

        {isPending && <p className="text-muted">Loading bank accounts…</p>}
        {isError && (
          <p className="text-red-400">
            Could not load bank accounts. Confirm the accounting schema is exposed and you have an
            accounting role.
          </p>
        )}

        {!isPending && !isError && accounts.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-line px-6 py-16 text-center">
            <span className="material-symbols-outlined text-4xl text-subtle">
              account_balance_wallet
            </span>
            <p className="text-lg font-bold text-white">No bank accounts yet</p>
            <p className="max-w-sm text-sm text-muted">
              Add a bank or credit-card account and link it to a general-ledger cash account.
              Imported transactions you accept will post against it.
            </p>
            <Button size="sm" icon="add" onClick={() => setShowCreate(true)}>
              Add account
            </Button>
          </div>
        )}

        {accounts.length > 0 && (
          <div className="divide-y divide-white/5 overflow-hidden rounded-lg border border-line">
            {accounts.map((account) => (
              <BankAccountRow
                key={account.id}
                account={account}
                onOpen={() => navigate(`${BANKING_BASE}/${account.id}`)}
              />
            ))}
          </div>
        )}
      </div>

      {showCreate && <NewBankAccountModal onClose={() => setShowCreate(false)} />}
    </AccountingShell>
  );
}

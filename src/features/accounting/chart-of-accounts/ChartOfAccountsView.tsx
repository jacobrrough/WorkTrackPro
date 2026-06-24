import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { AccountingShell } from '../components/AccountingShell';
import { useAccounts } from '../hooks/useAccountingQueries';
import { useCreateAccount } from '../hooks/useAccountingMutations';
import {
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_LABELS,
  DEFAULT_NORMAL_BALANCE,
  type Account,
  type AccountType,
  type NewAccountInput,
  type NormalBalance,
} from '../types';

const inputClass =
  'w-full rounded-sm border border-white/10 bg-background-dark px-2 py-1.5 text-white focus:border-primary focus:outline-none';

function AccountFormModal({ onClose }: { onClose: () => void }) {
  const createAccount = useCreateAccount();
  const [name, setName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountType, setAccountType] = useState<AccountType>('expense');
  const [normalBalance, setNormalBalance] = useState<NormalBalance>(DEFAULT_NORMAL_BALANCE.expense);
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onTypeChange = (t: AccountType) => {
    setAccountType(t);
    setNormalBalance(DEFAULT_NORMAL_BALANCE[t]);
  };

  const submit = async () => {
    setError(null);
    if (!name.trim()) {
      setError('Account name is required.');
      return;
    }
    const input: NewAccountInput = {
      name: name.trim(),
      accountNumber: accountNumber.trim() || null,
      accountType,
      normalBalance,
      description: description.trim() || null,
    };
    const created = await createAccount.mutateAsync(input);
    if (!created) {
      setError('Could not create the account. The account number may already exist.');
      return;
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-sm border border-white/10 bg-card-dark p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">New Account</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-sm text-muted hover:bg-white/10 hover:text-white"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <FormField label="Name" htmlFor="acc-name" required>
            <input
              id="acc-name"
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Office Supplies"
            />
          </FormField>

          <FormField label="Account number" htmlFor="acc-number" hint="Optional, must be unique">
            <input
              id="acc-number"
              className={inputClass}
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
              placeholder="e.g. 6100"
            />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Type" htmlFor="acc-type">
              <select
                id="acc-type"
                className={inputClass}
                value={accountType}
                onChange={(e) => onTypeChange(e.target.value as AccountType)}
              >
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {ACCOUNT_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField label="Normal balance" htmlFor="acc-balance">
              <select
                id="acc-balance"
                className={inputClass}
                value={normalBalance}
                onChange={(e) => setNormalBalance(e.target.value as NormalBalance)}
              >
                <option value="debit">Debit</option>
                <option value="credit">Credit</option>
              </select>
            </FormField>
          </div>

          <FormField label="Description" htmlFor="acc-desc">
            <input
              id="acc-desc"
              className={inputClass}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
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
            <Button onClick={submit} disabled={createAccount.isPending}>
              {createAccount.isPending ? 'Saving…' : 'Create account'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ChartOfAccountsView() {
  const { data: accounts = [], isPending, isError } = useAccounts();
  const [showForm, setShowForm] = useState(false);

  const grouped = useMemo(() => {
    const map: Record<AccountType, Account[]> = {
      asset: [],
      liability: [],
      equity: [],
      income: [],
      expense: [],
    };
    for (const a of accounts) map[a.accountType]?.push(a);
    return map;
  }, [accounts]);

  return (
    <AccountingShell
      active="accounts"
      title="Chart of Accounts"
      actions={
        <Button size="sm" icon="add" onClick={() => setShowForm(true)}>
          Add
        </Button>
      }
    >
      {isPending && <p className="text-muted">Loading accounts…</p>}
      {isError && (
        <p className="text-red-400">
          Could not load accounts. Confirm the accounting schema is exposed and you have an
          accounting role.
        </p>
      )}

      {!isPending && !isError && accounts.length === 0 && (
        <p className="text-muted">No accounts yet. Add your first account to get started.</p>
      )}

      <div className="flex flex-col gap-5">
        {ACCOUNT_TYPES.map((type) => {
          const rows = grouped[type];
          if (!rows || rows.length === 0) return null;
          return (
            <section key={type}>
              <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">
                {ACCOUNT_TYPE_LABELS[type]}
              </h2>
              <div className="overflow-hidden rounded-sm border border-white/10">
                {rows.map((a, i) => (
                  <div
                    key={a.id}
                    className={`flex items-center gap-3 px-3 py-2 ${
                      i > 0 ? 'border-t border-white/5' : ''
                    } ${a.isActive ? '' : 'opacity-50'}`}
                  >
                    <span className="w-14 shrink-0 font-mono text-xs text-subtle">
                      {a.accountNumber ?? '—'}
                    </span>
                    <span className="flex-1 text-white">{a.name}</span>
                    <span className="text-xs uppercase text-subtle">{a.normalBalance}</span>
                    {a.isSystem && (
                      <span className="rounded-sm bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold text-muted">
                        system
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {showForm && <AccountFormModal onClose={() => setShowForm(false)} />}
    </AccountingShell>
  );
}

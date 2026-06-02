import { useAccounts } from '../hooks/useAccountingQueries';

interface AccountPickerProps {
  value: string;
  onChange: (accountId: string) => void;
  id?: string;
  ariaLabel?: string;
  className?: string;
}

/** Searchable-ish GL account select backed by the chart of accounts. */
export function AccountPicker({ value, onChange, id, ariaLabel, className = '' }: AccountPickerProps) {
  const { data: accounts = [], isLoading } = useAccounts();
  return (
    <select
      id={id}
      aria-label={ariaLabel ?? 'Account'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={isLoading}
      className={`w-full rounded-sm border border-white/10 bg-background-dark px-2 py-1.5 text-white focus:border-primary focus:outline-none ${className}`}
    >
      <option value="">{isLoading ? 'Loading…' : 'Select account…'}</option>
      {accounts
        .filter((a) => a.isActive)
        .map((a) => (
          <option key={a.id} value={a.id}>
            {a.accountNumber ? `${a.accountNumber} · ` : ''}
            {a.name}
          </option>
        ))}
    </select>
  );
}

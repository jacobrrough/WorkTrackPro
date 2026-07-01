import { useAccounts } from '../hooks/useAccountingQueries';
import type { AccountType } from '../types';

interface AccountPickerProps {
  value: string;
  onChange: (accountId: string) => void;
  id?: string;
  ariaLabel?: string;
  className?: string;
  /** When set, only accounts of these types are offered (e.g. ['income'] for a revenue
   *  mapping). The currently-selected account is always kept selectable even if it falls
   *  outside the filter, so editing never silently drops an existing mapping. */
  accountTypes?: AccountType[];
  /** Placeholder for the empty option (default "Select account…"). */
  placeholder?: string;
}

/** Searchable-ish GL account select backed by the chart of accounts. */
export function AccountPicker({
  value,
  onChange,
  id,
  ariaLabel,
  className = '',
  accountTypes,
  placeholder,
}: AccountPickerProps) {
  const { data: accounts = [], isLoading } = useAccounts();
  const visible = accounts.filter(
    (a) => (a.isActive && (!accountTypes || accountTypes.includes(a.accountType))) || a.id === value
  );
  return (
    <select
      id={id}
      aria-label={ariaLabel ?? 'Account'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={isLoading}
      className={`w-full rounded-lg border border-line bg-background-dark px-2 py-1.5 text-white focus:border-primary focus:outline-none ${className}`}
    >
      <option value="">{isLoading ? 'Loading…' : (placeholder ?? 'Select account…')}</option>
      {visible.map((a) => (
        <option key={a.id} value={a.id}>
          {a.accountNumber ? `${a.accountNumber} · ` : ''}
          {a.name}
        </option>
      ))}
    </select>
  );
}

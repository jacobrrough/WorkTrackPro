import { useCustomers } from '../hooks/useAccountingQueries';

/**
 * Customer picker for JOB screens (create + edit). Lives in the accounting module so
 * the core app keeps its flag-off isolation — JobDetail/AdminCreateJob mount it
 * LAZILY behind ACCOUNTING_BUILD_ENABLED (the same dead-ternary pattern AppRouter
 * uses), so a flag-off build contains none of this code.
 *
 * Value semantics: '' = no customer (persisted as NULL). Inactive customers are
 * hidden from new picks, but a job already linked to one keeps showing it.
 */
export default function JobCustomerSelect({
  value,
  onChange,
  disabled,
  className,
  id,
}: {
  value: string | null;
  onChange: (customerId: string | null) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
}) {
  const { data: customers = [], isPending } = useCustomers();
  const current = value ?? '';
  // A job may point at a customer that has since been deactivated — keep it selectable.
  const missingCurrent = current !== '' && !customers.some((c) => c.id === current);

  return (
    <select
      id={id}
      className={
        className ??
        'h-10 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-white'
      }
      value={current}
      onChange={(e) => onChange(e.target.value || null)}
      disabled={disabled || isPending}
      aria-label="Customer"
    >
      <option value="">{isPending ? 'Loading customers…' : 'No customer'}</option>
      {missingCurrent && <option value={current}>(current customer)</option>}
      {customers.map((c) => (
        <option key={c.id} value={c.id}>
          {c.displayName}
        </option>
      ))}
    </select>
  );
}

/**
 * ⚠️  HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING. The employee master list (FLAG-DARK payroll
 *     module). Renders the PROMINENT UnverifiedBanner (via PayrollScreen). Read-only over
 *     accounting.employees; the only mutation reachable here is the active toggle (soft
 *     deactivate — employees are never hard-deleted because paychecks reference them). Editing /
 *     creating happens on EmployeeEditView. Moves NO money.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PayrollScreen } from './PayrollScreen';
import { useEmployees } from '../hooks/useAccountingQueries';
import { useSetEmployeeActive } from '../hooks/useAccountingMutations';
import { payrollEmployeePath } from '../constants';
import { EMPLOYMENT_TYPE_LABELS, type Employee } from '../types';
import { filingStatusLabel, formatCents, payTypeLabel } from './payrollFormat';

/** One employee row — name, type, pay setup summary, and an active/inactive toggle. */
function EmployeeRow({ employee }: { employee: Employee }) {
  const navigate = useNavigate();
  const setActive = useSetEmployeeActive();
  const [error, setError] = useState<string | null>(null);

  const rateLabel =
    employee.payType === 'hourly'
      ? `${formatCents(employee.payRateCents)}/hr`
      : `${formatCents(employee.payRateCents)}/yr`;

  const onToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setError(null);
    const res = await setActive.mutateAsync({ id: employee.id, isActive: !employee.isActive });
    if (!res.ok) setError(res.error ?? 'Could not change the employee status.');
  };

  return (
    <Card
      onClick={() => navigate(payrollEmployeePath(employee.id))}
      className="flex items-center gap-3"
      padding="md"
    >
      <span className="material-symbols-outlined text-slate-400">person</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-bold text-white">{employee.displayName}</p>
          <span className="rounded-sm bg-white/10 px-1.5 py-0.5 text-[11px] font-semibold text-slate-300">
            {EMPLOYMENT_TYPE_LABELS[employee.employmentType]}
          </span>
          {!employee.isActive && (
            <span className="rounded-sm bg-slate-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-slate-400">
              Inactive
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-slate-500">
          {payTypeLabel(employee.payType)} · {rateLabel}
          {employee.employmentType === 'w2' && ` · Fed ${filingStatusLabel(employee.fedFilingStatus)}`}
          {employee.profileId ? ' · linked login' : ' · no login link'}
        </p>
        {error && (
          <p className="mt-0.5 text-xs text-red-400" role="alert">
            {error}
          </p>
        )}
      </div>
      <Button
        size="sm"
        variant={employee.isActive ? 'ghost' : 'secondary'}
        onClick={onToggle}
        disabled={setActive.isPending}
      >
        {employee.isActive ? 'Deactivate' : 'Reactivate'}
      </Button>
    </Card>
  );
}

export default function EmployeesView() {
  const navigate = useNavigate();
  const [includeInactive, setIncludeInactive] = useState(true);
  const { data: employees = [], isPending, isError, refetch } = useEmployees(includeInactive);

  const visible = includeInactive ? employees : employees.filter((e) => e.isActive);

  return (
    <PayrollScreen
      section="employees"
      title="Employees (Unverified)"
      actions={
        <Button size="sm" icon="add" onClick={() => navigate(payrollEmployeePath('new'))}>
          New employee
        </Button>
      }
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
          Employee master
        </h2>
        <label className="flex items-center gap-2 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
            className="size-4 rounded-sm border-white/20 bg-background-dark"
          />
          Show inactive
        </label>
      </div>

      {isPending && <p className="text-slate-400">Loading employees…</p>}

      {!isPending && isError && (
        <div className="flex flex-col items-start gap-3 rounded-sm border border-red-500/30 bg-red-500/10 p-3">
          <p className="text-sm text-red-300">
            Could not load employees. Confirm the accounting schema is exposed and you have a payroll
            role.
          </p>
          <Button size="sm" variant="secondary" icon="refresh" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!isPending && !isError && visible.length === 0 && (
        <Card padding="lg" className="flex flex-col items-center gap-3 text-center">
          <span className="material-symbols-outlined text-4xl text-slate-600">badge</span>
          <div>
            <p className="font-semibold text-white">No employees yet</p>
            <p className="mt-1 text-sm text-slate-400">
              Add an employee to capture their W-4 / DE-4 withholding inputs and pay setup. Do not
              enter a real SSN or bank details — those fields are Phase-E encrypted placeholders and
              stay empty while the module is flag-dark.
            </p>
          </div>
          <Button icon="add" onClick={() => navigate(payrollEmployeePath('new'))}>
            New employee
          </Button>
        </Card>
      )}

      {!isPending && !isError && visible.length > 0 && (
        <div className="flex flex-col gap-2">
          {visible.map((employee) => (
            <EmployeeRow key={employee.id} employee={employee} />
          ))}
        </div>
      )}
    </PayrollScreen>
  );
}

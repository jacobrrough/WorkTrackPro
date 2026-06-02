/**
 * ⚠️  HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING. Create / edit one payroll employee (FLAG-DARK
 *     module). Renders the PROMINENT UnverifiedBanner (via PayrollScreen). Captures the W-4 (2020+)
 *     and CA DE-4 withholding inputs + pay setup. SSN and bank-account fields are DELIBERATELY NOT
 *     collected here — they are Phase-E encrypted placeholders (G8) and must stay empty until field
 *     encryption + key management land and a security professional signs off. Moves NO money.
 *
 * Mounted at /app/accounting/payroll/employees/:employeeId, where `:employeeId === 'new'` is the
 * create form. Money is entered in DOLLARS (CurrencyInput) and converted to INTEGER CENTS (G6).
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FormField } from '@/components/ui/FormField';
import { CurrencyInput } from '../components/CurrencyInput';
import { PayrollScreen } from './PayrollScreen';
import { useEmployee } from '../hooks/useAccountingQueries';
import { useCreateEmployee, useUpdateEmployee } from '../hooks/useAccountingMutations';
import { payrollEmployeesPath } from '../constants';
import {
  EMPLOYMENT_TYPES,
  EMPLOYMENT_TYPE_LABELS,
  PAY_TYPES,
  PAY_TYPE_LABELS,
  PAYROLL_FILING_STATUSES,
  PAYROLL_FILING_STATUS_LABELS,
  type EmploymentType,
  type NewEmployeeInput,
  type PayrollFilingStatus,
  type PayType,
} from '../types';
import { centsToDollars, dollarsToCents } from './payrollFormat';

const inputClass =
  'w-full rounded-sm border border-white/10 bg-background-dark px-2 py-1.5 text-white focus:border-primary focus:outline-none';

/** The editable form state (dollars for the money fields; converted to cents on save). */
interface FormState {
  displayName: string;
  email: string;
  employmentType: EmploymentType;
  payType: PayType;
  payRateDollars: number;
  // Federal W-4
  fedFilingStatus: PayrollFilingStatus;
  fedMultipleJobs: boolean;
  fedDependentsDollars: number;
  fedOtherIncomeDollars: number;
  fedDeductionsDollars: number;
  fedExtraWithholdingDollars: number;
  // CA DE-4
  caFilingStatus: PayrollFilingStatus;
  caAllowances: number;
  caExtraWithholdingDollars: number;
  notes: string;
}

const EMPTY: FormState = {
  displayName: '',
  email: '',
  employmentType: 'w2',
  payType: 'hourly',
  payRateDollars: 0,
  fedFilingStatus: 'single',
  fedMultipleJobs: false,
  fedDependentsDollars: 0,
  fedOtherIncomeDollars: 0,
  fedDeductionsDollars: 0,
  fedExtraWithholdingDollars: 0,
  caFilingStatus: 'single',
  caAllowances: 0,
  caExtraWithholdingDollars: 0,
  notes: '',
};

export default function EmployeeEditView() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const isNew = !employeeId || employeeId === 'new';
  const navigate = useNavigate();

  const {
    data: employee,
    isPending,
    isError,
    refetch,
  } = useEmployee(isNew ? undefined : employeeId);
  const createEmployee = useCreateEmployee();
  const updateEmployee = useUpdateEmployee();

  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  // Hydrate the form from the loaded employee (edit mode).
  useEffect(() => {
    if (!employee) return;
    setForm({
      displayName: employee.displayName,
      email: employee.email ?? '',
      employmentType: employee.employmentType,
      payType: employee.payType,
      payRateDollars: centsToDollars(employee.payRateCents),
      fedFilingStatus: employee.fedFilingStatus,
      fedMultipleJobs: employee.fedMultipleJobs,
      fedDependentsDollars: centsToDollars(employee.fedDependentsAmountCents),
      fedOtherIncomeDollars: centsToDollars(employee.fedOtherIncomeCents),
      fedDeductionsDollars: centsToDollars(employee.fedDeductionsCents),
      fedExtraWithholdingDollars: centsToDollars(employee.fedExtraWithholdingCents),
      caFilingStatus: employee.caFilingStatus,
      caAllowances: employee.caAllowances,
      caExtraWithholdingDollars: centsToDollars(employee.caExtraWithholdingCents),
      notes: employee.notes ?? '',
    });
  }, [employee]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setError(null);
  };

  const isW2 = form.employmentType === 'w2';
  const busy = createEmployee.isPending || updateEmployee.isPending;

  const buildInput = (): NewEmployeeInput => ({
    displayName: form.displayName.trim(),
    email: form.email.trim() || null,
    employmentType: form.employmentType,
    payType: form.payType,
    payRateCents: dollarsToCents(form.payRateDollars),
    fedFilingStatus: form.fedFilingStatus,
    fedMultipleJobs: form.fedMultipleJobs,
    fedDependentsAmountCents: dollarsToCents(form.fedDependentsDollars),
    fedOtherIncomeCents: dollarsToCents(form.fedOtherIncomeDollars),
    fedDeductionsCents: dollarsToCents(form.fedDeductionsDollars),
    fedExtraWithholdingCents: dollarsToCents(form.fedExtraWithholdingDollars),
    caFilingStatus: form.caFilingStatus,
    caAllowances: Math.max(0, Math.round(form.caAllowances)),
    caExtraWithholdingCents: dollarsToCents(form.caExtraWithholdingDollars),
    notes: form.notes.trim() || null,
  });

  const onSave = async () => {
    setError(null);
    if (!form.displayName.trim()) {
      setError('An employee needs a name.');
      return;
    }
    const input = buildInput();
    if (isNew) {
      const res = await createEmployee.mutateAsync(input);
      if (res.error || !res.employee) {
        setError(res.error ?? 'Could not create the employee. Confirm you have a payroll role.');
        return;
      }
      navigate(payrollEmployeesPath());
    } else {
      const res = await updateEmployee.mutateAsync({ id: employeeId as string, input });
      if (res.error || !res.employee) {
        setError(res.error ?? 'Could not update the employee.');
        return;
      }
      navigate(payrollEmployeesPath());
    }
  };

  const title = useMemo(
    () => (isNew ? 'New employee (Unverified)' : 'Edit employee (Unverified)'),
    [isNew]
  );

  // Edit mode: surface load states before showing the form.
  if (!isNew && isPending) {
    return (
      <PayrollScreen section="employees" title={title}>
        <p className="text-slate-400">Loading employee…</p>
      </PayrollScreen>
    );
  }
  if (!isNew && isError) {
    return (
      <PayrollScreen section="employees" title={title}>
        <div className="flex flex-col items-start gap-3 rounded-sm border border-red-500/30 bg-red-500/10 p-3">
          <p className="text-sm text-red-300">Could not load this employee.</p>
          <Button size="sm" variant="secondary" icon="refresh" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      </PayrollScreen>
    );
  }
  if (!isNew && !employee) {
    return (
      <PayrollScreen section="employees" title={title}>
        <Card padding="lg" className="text-center">
          <p className="text-slate-300">That employee was not found.</p>
          <Button
            className="mt-3"
            variant="secondary"
            onClick={() => navigate(payrollEmployeesPath())}
          >
            Back to employees
          </Button>
        </Card>
      </PayrollScreen>
    );
  }

  return (
    <PayrollScreen
      section="employees"
      title={title}
      bannerDetail="Do NOT enter a real SSN or bank details here — those are Phase-E encrypted placeholders and stay empty while the module is flag-dark."
    >
      <div className="flex flex-col gap-4">
        {/* Identity + pay setup */}
        <Card padding="lg" className="flex flex-col gap-3">
          <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">
            Identity & pay
          </h3>
          <FormField label="Name" htmlFor="emp-name" required>
            <input
              id="emp-name"
              className={inputClass}
              value={form.displayName}
              onChange={(e) => set('displayName', e.target.value)}
              placeholder="Employee name"
            />
          </FormField>
          <FormField label="Email" htmlFor="emp-email" hint="Optional.">
            <input
              id="emp-email"
              type="email"
              className={inputClass}
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              placeholder="name@example.com"
            />
          </FormField>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Employment type" htmlFor="emp-type">
              <select
                id="emp-type"
                className={inputClass}
                value={form.employmentType}
                onChange={(e) => set('employmentType', e.target.value as EmploymentType)}
              >
                {EMPLOYMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {EMPLOYMENT_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Pay type" htmlFor="emp-paytype">
              <select
                id="emp-paytype"
                className={inputClass}
                value={form.payType}
                onChange={(e) => set('payType', e.target.value as PayType)}
              >
                {PAY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {PAY_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
          <FormField
            label={form.payType === 'hourly' ? 'Hourly rate' : 'Annual salary'}
            htmlFor="emp-rate"
            hint={
              form.payType === 'hourly'
                ? 'Dollars per hour.'
                : 'Dollars per year (split across pay periods).'
            }
          >
            <CurrencyInput
              id="emp-rate"
              value={form.payRateDollars}
              onValueChange={(v) => set('payRateDollars', v)}
              className="max-w-[14rem]"
            />
          </FormField>
        </Card>

        {/* Federal W-4 — only meaningful for W-2 employees */}
        {isW2 && (
          <Card padding="lg" className="flex flex-col gap-3">
            <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">
              Federal W-4 (2020+)
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label="Filing status (Step 1c)" htmlFor="fed-status">
                <select
                  id="fed-status"
                  className={inputClass}
                  value={form.fedFilingStatus}
                  onChange={(e) => set('fedFilingStatus', e.target.value as PayrollFilingStatus)}
                >
                  {PAYROLL_FILING_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {PAYROLL_FILING_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField
                label="Step 2 — multiple jobs"
                htmlFor="fed-multi"
                hint="W-4 Step 2(c) checkbox."
              >
                <label className="flex h-[40px] items-center gap-2 text-sm text-slate-300">
                  <input
                    id="fed-multi"
                    type="checkbox"
                    checked={form.fedMultipleJobs}
                    onChange={(e) => set('fedMultipleJobs', e.target.checked)}
                    className="size-4 rounded-sm border-white/20 bg-background-dark"
                  />
                  Two jobs / spouse works
                </label>
              </FormField>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField
                label="Step 3 — dependents"
                htmlFor="fed-dep"
                hint="Annual dependents credit amount."
              >
                <CurrencyInput
                  id="fed-dep"
                  value={form.fedDependentsDollars}
                  onValueChange={(v) => set('fedDependentsDollars', v)}
                />
              </FormField>
              <FormField
                label="Step 4(a) — other income"
                htmlFor="fed-other"
                hint="Annual, not from jobs."
              >
                <CurrencyInput
                  id="fed-other"
                  value={form.fedOtherIncomeDollars}
                  onValueChange={(v) => set('fedOtherIncomeDollars', v)}
                />
              </FormField>
              <FormField
                label="Step 4(b) — deductions"
                htmlFor="fed-ded"
                hint="Annual deductions over the standard."
              >
                <CurrencyInput
                  id="fed-ded"
                  value={form.fedDeductionsDollars}
                  onValueChange={(v) => set('fedDeductionsDollars', v)}
                />
              </FormField>
              <FormField
                label="Step 4(c) — extra withholding"
                htmlFor="fed-extra"
                hint="Extra per PAY PERIOD."
              >
                <CurrencyInput
                  id="fed-extra"
                  value={form.fedExtraWithholdingDollars}
                  onValueChange={(v) => set('fedExtraWithholdingDollars', v)}
                />
              </FormField>
            </div>
          </Card>
        )}

        {/* California DE-4 — only meaningful for W-2 employees */}
        {isW2 && (
          <Card padding="lg" className="flex flex-col gap-3">
            <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">
              California DE-4
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label="Filing status" htmlFor="ca-status">
                <select
                  id="ca-status"
                  className={inputClass}
                  value={form.caFilingStatus}
                  onChange={(e) => set('caFilingStatus', e.target.value as PayrollFilingStatus)}
                >
                  {PAYROLL_FILING_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {PAYROLL_FILING_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField
                label="Regular withholding allowances"
                htmlFor="ca-allow"
                hint="DE-4 Worksheet A total (≥ 0)."
              >
                <input
                  id="ca-allow"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  className={`${inputClass} text-right`}
                  value={form.caAllowances === 0 ? '' : form.caAllowances}
                  onChange={(e) =>
                    set('caAllowances', Math.max(0, Number.parseInt(e.target.value, 10) || 0))
                  }
                  placeholder="0"
                />
              </FormField>
            </div>
            <FormField
              label="Additional CA withholding"
              htmlFor="ca-extra"
              hint="Extra per PAY PERIOD."
            >
              <CurrencyInput
                id="ca-extra"
                value={form.caExtraWithholdingDollars}
                onValueChange={(v) => set('caExtraWithholdingDollars', v)}
                className="max-w-[14rem]"
              />
            </FormField>
          </Card>
        )}

        {!isW2 && (
          <Card padding="lg" className="border-slate-500/30 bg-slate-500/5">
            <p className="text-xs text-slate-400">
              1099-NEC contractors have no income-tax withholding — gross pay only. Federal W-4 and
              CA DE-4 inputs are hidden for this employment type.
            </p>
          </Card>
        )}

        {/* SSN / bank — explicitly deferred to Phase E */}
        <Card padding="lg" className="border-amber-500/30 bg-amber-500/5">
          <h3 className="flex items-center gap-2 text-sm font-bold text-amber-200">
            <span className="material-symbols-outlined text-base">lock</span>
            SSN & bank details — Phase E (not collected here)
          </h3>
          <p className="mt-2 text-xs text-amber-100/90">
            SSN and bank routing/account numbers are intentionally NOT entered while the module is
            flag-dark. They require pgcrypto field encryption + key management (Phase E) and a
            security professional's sign-off. Direct deposit (NACHA/ACH) is a non-bankable stub, so
            no real bank data is ever needed by this build.
          </p>
        </Card>

        <FormField
          label="Notes"
          htmlFor="emp-notes"
          hint="Optional. Do not store sensitive identifiers here."
        >
          <textarea
            id="emp-notes"
            className={`${inputClass} min-h-[72px]`}
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
          />
        </FormField>

        <div className="flex items-center justify-end gap-3">
          {error && (
            <span className="mr-auto text-sm text-red-400" role="alert">
              {error}
            </span>
          )}
          <Button variant="ghost" onClick={() => navigate(payrollEmployeesPath())} disabled={busy}>
            Cancel
          </Button>
          <Button icon="save" onClick={onSave} disabled={busy}>
            {busy ? 'Saving…' : isNew ? 'Create employee' : 'Save changes'}
          </Button>
        </div>
      </div>
    </PayrollScreen>
  );
}

/**
 * ⚠️  HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING. Shared chrome for every C2 payroll screen:
 *     composes the module-wide AccountingShell (active = 'payroll'), renders the PROMINENT
 *     UnverifiedBanner (required on EVERY payroll screen/report/export), and a payroll SUB-nav so an
 *     admin can move between the employee master / schedules / runs / tax tables / reports. Every
 *     payroll route renders through this, so the banner can never be forgotten on a payroll surface.
 */
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AccountingShell } from '../components/AccountingShell';
import { UnverifiedBanner } from '../components/UnverifiedBanner';
import {
  payrollEmployeesPath,
  payrollPath,
  payrollReportsPath,
  payrollRunsPath,
  payrollSchedulesPath,
  payrollTaxTablesPath,
} from '../constants';

/** The payroll sub-sections (a secondary nav within the module's Payroll area). */
export type PayrollSection =
  | 'overview'
  | 'employees'
  | 'schedules'
  | 'runs'
  | 'tax-tables'
  | 'reports';

interface SubNavItem {
  key: PayrollSection;
  label: string;
  icon: string;
  path: string;
}

const SUB_NAV: SubNavItem[] = [
  { key: 'overview', label: 'Overview', icon: 'dashboard', path: payrollPath() },
  { key: 'employees', label: 'Employees', icon: 'badge', path: payrollEmployeesPath() },
  { key: 'schedules', label: 'Schedules', icon: 'event_repeat', path: payrollSchedulesPath() },
  { key: 'runs', label: 'Pay runs', icon: 'payments', path: payrollRunsPath() },
  { key: 'tax-tables', label: 'Tax tables', icon: 'table_chart', path: payrollTaxTablesPath() },
  { key: 'reports', label: 'Reports', icon: 'description', path: payrollReportsPath() },
];

interface PayrollScreenProps {
  /** Which payroll sub-section is active (highlights the sub-nav pill). */
  section: PayrollSection;
  title: string;
  /** Module-specific banner caveat appended under the headline. */
  bannerDetail?: string;
  /** Optional header actions (rendered in the AccountingShell header). */
  actions?: ReactNode;
  children: ReactNode;
}

const DEFAULT_BANNER_DETAIL =
  'Payroll is flag-dark. Nothing here is filing-grade; direct deposit is a non-bankable stub. Verify every rate, form, and the encryption posture before enabling.';

export function PayrollScreen({
  section,
  title,
  bannerDetail,
  actions,
  children,
}: PayrollScreenProps) {
  const navigate = useNavigate();

  return (
    <AccountingShell active="payroll" title={title} actions={actions}>
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        <UnverifiedBanner detail={bannerDetail ?? DEFAULT_BANNER_DETAIL} />

        <nav
          className="flex gap-1 overflow-x-auto rounded-sm border border-white/10 bg-card-dark p-1"
          aria-label="Payroll sections"
        >
          {SUB_NAV.map((item) => {
            const isActive = item.key === section;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => navigate(item.path)}
                aria-current={isActive ? 'page' : undefined}
                className={`flex shrink-0 items-center gap-1.5 rounded-sm px-3 py-1.5 text-sm font-semibold transition-colors ${
                  isActive
                    ? 'bg-primary text-white'
                    : 'text-slate-400 hover:bg-white/10 hover:text-white'
                }`}
              >
                <span className="material-symbols-outlined text-lg">{item.icon}</span>
                {item.label}
              </button>
            );
          })}
        </nav>

        {children}
      </div>
    </AccountingShell>
  );
}

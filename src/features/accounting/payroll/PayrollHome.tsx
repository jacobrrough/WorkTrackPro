/**
 * ⚠️  HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING. The payroll module hub. The whole payroll
 *     module is FLAG-DARK (VITE_ACCOUNTING_ENABLED off) and requires a CPA/EA payroll professional
 *     AND/OR security sign-off before it is enabled. This screen (like EVERY payroll screen,
 *     report, and export) renders the PROMINENT UnverifiedBanner. It moves NO money — it only links
 *     to the employee master, pay schedules, pay runs, the Admin Tax-Table editor, and the
 *     statutory report STUBS. The ONLY money path in the whole module is committing a pay run (a
 *     single balanced JE via accounting.commit_pay_run).
 */
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { AccountingShell } from '../components/AccountingShell';
import { UnverifiedBanner } from '../components/UnverifiedBanner';
import {
  payrollEmployeesPath,
  payrollReportsPath,
  payrollRunsPath,
  payrollSchedulesPath,
  payrollTaxTablesPath,
} from '../constants';

interface PayrollTile {
  key: string;
  label: string;
  icon: string;
  description: string;
  to: string;
}

const TILES: PayrollTile[] = [
  {
    key: 'employees',
    label: 'Employees',
    icon: 'badge',
    description: 'W-2 / 1099 master with W-4 & DE-4 withholding inputs and pay setup.',
    to: payrollEmployeesPath(),
  },
  {
    key: 'schedules',
    label: 'Pay schedules',
    icon: 'event_repeat',
    description: 'Named pay frequencies (weekly … monthly) that drive withholding annualization.',
    to: payrollSchedulesPath(),
  },
  {
    key: 'runs',
    label: 'Pay runs',
    icon: 'payments',
    description: 'Calculate → review paychecks → commit a balanced payroll journal entry → paystubs.',
    to: payrollRunsPath(),
  },
  {
    key: 'tax-tables',
    label: 'Tax tables',
    icon: 'table_chart',
    description: 'Admin-updatable federal & CA rates / brackets. Verify every value before use.',
    to: payrollTaxTablesPath(),
  },
  {
    key: 'reports',
    label: 'Reports & filings',
    icon: 'description',
    description: 'W-2 / 1099-NEC / DE-9C and NACHA direct-deposit STUBS — none filing-grade.',
    to: payrollReportsPath(),
  },
];

export default function PayrollHome() {
  const navigate = useNavigate();

  return (
    <AccountingShell active="payroll" title="Payroll (Unverified)">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <UnverifiedBanner detail="Full payroll module — flag-dark. No paycheck, paystub, report, or direct-deposit file produced here is filing-grade or bankable." />

        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-white">
            <span className="material-symbols-outlined text-primary">badge</span>
            Payroll
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Employee management, a pay-run that computes federal (FICA / FUTA / Medicare) and
            California (UI / ETT / SDI / PIT) withholding from admin-updatable tax tables (hours
            sourced read-only from shifts) and posts a balanced payroll journal entry, paystubs, and
            statutory report stubs. Every rate, bracket, and form must be verified by a payroll
            professional before this module is enabled.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {TILES.map((t) => (
            <Card
              key={t.key}
              onClick={() => navigate(t.to)}
              className="flex flex-col items-start gap-2"
              padding="lg"
            >
              <span className="material-symbols-outlined text-2xl text-primary">{t.icon}</span>
              <span className="font-bold text-white">{t.label}</span>
              <span className="text-xs text-slate-400">{t.description}</span>
            </Card>
          ))}
        </div>

        <Card padding="lg" className="border-amber-500/30 bg-amber-500/5">
          <h3 className="flex items-center gap-2 text-sm font-bold text-amber-200">
            <span className="material-symbols-outlined text-base">checklist</span>
            What a human must verify before enabling
          </h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-100/90">
            <li>Every federal & CA rate, wage base, threshold, and withholding bracket against the
              current IRS Pub 15 / Pub 15-T and CA EDD DE 44 for the tax year.</li>
            <li>The withholding formulas and statutory deductions (the engine surfaces known gaps,
              e.g. CA DE 44 Table 5 only and a placeholder UI experience rate).</li>
            <li>Hours sourcing, overtime rules, and the pay-frequency annualization the engine uses.</li>
            <li>The W-2 / 1099-NEC / DE-9C box mapping and the NACHA file format — all are STUBS.</li>
            <li>Encryption / key posture for SSN & bank data (Phase E) before any real data is
              entered.</li>
          </ul>
        </Card>
      </div>
    </AccountingShell>
  );
}

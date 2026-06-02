import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { AccountingShell } from '../components/AccountingShell';
import { TaxDisclaimer } from '../components/TaxDisclaimer';
import {
  ACCOUNTING_REPORTS,
  BUDGETS_BASE,
  REPORTS_BASE,
  cashFlowForecastPath,
  salesTaxLiabilityPath,
  taxCalendarPath,
} from '../constants';

/**
 * Reports index (A3) — links into each financial report. Every report screen shows
 * the same G9 disclaimer and offers PDF/CSV export; it is repeated here because the
 * index itself summarizes financial reporting.
 */
export default function ReportsView() {
  const navigate = useNavigate();

  return (
    <AccountingShell active="reports" title="Reports">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <TaxDisclaimer />

        <p className="text-sm text-slate-400">
          All figures are derived from <span className="font-semibold text-slate-200">posted</span>{' '}
          journal activity only. Drafts and voided entries are excluded.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {ACCOUNTING_REPORTS.map((r) => (
            <Card
              key={r.key}
              onClick={() => navigate(`${REPORTS_BASE}/${r.slug}`)}
              className="flex flex-col gap-1.5"
            >
              <span className="flex items-center gap-2">
                <span className="material-symbols-outlined text-2xl text-primary">{r.icon}</span>
                <span className="font-bold text-white">{r.label}</span>
              </span>
              <span className="text-xs text-slate-400">{r.description}</span>
            </Card>
          ))}
        </div>

        <h3 className="mt-2 text-sm font-bold uppercase tracking-wide text-slate-500">
          Planning &amp; forecasting
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Card onClick={() => navigate(BUDGETS_BASE)} className="flex flex-col gap-1.5">
            <span className="flex items-center gap-2">
              <span className="material-symbols-outlined text-2xl text-primary">savings</span>
              <span className="font-bold text-white">Budgets &amp; Budget vs Actual</span>
            </span>
            <span className="text-xs text-slate-400">
              Plan monthly amounts per account, then compare your plan against posted actuals.
            </span>
          </Card>
          <Card onClick={() => navigate(cashFlowForecastPath())} className="flex flex-col gap-1.5">
            <span className="flex items-center gap-2">
              <span className="material-symbols-outlined text-2xl text-primary">waterfall_chart</span>
              <span className="font-bold text-white">Cash-Flow Forecast</span>
            </span>
            <span className="text-xs text-slate-400">
              Project cash in from open invoices minus cash out for open bills, by due date.
            </span>
          </Card>
        </div>

        <h3 className="mt-2 text-sm font-bold uppercase tracking-wide text-slate-500">
          Sales tax &amp; compliance
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Card onClick={() => navigate(salesTaxLiabilityPath())} className="flex flex-col gap-1.5">
            <span className="flex items-center gap-2">
              <span className="material-symbols-outlined text-2xl text-primary">receipt_long</span>
              <span className="font-bold text-white">Sales-Tax Liability</span>
            </span>
            <span className="text-xs text-slate-400">
              Tax collected (credits to Sales Tax Payable) by agency, with a CDTFA-style
              taxable/non-taxable summary. Reporting only — no e-filing.
            </span>
          </Card>
          <Card onClick={() => navigate(taxCalendarPath())} className="flex flex-col gap-1.5">
            <span className="flex items-center gap-2">
              <span className="material-symbols-outlined text-2xl text-primary">event</span>
              <span className="font-bold text-white">Tax Calendar</span>
            </span>
            <span className="text-xs text-slate-400">
              Upcoming sales-tax filing deadlines per agency, soonest first. Read-only — no
              reminders are sent.
            </span>
          </Card>
        </div>
      </div>
    </AccountingShell>
  );
}

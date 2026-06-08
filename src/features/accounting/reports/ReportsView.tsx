import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { AccountingShell } from '../components/AccountingShell';
import { TaxDisclaimer } from '../components/TaxDisclaimer';
import {
  ACCOUNTING_REPORTS,
  BUDGETS_BASE,
  REPORTS_BASE,
  cashFlowForecastPath,
  cashFlowStatementPath,
  form1099WorklistPath,
  generalLedgerPath,
  purchasesByVendorPath,
  salesByCustomerPath,
  salesByItemPath,
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
          General ledger &amp; cash flow
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Card onClick={() => navigate(generalLedgerPath())} className="flex flex-col gap-1.5">
            <span className="flex items-center gap-2">
              <span className="material-symbols-outlined text-2xl text-primary">menu_book</span>
              <span className="font-bold text-white">General Ledger</span>
            </span>
            <span className="text-xs text-slate-400">
              Every posted transaction for an account, with a running balance. Drill in from any
              statement’s account row.
            </span>
          </Card>
          <Card onClick={() => navigate(cashFlowStatementPath())} className="flex flex-col gap-1.5">
            <span className="flex items-center gap-2">
              <span className="material-symbols-outlined text-2xl text-primary">water_drop</span>
              <span className="font-bold text-white">Statement of Cash Flows</span>
            </span>
            <span className="text-xs text-slate-400">
              Net income adjusted for balance-sheet changes (indirect method), split into operating,
              investing and financing.
            </span>
          </Card>
        </div>

        <h3 className="mt-2 text-sm font-bold uppercase tracking-wide text-slate-500">
          Management reports
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Card onClick={() => navigate(salesByCustomerPath())} className="flex flex-col gap-1.5">
            <span className="flex items-center gap-2">
              <span className="material-symbols-outlined text-2xl text-primary">groups</span>
              <span className="font-bold text-white">Sales by Customer</span>
            </span>
            <span className="text-xs text-slate-400">
              Pre-tax invoice revenue grouped by customer, ranked. Non-void invoices.
            </span>
          </Card>
          <Card onClick={() => navigate(salesByItemPath())} className="flex flex-col gap-1.5">
            <span className="flex items-center gap-2">
              <span className="material-symbols-outlined text-2xl text-primary">category</span>
              <span className="font-bold text-white">Sales by Item</span>
            </span>
            <span className="text-xs text-slate-400">
              Pre-tax invoice revenue grouped by item or service, ranked. Non-void invoices.
            </span>
          </Card>
          <Card onClick={() => navigate(purchasesByVendorPath())} className="flex flex-col gap-1.5">
            <span className="flex items-center gap-2">
              <span className="material-symbols-outlined text-2xl text-primary">
                local_shipping
              </span>
              <span className="font-bold text-white">Purchases by Vendor</span>
            </span>
            <span className="text-xs text-slate-400">
              Bill spend grouped by vendor, ranked. Non-void bills.
            </span>
          </Card>
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
              <span className="material-symbols-outlined text-2xl text-primary">
                waterfall_chart
              </span>
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
          <Card onClick={() => navigate(form1099WorklistPath())} className="flex flex-col gap-1.5">
            <span className="flex items-center gap-2">
              <span className="material-symbols-outlined text-2xl text-primary">badge</span>
              <span className="font-bold text-white">1099-NEC Worklist</span>
            </span>
            <span className="text-xs text-slate-400">
              1099 vendors paid $600+ in a calendar year, with W-9 completeness. Card / third-party
              payments excluded. Reporting only — no e-file.
            </span>
          </Card>
        </div>
      </div>
    </AccountingShell>
  );
}

import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AccountingShell } from '../components/AccountingShell';
import { TaxDisclaimer } from '../components/TaxDisclaimer';
import { REPORTS_BASE } from '../constants';
import { ExportButtons } from './ExportButtons';
import type { ReportDocument } from './reportExport';

interface ReportPageProps {
  title: string;
  /** Period / as-of subtitle line. */
  subtitle: string;
  /** Optional status element (e.g. a BalancedBadge). */
  status?: ReactNode;
  /** Optional filter row (e.g. DateRangeFilter). */
  filter?: ReactNode;
  /** Builds the export document at click-time; null disables export. */
  buildDocument: () => ReportDocument | null;
  /** True while the report data is unavailable (disables export). */
  exportDisabled?: boolean;
  /**
   * Append the C1 sales-tax caveat ("Representative rates only.") to the G9 disclaimer.
   * Used by the Sales-Tax Liability screen; the A3 financial reports leave it off.
   */
  disclaimerRepresentativeRates?: boolean;
  children: ReactNode;
}

/**
 * Shared chrome for a single financial report: AccountingShell + back-to-reports
 * link, a title/subtitle header with export buttons, the G9 disclaimer (always
 * shown — invariant), an optional filter, and the report body. The five report
 * screens supply only their filter + table body.
 */
export function ReportPage({
  title,
  subtitle,
  status,
  filter,
  buildDocument,
  exportDisabled,
  disclaimerRepresentativeRates = false,
  children,
}: ReportPageProps) {
  const navigate = useNavigate();

  return (
    <AccountingShell active="reports" title={title}>
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <button
          type="button"
          onClick={() => navigate(REPORTS_BASE)}
          className="flex items-center gap-1 self-start text-sm font-semibold text-slate-400 hover:text-white"
        >
          <span className="material-symbols-outlined text-lg">arrow_back</span>
          All reports
        </button>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-white">{title}</h2>
            <p className="text-sm text-slate-400">{subtitle}</p>
            {status && <div className="mt-1">{status}</div>}
          </div>
          <ExportButtons buildDocument={buildDocument} disabled={exportDisabled} />
        </div>

        <TaxDisclaimer representativeRates={disclaimerRepresentativeRates} />

        {filter}

        {children}
      </div>
    </AccountingShell>
  );
}

import { Routes, Route, Navigate } from 'react-router-dom';
import { AdminGuard } from '@/components/AdminGuard';
import { lazyWithRetry } from '@/lib/lazyWithRetry';

const AccountingHome = lazyWithRetry(() => import('./AccountingHome'), 'AccountingHome');
const ChartOfAccountsView = lazyWithRetry(
  () => import('./chart-of-accounts/ChartOfAccountsView'),
  'ChartOfAccountsView'
);
const JournalView = lazyWithRetry(() => import('./journal/JournalView'), 'JournalView');
const JournalEntryDetail = lazyWithRetry(
  () => import('./journal/JournalEntryDetail'),
  'JournalEntryDetail'
);
const InvoicesView = lazyWithRetry(() => import('./invoices/InvoicesView'), 'InvoicesView');
const InvoiceCreateView = lazyWithRetry(
  () => import('./invoices/InvoiceCreateView'),
  'InvoiceCreateView'
);
const InvoiceDetailView = lazyWithRetry(
  () => import('./invoices/InvoiceDetailView'),
  'InvoiceDetailView'
);
const BillsView = lazyWithRetry(() => import('./bills/BillsView'), 'BillsView');
const BillCreateView = lazyWithRetry(() => import('./bills/BillCreateView'), 'BillCreateView');
const BillDetailView = lazyWithRetry(() => import('./bills/BillDetailView'), 'BillDetailView');
const ReportsView = lazyWithRetry(() => import('./reports/ReportsView'), 'ReportsView');
const TrialBalanceView = lazyWithRetry(
  () => import('./reports/TrialBalanceView'),
  'TrialBalanceView'
);
const ProfitAndLossView = lazyWithRetry(
  () => import('./reports/ProfitAndLossView'),
  'ProfitAndLossView'
);
const BalanceSheetView = lazyWithRetry(
  () => import('./reports/BalanceSheetView'),
  'BalanceSheetView'
);
const ArAgingView = lazyWithRetry(() => import('./reports/ArAgingView'), 'ArAgingView');
const ApAgingView = lazyWithRetry(() => import('./reports/ApAgingView'), 'ApAgingView');
const SalesTaxLiabilityView = lazyWithRetry(
  () => import('./reports/SalesTaxLiabilityView'),
  'SalesTaxLiabilityView'
);
const TaxCalendarView = lazyWithRetry(() => import('./reports/TaxCalendarView'), 'TaxCalendarView');
const BankAccountsView = lazyWithRetry(
  () => import('./banking/BankAccountsView'),
  'BankAccountsView'
);
const BankAccountDetailView = lazyWithRetry(
  () => import('./banking/BankAccountDetailView'),
  'BankAccountDetailView'
);
const BankImportView = lazyWithRetry(() => import('./banking/BankImportView'), 'BankImportView');
const BankRulesView = lazyWithRetry(() => import('./banking/BankRulesView'), 'BankRulesView');
const BankReconcileView = lazyWithRetry(
  () => import('./banking/BankReconcileView'),
  'BankReconcileView'
);
const BankReconcileDetailView = lazyWithRetry(
  () => import('./banking/BankReconcileDetailView'),
  'BankReconcileDetailView'
);
const JobCostingView = lazyWithRetry(
  () => import('./job-costing/JobCostingView'),
  'JobCostingView'
);
const JobCostingDetailView = lazyWithRetry(
  () => import('./job-costing/JobCostingDetailView'),
  'JobCostingDetailView'
);
const DimensionsView = lazyWithRetry(() => import('./dimensions/DimensionsView'), 'DimensionsView');
const RecurringTemplatesView = lazyWithRetry(
  () => import('./recurring/RecurringTemplatesView'),
  'RecurringTemplatesView'
);
const RecurringTemplateEditView = lazyWithRetry(
  () => import('./recurring/RecurringTemplateEditView'),
  'RecurringTemplateEditView'
);
const InventoryValuationView = lazyWithRetry(
  () => import('./inventory/InventoryValuationView'),
  'InventoryValuationView'
);
const InventoryValuationItemView = lazyWithRetry(
  () => import('./inventory/InventoryValuationItemView'),
  'InventoryValuationItemView'
);
const InventoryCogsWorklistView = lazyWithRetry(
  () => import('./inventory/InventoryCogsWorklistView'),
  'InventoryCogsWorklistView'
);
const AccountingSettingsView = lazyWithRetry(
  () => import('./settings/AccountingSettingsView'),
  'AccountingSettingsView'
);
const TaxTableUpdatesView = lazyWithRetry(
  () => import('./tax-tables/TaxTableUpdatesView'),
  'TaxTableUpdatesView'
);
const TaxTableDriftDetailView = lazyWithRetry(
  () => import('./tax-tables/TaxTableDriftDetailView'),
  'TaxTableDriftDetailView'
);
const BudgetsView = lazyWithRetry(() => import('./budgets/BudgetsView'), 'BudgetsView');
const BudgetEditorView = lazyWithRetry(
  () => import('./budgets/BudgetEditorView'),
  'BudgetEditorView'
);
const BudgetVsActualView = lazyWithRetry(
  () => import('./budgets/BudgetVsActualView'),
  'BudgetVsActualView'
);
const CashFlowForecastView = lazyWithRetry(
  () => import('./budgets/CashFlowForecastView'),
  'CashFlowForecastView'
);
const FixedAssetsView = lazyWithRetry(
  () => import('./fixed-assets/FixedAssetsView'),
  'FixedAssetsView'
);
const FixedAssetCreateView = lazyWithRetry(
  () => import('./fixed-assets/FixedAssetCreateView'),
  'FixedAssetCreateView'
);
const FixedAssetDetailView = lazyWithRetry(
  () => import('./fixed-assets/FixedAssetDetailView'),
  'FixedAssetDetailView'
);
const CustomFieldsView = lazyWithRetry(
  () => import('./custom-fields/CustomFieldsView'),
  'CustomFieldsView'
);
// IMPORT / MIGRATION (HELD / UNVERIFIED — NOT FOR FILING). Every screen renders the
// UnverifiedBanner; only an explicit admin commit posts balanced opening-balance entries.
const ImportBatchesView = lazyWithRetry(
  () => import('./import/ImportBatchesView'),
  'ImportBatchesView'
);
const ImportBatchDetailView = lazyWithRetry(
  () => import('./import/ImportBatchDetailView'),
  'ImportBatchDetailView'
);
// NOTIFICATION DELIVERY (HELD / UNVERIFIED — NOT FOR FILING). The config/preferences surface
// renders the UnverifiedBanner; it edits accounting.notification_rules config only (no money,
// no JE). Delivery is the dispatch RPC / the env-gated server sweep — never this screen.
const NotificationRulesSettingsView = lazyWithRetry(
  () => import('./notifications/NotificationRulesSettingsView'),
  'NotificationRulesSettingsView'
);
// C2 PAYROLL (HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING). Every payroll screen renders the
// UnverifiedBanner (via PayrollScreen); only an explicit commit posts ONE balanced payroll JE (via
// accounting.commit_pay_run). Relative segments under /app/accounting/payroll.
const PayrollHome = lazyWithRetry(() => import('./payroll/PayrollHome'), 'PayrollHome');
const EmployeesView = lazyWithRetry(() => import('./payroll/EmployeesView'), 'EmployeesView');
const EmployeeEditView = lazyWithRetry(
  () => import('./payroll/EmployeeEditView'),
  'EmployeeEditView'
);
const PaySchedulesView = lazyWithRetry(
  () => import('./payroll/PaySchedulesView'),
  'PaySchedulesView'
);
const PayRunsView = lazyWithRetry(() => import('./payroll/PayRunsView'), 'PayRunsView');
const PayRunWorkspaceView = lazyWithRetry(
  () => import('./payroll/PayRunWorkspaceView'),
  'PayRunWorkspaceView'
);
const PaystubView = lazyWithRetry(() => import('./payroll/PaystubView'), 'PaystubView');
const TaxTablesView = lazyWithRetry(() => import('./payroll/TaxTablesView'), 'TaxTablesView');
const PayrollReportsView = lazyWithRetry(
  () => import('./payroll/PayrollReportsView'),
  'PayrollReportsView'
);
// PHASE E SECURITY HARDENING (HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING). Every security screen
// renders the UnverifiedBanner (via SecurityScreen). NOTHING here moves money or posts a journal
// entry. Relative segments under /app/accounting/settings/security.
const SecurityOverviewView = lazyWithRetry(
  () => import('./security/SecurityOverviewView'),
  'SecurityOverviewView'
);
const AuditChainDetailView = lazyWithRetry(
  () => import('./security/AuditChainDetailView'),
  'AuditChainDetailView'
);
const RbacManagementView = lazyWithRetry(
  () => import('./security/RbacManagementView'),
  'RbacManagementView'
);
const BackupRestoreView = lazyWithRetry(
  () => import('./security/BackupRestoreView'),
  'BackupRestoreView'
);

/**
 * Single lazy entry point for the whole accounting module. AppRouter mounts this at
 * /app/accounting/* ONLY when the build flag is on — and because the import lives in
 * a flag-gated ternary there, the entire module (this file + every screen chunk) is
 * excluded from the production build when the flag is off.
 *
 * AdminGuard gates the whole subtree (Phase 1). Swap in a finer AccountingGuard here
 * when accounting roles graduate. Child paths are relative to /app/accounting.
 */
export default function AccountingRouter() {
  return (
    <AdminGuard>
      <Routes>
        <Route index element={<AccountingHome />} />
        <Route path="accounts" element={<ChartOfAccountsView />} />
        <Route path="journal" element={<JournalView />} />
        <Route path="journal/:entryId" element={<JournalEntryDetail />} />
        <Route path="invoices" element={<InvoicesView />} />
        <Route path="invoices/new" element={<InvoiceCreateView />} />
        <Route path="invoices/:invoiceId" element={<InvoiceDetailView />} />
        <Route path="bills" element={<BillsView />} />
        <Route path="bills/new" element={<BillCreateView />} />
        <Route path="bills/:billId" element={<BillDetailView />} />
        <Route path="reports" element={<ReportsView />} />
        <Route path="reports/trial-balance" element={<TrialBalanceView />} />
        <Route path="reports/profit-and-loss" element={<ProfitAndLossView />} />
        <Route path="reports/balance-sheet" element={<BalanceSheetView />} />
        <Route path="reports/ar-aging" element={<ArAgingView />} />
        <Route path="reports/ap-aging" element={<ApAgingView />} />
        <Route path="reports/sales-tax" element={<SalesTaxLiabilityView />} />
        <Route path="reports/tax-calendar" element={<TaxCalendarView />} />
        <Route path="banking" element={<BankAccountsView />} />
        <Route path="banking/:bankAccountId" element={<BankAccountDetailView />} />
        <Route path="banking/:bankAccountId/import" element={<BankImportView />} />
        <Route path="banking/:bankAccountId/rules" element={<BankRulesView />} />
        <Route path="banking/:bankAccountId/reconcile" element={<BankReconcileView />} />
        <Route
          path="banking/:bankAccountId/reconcile/:reconciliationId"
          element={<BankReconcileDetailView />}
        />
        <Route path="job-costing" element={<JobCostingView />} />
        <Route path="job-costing/:jobId" element={<JobCostingDetailView />} />
        <Route path="dimensions" element={<DimensionsView />} />
        <Route path="recurring" element={<RecurringTemplatesView />} />
        <Route path="recurring/new" element={<RecurringTemplateEditView />} />
        <Route path="recurring/:templateId" element={<RecurringTemplateEditView />} />
        <Route path="inventory" element={<InventoryValuationView />} />
        <Route path="inventory/cogs" element={<InventoryCogsWorklistView />} />
        <Route path="inventory/items/:sourceInventoryId" element={<InventoryValuationItemView />} />
        <Route path="settings" element={<AccountingSettingsView />} />
        {/* NOTIFICATION DELIVERY (HELD / UNVERIFIED — NOT FOR FILING) — config surface under
            Settings. Banner on screen; edits config only (no money/JE). */}
        <Route path="settings/notifications" element={<NotificationRulesSettingsView />} />
        {/* TAX-SYNC (ADVISORY-ONLY) — accounting_admin-only screens under Settings. */}
        <Route path="settings/tax-tables" element={<TaxTableUpdatesView />} />
        <Route path="settings/tax-tables/drift/:driftId" element={<TaxTableDriftDetailView />} />
        {/* PHASE E SECURITY HARDENING (HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING) — screens under
            Settings. Banner on every screen; nothing moves money or posts a JE. The audit-chain
            detail is reached FROM the overview. */}
        <Route path="settings/security" element={<SecurityOverviewView />} />
        <Route path="settings/security/audit-chain" element={<AuditChainDetailView />} />
        <Route path="settings/security/roles" element={<RbacManagementView />} />
        <Route path="settings/security/backup" element={<BackupRestoreView />} />
        <Route path="budgets" element={<BudgetsView />} />
        {/* Static segment ranks above :budgetId, so the forecast resolves correctly. */}
        <Route path="budgets/cash-flow" element={<CashFlowForecastView />} />
        <Route path="budgets/:budgetId" element={<BudgetEditorView />} />
        <Route path="budgets/:budgetId/vs-actual" element={<BudgetVsActualView />} />
        <Route path="fixed-assets" element={<FixedAssetsView />} />
        {/* Static segment ranks above :assetId, so "new" resolves to the create form. */}
        <Route path="fixed-assets/new" element={<FixedAssetCreateView />} />
        <Route path="fixed-assets/:assetId" element={<FixedAssetDetailView />} />
        <Route path="custom-fields" element={<CustomFieldsView />} />
        {/* IMPORT / MIGRATION (HELD / UNVERIFIED — NOT FOR FILING). Banner on every screen. */}
        <Route path="import" element={<ImportBatchesView />} />
        <Route path="import/:batchId" element={<ImportBatchDetailView />} />
        {/* C2 PAYROLL (HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING). Banner on every screen +
            export. Static segments (employees/new, schedules) are registered before the dynamic
            :employeeId/:runId so they resolve first; the paystub path is the most specific. */}
        <Route path="payroll" element={<PayrollHome />} />
        <Route path="payroll/employees" element={<EmployeesView />} />
        <Route path="payroll/employees/:employeeId" element={<EmployeeEditView />} />
        <Route path="payroll/schedules" element={<PaySchedulesView />} />
        <Route path="payroll/runs" element={<PayRunsView />} />
        <Route path="payroll/runs/:runId" element={<PayRunWorkspaceView />} />
        <Route path="payroll/runs/:runId/paychecks/:paycheckId" element={<PaystubView />} />
        <Route path="payroll/tax-tables" element={<TaxTablesView />} />
        <Route path="payroll/reports" element={<PayrollReportsView />} />
        <Route path="*" element={<Navigate to="/app/accounting" replace />} />
      </Routes>
    </AdminGuard>
  );
}

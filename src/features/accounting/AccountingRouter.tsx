import { Routes, Route, Navigate } from 'react-router-dom';
import { AdminGuard } from '@/components/AdminGuard';
import { lazyWithRetry } from '@/lib/lazyWithRetry';

const AccountingHome = lazyWithRetry(() => import('./AccountingHome'), 'AccountingHome');
const ChartOfAccountsView = lazyWithRetry(
  () => import('./chart-of-accounts/ChartOfAccountsView'),
  'ChartOfAccountsView'
);
const QuickBooksImportView = lazyWithRetry(
  () => import('./import/QuickBooksImportView'),
  'QuickBooksImportView'
);
const AccountsImport = lazyWithRetry(() => import('./import/AccountsImport'), 'AccountsImport');
const PartyImport = lazyWithRetry(() => import('./import/PartyImport'), 'PartyImport');
const TransactionsImport = lazyWithRetry(
  () => import('./import/TransactionsImport'),
  'TransactionsImport'
);
const QuickBooksConnectView = lazyWithRetry(
  () => import('./integrations/QuickBooksConnectView'),
  'QuickBooksConnectView'
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
const EstimatesView = lazyWithRetry(() => import('./estimates/EstimatesView'), 'EstimatesView');
const EstimateCreateView = lazyWithRetry(
  () => import('./estimates/EstimateCreateView'),
  'EstimateCreateView'
);
const EstimateDetailView = lazyWithRetry(
  () => import('./estimates/EstimateDetailView'),
  'EstimateDetailView'
);
const ProjectsView = lazyWithRetry(() => import('./progress/ProjectsView'), 'ProjectsView');
const ProjectDetailView = lazyWithRetry(
  () => import('./progress/ProjectDetailView'),
  'ProjectDetailView'
);
const ProgressInvoiceCreateView = lazyWithRetry(
  () => import('./progress/ProgressInvoiceCreateView'),
  'ProgressInvoiceCreateView'
);
const POsView = lazyWithRetry(() => import('./purchase-orders/POsView'), 'POsView');
const POCreateView = lazyWithRetry(() => import('./purchase-orders/POCreateView'), 'POCreateView');
const PODetailView = lazyWithRetry(() => import('./purchase-orders/PODetailView'), 'PODetailView');
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
const GeneralLedgerView = lazyWithRetry(
  () => import('./reports/GeneralLedgerView'),
  'GeneralLedgerView'
);
const AccountLedgerView = lazyWithRetry(
  () => import('./reports/AccountLedgerView'),
  'AccountLedgerView'
);
const CashFlowStatementView = lazyWithRetry(
  () => import('./reports/CashFlowStatementView'),
  'CashFlowStatementView'
);
const SalesByCustomerView = lazyWithRetry(
  () => import('./reports/SalesByCustomerView'),
  'SalesByCustomerView'
);
const SalesByItemView = lazyWithRetry(() => import('./reports/SalesByItemView'), 'SalesByItemView');
const PurchasesByVendorView = lazyWithRetry(
  () => import('./reports/PurchasesByVendorView'),
  'PurchasesByVendorView'
);
const Form1099WorklistView = lazyWithRetry(
  () => import('./reports/Form1099WorklistView'),
  'Form1099WorklistView'
);
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
const TaxJurisdictionsView = lazyWithRetry(
  () => import('./tax-tables/TaxJurisdictionsView'),
  'TaxJurisdictionsView'
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
        <Route path="import" element={<QuickBooksImportView />} />
        <Route path="import/accounts" element={<AccountsImport />} />
        <Route path="import/customers" element={<PartyImport kind="customer" />} />
        <Route path="import/vendors" element={<PartyImport kind="vendor" />} />
        <Route path="import/transactions" element={<TransactionsImport />} />
        {/* QuickBooks Online OAuth connection (import Phase 0). The /api/qbo-oauth/callback
            redirects back here with ?qbo=connected|error. */}
        <Route path="integrations" element={<QuickBooksConnectView />} />
        <Route path="journal" element={<JournalView />} />
        <Route path="journal/:entryId" element={<JournalEntryDetail />} />
        <Route path="invoices" element={<InvoicesView />} />
        <Route path="invoices/new" element={<InvoiceCreateView />} />
        <Route path="invoices/:invoiceId" element={<InvoiceDetailView />} />
        <Route path="estimates" element={<EstimatesView />} />
        <Route path="estimates/new" element={<EstimateCreateView />} />
        <Route path="estimates/:estimateId" element={<EstimateDetailView />} />
        <Route path="progress" element={<ProjectsView />} />
        <Route path="progress/:projectId" element={<ProjectDetailView />} />
        <Route path="progress/:projectId/bill" element={<ProgressInvoiceCreateView />} />
        <Route path="purchase-orders" element={<POsView />} />
        <Route path="purchase-orders/new" element={<POCreateView />} />
        <Route path="purchase-orders/:poId" element={<PODetailView />} />
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
        {/* #3 GL detail + drill-down: static segment ranks above :accountId. */}
        <Route path="reports/general-ledger" element={<GeneralLedgerView />} />
        <Route path="reports/general-ledger/:accountId" element={<AccountLedgerView />} />
        {/* #5 Statement of Cash Flows (distinct slug from the D2 budgets/cash-flow forecast). */}
        <Route path="reports/cash-flow-statement" element={<CashFlowStatementView />} />
        {/* #4 management reports. */}
        <Route path="reports/sales-by-customer" element={<SalesByCustomerView />} />
        <Route path="reports/sales-by-item" element={<SalesByItemView />} />
        <Route path="reports/purchases-by-vendor" element={<PurchasesByVendorView />} />
        {/* #12 1099-NEC worklist (advisory; no e-file). */}
        <Route path="reports/form-1099" element={<Form1099WorklistView />} />
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
        {/* TAX-SYNC (ADVISORY-ONLY) — accounting_admin-only screens under Settings. */}
        <Route path="settings/tax-tables" element={<TaxTableUpdatesView />} />
        <Route path="settings/tax-tables/drift/:driftId" element={<TaxTableDriftDetailView />} />
        {/* #13 Sales-tax jurisdictions (address → tax-code map; advisory). */}
        <Route path="settings/tax-jurisdictions" element={<TaxJurisdictionsView />} />
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
        <Route path="*" element={<Navigate to="/app/accounting" replace />} />
      </Routes>
    </AdminGuard>
  );
}

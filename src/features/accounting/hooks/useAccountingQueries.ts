import { useQuery } from '@tanstack/react-query';
import {
  accountingSettingsService,
  accountsService,
  attachmentsService,
  bankAccountsService,
  bankRulesService,
  bankTransactionsService,
  billsService,
  budgetsService,
  customFieldsService,
  customersService,
  dimensionsService,
  fixedAssetsService,
  importService,
  inventoryCogsService,
  invoicesService,
  jobCostingService,
  journalService,
  notificationRulesService,
  notificationDispatchService,
  paymentsService,
  reconciliationsService,
  recurringTemplatesService,
  reportsService,
  salesTaxService,
  taxService,
  taxTableSyncService,
  vendorPaymentsService,
  vendorsService,
  employeesService,
  payScheduleService,
  payRunService,
  payrollTaxTablesService,
  payrollReportsService,
  securityService,
  rbacService,
  type BankTransactionFilter,
  type ImportStagingFilter,
} from '@/services/api/accounting';
import type { CashFlowForecastOptions } from '../reports/budgetMath';
import type {
  AttachmentEntityType,
  CustomFieldEntityType,
  DateRange,
  DimensionType,
  PayrollReportKind,
  TaxTableDrift,
  TaxTableDriftStatus,
} from '../types';
import { ACCOUNTING_QUERY_KEYS } from '../constants';

/** Chart of accounts. */
export function useAccounts() {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.accounts,
    queryFn: () => accountsService.getAll(),
  });
}

/** Journal entries (most recent first). */
export function useJournalEntries() {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.journal,
    queryFn: () => journalService.list(),
  });
}

/** A single journal entry with its lines (account names hydrated). */
export function useJournalEntry(id: string | undefined) {
  return useQuery({
    queryKey: id ? ACCOUNTING_QUERY_KEYS.journalEntry(id) : ['accounting', 'journal', 'none'],
    queryFn: () => journalService.getById(id as string),
    enabled: !!id,
  });
}

/** AR customer master (active by default). */
export function useCustomers(includeInactive = false) {
  return useQuery({
    queryKey: [...ACCOUNTING_QUERY_KEYS.customers, { includeInactive }] as const,
    queryFn: () => customersService.getAll(includeInactive),
  });
}

/** A single customer. */
export function useCustomer(id: string | undefined) {
  return useQuery({
    queryKey: id ? ACCOUNTING_QUERY_KEYS.customer(id) : ['accounting', 'customers', 'none'],
    queryFn: () => customersService.getById(id as string),
    enabled: !!id,
  });
}

/** Sales-tax codes with their combined rate. */
export function useTaxCodes(includeInactive = false) {
  return useQuery({
    queryKey: [...ACCOUNTING_QUERY_KEYS.taxCodes, { includeInactive }] as const,
    queryFn: () => taxService.getAll(includeInactive),
  });
}

/** Invoice list (most recent first). */
export function useInvoices() {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.invoices,
    queryFn: () => invoicesService.list(),
  });
}

/** A single invoice with its lines (customer name hydrated). */
export function useInvoice(id: string | undefined) {
  return useQuery({
    queryKey: id ? ACCOUNTING_QUERY_KEYS.invoice(id) : ['accounting', 'invoices', 'none'],
    queryFn: () => invoicesService.getById(id as string),
    enabled: !!id,
  });
}

/** Payments applied to a given invoice. */
export function useInvoicePayments(invoiceId: string | undefined) {
  return useQuery({
    queryKey: invoiceId
      ? ACCOUNTING_QUERY_KEYS.invoicePayments(invoiceId)
      : ['accounting', 'invoices', 'none', 'payments'],
    queryFn: () => paymentsService.listForInvoice(invoiceId as string),
    enabled: !!invoiceId,
  });
}

/** Customer payment list (most recent first). */
export function usePayments() {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.payments,
    queryFn: () => paymentsService.list(),
  });
}

// ── AP side (A2): vendors, bills, vendor payments ────────────────────────────

/** AP vendor master (active by default). */
export function useVendors(includeInactive = false) {
  return useQuery({
    queryKey: [...ACCOUNTING_QUERY_KEYS.vendors, { includeInactive }] as const,
    queryFn: () => vendorsService.getAll(includeInactive),
  });
}

/** A single vendor. */
export function useVendor(id: string | undefined) {
  return useQuery({
    queryKey: id ? ACCOUNTING_QUERY_KEYS.vendor(id) : ['accounting', 'vendors', 'none'],
    queryFn: () => vendorsService.getById(id as string),
    enabled: !!id,
  });
}

/** Bill list (most recent first). */
export function useBills() {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.bills,
    queryFn: () => billsService.list(),
  });
}

/** A single bill with its lines (vendor name hydrated). */
export function useBill(id: string | undefined) {
  return useQuery({
    queryKey: id ? ACCOUNTING_QUERY_KEYS.bill(id) : ['accounting', 'bills', 'none'],
    queryFn: () => billsService.getById(id as string),
    enabled: !!id,
  });
}

/** Open bills for a vendor (e.g. to choose what a payment applies to). */
export function useVendorBills(vendorId: string | undefined) {
  return useQuery({
    queryKey: vendorId
      ? ACCOUNTING_QUERY_KEYS.vendorBills(vendorId)
      : ['accounting', 'vendors', 'none', 'bills'],
    queryFn: () => billsService.listForVendor(vendorId as string),
    enabled: !!vendorId,
  });
}

/** Vendor payments applied to a given bill. */
export function useBillPayments(billId: string | undefined) {
  return useQuery({
    queryKey: billId
      ? ACCOUNTING_QUERY_KEYS.billPayments(billId)
      : ['accounting', 'bills', 'none', 'payments'],
    queryFn: () => vendorPaymentsService.listForBill(billId as string),
    enabled: !!billId,
  });
}

/** Vendor payment list (most recent first). */
export function useVendorPayments() {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.vendorPayments,
    queryFn: () => vendorPaymentsService.list(),
  });
}

// ── Financial reports (A3) ───────────────────────────────────────────────────
// Each period report keys by its date range so changing the filter refetches; an
// empty/omitted range means all-time. Aging reports are point-in-time (as of today)
// and take no range. All read posted activity only — there is nothing to mutate.

/** Trial Balance for an optional entry-date window (all-time when omitted). */
export function useTrialBalance(range: DateRange = {}) {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.trialBalance(range),
    queryFn: () => reportsService.getTrialBalance(range),
  });
}

/** Profit & Loss (income − expense) for an optional entry-date window. */
export function useProfitAndLoss(range: DateRange = {}) {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.profitAndLoss(range),
    queryFn: () => reportsService.getProfitAndLoss(range),
  });
}

/** Balance Sheet (assets = liabilities + equity) as of an optional window end. */
export function useBalanceSheet(range: DateRange = {}) {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.balanceSheet(range),
    queryFn: () => reportsService.getBalanceSheet(range),
  });
}

/** AR aging — open customer invoices bucketed by days overdue, as of today. */
export function useArAging() {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.arAging,
    queryFn: () => reportsService.getArAging(),
  });
}

/** AP aging — open vendor bills bucketed by days overdue, as of today. */
export function useApAging() {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.apAging,
    queryFn: () => reportsService.getApAging(),
  });
}

// ── Banking (A4): accounts, transactions, rules, reconciliations ─────────────

/** Bank/credit-card accounts (active by default). */
export function useBankAccounts(includeInactive = false) {
  return useQuery({
    queryKey: [...ACCOUNTING_QUERY_KEYS.bankAccounts, { includeInactive }] as const,
    queryFn: () => bankAccountsService.getAll(includeInactive),
  });
}

/** A single bank account with its linked GL account hydrated. */
export function useBankAccount(id: string | undefined) {
  return useQuery({
    queryKey: id ? ACCOUNTING_QUERY_KEYS.bankAccount(id) : ['accounting', 'bank', 'accounts', 'none'],
    queryFn: () => bankAccountsService.getById(id as string),
    enabled: !!id,
  });
}

/** Imported transactions for a bank account (newest first), optionally filtered. */
export function useBankTransactions(
  bankAccountId: string | undefined,
  filter: BankTransactionFilter = {}
) {
  return useQuery({
    queryKey: bankAccountId
      ? ([...ACCOUNTING_QUERY_KEYS.bankTransactions(bankAccountId), filter] as const)
      : ['accounting', 'bank', 'accounts', 'none', 'transactions'],
    queryFn: () => bankTransactionsService.listForAccount(bankAccountId as string, filter),
    enabled: !!bankAccountId,
  });
}

/** Bank rules — account-scoped (incl. global) when an id is given, else all. */
export function useBankRules(bankAccountId?: string) {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.bankRules(bankAccountId),
    queryFn: () => bankRulesService.list(bankAccountId),
  });
}

/** Reconciliations for a bank account (newest statement first). */
export function useReconciliations(bankAccountId?: string) {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.reconciliations(bankAccountId),
    queryFn: () => reconciliationsService.list(bankAccountId),
  });
}

/** A single reconciliation header. */
export function useReconciliation(id: string | undefined) {
  return useQuery({
    queryKey: id ? ACCOUNTING_QUERY_KEYS.reconciliation(id) : ['accounting', 'bank', 'reconciliations', 'none'],
    queryFn: () => reconciliationsService.getById(id as string),
    enabled: !!id,
  });
}

/** Live reconcile math (beginning + Σ cleared vs. statement ending) for the screen. */
export function useReconciliationSummary(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? ACCOUNTING_QUERY_KEYS.reconciliationSummary(id)
      : ['accounting', 'bank', 'reconciliations', 'none', 'summary'],
    queryFn: () => reconciliationsService.getSummary(id as string),
    enabled: !!id,
  });
}

// ── Job costing (B1) ─────────────────────────────────────────────────────────
// Read-only profitability views over accounting.v_job_costing plus the per-job
// invoice/bill drill-downs for the detail screen. Nothing here mutates.

/** Per-job profitability rows for the dashboard (margin desc from the service). */
export function useJobCosting() {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.jobCostingList,
    queryFn: () => jobCostingService.list(),
  });
}

/** One job's costing row (per-job detail header). */
export function useJobCostingDetail(jobId: string | undefined) {
  return useQuery({
    queryKey: jobId
      ? ACCOUNTING_QUERY_KEYS.jobCostingDetail(jobId)
      : ['accounting', 'job-costing', 'none'],
    queryFn: () => jobCostingService.getByJobId(jobId as string),
    enabled: !!jobId,
  });
}

/** Invoices billed against a job (detail screen drill-down). */
export function useJobInvoices(jobId: string | undefined) {
  return useQuery({
    queryKey: jobId
      ? ACCOUNTING_QUERY_KEYS.jobInvoices(jobId)
      : ['accounting', 'job-costing', 'none', 'invoices'],
    queryFn: () => invoicesService.listForJob(jobId as string),
    enabled: !!jobId,
  });
}

/** Bills charged against a job (detail screen drill-down). */
export function useJobBills(jobId: string | undefined) {
  return useQuery({
    queryKey: jobId
      ? ACCOUNTING_QUERY_KEYS.jobBills(jobId)
      : ['accounting', 'job-costing', 'none', 'bills'],
    queryFn: () => billsService.listForJob(jobId as string),
    enabled: !!jobId,
  });
}

// ── Reporting dimensions (B2) ─────────────────────────────────────────────────
// Class/location/department tags. Pure master data — only dimension CRUD mutates it.

/** All reporting dimensions (active by default), ordered by type then name. */
export function useDimensions(includeInactive = false) {
  return useQuery({
    queryKey: [...ACCOUNTING_QUERY_KEYS.dimensions, { includeInactive }] as const,
    queryFn: () => dimensionsService.list(includeInactive),
  });
}

/** Dimensions of a single type (for the DimensionPicker). */
export function useDimensionsByType(type: DimensionType | undefined, includeInactive = false) {
  return useQuery({
    queryKey: type
      ? ([...ACCOUNTING_QUERY_KEYS.dimensionsByType(type), { includeInactive }] as const)
      : ['accounting', 'dimensions', 'type', 'none'],
    queryFn: () => dimensionsService.listByType(type as DimensionType, includeInactive),
    enabled: !!type,
  });
}

/** A single dimension. */
export function useDimension(id: string | undefined) {
  return useQuery({
    queryKey: id ? ACCOUNTING_QUERY_KEYS.dimension(id) : ['accounting', 'dimensions', 'none'],
    queryFn: () => dimensionsService.getById(id as string),
    enabled: !!id,
  });
}

// ── Recurring templates (B2) ──────────────────────────────────────────────────
// Templates store intent; the generate mutation (useAccountingMutations) is the only
// money path. These queries are read-only.

/** All recurring templates (including paused by default), oldest-due first. */
export function useRecurringTemplates(includeInactive = true) {
  return useQuery({
    queryKey: [...ACCOUNTING_QUERY_KEYS.recurring, { includeInactive }] as const,
    queryFn: () => recurringTemplatesService.list(includeInactive),
  });
}

/** A single recurring template (with its payload). */
export function useRecurringTemplate(id: string | undefined) {
  return useQuery({
    queryKey: id ? ACCOUNTING_QUERY_KEYS.recurringTemplate(id) : ['accounting', 'recurring', 'none'],
    queryFn: () => recurringTemplatesService.getById(id as string),
    enabled: !!id,
  });
}

/** Templates due to generate as of a date (default today). */
export function useRecurringDue(asOf?: string) {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.recurringDue(asOf),
    queryFn: () => recurringTemplatesService.listDue(asOf),
  });
}

// ── Inventory valuation → COGS (B3) ───────────────────────────────────────────
// Read-only views over the FIFO layers + COGS events. The only money path is the
// consume mutation (useAccountingMutations), which posts a balanced JE via the RPC.

/** Per-stock-item inventory valuation (asset value, avg cost, lifetime COGS). */
export function useInventoryValuation() {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.inventoryValuation,
    queryFn: () => inventoryCogsService.valuation(),
  });
}

/** One stock item's valuation row (detail drill-down). */
export function useInventoryValuationItem(sourceInventoryId: string | undefined) {
  return useQuery({
    queryKey: sourceInventoryId
      ? ACCOUNTING_QUERY_KEYS.inventoryValuationItem(sourceInventoryId)
      : ['accounting', 'inventory', 'valuation', 'none'],
    queryFn: () => inventoryCogsService.getValuationFor(sourceInventoryId as string),
    enabled: !!sourceInventoryId,
  });
}

/** The COGS work list: jobs that consumed stock, flagged costed/uncosted. */
export function useConsumableJobs() {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.inventoryConsumableJobs,
    queryFn: () => inventoryCogsService.listConsumableJobs(),
  });
}

/** Posted COGS events (the audit trail), optionally scoped to one job. */
export function useJobCogsEvents(jobId?: string) {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.inventoryCogsEvents(jobId),
    queryFn: () => inventoryCogsService.listCogsEvents(jobId),
  });
}

// ── Books-closed (period lock) date (D1) ──────────────────────────────────────
// The single lock date (or null = books open). Read by the admin Settings screen and
// by any surface that wants to warn before posting/voiding into a closed period. The
// only writer is useSetClosedThroughDate (admin-only RPC, in useAccountingMutations).

/** The current books-closed-through date as `YYYY-MM-DD`, or null when books are open. */
export function useClosedThroughDate() {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.closedThroughDate,
    queryFn: () => accountingSettingsService.getClosedThroughDate(),
  });
}

/**
 * The resolved default GL account mappings (settings.default_accounts), read-only.
 * Surfaced on the Settings screen so an admin can verify which chart-of-accounts
 * account each posting role (AR/income/sales-tax/cash + the COA-EXPAND structural
 * opening-balance/uncategorized/payment-processor accounts) resolves to. The posting
 * layer reads the same mapping internally; nothing in the UI writes it (it is seeded by
 * migration), so there is no companion mutation hook.
 */
export function useDefaultAccounts() {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.defaultAccounts,
    queryFn: () => accountingSettingsService.getDefaultAccounts(),
  });
}

// ── Budgeting & forecasting (D2) ──────────────────────────────────────────────
// Budgets are planning artifacts (no money moves); the editor grid + Budget-vs-Actual
// read under the `budgets` subtree. Budget-vs-Actual derives its actuals from POSTED
// journal lines on the same basis as the trial balance, so it is invalidated by the
// `reports` fan-out too (it keys under `budgets` for the grid relationship but the BvA
// figures change whenever postings change — the budget mutations only touch the plan).
// The cash-flow forecast keys under `reports` since it reflects open AR/AP.

/** All budgets (newest fiscal year first). */
export function useBudgets() {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.budgets,
    queryFn: () => budgetsService.list(),
  });
}

/** A single budget header. */
export function useBudget(id: string | undefined) {
  return useQuery({
    queryKey: id ? ACCOUNTING_QUERY_KEYS.budget(id) : ['accounting', 'budgets', 'none'],
    queryFn: () => budgetsService.getById(id as string),
    enabled: !!id,
  });
}

/** The editor grid (accounts × 12 months) for a budget. */
export function useBudgetGrid(id: string | undefined) {
  return useQuery({
    queryKey: id ? ACCOUNTING_QUERY_KEYS.budgetGrid(id) : ['accounting', 'budgets', 'none', 'grid'],
    queryFn: () => budgetsService.getGrid(id as string),
    enabled: !!id,
  });
}

/** Budget-vs-Actual for a budget's fiscal year (actuals = posted journal lines). */
export function useBudgetVsActual(id: string | undefined) {
  return useQuery({
    queryKey: id ? ACCOUNTING_QUERY_KEYS.budgetVsActual(id) : ['accounting', 'budgets', 'none', 'vs-actual'],
    queryFn: () => budgetsService.getBudgetVsActual(id as string),
    enabled: !!id,
  });
}

/** Cash-flow forecast from open AR/AP due dates (independent of any budget). */
export function useCashFlowForecast(options: CashFlowForecastOptions = {}) {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.cashFlowForecast({
      startMonth: options.startMonth ?? null,
      months: options.months ?? null,
      openingBalance: options.openingBalance ?? null,
    }),
    queryFn: () => budgetsService.getCashFlowForecast(options),
  });
}

// ── Fixed assets & depreciation (D3) ──────────────────────────────────────────
// The register + per-asset schedule read under the `fixedAssets` subtree. Running
// depreciation posts balanced JEs, so the run-depreciation mutation (useAccountingMutations)
// invalidates fixedAssets + journal + reports — but the queries here are read-only.

/** All fixed assets (newest in-service first). */
export function useFixedAssets() {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.fixedAssetList,
    queryFn: () => fixedAssetsService.list(),
  });
}

/** The asset register: cost, accumulated depreciation, net book value, remaining plan. */
export function useFixedAssetRegister() {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.fixedAssetRegister,
    queryFn: () => fixedAssetsService.register(),
  });
}

/** A single fixed-asset header. */
export function useFixedAsset(id: string | undefined) {
  return useQuery({
    queryKey: id ? ACCOUNTING_QUERY_KEYS.fixedAsset(id) : ['accounting', 'fixed-assets', 'none'],
    queryFn: () => fixedAssetsService.getById(id as string),
    enabled: !!id,
  });
}

/** A single asset's register row (detail header: NBV, accumulated depreciation). */
export function useFixedAssetRegisterRow(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? ([...ACCOUNTING_QUERY_KEYS.fixedAsset(id), 'register'] as const)
      : ['accounting', 'fixed-assets', 'none', 'register'],
    queryFn: () => fixedAssetsService.getRegisterRow(id as string),
    enabled: !!id,
  });
}

/** One asset's full planned/posted depreciation schedule (oldest period first). */
export function useFixedAssetSchedule(fixedAssetId: string | undefined) {
  return useQuery({
    queryKey: fixedAssetId
      ? ACCOUNTING_QUERY_KEYS.fixedAssetSchedule(fixedAssetId)
      : ['accounting', 'fixed-assets', 'none', 'schedule'],
    queryFn: () => fixedAssetsService.listSchedule(fixedAssetId as string),
    enabled: !!fixedAssetId,
  });
}

// ── Custom fields on accounting entities (D4) ─────────────────────────────────
// The admin definitions list (optionally scoped to one entity type) and the per-entity
// value list read under the `customFields` subtree. Pure metadata — only the custom-field
// mutations (useAccountingMutations) invalidate it; nothing here moves money.

/**
 * Custom field DEFINITIONS, optionally for a single entity type. With an entity type the
 * service returns active-only defs in render order (what the host create/detail screens
 * consume); without one it returns all defs across entity types for the admin screen.
 * `includeInactive` surfaces deactivated defs (admin management).
 */
export function useCustomFieldDefs(
  entityType?: CustomFieldEntityType,
  includeInactive = false
) {
  return useQuery({
    queryKey: [...ACCOUNTING_QUERY_KEYS.customFieldDefs(entityType), { includeInactive }] as const,
    queryFn: () =>
      entityType
        ? customFieldsService.listDefsForEntity(entityType, includeInactive)
        : customFieldsService.listDefs(includeInactive),
  });
}

/**
 * The render-ready custom fields for ONE entity row: every active definition for the
 * entity type paired with its current value (null when unset), in render order. This is
 * the single read the host create/detail screens use to render/edit custom fields. Both
 * `entityType` and `entityId` must be present (a draft with no id yet renders defs with
 * null values via useCustomFieldDefs instead).
 */
export function useEntityCustomFields(
  entityType: CustomFieldEntityType | undefined,
  entityId: string | undefined,
  includeInactive = false
) {
  return useQuery({
    queryKey:
      entityType && entityId
        ? ([...ACCOUNTING_QUERY_KEYS.customFieldValues(entityType, entityId), { includeInactive }] as const)
        : ['accounting', 'custom-fields', 'values', 'none'],
    queryFn: () =>
      customFieldsService.listForEntity(
        entityType as CustomFieldEntityType,
        entityId as string,
        includeInactive
      ),
    enabled: !!entityType && !!entityId,
  });
}

// ── Sales-tax reporting & tax calendar (C1) ───────────────────────────────────
// Both are READ-ONLY over the posted ledger + tax_* tables + the tax_filing_calendar
// settings row. The liability report keys by date range (an empty range = all-time);
// the calendar keys by "as of". C1 mutates nothing, so there are no companion mutation
// hooks — nothing here is ever invalidated by an accounting action.

/**
 * Sales-tax liability report for an optional entry-date window (all-time when omitted):
 * tax COLLECTED (net credit to the 2200 "Sales Tax Payable" account) grouped by tax
 * agency/jurisdiction, with a CDTFA-style taxable/non-taxable summary and an explicit
 * "Unattributed / review" bucket for any 2200 credit that cannot be tied to a source
 * invoice/agency (surfaced, never guessed).
 */
export function useSalesTaxLiability(range: DateRange = {}) {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.salesTaxLiability(range),
    queryFn: () => salesTaxService.getSalesTaxLiability(range),
  });
}

/**
 * Read-only tax-calendar dashboard: upcoming/recent filing deadlines per agency,
 * soonest due first, computed from the tax_filing_calendar settings rules (falling back
 * to each agency's filing_frequency). NO notification is delivered. `asOf` defaults to
 * today in the service; passing it explicitly keys the cache per reference date.
 */
export function useTaxFilingCalendar(asOf?: string, upcoming = 4) {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.taxCalendar(asOf),
    queryFn: () => salesTaxService.getTaxFilingCalendar(asOf, upcoming),
  });
}

// ── TAX-SYNC: quarterly tax-table refresh + drift alert (ADVISORY-ONLY) ────────────────
// Reads over the accounting.tax_table_* tables (migration 022). All ADVISORY: the sources
// list, snapshot history, the drift inbox (the in-app admin alert), the open-drift COUNT
// (badge), and a drift's detail + current-rates preview. Only the TAX-SYNC mutations
// (useAccountingMutations: apply / dismiss / check-now) invalidate this subtree; nothing
// here moves money. G9 disclaimer is rendered by the UI lane.

/** Tax-table sources (active first); includes inactive by default for the admin screen. */
export function useTaxTableSources(includeInactive = true) {
  return useQuery({
    queryKey: [...ACCOUNTING_QUERY_KEYS.taxTableSources, { includeInactive }] as const,
    queryFn: () => taxTableSyncService.listSources(includeInactive),
  });
}

/** Snapshot (pull) history for one source, newest first. `raw` text is omitted from list. */
export function useTaxTableSnapshots(sourceId: string | undefined, limit = 50) {
  return useQuery({
    queryKey: sourceId
      ? ([...ACCOUNTING_QUERY_KEYS.taxTableSnapshots(sourceId), { limit }] as const)
      : ['accounting', 'tax-table-sync', 'sources', 'none', 'snapshots'],
    queryFn: () => taxTableSyncService.listSnapshots(sourceId as string, limit),
    enabled: !!sourceId,
  });
}

/**
 * Drift rows, optionally filtered by status. Pass 'open' for the actionable inbox; omit
 * for the full history. Each row is hydrated with its source name/kind.
 */
export function useTaxTableDrift(status?: TaxTableDriftStatus) {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.taxTableDrift(status),
    queryFn: () => taxTableSyncService.listDrift(status),
  });
}

/**
 * Count of OPEN drift — the number the admin "Tax table updates" badge shows. Cheap
 * head+exact count (no rows transferred). Refetches when the TAX-SYNC mutations invalidate
 * the subtree.
 */
export function useOpenTaxTableDriftCount() {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.taxTableDriftOpenCount,
    queryFn: () => taxTableSyncService.countOpenDrift(),
  });
}

/** One drift row (source hydrated) for the detail screen. */
export function useTaxTableDriftDetail(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? ACCOUNTING_QUERY_KEYS.taxTableDriftDetail(id)
      : ['accounting', 'tax-table-sync', 'drift', 'none'],
    queryFn: () => taxTableSyncService.getDriftById(id as string),
    enabled: !!id,
  });
}

/**
 * The ACTIVE stored tax rates a drift's applicable diff entries target, keyed by name —
 * the "currently stored" side of the drift detail's old-vs-new comparison. Depends on the
 * already-loaded drift (so the detail screen passes the drift it fetched). Returns a Map;
 * an entry absent from the Map means Apply would INSERT a new active rate of that name.
 */
export function useTaxTableDriftCurrentRates(drift: TaxTableDrift | null | undefined) {
  return useQuery({
    queryKey: drift
      ? ACCOUNTING_QUERY_KEYS.taxTableDriftRates(drift.id)
      : ['accounting', 'tax-table-sync', 'drift', 'none', 'current-rates'],
    queryFn: () => taxTableSyncService.getCurrentRatesForDrift(drift as TaxTableDrift),
    enabled: !!drift,
  });
}

// ── IMPORT / MIGRATION (HELD / UNVERIFIED — NOT FOR FILING) ────────────────────────────
// Reads over accounting.import_batches / import_staging / import_account_map (migration
// 20260601000024). All READ-ONLY: the batch list, a batch header, its staging rows
// (optionally filtered), its account-map wizard rows, the live opening-balance
// reconciliation, and the 'ready' pre-flight blockers. Only the COMMIT mutation
// (useAccountingMutations) posts money; nothing here moves money. The UI renders the
// "UNVERIFIED — NOT FOR FILING" banner on every screen + export. With VITE_ACCOUNTING_ENABLED
// unset none of this is reachable and it is stripped from the production build.

/** All import batches (newest first). */
export function useImportBatches() {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.importBatches,
    queryFn: () => importService.listBatches(),
  });
}

/** One import batch header (with a staging row count). */
export function useImportBatch(id: string | undefined) {
  return useQuery({
    queryKey: id ? ACCOUNTING_QUERY_KEYS.importBatch(id) : ['accounting', 'import', 'batches', 'none'],
    queryFn: () => importService.getBatch(id as string),
    enabled: !!id,
  });
}

/** Stable cache-key fragment for a staging filter (entity type + postable flag). */
function stagingFilterKey(filter: ImportStagingFilter): string {
  return `${filter.entityType ?? 'any'}:${filter.postableOnly ? 'postable' : 'all'}`;
}

/** Staged source records for a batch (sort order), optionally filtered by entity type. */
export function useImportStaging(batchId: string | undefined, filter: ImportStagingFilter = {}) {
  return useQuery({
    queryKey: batchId
      ? ACCOUNTING_QUERY_KEYS.importStaging(batchId, stagingFilterKey(filter))
      : ['accounting', 'import', 'batches', 'none', 'staging'],
    queryFn: () => importService.listStaging(batchId as string, filter),
    enabled: !!batchId,
  });
}

/** The chart-of-accounts mapping wizard rows for a batch. */
export function useImportAccountMap(batchId: string | undefined) {
  return useQuery({
    queryKey: batchId
      ? ACCOUNTING_QUERY_KEYS.importAccountMap(batchId)
      : ['accounting', 'import', 'batches', 'none', 'account-map'],
    queryFn: () => importService.listAccountMap(batchId as string),
    enabled: !!batchId,
  });
}

/**
 * The live opening-balance reconciliation for a batch (Σ debits/credits in cents + the
 * equity/liability offset plugs the commit will book). `sourceBalances` is the human's key
 * "reconciles to the source trial balance" check, shown before any commit.
 */
export function useImportReconciliation(batchId: string | undefined) {
  return useQuery({
    queryKey: batchId
      ? ACCOUNTING_QUERY_KEYS.importReconciliation(batchId)
      : ['accounting', 'import', 'batches', 'none', 'reconciliation'],
    queryFn: () => importService.reconcile(batchId as string),
    enabled: !!batchId,
  });
}

/** The blockers preventing a batch from being marked 'ready' (empty ⇒ committable). */
export function useImportReadyBlockers(batchId: string | undefined) {
  return useQuery({
    queryKey: batchId
      ? ACCOUNTING_QUERY_KEYS.importReadyBlockers(batchId)
      : ['accounting', 'import', 'batches', 'none', 'ready-blockers'],
    queryFn: () => importService.readyBlockers(batchId as string),
    enabled: !!batchId,
  });
}

// ── NOTIFICATION DELIVERY (HELD / UNVERIFIED — NOT FOR FILING) ─────────────────────────
// Reads over accounting.notification_rules (migration 20260601000025). READ-ONLY config:
// the five event rules (ship DISABLED) for the preferences/config surface, plus the recipient
// AUDIENCE preview (accounting-role holders + approved admins) so an admin can see who would
// be notified before enabling anything. NOTHING here delivers — delivery is the dispatch
// mutation (useAccountingMutations) / the env-gated server sweep. NO money moves. The config
// surface renders the "UNVERIFIED — NOT FOR FILING" banner. With VITE_ACCOUNTING_ENABLED unset
// none of this is reachable and it is stripped from the production build.

/** The five notification rules (ship DISABLED), for the config/preferences surface. */
export function useNotificationRules() {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.notificationRules,
    queryFn: () => notificationRulesService.list(),
  });
}

/**
 * The recipient AUDIENCE preview: distinct user ids who would receive accounting notifications
 * (accounting-role holders + approved admins). Lets an admin see the blast radius before
 * enabling a rule. READ-ONLY over public.* — leaks no financial detail.
 */
export function useNotificationRecipients() {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.notificationRecipients,
    queryFn: () => notificationDispatchService.resolveRecipientIds(),
  });
}

// ── DOCUMENT MANAGEMENT / ATTACHMENTS (HELD / UNVERIFIED — NOT FOR FILING) ─────────────
// Read over accounting.attachments (migration 20260601000026) for ONE entity, reusing the
// existing `attachments` storage bucket for the bytes. READ-ONLY here — uploading/removing is
// a mutation (useAccountingMutations). NO money moves. The attachment control + its preview
// render the "UNVERIFIED — NOT FOR FILING" banner (and disclose that files are unencrypted).
// With VITE_ACCOUNTING_ENABLED unset none of this is reachable and it is stripped from the
// production build.

/**
 * All attachments for one accounting entity (newest first), for the upload/list/preview
 * control mounted on the entity's detail screen. `enabled` only when both the entity type and
 * id are present (a draft with no id yet has nothing to attach to). Keyed by (entityType,
 * entityId) so attaching/removing on one entity refetches ONLY that entity's list.
 */
export function useAccountingAttachments(
  entityType: AttachmentEntityType | undefined,
  entityId: string | undefined
) {
  return useQuery({
    queryKey:
      entityType && entityId
        ? ACCOUNTING_QUERY_KEYS.attachmentsForEntity(entityType, entityId)
        : ['accounting', 'attachments', 'none'],
    queryFn: () => attachmentsService.listForEntity(entityType as AttachmentEntityType, entityId as string),
    enabled: !!entityType && !!entityId,
  });
}

// ── C2 PAYROLL (HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING) ─────────────────────────
// Reads over accounting.employees / pay_schedules / pay_runs / paychecks / payroll_liabilities /
// payroll_tax_tables (migrations 028–029). All READ-ONLY here: the employee master, pay schedules,
// the pay-run list + a run's header / paychecks / liabilities, the admin tax tables (+ the seeded
// kinds so the UI can flag gaps), and the W-2/1099-NEC/DE-9C + NACHA report STUBS. Only the
// CALCULATE / COMMIT / VOID mutations (useAccountingMutations) write; only COMMIT moves money. The
// UI banners every screen + export. With VITE_ACCOUNTING_ENABLED unset none of this is reachable
// and it is stripped from the production build.

/** Employee master (active by default), name-ordered. */
export function useEmployees(includeInactive = false) {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.employees(includeInactive),
    queryFn: () => employeesService.list(includeInactive),
  });
}

/** A single employee (W-4/DE-4 + pay setup). */
export function useEmployee(id: string | undefined) {
  return useQuery({
    queryKey: id ? ACCOUNTING_QUERY_KEYS.employee(id) : ['accounting', 'payroll', 'employees', 'none'],
    queryFn: () => employeesService.getById(id as string),
    enabled: !!id,
  });
}

/** Pay schedules (active by default). */
export function usePaySchedules(includeInactive = false) {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.paySchedules(includeInactive),
    queryFn: () => payScheduleService.list(includeInactive),
  });
}

/** A single pay schedule. */
export function usePaySchedule(id: string | undefined) {
  return useQuery({
    queryKey: id ? ACCOUNTING_QUERY_KEYS.paySchedule(id) : ['accounting', 'payroll', 'pay-schedules', 'none'],
    queryFn: () => payScheduleService.getById(id as string),
    enabled: !!id,
  });
}

/** Pay-run list (newest pay date first). */
export function usePayRuns() {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.payRuns,
    queryFn: () => payRunService.list(),
  });
}

/** A single pay-run header. */
export function usePayRun(id: string | undefined) {
  return useQuery({
    queryKey: id ? ACCOUNTING_QUERY_KEYS.payRun(id) : ['accounting', 'payroll', 'pay-runs', 'none'],
    queryFn: () => payRunService.getById(id as string),
    enabled: !!id,
  });
}

/** A run's paychecks (employee name hydrated) — the review/paystub list. */
export function usePayRunPaychecks(runId: string | undefined) {
  return useQuery({
    queryKey: runId ? ACCOUNTING_QUERY_KEYS.payRunPaychecks(runId) : ['accounting', 'payroll', 'pay-runs', 'none', 'paychecks'],
    queryFn: () => payRunService.listPaychecks(runId as string),
    enabled: !!runId,
  });
}

/** A run's per-agency liability accruals (the 2300 breakdown). */
export function usePayRunLiabilities(runId: string | undefined) {
  return useQuery({
    queryKey: runId ? ACCOUNTING_QUERY_KEYS.payRunLiabilities(runId) : ['accounting', 'payroll', 'pay-runs', 'none', 'liabilities'],
    queryFn: () => payRunService.listLiabilities(runId as string),
    enabled: !!runId,
  });
}

/** A single paycheck (for the paystub view). */
export function usePaycheck(id: string | undefined) {
  return useQuery({
    queryKey: id ? ACCOUNTING_QUERY_KEYS.paycheck(id) : ['accounting', 'payroll', 'paychecks', 'none'],
    queryFn: () => payRunService.getPaycheck(id as string),
    enabled: !!id,
  });
}

/**
 * The admin tax-table rows for a tax year (active + inactive by default for the Admin Tax-Table
 * editor). VERIFY every rate/bracket against current IRS Pub 15-T & CA EDD before any real use.
 */
export function usePayrollTaxTables(taxYear: number, includeInactive = true) {
  return useQuery({
    queryKey: [...ACCOUNTING_QUERY_KEYS.payrollTaxTables(taxYear), { includeInactive }] as const,
    queryFn: () => payrollTaxTablesService.listForYear(taxYear, includeInactive),
  });
}

/** The distinct seeded tax years (for the year picker). */
export function usePayrollTaxTableYears() {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.payrollTaxTableYears,
    queryFn: () => payrollTaxTablesService.listTaxYears(),
  });
}

/** The tax KINDS seeded (active) for a year — so the UI can flag missing-table GAPS. */
export function usePayrollSeededKinds(taxYear: number) {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.payrollSeededKinds(taxYear),
    queryFn: () => payrollTaxTablesService.seededKinds(taxYear),
  });
}

/**
 * A statutory report STUB (W-2 / 1099-NEC / DE-9C) for a tax year (optionally a quarter for
 * DE-9C), aggregated from COMMITTED paychecks. NOT filing-grade — the result carries
 * `unverified: true` and the UI banners the export.
 */
export function usePayrollReport(kind: PayrollReportKind | undefined, taxYear: number, quarter: number | null = null) {
  return useQuery({
    queryKey: kind
      ? ACCOUNTING_QUERY_KEYS.payrollReport(kind, taxYear, quarter)
      : ['accounting', 'payroll', 'reports', 'none'],
    queryFn: () => payrollReportsService.buildReport(kind as PayrollReportKind, taxYear, quarter),
    enabled: !!kind,
  });
}

/** The committed pay runs for a year (the reports index). */
export function usePayrollCommittedRuns(taxYear: number) {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.payrollCommittedRuns(taxYear),
    queryFn: () => payrollReportsService.committedRunsForYear(taxYear),
  });
}

/**
 * The NACHA direct-deposit STUB for a committed run. PLACEHOLDER only — `bankable` is always false
 * and no real bank details are read (Phase E). The UI banners it heavily.
 */
export function usePayrollNachaStub(runId: string | undefined) {
  return useQuery({
    queryKey: runId ? ACCOUNTING_QUERY_KEYS.payrollNachaStub(runId) : ['accounting', 'payroll', 'pay-runs', 'none', 'nacha-stub'],
    queryFn: () => payrollReportsService.buildNachaStub(runId as string),
    enabled: !!runId,
  });
}

// ── PHASE E SECURITY HARDENING (HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING) ─────────────────
// Reads over the Phase E DB layer (migrations 031/032/033): the encryption-coverage probe, the
// audit hash-chain integrity badge + full verification, the read-only security-settings blobs, and
// the RBAC grants/summaries/candidates. All READ-ONLY here; the security/rbac mutations
// (useAccountingMutations) write. NOTHING moves money or posts a journal entry. Every security
// screen renders the UnverifiedBanner (UI lane). With VITE_ACCOUNTING_ENABLED unset none of this is
// reachable and it is stripped from the production build. A SECURITY review is required before the
// module is enabled (key management/rotation, encryption coverage, hash-chain integrity, backup).

/**
 * Per-field plaintext-vs-ciphertext COUNTS (accounting.encryption_coverage) — drives the Security
 * Overview "cutover progress" display. COUNTS ONLY; the RPC never returns a sensitive value.
 */
export function useEncryptionCoverage() {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.securityCoverage,
    queryFn: () => securityService.encryptionCoverage(),
  });
}

/**
 * The audit hash-chain integrity badge (accounting.audit_chain_status): { verified, chainedRows,
 * unchainedRows, firstBreakSeq }. `verified` is true only when the full walk found NO break.
 */
export function useAuditChainStatus() {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.securityAuditChainStatus,
    queryFn: () => securityService.auditChainStatus(),
  });
}

/**
 * The full per-seq audit-chain verification (accounting.verify_audit_chain) — one row per inspected
 * chain_seq with ok / reason / stored-vs-expected hash, for the integrity-detail screen. `from`
 * defaults to genesis (1).
 */
export function useAuditChainVerification(from = 1) {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.securityAuditChainVerify(from),
    queryFn: () => securityService.verifyAuditChain(from),
  });
}

/** The default per-route rate limits the E5 limiter consumes (read-only Security settings). */
export function useSecurityRateLimits() {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.securityRateLimits,
    queryFn: () => securityService.getRateLimits(),
  });
}

/** The documented backup/restore policy surfaced on the Backup/Restore STUB screen (read-only). */
export function useBackupPolicy() {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.securityBackupPolicy,
    queryFn: () => securityService.getBackupPolicy(),
  });
}

/**
 * The role grants collapsed PER USER (the RBAC management screen's primary list): one row per user
 * with the roles they hold + the underlying grant rows. Reads accounting.user_roles (RLS: any
 * role-holder may read) and hydrates user email/name from public.profiles.
 */
export function useUserRoles() {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.rbacUserRoles,
    queryFn: () => rbacService.listUserRoles(),
  });
}

/** Candidate users (approved profiles) the admin can grant a role to — the "add a grant" picker. */
export function useRoleCandidates() {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.rbacCandidates,
    queryFn: () => rbacService.listCandidates(),
  });
}

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
  estimatesService,
  documentSnapshotsService,
  documentActivityService,
  progressBillingService,
  projectsService,
  purchaseOrdersService,
  vendor1099Service,
  taxJurisdictionsService,
  fixedAssetsService,
  inventoryCogsService,
  invoicesService,
  invoiceEmailsService,
  jobCostingService,
  journalService,
  managementReportsService,
  paymentsService,
  plaidService,
  reconciliationsService,
  recurringTemplatesService,
  reportsService,
  salesTaxService,
  taxService,
  taxTableSyncService,
  vendorPaymentsService,
  vendorsService,
  type BankTransactionFilter,
} from '@/services/api/accounting';
import type { CashFlowForecastOptions } from '../reports/budgetMath';
import type {
  AttachmentEntityType,
  CustomFieldEntityType,
  DateRange,
  DimensionType,
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

/** One customer's invoices (the Customers hub). */
export function useInvoicesByCustomer(customerId: string | undefined) {
  return useQuery({
    queryKey: customerId
      ? ACCOUNTING_QUERY_KEYS.customerInvoices(customerId)
      : ['accounting', 'customers', 'none', 'invoices'],
    queryFn: () => invoicesService.listByCustomer(customerId as string),
    enabled: !!customerId,
  });
}

/** One customer's estimates (the Customers hub). */
export function useEstimatesByCustomer(customerId: string | undefined) {
  return useQuery({
    queryKey: customerId
      ? ACCOUNTING_QUERY_KEYS.customerEstimates(customerId)
      : ['accounting', 'customers', 'none', 'estimates'],
    queryFn: () => estimatesService.listByCustomer(customerId as string),
    enabled: !!customerId,
  });
}

/** One customer's payments (the Customers hub). */
export function usePaymentsByCustomer(customerId: string | undefined) {
  return useQuery({
    queryKey: customerId
      ? ACCOUNTING_QUERY_KEYS.customerPayments(customerId)
      : ['accounting', 'customers', 'none', 'payments'],
    queryFn: () => paymentsService.listByCustomer(customerId as string),
    enabled: !!customerId,
  });
}

/** Version history (restore points) for one invoice or estimate. */
export function useDocumentSnapshots(
  documentType: 'invoice' | 'estimate',
  documentId: string | undefined
) {
  return useQuery({
    queryKey: documentId
      ? ACCOUNTING_QUERY_KEYS.documentSnapshots(documentType, documentId)
      : ['accounting', 'snapshots', 'none'],
    queryFn: () => documentSnapshotsService.listForDocument(documentType, documentId as string),
    enabled: !!documentId,
  });
}

/** QuickBooks-style audit timeline (created/edited/sent/paid/voided…) for one document. */
export function useDocumentTimeline(
  documentType: 'invoice' | 'estimate' | 'bill',
  documentId: string | undefined
) {
  return useQuery({
    queryKey: documentId
      ? ACCOUNTING_QUERY_KEYS.documentTimeline(documentType, documentId)
      : ['accounting', 'timeline', 'none'],
    queryFn: () => documentActivityService.timeline(documentType, documentId as string),
    enabled: !!documentId,
  });
}

/** Sent-version state ("does the customer hold the current version?") for an invoice/estimate. */
export function useDocumentSentState(
  documentType: 'invoice' | 'estimate',
  documentId: string | undefined
) {
  return useQuery({
    queryKey: documentId
      ? ACCOUNTING_QUERY_KEYS.documentSentState(documentType, documentId)
      : ['accounting', 'sent-state', 'none'],
    queryFn: () => documentActivityService.sentState(documentType, documentId as string),
    enabled: !!documentId,
  });
}

/** Resolve an estimate by its number — powers the job card's est# deep link. */
export function useEstimateByNumber(estimateNumber: string | null | undefined) {
  const num = estimateNumber?.trim() || undefined;
  return useQuery({
    queryKey: ['accounting', 'estimates', 'byNumber', num] as const,
    queryFn: () => estimatesService.findByNumber(num as string),
    enabled: !!num,
    staleTime: 5 * 60 * 1000,
  });
}

/** Resolve an invoice by its number — powers the job card's inv# deep link. */
export function useInvoiceByNumber(invoiceNumber: string | null | undefined) {
  const num = invoiceNumber?.trim() || undefined;
  return useQuery({
    queryKey: ['accounting', 'invoices', 'byNumber', num] as const,
    queryFn: () => invoicesService.findByNumber(num as string),
    enabled: !!num,
    staleTime: 5 * 60 * 1000,
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

/** General-ledger account register (#3) — posted lines for one account in a window. */
export function useAccountLedger(accountId: string | undefined, range: DateRange = {}) {
  return useQuery({
    queryKey: accountId
      ? ACCOUNTING_QUERY_KEYS.accountLedger(accountId, range)
      : ['accounting', 'reports', 'account-ledger', 'none'],
    queryFn: () => reportsService.getAccountLedger(accountId as string, range),
    enabled: !!accountId,
  });
}

/** Statement of Cash Flows (#5, indirect method) over a from–to window. */
export function useCashFlowStatement(range: DateRange = {}) {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.cashFlowStatement(range),
    queryFn: () => reportsService.getCashFlowStatement(range),
  });
}

/** Sales by customer (#4) — pre-tax invoiced revenue per customer over a window. */
export function useSalesByCustomer(range: DateRange = {}) {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.salesByCustomer(range),
    queryFn: () => managementReportsService.getSalesByCustomer(range),
  });
}

/** Sales by item (#4) — pre-tax invoiced revenue per item over a window. */
export function useSalesByItem(range: DateRange = {}) {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.salesByItem(range),
    queryFn: () => managementReportsService.getSalesByItem(range),
  });
}

/** Purchases by vendor (#4) — pre-tax billed spend per vendor over a window. */
export function usePurchasesByVendor(range: DateRange = {}) {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.purchasesByVendor(range),
    queryFn: () => managementReportsService.getPurchasesByVendor(range),
  });
}

/**
 * Document attachments (#2) for ONE accounting entity, oldest-first. Disabled until the
 * entity has an id (a draft has none). Pure file metadata — nothing here moves money.
 */
export function useEntityAttachments(
  entityType: AttachmentEntityType,
  entityId: string | undefined
) {
  return useQuery({
    queryKey: entityId
      ? ACCOUNTING_QUERY_KEYS.attachmentsForEntity(entityType, entityId)
      : ['accounting', 'attachments', entityType, 'none'],
    queryFn: () => attachmentsService.listForEntity(entityType, entityId as string),
    enabled: !!entityId,
  });
}

/** #6 — email + reminder history for an invoice, newest first. */
export function useInvoiceEmails(invoiceId: string | undefined) {
  return useQuery({
    queryKey: invoiceId
      ? ACCOUNTING_QUERY_KEYS.invoiceEmails(invoiceId)
      : ['accounting', 'invoices', 'none', 'emails'],
    queryFn: () => invoiceEmailsService.listForInvoice(invoiceId as string),
    enabled: !!invoiceId,
  });
}

/** #8 — estimate list (most recent first). */
export function useEstimates() {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.estimates,
    queryFn: () => estimatesService.list(),
  });
}

/** #8 — a single estimate with its lines (customer name hydrated). */
export function useEstimate(id: string | undefined) {
  return useQuery({
    queryKey: id ? ACCOUNTING_QUERY_KEYS.estimate(id) : ['accounting', 'estimates', 'none'],
    queryFn: () => estimatesService.getById(id as string),
    enabled: !!id,
  });
}

// ── #10 Progress billing ───────────────────────────────────────────────────────
/** All progress-billing projects (most recent first). */
export function useProjects() {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.projects,
    queryFn: () => projectsService.list(),
  });
}

/** A single project (customer name hydrated). */
export function useProject(id: string | undefined) {
  return useQuery({
    queryKey: id ? ACCOUNTING_QUERY_KEYS.project(id) : ['accounting', 'projects', 'none'],
    queryFn: () => projectsService.getById(id as string),
    enabled: !!id,
  });
}

/** A project's schedule-of-values lines (in sort order). */
export function useSovLines(projectId: string | undefined) {
  return useQuery({
    queryKey: projectId
      ? ACCOUNTING_QUERY_KEYS.sovLines(projectId)
      : ['accounting', 'projects', 'none', 'sov-lines'],
    queryFn: () => progressBillingService.listSovLines(projectId as string),
    enabled: !!projectId,
  });
}

/** A project's change orders (oldest first). */
export function useChangeOrders(projectId: string | undefined) {
  return useQuery({
    queryKey: projectId
      ? ACCOUNTING_QUERY_KEYS.changeOrders(projectId)
      : ['accounting', 'projects', 'none', 'change-orders'],
    queryFn: () => progressBillingService.listChangeOrders(projectId as string),
    enabled: !!projectId,
  });
}

/** A project's progress invoices / applications (by sequence, with their lines). */
export function useProgressInvoices(projectId: string | undefined) {
  return useQuery({
    queryKey: projectId
      ? ACCOUNTING_QUERY_KEYS.progressInvoices(projectId)
      : ['accounting', 'projects', 'none', 'progress-invoices'],
    queryFn: () => progressBillingService.listProgressInvoices(projectId as string),
    enabled: !!projectId,
  });
}

// ── #11 Purchase orders ────────────────────────────────────────────────────────
/** Purchase order list (most recent first). */
export function usePurchaseOrders() {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.purchaseOrders,
    queryFn: () => purchaseOrdersService.list(),
  });
}

/** A single purchase order with its lines (vendor name hydrated). */
export function usePurchaseOrder(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? ACCOUNTING_QUERY_KEYS.purchaseOrder(id)
      : ['accounting', 'purchase-orders', 'none'],
    queryFn: () => purchaseOrdersService.getById(id as string),
    enabled: !!id,
  });
}

/** Bills produced from a PO (for the 3-way-match variance panel). */
export function usePurchaseOrderBills(poId: string | undefined) {
  return useQuery({
    queryKey: poId
      ? ACCOUNTING_QUERY_KEYS.purchaseOrderBills(poId)
      : ['accounting', 'purchase-orders', 'none', 'bills'],
    queryFn: () => purchaseOrdersService.listBillsForPo(poId as string),
    enabled: !!poId,
  });
}

// ── #12 1099 vendor tracking (advisory; moves no money) ───────────────────────
/** One vendor's W-9 record (null until recorded). Reads THROW so React Query surfaces them. */
export function useVendorTaxInfo(vendorId: string | undefined) {
  return useQuery({
    queryKey: vendorId
      ? ACCOUNTING_QUERY_KEYS.vendorTaxInfo(vendorId)
      : ['accounting', 'vendors', 'none', 'tax-info'],
    queryFn: () => vendor1099Service.getTaxInfo(vendorId as string),
    enabled: !!vendorId,
  });
}

/** The ranked 1099-NEC worklist for a calendar year (advisory; no e-file). */
export function use1099Totals(year: number) {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.form1099Totals(year),
    queryFn: () => vendor1099Service.list1099Totals(year),
  });
}

// ── #13 Sales-tax jurisdictions (reference data; moves no money) ──────────────
/** The address → tax-code jurisdiction map, most specific first. */
export function useTaxJurisdictions() {
  return useQuery({
    queryKey: ACCOUNTING_QUERY_KEYS.taxJurisdictions,
    queryFn: () => taxJurisdictionsService.list(),
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
    queryKey: id
      ? ACCOUNTING_QUERY_KEYS.bankAccount(id)
      : ['accounting', 'bank', 'accounts', 'none'],
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
    queryKey: id
      ? ACCOUNTING_QUERY_KEYS.reconciliation(id)
      : ['accounting', 'bank', 'reconciliations', 'none'],
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

// ── Plaid bank feeds (Phase 0) ────────────────────────────────────────────────
// The connected institutions (Plaid Items), read via the admin-only plaid-status
// function — accounting.plaid_items is service-role-only, so this is the only way the UI
// can list connections. getStatus() returns [] on any failure, so this query never throws.
// Keyed under ['plaid', ...] (its own subtree, OUTSIDE the ['accounting', ...] tree) because
// the secret-bearing connection state is owned by the functions, not the accounting schema;
// the Plaid mutations invalidate this key plus the bankAccounts subtree they wire up.

/** Connected Plaid Items (safe, non-secret status fields). */
export function usePlaidItems() {
  return useQuery({
    queryKey: ['plaid', 'items'] as const,
    queryFn: () => plaidService.getStatus(),
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

/** Estimates quoted against a job (job billing panel + job-costing drill-down). */
export function useJobEstimates(jobId: string | undefined) {
  return useQuery({
    queryKey: jobId
      ? ACCOUNTING_QUERY_KEYS.jobEstimates(jobId)
      : ['accounting', 'job-costing', 'none', 'estimates'],
    queryFn: () => estimatesService.listForJob(jobId as string),
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
    queryKey: id
      ? ACCOUNTING_QUERY_KEYS.recurringTemplate(id)
      : ['accounting', 'recurring', 'none'],
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
    queryKey: id
      ? ACCOUNTING_QUERY_KEYS.budgetVsActual(id)
      : ['accounting', 'budgets', 'none', 'vs-actual'],
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
export function useCustomFieldDefs(entityType?: CustomFieldEntityType, includeInactive = false) {
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
        ? ([
            ...ACCOUNTING_QUERY_KEYS.customFieldValues(entityType, entityId),
            { includeInactive },
          ] as const)
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

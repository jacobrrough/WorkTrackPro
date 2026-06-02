/** Shared constants for the accounting module. */

export const ACCOUNTING_BASE = '/app/accounting';
export const REPORTS_BASE = `${ACCOUNTING_BASE}/reports`;
export const BANKING_BASE = `${ACCOUNTING_BASE}/banking`;
export const JOB_COSTING_BASE = `${ACCOUNTING_BASE}/job-costing`;
export const DIMENSIONS_BASE = `${ACCOUNTING_BASE}/dimensions`;
export const RECURRING_BASE = `${ACCOUNTING_BASE}/recurring`;
export const INVENTORY_BASE = `${ACCOUNTING_BASE}/inventory`;
export const BUDGETS_BASE = `${ACCOUNTING_BASE}/budgets`;
export const FIXED_ASSETS_BASE = `${ACCOUNTING_BASE}/fixed-assets`;
export const CUSTOM_FIELDS_BASE = `${ACCOUNTING_BASE}/custom-fields`;
export const SETTINGS_BASE = `${ACCOUNTING_BASE}/settings`;

/**
 * IMPORT / MIGRATION (HELD / UNVERIFIED — NOT FOR FILING). The whole import module is
 * FLAG-DARK and requires CPA and/or security sign-off before it is enabled. Two screens:
 * a batch list (with a new-batch upload/parse) at /app/accounting/import, and a per-batch
 * wizard host (preview → COA mapping → reconciliation → admin commit) at
 * /app/accounting/import/:batchId. The router registers these with RELATIVE segments.
 * Every screen + export renders the UnverifiedBanner; only an explicit admin commit posts
 * BALANCED opening-balance journal entries (via accounting.commit_import_batch).
 */
export const IMPORT_BASE = `${ACCOUNTING_BASE}/import`;
/** Relative route segments (mounted in the AccountingRouter). */
export const IMPORT_SEGMENT = 'import';
export const IMPORT_BATCH_SEGMENT = 'import/:batchId';
/** Absolute path to the import batch list. */
export const importPath = (): string => IMPORT_BASE;
/** Absolute path to one import batch's wizard. */
export const importBatchPath = (batchId: string): string => `${IMPORT_BASE}/${batchId}`;

/**
 * NOTIFICATION DELIVERY (HELD / UNVERIFIED — NOT FOR FILING). The whole notification module
 * is FLAG-DARK and requires CPA and/or security sign-off before it is enabled. A single
 * config/preferences surface at /app/accounting/settings/notifications: the five event rules
 * (each shipping DISABLED) with an enable toggle + threshold input, plus a recipient-audience
 * preview so an admin can see the blast radius before enabling anything. The router registers
 * it with a RELATIVE segment (under the existing `settings` parent). The screen renders the
 * UnverifiedBanner; it moves NO money and posts NO journal entry — it only edits
 * accounting.notification_rules config. Delivery itself is the dispatch RPC / the env-gated
 * server sweep, never this screen.
 */
export const NOTIFICATIONS_BASE = `${SETTINGS_BASE}/notifications`;
/** Relative route segment (mounted under the existing `settings` parent in the router). */
export const NOTIFICATIONS_SETTINGS_SEGMENT = 'settings/notifications';
/** Absolute path to the notification config/preferences surface. */
export const notificationsPath = (): string => NOTIFICATIONS_BASE;

/**
 * C2 PAYROLL (HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING). The whole payroll module is
 * FLAG-DARK and requires a CPA/EA payroll professional AND/OR security sign-off before it is
 * enabled. Screens (UI lane): an employee master + editor, pay schedules, a pay-run list +
 * per-run workspace (calculate → review paychecks → commit → paystubs), an Admin Tax-Table
 * editor (verify every rate), and the W-2/1099-NEC/DE-9C + NACHA report STUBS. EVERY screen and
 * export renders the UnverifiedBanner; only an explicit commit posts the BALANCED payroll JE (via
 * accounting.commit_pay_run). The router registers these with RELATIVE segments.
 */
export const PAYROLL_BASE = `${ACCOUNTING_BASE}/payroll`;
/** Relative route segments (mounted in the AccountingRouter). */
export const PAYROLL_SEGMENT = 'payroll';
export const PAYROLL_EMPLOYEES_SEGMENT = 'payroll/employees';
export const PAYROLL_EMPLOYEE_SEGMENT = 'payroll/employees/:employeeId';
export const PAYROLL_SCHEDULES_SEGMENT = 'payroll/schedules';
export const PAYROLL_RUNS_SEGMENT = 'payroll/runs';
export const PAYROLL_RUN_SEGMENT = 'payroll/runs/:runId';
export const PAYROLL_PAYCHECK_SEGMENT = 'payroll/runs/:runId/paychecks/:paycheckId';
export const PAYROLL_TAX_TABLES_SEGMENT = 'payroll/tax-tables';
export const PAYROLL_REPORTS_SEGMENT = 'payroll/reports';
/** Absolute path helpers. */
export const payrollPath = (): string => PAYROLL_BASE;
export const payrollEmployeesPath = (): string => `${PAYROLL_BASE}/employees`;
export const payrollEmployeePath = (employeeId: string): string => `${PAYROLL_BASE}/employees/${employeeId}`;
export const payrollSchedulesPath = (): string => `${PAYROLL_BASE}/schedules`;
export const payrollRunsPath = (): string => `${PAYROLL_BASE}/runs`;
export const payrollRunPath = (runId: string): string => `${PAYROLL_BASE}/runs/${runId}`;
export const payrollPaycheckPath = (runId: string, paycheckId: string): string =>
  `${PAYROLL_BASE}/runs/${runId}/paychecks/${paycheckId}`;
export const payrollTaxTablesPath = (): string => `${PAYROLL_BASE}/tax-tables`;
export const payrollReportsPath = (): string => `${PAYROLL_BASE}/reports`;

/**
 * TAX-SYNC (ADVISORY-ONLY) lives UNDER Settings: an accounting_admin-only "Tax table
 * updates" screen (sources + open-drift inbox) plus a per-drift detail (old-vs-new +
 * Apply/Dismiss). Mounted at /app/accounting/settings/tax-tables[/drift/:driftId]; the
 * router registers these with RELATIVE segments. The screens NEVER move money — Apply
 * only changes a stored reference rate via the admin RPC; nothing here posts a JE.
 */
export const TAX_TABLES_BASE = `${SETTINGS_BASE}/tax-tables`;
/** Relative route segments (mounted under the existing `settings` parent in the router). */
export const TAX_TABLES_SETTINGS_SEGMENT = 'settings/tax-tables';
export const TAX_TABLE_DRIFT_SEGMENT = 'settings/tax-tables/drift/:driftId';
/** Absolute path to the Tax table updates screen. */
export const taxTablesPath = (): string => TAX_TABLES_BASE;
/** Absolute path to one drift's detail screen. */
export const taxTableDriftPath = (driftId: string): string => `${TAX_TABLES_BASE}/drift/${driftId}`;

/**
 * PHASE E SECURITY HARDENING (HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING). The whole
 * module is FLAG-DARK and requires a SECURITY review (key management/rotation, encryption
 * coverage, hash-chain integrity, backup/restore) before it is enabled. Three security screens
 * live UNDER Settings, plus an audit-chain detail drill-down:
 *   • Security Overview  /app/accounting/settings/security
 *     — encryption cutover-progress (counts only) + the audit hash-chain integrity badge +
 *       the read-only rate-limit summary + the supervised one-time chain backfill.
 *   • Audit-chain detail /app/accounting/settings/security/audit-chain
 *     — the full per-seq verification (ok / reason / stored-vs-expected hash).
 *   • RBAC management   /app/accounting/settings/security/roles
 *     — grant/revoke accounting roles over accounting.user_roles (accounting_admin-only at the DB).
 *   • Backup/Restore    /app/accounting/settings/security/backup
 *     — a read-only documentation STUB of the pg_dump + AES runbook (NO destructive action).
 * The router registers these with RELATIVE segments (under the existing `settings` parent). Every
 * screen renders the UnverifiedBanner; NOTHING here moves money or posts a journal entry.
 */
export const SECURITY_BASE = `${SETTINGS_BASE}/security`;
/** Relative route segments (mounted under the existing `settings` parent in the router). */
export const SECURITY_OVERVIEW_SEGMENT = 'settings/security';
export const SECURITY_AUDIT_CHAIN_SEGMENT = 'settings/security/audit-chain';
export const SECURITY_ROLES_SEGMENT = 'settings/security/roles';
export const SECURITY_BACKUP_SEGMENT = 'settings/security/backup';
/** Absolute path to the Security Overview screen. */
export const securityOverviewPath = (): string => SECURITY_BASE;
/** Absolute path to the audit-chain integrity detail screen. */
export const securityAuditChainPath = (): string => `${SECURITY_BASE}/audit-chain`;
/** Absolute path to the RBAC management screen. */
export const securityRolesPath = (): string => `${SECURITY_BASE}/roles`;
/** Absolute path to the Backup/Restore documentation STUB screen. */
export const securityBackupPath = (): string => `${SECURITY_BASE}/backup`;

/** The five A3 financial reports, used by the Reports index and the router. */
export interface ReportLink {
  key: string;
  label: string;
  icon: string;
  /** Relative path segment under /app/accounting/reports. */
  slug: string;
  description: string;
}

export const ACCOUNTING_REPORTS: ReportLink[] = [
  {
    key: 'trial-balance',
    label: 'Trial Balance',
    icon: 'balance',
    slug: 'trial-balance',
    description: 'Every account’s posted debit/credit balance — debits must equal credits.',
  },
  {
    key: 'profit-and-loss',
    label: 'Profit & Loss',
    icon: 'trending_up',
    slug: 'profit-and-loss',
    description: 'Income minus expenses for a period = net income.',
  },
  {
    key: 'balance-sheet',
    label: 'Balance Sheet',
    icon: 'account_balance',
    slug: 'balance-sheet',
    description: 'Assets = liabilities + equity, as of a date.',
  },
  {
    key: 'ar-aging',
    label: 'A/R Aging',
    icon: 'request_quote',
    slug: 'ar-aging',
    description: 'Open customer invoices bucketed by how overdue they are.',
  },
  {
    key: 'ap-aging',
    label: 'A/P Aging',
    icon: 'payments',
    slug: 'ap-aging',
    description: 'Open vendor bills bucketed by how overdue they are.',
  },
];

/**
 * D2 budget-scoped report sub-routes, mounted under a single budget at
 * /app/accounting/budgets/:budgetId/<slug>. Budget-vs-Actual needs a budget id;
 * the cash-flow forecast does not (it reads open AR/AP), so it also has an
 * unscoped entry under /app/accounting/budgets/cash-flow.
 */
export const BUDGET_VS_ACTUAL_SLUG = 'vs-actual';
export const CASH_FLOW_SLUG = 'cash-flow';

/**
 * C1 sales-tax report sub-routes, mounted under /app/accounting/reports/<slug>. The
 * Sales-Tax Liability report and the read-only Tax Calendar dashboard. Both are
 * reporting-only (no e-filing, no money movement, no notification delivery).
 */
export const SALES_TAX_LIABILITY_SLUG = 'sales-tax';
export const TAX_CALENDAR_SLUG = 'tax-calendar';

/** Path to the Sales-Tax Liability report. */
export const salesTaxLiabilityPath = (): string => `${REPORTS_BASE}/${SALES_TAX_LIABILITY_SLUG}`;
/** Path to the read-only Tax Calendar dashboard. */
export const taxCalendarPath = (): string => `${REPORTS_BASE}/${TAX_CALENDAR_SLUG}`;

/** Path to a budget's editor grid. */
export const budgetEditorPath = (budgetId: string): string => `${BUDGETS_BASE}/${budgetId}`;
/** Path to a budget's Budget-vs-Actual report. */
export const budgetVsActualPath = (budgetId: string): string =>
  `${BUDGETS_BASE}/${budgetId}/${BUDGET_VS_ACTUAL_SLUG}`;
/** Path to the (budget-independent) cash-flow forecast. */
export const cashFlowForecastPath = (): string => `${BUDGETS_BASE}/${CASH_FLOW_SLUG}`;

/**
 * React Query keys, all namespaced under ['accounting', ...] so the module can
 * invalidate its own cache subtree without touching the core app's queries.
 */
export const ACCOUNTING_QUERY_KEYS = {
  all: ['accounting'] as const,
  accounts: ['accounting', 'accounts'] as const,
  account: (id: string) => ['accounting', 'account', id] as const,
  journal: ['accounting', 'journal'] as const,
  journalEntry: (id: string) => ['accounting', 'journal', id] as const,
  customers: ['accounting', 'customers'] as const,
  customer: (id: string) => ['accounting', 'customers', id] as const,
  taxCodes: ['accounting', 'tax-codes'] as const,
  invoices: ['accounting', 'invoices'] as const,
  invoice: (id: string) => ['accounting', 'invoices', id] as const,
  invoicePayments: (invoiceId: string) => ['accounting', 'invoices', invoiceId, 'payments'] as const,
  payments: ['accounting', 'payments'] as const,
  payment: (id: string) => ['accounting', 'payments', id] as const,
  vendors: ['accounting', 'vendors'] as const,
  vendor: (id: string) => ['accounting', 'vendors', id] as const,
  bills: ['accounting', 'bills'] as const,
  bill: (id: string) => ['accounting', 'bills', id] as const,
  billPayments: (billId: string) => ['accounting', 'bills', billId, 'payments'] as const,
  vendorBills: (vendorId: string) => ['accounting', 'vendors', vendorId, 'bills'] as const,
  vendorPayments: ['accounting', 'vendor-payments'] as const,
  vendorPayment: (id: string) => ['accounting', 'vendor-payments', id] as const,
  // ── Reports (A3). `reports` is the subtree root for scoped invalidation; the
  // period reports key by date range so changing the filter refetches. Aging is
  // point-in-time (as of today) so it takes no range. ──────────────────────────
  reports: ['accounting', 'reports'] as const,
  trialBalance: (range?: ReportRangeKey) =>
    ['accounting', 'reports', 'trial-balance', rangeKey(range)] as const,
  profitAndLoss: (range?: ReportRangeKey) =>
    ['accounting', 'reports', 'profit-and-loss', rangeKey(range)] as const,
  balanceSheet: (range?: ReportRangeKey) =>
    ['accounting', 'reports', 'balance-sheet', rangeKey(range)] as const,
  arAging: ['accounting', 'reports', 'ar-aging'] as const,
  apAging: ['accounting', 'reports', 'ap-aging'] as const,
  // ── Banking (A4). `bank` is the subtree root for scoped invalidation; the
  // detail/list keys hang under it so a bank action invalidates only banking. ──
  bank: ['accounting', 'bank'] as const,
  bankAccounts: ['accounting', 'bank', 'accounts'] as const,
  bankAccount: (id: string) => ['accounting', 'bank', 'accounts', id] as const,
  bankTransactions: (bankAccountId: string) =>
    ['accounting', 'bank', 'accounts', bankAccountId, 'transactions'] as const,
  bankTransaction: (id: string) => ['accounting', 'bank', 'transactions', id] as const,
  bankRules: (bankAccountId?: string) =>
    ['accounting', 'bank', 'rules', bankAccountId ?? 'all'] as const,
  reconciliations: (bankAccountId?: string) =>
    ['accounting', 'bank', 'reconciliations', bankAccountId ?? 'all'] as const,
  reconciliation: (id: string) => ['accounting', 'bank', 'reconciliations', id] as const,
  reconciliationSummary: (id: string) =>
    ['accounting', 'bank', 'reconciliations', id, 'summary'] as const,
  // ── Job costing (B1). `jobCosting` is the subtree root; the per-job detail and
  // its drill-down invoice/bill lists hang under it. Read-only — nothing here is
  // ever invalidated by an accounting mutation directly, but posting/voiding an
  // invoice or bill moves a job's revenue, so those mutations also invalidate this
  // subtree (see useAccountingMutations). ──────────────────────────────────────
  jobCosting: ['accounting', 'job-costing'] as const,
  jobCostingList: ['accounting', 'job-costing', 'list'] as const,
  jobCostingDetail: (jobId: string) => ['accounting', 'job-costing', jobId] as const,
  jobInvoices: (jobId: string) => ['accounting', 'job-costing', jobId, 'invoices'] as const,
  jobBills: (jobId: string) => ['accounting', 'job-costing', jobId, 'bills'] as const,
  // ── Reporting dimensions (B2). `dimensions` is the subtree root for scoped
  // invalidation; the per-type list and per-id detail hang under it. ────────────
  dimensions: ['accounting', 'dimensions'] as const,
  dimensionsByType: (type: string) => ['accounting', 'dimensions', 'type', type] as const,
  dimension: (id: string) => ['accounting', 'dimensions', id] as const,
  // ── Recurring templates (B2). `recurring` is the subtree root; `recurringDue`
  // is the as-of "due" list. Generating posts an invoice/bill/JE, so the generate
  // mutation invalidates recurring + invoices/bills + journal + reports + jobCosting. ─
  recurring: ['accounting', 'recurring'] as const,
  recurringTemplate: (id: string) => ['accounting', 'recurring', id] as const,
  recurringDue: (asOf?: string) => ['accounting', 'recurring', 'due', asOf ?? 'today'] as const,
  // ── Inventory valuation → COGS (B3). `inventory` is the subtree root for scoped
  // invalidation; valuation, the per-item detail, the COGS work list and event log
  // hang under it. Posting COGS posts a balanced JE, so the consume mutation also
  // invalidates journal + reports + jobCosting (a job's costs changed). ───────────
  inventory: ['accounting', 'inventory'] as const,
  inventoryValuation: ['accounting', 'inventory', 'valuation'] as const,
  inventoryValuationItem: (sourceInventoryId: string) =>
    ['accounting', 'inventory', 'valuation', sourceInventoryId] as const,
  inventoryConsumableJobs: ['accounting', 'inventory', 'consumable-jobs'] as const,
  inventoryCogsEvents: (jobId?: string) =>
    ['accounting', 'inventory', 'cogs-events', jobId ?? 'all'] as const,
  // ── Books-closed (period lock) date (D1). A single scalar value (the lock date or
  // null). Setting it does not move money, but it changes WHICH dates the journal +
  // reports may be posted/voided into, so the setter mutation invalidates this key
  // plus the journal + reports subtrees (see useAccountingMutations). ─────────────
  closedThroughDate: ['accounting', 'settings', 'closed-through-date'] as const,
  // ── Default GL account mappings (COA-EXPAND). The resolved settings.default_accounts
  // blob (AR/income/sales-tax/cash + the structural opening-balance/uncategorized/
  // payment-processor accounts). Read-only on the Settings screen so an admin can verify
  // which chart-of-accounts account each posting role resolves to before the consumer
  // modules (import/migration, bank feeds) go live. Setting it is a DB migration concern,
  // so nothing in the UI mutates this key. ─────────────────────────────────────────────
  defaultAccounts: ['accounting', 'settings', 'default-accounts'] as const,
  // ── Budgeting & forecasting (D2). `budgets` is the subtree root for scoped
  // invalidation; the list/detail/grid/budget-vs-actual hang under it. Budgets move no
  // money, so budget CRUD invalidates ONLY this subtree. The cash-flow FORECAST instead
  // reflects open AR/AP, so it lives under `reports` (any invoice/bill/payment money
  // mutation already invalidates `reports`, which refreshes the forecast for free).
  budgets: ['accounting', 'budgets'] as const,
  budget: (id: string) => ['accounting', 'budgets', id] as const,
  budgetGrid: (id: string) => ['accounting', 'budgets', id, 'grid'] as const,
  budgetVsActual: (id: string) => ['accounting', 'budgets', id, 'vs-actual'] as const,
  cashFlowForecast: (key?: CashFlowForecastKey) =>
    ['accounting', 'reports', 'cash-flow-forecast', forecastKey(key)] as const,
  // ── Fixed assets & depreciation (D3). `fixedAssets` is the subtree root for scoped
  // invalidation; the asset list, the register, the per-asset detail header and its
  // depreciation schedule hang under it. Running depreciation posts BALANCED JEs, so the
  // run-depreciation mutation also invalidates journal + reports (depreciation hits the
  // P&L and Balance Sheet) — the same fan-out the AR/AP money mutations use, all scoped
  // under ['accounting', ...]. ───────────────────────────────────────────────────────
  fixedAssets: ['accounting', 'fixed-assets'] as const,
  fixedAssetList: ['accounting', 'fixed-assets', 'list'] as const,
  fixedAssetRegister: ['accounting', 'fixed-assets', 'register'] as const,
  fixedAsset: (id: string) => ['accounting', 'fixed-assets', id] as const,
  fixedAssetSchedule: (id: string) => ['accounting', 'fixed-assets', id, 'schedule'] as const,
  // ── Custom fields on accounting entities (D4). `customFields` is the subtree root
  // for scoped invalidation; the admin definitions list (optionally per entity type) and
  // the per-entity value lists hang under it. Custom fields move NO money, so every
  // mutation here invalidates ONLY this subtree — defining/editing a field or saving a
  // value never posts a journal entry, so the journal/reports subtrees are never touched.
  customFields: ['accounting', 'custom-fields'] as const,
  customFieldDefs: (entityType?: string) =>
    ['accounting', 'custom-fields', 'defs', entityType ?? 'all'] as const,
  customFieldValues: (entityType: string, entityId: string) =>
    ['accounting', 'custom-fields', 'values', entityType, entityId] as const,
  // ── Sales-tax reporting & tax calendar (C1). `salesTax` is the subtree root for
  // scoped invalidation. The liability report keys by date range (changing the filter
  // refetches; an empty range = all-time). The calendar keys by "as of". Both are
  // READ-ONLY over the posted ledger + tax_* tables + the tax_filing_calendar settings
  // row — C1 posts no journal entry and mutates nothing, so nothing ever invalidates
  // this subtree directly. (A future money mutation that credited 2200 would already
  // invalidate the `reports` subtree; the liability report is grouped here for cohesion
  // and could be co-invalidated alongside `reports` if it is ever surfaced live.) ──────
  salesTax: ['accounting', 'sales-tax'] as const,
  salesTaxLiability: (range?: ReportRangeKey) =>
    ['accounting', 'sales-tax', 'liability', rangeKey(range)] as const,
  taxCalendar: (asOf?: string) => ['accounting', 'sales-tax', 'calendar', asOf ?? 'today'] as const,
  // ── TAX-SYNC: quarterly tax-table refresh + drift alert (ADVISORY-ONLY). `taxTableSync`
  // is the subtree root for scoped invalidation; the sources list, per-source snapshot
  // history, the drift list (optionally by status), the open-drift COUNT (the badge), the
  // per-drift detail and the drift's current-rates preview hang under it. APPLYING a drift
  // mutates accounting.tax_rates (reference data — no journal entry, no money moved), so the
  // apply mutation also invalidates the `taxCodes` and `salesTax` subtrees (their combined
  // rates derive from tax_rates). DISMISS / "check now" touch only this subtree. Everything
  // stays under ['accounting', ...] so the core app's cache is never disturbed. ──────────
  taxTableSync: ['accounting', 'tax-table-sync'] as const,
  taxTableSources: ['accounting', 'tax-table-sync', 'sources'] as const,
  taxTableSource: (id: string) => ['accounting', 'tax-table-sync', 'sources', id] as const,
  taxTableSnapshots: (sourceId: string) =>
    ['accounting', 'tax-table-sync', 'sources', sourceId, 'snapshots'] as const,
  taxTableSnapshot: (id: string) => ['accounting', 'tax-table-sync', 'snapshots', id] as const,
  taxTableDrift: (status?: string) =>
    ['accounting', 'tax-table-sync', 'drift', status ?? 'all'] as const,
  taxTableDriftOpenCount: ['accounting', 'tax-table-sync', 'drift', 'open-count'] as const,
  taxTableDriftDetail: (id: string) => ['accounting', 'tax-table-sync', 'drift', id] as const,
  taxTableDriftRates: (id: string) =>
    ['accounting', 'tax-table-sync', 'drift', id, 'current-rates'] as const,
  // ── IMPORT / MIGRATION (HELD / UNVERIFIED — NOT FOR FILING). `import` is the subtree
  // root for scoped invalidation; the batch list, a batch's header, its staging rows
  // (optionally filtered), its account-map and its reconciliation hang under it. Only the
  // COMMIT mutation posts money (via accounting.commit_import_batch → post_journal_entry),
  // so commit additionally invalidates the journal + reports subtrees — the same fan-out
  // the AR/AP money mutations use. Every other import mutation (stage/seed/map/ready) is
  // staging-only and touches ONLY this subtree. All keys stay under ['accounting', ...] so
  // the core app's cache is never disturbed; with the flag OFF none of this is reachable. ──
  import: ['accounting', 'import'] as const,
  importBatches: ['accounting', 'import', 'batches'] as const,
  importBatch: (id: string) => ['accounting', 'import', 'batches', id] as const,
  importStaging: (batchId: string, filterKey?: string) =>
    ['accounting', 'import', 'batches', batchId, 'staging', filterKey ?? 'all'] as const,
  importAccountMap: (batchId: string) =>
    ['accounting', 'import', 'batches', batchId, 'account-map'] as const,
  importReconciliation: (batchId: string) =>
    ['accounting', 'import', 'batches', batchId, 'reconciliation'] as const,
  importReadyBlockers: (batchId: string) =>
    ['accounting', 'import', 'batches', batchId, 'ready-blockers'] as const,
  // ── NOTIFICATION DELIVERY (HELD / UNVERIFIED — NOT FOR FILING). `notifications` is the
  // subtree root for scoped invalidation; the rules list, a single rule, and the recipient
  // audience hang under it. Editing a rule (enable/disable/threshold) invalidates ONLY this
  // subtree — the notification module posts NO journal entry and moves NO money, so the
  // journal/reports subtrees are never touched. DISPATCH delivers into the EXISTING
  // public.system_notifications feed via accounting.dispatch_notification; that feed is owned
  // by the core app's own notification queries (NotificationBell), which this module does not
  // manage — so a successful dispatch does not invalidate any ['accounting', ...] key. All
  // keys stay under ['accounting', ...]; with the flag OFF none of this is reachable. ────────
  notifications: ['accounting', 'notifications'] as const,
  notificationRules: ['accounting', 'notifications', 'rules'] as const,
  notificationRule: (id: string) => ['accounting', 'notifications', 'rules', id] as const,
  notificationRecipients: ['accounting', 'notifications', 'recipients'] as const,
  // ── DOCUMENT MANAGEMENT / ATTACHMENTS (HELD / UNVERIFIED — NOT FOR FILING). `attachments`
  // is the subtree root for scoped invalidation; the per-entity list keys by (entityType,
  // entityId) so attaching/removing a file on one entity refetches ONLY that entity's list.
  // The module posts NO journal entry and moves NO money, so every mutation here invalidates
  // ONLY this subtree — the journal/reports subtrees are never touched. All keys stay under
  // ['accounting', ...] so the core app's cache (incl. its OWN public.attachments queries for
  // parts/jobs) is never disturbed; with the flag OFF none of this is reachable. ────────────
  attachments: ['accounting', 'attachments'] as const,
  attachmentsForEntity: (entityType: string, entityId: string) =>
    ['accounting', 'attachments', entityType, entityId] as const,
  // ── C2 PAYROLL (HELD / UNVERIFIED — NOT FOR FILING). `payroll` is the subtree root for scoped
  // invalidation; the employee master, pay schedules, the pay-run list + a run's header /
  // paychecks / liabilities, the admin tax tables, and the statutory report/NACHA stubs hang under
  // it. CALCULATE writes paychecks/liabilities but moves NO money → it invalidates only the
  // `payroll` subtree. COMMIT is the ONLY money path (accounting.commit_pay_run → ONE balanced JE),
  // so it additionally invalidates the journal + reports subtrees — the same fan-out the AR/AP money
  // mutations use. VOID likewise. Editing a tax table changes how a FUTURE run computes withholding
  // (no JE) → `payroll` subtree only. All keys stay under ['accounting', ...]; with the flag OFF
  // none of this is reachable and it is stripped from the production build. ──────────────────────
  payroll: ['accounting', 'payroll'] as const,
  employees: (includeInactive?: boolean) =>
    ['accounting', 'payroll', 'employees', includeInactive ? 'all' : 'active'] as const,
  employee: (id: string) => ['accounting', 'payroll', 'employees', id] as const,
  paySchedules: (includeInactive?: boolean) =>
    ['accounting', 'payroll', 'pay-schedules', includeInactive ? 'all' : 'active'] as const,
  paySchedule: (id: string) => ['accounting', 'payroll', 'pay-schedules', id] as const,
  payRuns: ['accounting', 'payroll', 'pay-runs'] as const,
  payRun: (id: string) => ['accounting', 'payroll', 'pay-runs', id] as const,
  payRunPaychecks: (runId: string) => ['accounting', 'payroll', 'pay-runs', runId, 'paychecks'] as const,
  payRunLiabilities: (runId: string) => ['accounting', 'payroll', 'pay-runs', runId, 'liabilities'] as const,
  paycheck: (id: string) => ['accounting', 'payroll', 'paychecks', id] as const,
  payrollTaxTables: (taxYear: number) => ['accounting', 'payroll', 'tax-tables', taxYear] as const,
  payrollTaxTableYears: ['accounting', 'payroll', 'tax-tables', 'years'] as const,
  payrollTaxTable: (id: string) => ['accounting', 'payroll', 'tax-tables', 'row', id] as const,
  payrollSeededKinds: (taxYear: number) => ['accounting', 'payroll', 'tax-tables', taxYear, 'seeded-kinds'] as const,
  payrollReport: (kind: string, taxYear: number, quarter?: number | null) =>
    ['accounting', 'payroll', 'reports', kind, taxYear, quarter ?? 'year'] as const,
  payrollNachaStub: (runId: string) => ['accounting', 'payroll', 'pay-runs', runId, 'nacha-stub'] as const,
  payrollCommittedRuns: (taxYear: number) => ['accounting', 'payroll', 'reports', 'committed-runs', taxYear] as const,
  // ── PHASE E SECURITY HARDENING (HELD / UNVERIFIED — NOT FOR FILING). `security` and `rbac` are
  // the subtree roots for scoped invalidation. The encryption-coverage probe, the audit hash-chain
  // status + per-seq verification, and the two read-only security-settings blobs hang under
  // `security`; the role grants + per-user summaries + the candidate picker hang under `rbac`.
  // NOTHING here moves money or posts a journal entry, so every mutation in this area invalidates
  // ONLY its own subtree — the journal/reports subtrees are NEVER touched. The encrypted-field
  // accessors (set_*) also refresh `securityCoverage` (a backfill changes the plaintext-vs-cipher
  // counts) and the audit backfill refreshes the chain keys. Granting/revoking a role invalidates
  // the `rbac` subtree. All keys stay under ['accounting', ...] so the core app's cache is never
  // disturbed; with the flag OFF none of this is reachable and it is stripped from the build. ──────
  security: ['accounting', 'security'] as const,
  securityCoverage: ['accounting', 'security', 'encryption-coverage'] as const,
  securityAuditChainStatus: ['accounting', 'security', 'audit-chain', 'status'] as const,
  securityAuditChainVerify: (from?: number) =>
    ['accounting', 'security', 'audit-chain', 'verify', from ?? 1] as const,
  securityRateLimits: ['accounting', 'security', 'rate-limits'] as const,
  securityBackupPolicy: ['accounting', 'security', 'backup-policy'] as const,
  rbac: ['accounting', 'rbac'] as const,
  rbacUserRoles: ['accounting', 'rbac', 'user-roles'] as const,
  rbacGrants: ['accounting', 'rbac', 'grants'] as const,
  rbacUserRolesFor: (userId: string) => ['accounting', 'rbac', 'user-roles', userId] as const,
  rbacCandidates: ['accounting', 'rbac', 'candidates'] as const,
};

/** Minimal serializable shape used to namespace the cash-flow forecast query key. */
export interface CashFlowForecastKey {
  startMonth?: string | null;
  months?: number | null;
  openingBalance?: number | null;
}

/** Stable key fragment for a forecast request (null/absent bounds → 'default'). */
function forecastKey(key?: CashFlowForecastKey): { startMonth: string; months: number | 'default'; openingBalance: number } {
  return {
    startMonth: key?.startMonth ?? 'default',
    months: key?.months ?? 'default',
    openingBalance: key?.openingBalance ?? 0,
  };
}

/** Minimal date-range shape used to namespace the period-report query keys. */
export interface ReportRangeKey {
  from?: string | null;
  to?: string | null;
}

/** Stable, serializable key fragment for a date range (null bounds → 'all'). */
function rangeKey(range?: ReportRangeKey): { from: string; to: string } {
  return { from: range?.from ?? 'all', to: range?.to ?? 'all' };
}

export interface AccountingNavItem {
  key: string;
  label: string;
  icon: string;
  path: string;
}

/** Sub-navigation for the module shell. */
export const ACCOUNTING_NAV: AccountingNavItem[] = [
  { key: 'overview', label: 'Overview', icon: 'dashboard', path: ACCOUNTING_BASE },
  { key: 'accounts', label: 'Accounts', icon: 'account_tree', path: `${ACCOUNTING_BASE}/accounts` },
  { key: 'journal', label: 'Journal', icon: 'menu_book', path: `${ACCOUNTING_BASE}/journal` },
  { key: 'invoices', label: 'Invoices', icon: 'receipt_long', path: `${ACCOUNTING_BASE}/invoices` },
  { key: 'bills', label: 'Bills', icon: 'request_quote', path: `${ACCOUNTING_BASE}/bills` },
  { key: 'banking', label: 'Banking', icon: 'account_balance_wallet', path: BANKING_BASE },
  { key: 'job-costing', label: 'Job costing', icon: 'query_stats', path: JOB_COSTING_BASE },
  { key: 'inventory', label: 'Inventory', icon: 'inventory_2', path: INVENTORY_BASE },
  { key: 'recurring', label: 'Recurring', icon: 'event_repeat', path: RECURRING_BASE },
  { key: 'dimensions', label: 'Dimensions', icon: 'sell', path: DIMENSIONS_BASE },
  { key: 'budgets', label: 'Budgets', icon: 'savings', path: BUDGETS_BASE },
  { key: 'fixed-assets', label: 'Fixed assets', icon: 'precision_manufacturing', path: FIXED_ASSETS_BASE },
  { key: 'reports', label: 'Reports', icon: 'analytics', path: `${ACCOUNTING_BASE}/reports` },
  { key: 'custom-fields', label: 'Custom fields', icon: 'tune', path: CUSTOM_FIELDS_BASE },
  // HELD / UNVERIFIED — NOT FOR FILING. Import/migration; every screen carries the banner.
  { key: 'import', label: 'Import', icon: 'cloud_upload', path: IMPORT_BASE },
  // HELD / UNVERIFIED — NOT FOR FILING. Notification config; the surface carries the banner.
  { key: 'notifications', label: 'Notifications', icon: 'notifications_active', path: NOTIFICATIONS_BASE },
  // HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING. Payroll; every screen + export carries the banner.
  { key: 'payroll', label: 'Payroll', icon: 'badge', path: PAYROLL_BASE },
  { key: 'settings', label: 'Settings', icon: 'settings', path: `${ACCOUNTING_BASE}/settings` },
];

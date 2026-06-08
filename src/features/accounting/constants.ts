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
export const ESTIMATES_BASE = `${ACCOUNTING_BASE}/estimates`;
export const PROGRESS_BASE = `${ACCOUNTING_BASE}/progress`;
export const PURCHASE_ORDERS_BASE = `${ACCOUNTING_BASE}/purchase-orders`;
/**
 * QuickBooks Online connection (import Phase 0). A single AccountingShell-wrapped
 * screen that runs the OAuth connect/disconnect handshake and a test call. The OAuth
 * callback redirects back here with ?qbo=connected|error.
 */
export const INTEGRATIONS_BASE = `${ACCOUNTING_BASE}/integrations`;
/** Relative route segment (mounted under /app/accounting in the router). */
export const INTEGRATIONS_SEGMENT = 'integrations';

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

// ── #13 Sales-tax rate automation — the address → tax-code jurisdiction map, an
// accounting_admin-only screen UNDER Settings (advisory; a mapping only points an address at
// an EXISTING composite tax code — it never moves money).
export const TAX_JURISDICTIONS_BASE = `${SETTINGS_BASE}/tax-jurisdictions`;
export const TAX_JURISDICTIONS_SETTINGS_SEGMENT = 'settings/tax-jurisdictions';
export const taxJurisdictionsPath = (): string => TAX_JURISDICTIONS_BASE;

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

// ── #3/#4/#5 report routes (GL detail + drill-down, cash-flow statement, mgmt reports). ──
export const GENERAL_LEDGER_SLUG = 'general-ledger';
export const CASH_FLOW_STATEMENT_SLUG = 'cash-flow-statement';
export const SALES_BY_CUSTOMER_SLUG = 'sales-by-customer';
export const SALES_BY_ITEM_SLUG = 'sales-by-item';
export const PURCHASES_BY_VENDOR_SLUG = 'purchases-by-vendor';

/** General-ledger account-picker landing. */
export const generalLedgerPath = (): string => `${REPORTS_BASE}/${GENERAL_LEDGER_SLUG}`;
/** One account's GL register, carrying the current date range as a `?from=&to=` query. */
export const accountLedgerPath = (accountId: string, range?: ReportRangeKey): string => {
  const base = `${REPORTS_BASE}/${GENERAL_LEDGER_SLUG}/${accountId}`;
  const params = new URLSearchParams();
  if (range?.from) params.set('from', range.from);
  if (range?.to) params.set('to', range.to);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
};
/** Statement of Cash Flows (indirect method). */
export const cashFlowStatementPath = (): string => `${REPORTS_BASE}/${CASH_FLOW_STATEMENT_SLUG}`;
/** Sales by customer (management report). */
export const salesByCustomerPath = (): string => `${REPORTS_BASE}/${SALES_BY_CUSTOMER_SLUG}`;
/** Sales by item (management report). */
export const salesByItemPath = (): string => `${REPORTS_BASE}/${SALES_BY_ITEM_SLUG}`;
/** Purchases by vendor (management report). */
export const purchasesByVendorPath = (): string => `${REPORTS_BASE}/${PURCHASES_BY_VENDOR_SLUG}`;

/** #12 1099-NEC worklist (advisory; no e-file). */
export const FORM_1099_SLUG = 'form-1099';
export const form1099WorklistPath = (): string => `${REPORTS_BASE}/${FORM_1099_SLUG}`;

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
  // #13 — address → tax-code jurisdiction map (reference data; moves no money).
  taxJurisdictions: ['accounting', 'tax-jurisdictions'] as const,
  // #12 — 1099 vendor tracking: the W-9 record hangs under the vendor; worklist totals by year.
  vendorTaxInfo: (vendorId: string) => ['accounting', 'vendors', vendorId, 'tax-info'] as const,
  form1099Totals: (year: number) => ['accounting', 'reports', 'form-1099', year] as const,
  invoices: ['accounting', 'invoices'] as const,
  invoice: (id: string) => ['accounting', 'invoices', id] as const,
  invoicePayments: (invoiceId: string) =>
    ['accounting', 'invoices', invoiceId, 'payments'] as const,
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
  // ── GL detail (#3) + management reports (#4) + cash-flow statement (#5). Read-only
  // over the posted ledger, keyed by range under the `reports` subtree (the account
  // ledger also by accountId). Never invalidated directly — a posting invalidates `reports`.
  accountLedger: (accountId: string, range?: ReportRangeKey) =>
    ['accounting', 'reports', 'account-ledger', accountId, rangeKey(range)] as const,
  cashFlowStatement: (range?: ReportRangeKey) =>
    ['accounting', 'reports', 'cash-flow-statement', rangeKey(range)] as const,
  salesByCustomer: (range?: ReportRangeKey) =>
    ['accounting', 'reports', 'sales-by-customer', rangeKey(range)] as const,
  salesByItem: (range?: ReportRangeKey) =>
    ['accounting', 'reports', 'sales-by-item', rangeKey(range)] as const,
  purchasesByVendor: (range?: ReportRangeKey) =>
    ['accounting', 'reports', 'purchases-by-vendor', rangeKey(range)] as const,
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
  // ── #2 Document attachments. `attachments` is the subtree root; the per-entity list
  // hangs under it. Attachments move NO money — mutations invalidate only this subtree.
  attachments: ['accounting', 'attachments'] as const,
  attachmentsForEntity: (entityType: string, entityId: string) =>
    ['accounting', 'attachments', entityType, entityId] as const,
  // ── #6 Invoice emails / #7 portal tokens. Both hang under the invoices subtree so an
  // invoice mutation that touches them invalidates cleanly. They move NO money. ──────────
  invoiceEmails: (invoiceId: string) => ['accounting', 'invoices', invoiceId, 'emails'] as const,
  portalTokensForInvoice: (invoiceId: string) =>
    ['accounting', 'invoices', invoiceId, 'portal-tokens'] as const,
  // ── #8 Estimates. `estimates` is the subtree root; the per-estimate detail hangs under it.
  estimates: ['accounting', 'estimates'] as const,
  estimate: (id: string) => ['accounting', 'estimates', id] as const,
  // ── #10 Progress billing. `projects` is the subtree root; per-project SOV/change-order/
  // application lists hang under it. Posting an application or releasing retainage posts a
  // balanced JE + invoice, so those mutations also invalidate journal+reports+jobCosting+invoices.
  projects: ['accounting', 'projects'] as const,
  project: (id: string) => ['accounting', 'projects', id] as const,
  sovLines: (projectId: string) => ['accounting', 'projects', projectId, 'sov-lines'] as const,
  changeOrders: (projectId: string) =>
    ['accounting', 'projects', projectId, 'change-orders'] as const,
  progressInvoices: (projectId: string) =>
    ['accounting', 'projects', projectId, 'progress-invoices'] as const,
  // ── #11 Purchase orders. A PO posts no JE; CONVERT creates a draft bill (invalidates bills).
  purchaseOrders: ['accounting', 'purchase-orders'] as const,
  purchaseOrder: (id: string) => ['accounting', 'purchase-orders', id] as const,
  purchaseOrderBills: (id: string) => ['accounting', 'purchase-orders', id, 'bills'] as const,
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
};

/** Minimal serializable shape used to namespace the cash-flow forecast query key. */
export interface CashFlowForecastKey {
  startMonth?: string | null;
  months?: number | null;
  openingBalance?: number | null;
}

/** Stable key fragment for a forecast request (null/absent bounds → 'default'). */
function forecastKey(key?: CashFlowForecastKey): {
  startMonth: string;
  months: number | 'default';
  openingBalance: number;
} {
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

/** QuickBooks-style sidebar sections the nav items group under. */
export type AccountingNavGroup =
  | 'overview'
  | 'sales'
  | 'expenses'
  | 'accounting'
  | 'reports'
  | 'setup';

export interface AccountingNavItem {
  key: string;
  label: string;
  icon: string;
  path: string;
  /** Which left-rail section this item lives under. */
  group: AccountingNavGroup;
}

/** Sub-navigation for the module shell. The left rail AND the home tiles both derive from this. */
export const ACCOUNTING_NAV: AccountingNavItem[] = [
  {
    key: 'overview',
    label: 'Overview',
    icon: 'dashboard',
    path: ACCOUNTING_BASE,
    group: 'overview',
  },
  {
    key: 'accounts',
    label: 'Accounts',
    icon: 'account_tree',
    path: `${ACCOUNTING_BASE}/accounts`,
    group: 'accounting',
  },
  {
    key: 'import',
    label: 'Import',
    icon: 'upload_file',
    path: `${ACCOUNTING_BASE}/import`,
    group: 'setup',
  },
  {
    key: 'integrations',
    label: 'Integrations',
    icon: 'sync_alt',
    path: INTEGRATIONS_BASE,
    group: 'setup',
  },
  {
    key: 'journal',
    label: 'Journal',
    icon: 'menu_book',
    path: `${ACCOUNTING_BASE}/journal`,
    group: 'accounting',
  },
  {
    key: 'invoices',
    label: 'Invoices',
    icon: 'receipt_long',
    path: `${ACCOUNTING_BASE}/invoices`,
    group: 'sales',
  },
  {
    key: 'estimates',
    label: 'Estimates',
    icon: 'description',
    path: ESTIMATES_BASE,
    group: 'sales',
  },
  {
    key: 'progress',
    label: 'Progress billing',
    icon: 'foundation',
    path: PROGRESS_BASE,
    group: 'sales',
  },
  {
    key: 'purchase-orders',
    label: 'Purchase orders',
    icon: 'shopping_cart',
    path: PURCHASE_ORDERS_BASE,
    group: 'sales',
  },
  {
    key: 'bills',
    label: 'Bills',
    icon: 'request_quote',
    path: `${ACCOUNTING_BASE}/bills`,
    group: 'expenses',
  },
  {
    key: 'banking',
    label: 'Banking',
    icon: 'account_balance_wallet',
    path: BANKING_BASE,
    group: 'expenses',
  },
  {
    key: 'job-costing',
    label: 'Job costing',
    icon: 'query_stats',
    path: JOB_COSTING_BASE,
    group: 'accounting',
  },
  {
    key: 'inventory',
    label: 'Inventory',
    icon: 'inventory_2',
    path: INVENTORY_BASE,
    group: 'accounting',
  },
  {
    key: 'recurring',
    label: 'Recurring',
    icon: 'event_repeat',
    path: RECURRING_BASE,
    group: 'accounting',
  },
  {
    key: 'dimensions',
    label: 'Dimensions',
    icon: 'sell',
    path: DIMENSIONS_BASE,
    group: 'accounting',
  },
  { key: 'budgets', label: 'Budgets', icon: 'savings', path: BUDGETS_BASE, group: 'setup' },
  {
    key: 'fixed-assets',
    label: 'Fixed assets',
    icon: 'precision_manufacturing',
    path: FIXED_ASSETS_BASE,
    group: 'accounting',
  },
  {
    key: 'reports',
    label: 'Reports',
    icon: 'analytics',
    path: `${ACCOUNTING_BASE}/reports`,
    group: 'reports',
  },
  {
    key: 'custom-fields',
    label: 'Custom fields',
    icon: 'tune',
    path: CUSTOM_FIELDS_BASE,
    group: 'setup',
  },
  {
    key: 'settings',
    label: 'Settings',
    icon: 'settings',
    path: `${ACCOUNTING_BASE}/settings`,
    group: 'setup',
  },
];

/** Ordered left-rail sections (QuickBooks-style). `overview` is pinned at the top, no header. */
export const ACCOUNTING_NAV_SECTIONS: { group: AccountingNavGroup; label: string }[] = [
  { group: 'sales', label: 'Sales' },
  { group: 'expenses', label: 'Expenses' },
  { group: 'accounting', label: 'Accounting' },
  { group: 'reports', label: 'Reports' },
  { group: 'setup', label: 'Setup' },
];

/** The pinned `overview` item (rendered at the top of the rail/home with no section header). */
export const ACCOUNTING_NAV_OVERVIEW: AccountingNavItem =
  ACCOUNTING_NAV.find((n) => n.group === 'overview') ?? ACCOUNTING_NAV[0];

/** Group the nav items into the fixed section order (overview excluded — rendered specially). */
export function accountingNavByGroup(): {
  group: AccountingNavGroup;
  label: string;
  items: AccountingNavItem[];
}[] {
  return ACCOUNTING_NAV_SECTIONS.map((s) => ({
    ...s,
    items: ACCOUNTING_NAV.filter((n) => n.group === s.group),
  }));
}

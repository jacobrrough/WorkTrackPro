import type {
  Account,
  AccountBalanceRow,
  AccountType,
  AgingBucket,
  AgingRow,
  Budget,
  BudgetLine,
  BudgetStatus,
  BankAccount,
  BankAccountType,
  BankRule,
  BankRuleField,
  BankRuleOp,
  BankTransaction,
  BankTransactionStatus,
  Bill,
  BillLine,
  BillStatus,
  CustomFieldDataType,
  CustomFieldDef,
  CustomFieldEntityType,
  CustomFieldOption,
  CustomFieldValue,
  CustomFieldValueJson,
  Customer,
  DepreciationMethod,
  DepreciationScheduleRow,
  Dimension,
  DimensionType,
  FixedAsset,
  FixedAssetRegisterRow,
  FixedAssetStatus,
  InventoryCogsEvent,
  InventoryValuationRow,
  Invoice,
  Item,
  ItemType,
  InvoiceLine,
  InvoiceStatus,
  JobCostingRow,
  JournalEntry,
  JournalLine,
  JournalSourceType,
  JournalStatus,
  NormalBalance,
  Payment,
  PaymentApplication,
  PaymentMethod,
  QboEntityCounts,
  QboImportLogEntry,
  QboImportRun,
  QboLogAction,
  QboPhaseProgress,
  QboRunStatus,
  QboSyncMode,
  Reconciliation,
  ReconciliationStatus,
  RecurringFrequency,
  RecurringKind,
  RecurringPayload,
  RecurringTemplate,
  TaxAgency,
  TaxCode,
  TaxJurisdiction,
  TaxFilingFrequency,
  TaxFilingRule,
  TaxRate,
  TaxTableDrift,
  TaxTableDriftSeverity,
  TaxTableDriftStatus,
  TaxTableKind,
  TaxTableParsedEntry,
  TaxTableSnapshot,
  TaxTableSource,
  Vendor,
  VendorPayment,
  VendorPaymentApplication,
  VendorTaxInfo,
  FederalEntityType,
} from '../../../features/accounting/types';
import type { PerDocLayout } from '../../../features/accounting/documents/salesDocumentTypes';
import { parseDiff } from '../../../features/accounting/taxTableDiff';
import { readCustomerAddress } from './customerAddress';

/**
 * Row <-> domain mappers for the accounting schema. Rows come back loosely typed
 * (the `accounting` schema isn't in the generated Database types), so every mapper
 * takes a Record<string, unknown> and narrows explicitly.
 */

export type Row = Record<string, unknown>;

const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const str = (v: unknown): string => (v == null ? '' : String(v));
const nstr = (v: unknown): string | null => (v == null ? null : String(v));
const bool = (v: unknown, fallback = false): boolean =>
  typeof v === 'boolean' ? v : v == null ? fallback : v === 'true' || v === 1;

export function mapAccountRow(row: Row): Account {
  return {
    id: str(row.id),
    accountNumber: nstr(row.account_number),
    name: str(row.name),
    accountType: (row.account_type as AccountType) ?? 'asset',
    accountSubtype: nstr(row.account_subtype),
    parentAccountId: nstr(row.parent_account_id),
    normalBalance: (row.normal_balance as NormalBalance) ?? 'debit',
    currency: str(row.currency) || 'USD',
    isActive: row.is_active !== false,
    isSystem: row.is_system === true,
    description: nstr(row.description),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  };
}

export function mapJournalLineRow(row: Row): JournalLine {
  const account = (row.account ?? null) as Row | null;
  return {
    id: str(row.id),
    journalEntryId: str(row.journal_entry_id),
    accountId: str(row.account_id),
    debit: num(row.debit),
    credit: num(row.credit),
    jobId: nstr(row.job_id),
    customerId: nstr(row.customer_id),
    vendorId: nstr(row.vendor_id),
    classId: nstr(row.class_id),
    locationId: nstr(row.location_id),
    departmentId: nstr(row.department_id),
    lineMemo: nstr(row.line_memo),
    sortOrder: num(row.sort_order),
    accountName: account ? str(account.name) : undefined,
    accountNumber: account ? nstr(account.account_number) : undefined,
  };
}

export function mapJournalEntryRow(row: Row): JournalEntry {
  const rawLines = (row.lines ?? row.journal_lines ?? null) as Row[] | null;
  return {
    id: str(row.id),
    entryNumber: num(row.entry_number),
    entryDate: str(row.entry_date),
    memo: nstr(row.memo),
    sourceType: (row.source_type as JournalSourceType) ?? 'manual',
    sourceId: nstr(row.source_id),
    status: (row.status as JournalStatus) ?? 'draft',
    postedAt: nstr(row.posted_at),
    voidedAt: nstr(row.voided_at),
    voidReason: nstr(row.void_reason),
    reversalOfEntryId: nstr(row.reversal_of_entry_id),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
    lines: rawLines ? rawLines.map(mapJournalLineRow) : undefined,
  };
}

// ── Customers ────────────────────────────────────────────────────────────────
export function mapCustomerRow(row: Row): Customer {
  return {
    id: str(row.id),
    displayName: str(row.display_name),
    companyName: nstr(row.company_name),
    contactName: nstr(row.contact_name),
    email: nstr(row.email),
    phone: nstr(row.phone),
    taxExempt: bool(row.tax_exempt),
    resaleCertificate: nstr(row.resale_certificate),
    defaultTaxCodeId: nstr(row.default_tax_code_id),
    terms: nstr(row.terms),
    isActive: row.is_active !== false,
    notes: nstr(row.notes),
    sourceProposalId: nstr(row.source_proposal_id),
    billingAddress: readCustomerAddress(row.billing_address),
    shippingAddress: readCustomerAddress(row.shipping_address),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  };
}

// ── Tax codes ────────────────────────────────────────────────────────────────
/**
 * Map a tax_codes row. `rate` is the combined decimal rate; the service computes it
 * by summing the linked tax_rates (passed in via `rateOverride`) since it is not a
 * column on tax_codes.
 */
export function mapTaxCodeRow(row: Row, rateOverride?: number): TaxCode {
  return {
    id: str(row.id),
    name: str(row.name),
    description: nstr(row.description),
    isTaxable: bool(row.is_taxable, true),
    isDefault: bool(row.is_default),
    isActive: row.is_active !== false,
    rate: rateOverride != null ? rateOverride : num(row.rate),
    createdAt: str(row.created_at),
  };
}

// ── Tax jurisdictions (#13, address-based tax-code selection) ─────────────────
/** Map an `accounting.tax_jurisdictions` row (geography → composite tax_code mapping). */
export function mapTaxJurisdictionRow(row: Row): TaxJurisdiction {
  return {
    id: str(row.id),
    country: str(row.country) || 'US',
    state: nstr(row.state),
    county: nstr(row.county),
    city: nstr(row.city),
    zip: nstr(row.zip),
    taxCodeId: str(row.tax_code_id),
    priority: num(row.priority),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  };
}

// ── Tax agencies & filing calendar (C1) ──────────────────────────────────────

const VALID_TAX_FILING_FREQUENCIES = new Set<TaxFilingFrequency>([
  'monthly',
  'quarterly',
  'annual',
]);

/** Narrow a raw filing_frequency cell to the union, or null when unset/invalid. */
function taxFilingFrequency(v: unknown): TaxFilingFrequency | null {
  const s = str(v) as TaxFilingFrequency;
  return VALID_TAX_FILING_FREQUENCIES.has(s) ? s : null;
}

/**
 * Map an `accounting.tax_agencies` row. `rate` is the agency's COMBINED decimal rate
 * (Σ of its active tax_rates), which is not a column on tax_agencies — the service
 * computes it from the joined rates and passes it via `rateOverride`, exactly as
 * mapTaxCodeRow does for tax codes. `liabilityAccountId` is the GL liability account
 * (typically 2200 "Sales Tax Payable") the agency's tax accrues to.
 */
export function mapTaxAgencyRow(row: Row, rateOverride?: number): TaxAgency {
  return {
    id: str(row.id),
    name: str(row.name),
    liabilityAccountId: nstr(row.liability_account_id),
    filingFrequency: taxFilingFrequency(row.filing_frequency),
    rate: rateOverride != null ? rateOverride : num(row.rate),
    createdAt: str(row.created_at),
  };
}

/**
 * Parse the `tax_filing_calendar` settings value (migration 020) into TaxFilingRule[].
 * The DB stores a jsonb ARRAY of per-agency rules; supabase-js returns jsonb pre-parsed,
 * but we defend against a stringified array (or a null/garbage cell) so a malformed value
 * degrades to [] rather than throwing. Each rule's snake_case keys (period_basis,
 * due_day, due_month_offset) are mapped to camelCase here. A rule missing an `agency`
 * name is dropped (it cannot be matched to a tax_agencies row). Pure; exported for tests.
 */
export function parseTaxFilingRules(v: unknown): TaxFilingRule[] {
  let arr: unknown = v;
  if (typeof v === 'string') {
    try {
      arr = JSON.parse(v);
    } catch {
      arr = null;
    }
  }
  if (!Array.isArray(arr)) return [];
  const out: TaxFilingRule[] = [];
  for (const entry of arr) {
    if (!entry || typeof entry !== 'object') continue;
    const o = entry as Record<string, unknown>;
    const agency = str(o.agency);
    if (agency === '') continue;
    out.push({
      agency,
      frequency: taxFilingFrequency(o.frequency) ?? 'quarterly',
      // Only 'calendar' is supported; anything else normalizes to it.
      periodBasis: 'calendar',
      dueDay: num(o.due_day, 31),
      dueMonthOffset: num(o.due_month_offset, 1),
      notes: nstr(o.notes),
    });
  }
  return out;
}

// ── Invoices ─────────────────────────────────────────────────────────────────
export function mapInvoiceLineRow(row: Row): InvoiceLine {
  return {
    id: str(row.id),
    invoiceId: str(row.invoice_id),
    itemId: nstr(row.item_id),
    partId: nstr(row.part_id),
    description: nstr(row.description),
    quantity: num(row.quantity, 1),
    unitPrice: num(row.unit_price),
    lineTotal: num(row.line_total),
    discount: num(row.discount),
    taxCodeId: nstr(row.tax_code_id),
    taxable: bool(row.taxable, true),
    incomeAccountId: nstr(row.income_account_id),
    jobId: nstr(row.job_id),
    classId: nstr(row.class_id),
    locationId: nstr(row.location_id),
    departmentId: nstr(row.department_id),
    sortOrder: num(row.sort_order),
  };
}

export function mapInvoiceRow(row: Row): Invoice {
  const rawLines = (row.lines ?? row.invoice_lines ?? null) as Row[] | null;
  const customer = (row.customer ?? null) as Row | null;
  return {
    id: str(row.id),
    invoiceNumber: nstr(row.invoice_number),
    customerId: str(row.customer_id),
    jobId: nstr(row.job_id),
    invoiceDate: str(row.invoice_date),
    dueDate: nstr(row.due_date),
    terms: nstr(row.terms),
    status: (row.status as InvoiceStatus) ?? 'draft',
    subtotal: num(row.subtotal),
    discountTotal: num(row.discount_total),
    taxTotal: num(row.tax_total),
    total: num(row.total),
    amountPaid: num(row.amount_paid),
    balanceDue: num(row.balance_due),
    taxCodeId: nstr(row.tax_code_id),
    journalEntryId: nstr(row.journal_entry_id),
    memo: nstr(row.memo),
    notes: nstr(row.notes),
    layout: (row.layout as PerDocLayout | null) ?? null,
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
    lines: rawLines
      ? rawLines.map(mapInvoiceLineRow).sort((a, b) => a.sortOrder - b.sortOrder)
      : undefined,
    customerName: customer ? str(customer.display_name) : undefined,
  };
}

// ── Payments ─────────────────────────────────────────────────────────────────
export function mapPaymentApplicationRow(row: Row): PaymentApplication {
  return {
    id: str(row.id),
    paymentId: str(row.payment_id),
    invoiceId: str(row.invoice_id),
    amountApplied: num(row.amount_applied),
    createdAt: str(row.created_at),
  };
}

export function mapPaymentRow(row: Row): Payment {
  const rawApps = (row.applications ?? row.payment_applications ?? null) as Row[] | null;
  return {
    id: str(row.id),
    customerId: str(row.customer_id),
    paymentDate: str(row.payment_date),
    amount: num(row.amount),
    method: (row.method as PaymentMethod) ?? 'other',
    reference: nstr(row.reference),
    depositAccountId: nstr(row.deposit_account_id),
    unappliedAmount: num(row.unapplied_amount),
    journalEntryId: nstr(row.journal_entry_id),
    memo: nstr(row.memo),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
    applications: rawApps ? rawApps.map(mapPaymentApplicationRow) : undefined,
  };
}

// ── Vendors ──────────────────────────────────────────────────────────────────
export function mapVendorRow(row: Row): Vendor {
  return {
    id: str(row.id),
    displayName: str(row.display_name),
    companyName: nstr(row.company_name),
    email: nstr(row.email),
    phone: nstr(row.phone),
    terms: nstr(row.terms),
    defaultExpenseAccountId: nstr(row.default_expense_account_id),
    taxId: nstr(row.tax_id),
    is1099: bool(row.is_1099),
    isActive: row.is_active !== false,
    notes: nstr(row.notes),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  };
}

// ── Bills ────────────────────────────────────────────────────────────────────
export function mapBillLineRow(row: Row): BillLine {
  return {
    id: str(row.id),
    billId: str(row.bill_id),
    accountId: nstr(row.account_id),
    itemId: nstr(row.item_id),
    description: nstr(row.description),
    quantity: num(row.quantity, 1),
    unitCost: num(row.unit_cost),
    lineTotal: num(row.line_total),
    jobId: nstr(row.job_id),
    classId: nstr(row.class_id),
    locationId: nstr(row.location_id),
    departmentId: nstr(row.department_id),
    sourceInventoryId: nstr(row.source_inventory_id),
    // #11 3-way-match link back to the purchase_order_line this bill line fulfils (null
    // on a bill that did not originate from a PO). Additive — no existing bill flow sets it.
    poLineId: nstr(row.po_line_id),
    sortOrder: num(row.sort_order),
  };
}

export function mapBillRow(row: Row): Bill {
  const rawLines = (row.lines ?? row.bill_lines ?? null) as Row[] | null;
  const vendor = (row.vendor ?? null) as Row | null;
  return {
    id: str(row.id),
    vendorId: str(row.vendor_id),
    billNumber: nstr(row.bill_number),
    billDate: str(row.bill_date),
    dueDate: nstr(row.due_date),
    terms: nstr(row.terms),
    status: (row.status as BillStatus) ?? 'open',
    subtotal: num(row.subtotal),
    taxTotal: num(row.tax_total),
    total: num(row.total),
    amountPaid: num(row.amount_paid),
    balanceDue: num(row.balance_due),
    jobId: nstr(row.job_id),
    journalEntryId: nstr(row.journal_entry_id),
    memo: nstr(row.memo),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
    lines: rawLines
      ? rawLines.map(mapBillLineRow).sort((a, b) => a.sortOrder - b.sortOrder)
      : undefined,
    vendorName: vendor ? str(vendor.display_name) : undefined,
  };
}

// ── Vendor payments ──────────────────────────────────────────────────────────
export function mapVendorPaymentApplicationRow(row: Row): VendorPaymentApplication {
  return {
    id: str(row.id),
    vendorPaymentId: str(row.vendor_payment_id),
    billId: str(row.bill_id),
    amountApplied: num(row.amount_applied),
    createdAt: str(row.created_at),
  };
}

export function mapVendorPaymentRow(row: Row): VendorPayment {
  const rawApps = (row.applications ?? row.vendor_payment_applications ?? null) as Row[] | null;
  return {
    id: str(row.id),
    vendorId: str(row.vendor_id),
    paymentDate: str(row.payment_date),
    amount: num(row.amount),
    method: (row.method as PaymentMethod) ?? 'other',
    reference: nstr(row.reference),
    payFromAccountId: nstr(row.pay_from_account_id),
    unappliedAmount: num(row.unapplied_amount),
    journalEntryId: nstr(row.journal_entry_id),
    memo: nstr(row.memo),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
    applications: rawApps ? rawApps.map(mapVendorPaymentApplicationRow) : undefined,
  };
}

// ── Financial reports (A3) ───────────────────────────────────────────────────

const VALID_AGING_BUCKETS = new Set<AgingBucket>(['current', '1-30', '31-60', '61-90', '90+']);

/** Narrow a raw aging_bucket cell to the AgingBucket union (defaults to 'current'). */
function agingBucket(v: unknown): AgingBucket {
  const s = str(v) as AgingBucket;
  return VALID_AGING_BUCKETS.has(s) ? s : 'current';
}

/**
 * Map one posted account-balance row to AccountBalanceRow. Handles both
 * `accounting.v_trial_balance` (columns account_id / account_number / name /
 * account_type / normal_balance / total_debit / total_credit / balance) and the
 * date-range aggregation the service builds from journal_lines + accounts (which
 * exposes the very same column names), so a single mapper serves TB / P&L / BS.
 */
export function mapAccountBalanceRow(row: Row): AccountBalanceRow {
  const totalDebit = num(row.total_debit);
  const totalCredit = num(row.total_credit);
  return {
    accountId: str(row.account_id),
    accountNumber: nstr(row.account_number),
    name: str(row.name),
    accountType: (row.account_type as AccountType) ?? 'asset',
    normalBalance: (row.normal_balance as NormalBalance) ?? 'debit',
    totalDebit,
    totalCredit,
    // Prefer the DB-computed balance when present; otherwise derive it.
    balance: row.balance == null ? totalDebit - totalCredit : num(row.balance),
  };
}

/** Map an `accounting.v_ar_aging` row (open customer invoice) to AgingRow. */
export function mapArAgingRow(row: Row): AgingRow {
  return {
    documentId: str(row.invoice_id),
    documentNumber: nstr(row.invoice_number),
    partyId: str(row.customer_id),
    partyName: str(row.customer_name),
    documentDate: str(row.invoice_date),
    dueDate: nstr(row.due_date),
    total: num(row.total),
    amountPaid: num(row.amount_paid),
    balanceDue: num(row.balance_due),
    daysOverdue: num(row.days_overdue),
    bucket: agingBucket(row.aging_bucket),
  };
}

/** Map an `accounting.v_ap_aging` row (open vendor bill) to AgingRow. */
export function mapApAgingRow(row: Row): AgingRow {
  return {
    documentId: str(row.bill_id),
    documentNumber: nstr(row.bill_number),
    partyId: str(row.vendor_id),
    partyName: str(row.vendor_name),
    documentDate: str(row.bill_date),
    dueDate: nstr(row.due_date),
    total: num(row.total),
    amountPaid: num(row.amount_paid),
    balanceDue: num(row.balance_due),
    daysOverdue: num(row.days_overdue),
    bucket: agingBucket(row.aging_bucket),
  };
}

// ── Job costing (B1) ─────────────────────────────────────────────────────────

/**
 * Map an `accounting.v_job_costing` row to JobCostingRow. The view exposes
 * job_id / job_code / name / status / labor_minutes / labor_cost / material_cost /
 * revenue / margin (all money columns numeric, summed/rounded in the view). `status`
 * is the operational public.jobs.status passed through; `job_code` may be null.
 * `margin` is the DB-computed revenue − material − labor (margin % is derived in JS).
 */
export function mapJobCostingRow(row: Row): JobCostingRow {
  return {
    jobId: str(row.job_id),
    jobCode: nstr(row.job_code),
    name: str(row.name),
    status: nstr(row.status),
    laborMinutes: num(row.labor_minutes),
    laborCost: num(row.labor_cost),
    materialCost: num(row.material_cost),
    revenue: num(row.revenue),
    margin: num(row.margin),
  };
}

// ── Banking (A4) ─────────────────────────────────────────────────────────────

const VALID_BANK_ACCOUNT_TYPES = new Set<BankAccountType>(['checking', 'savings', 'credit_card']);
const VALID_BANK_TXN_STATUS = new Set<BankTransactionStatus>([
  'unreviewed',
  'categorized',
  'matched',
  'excluded',
]);
const VALID_BANK_RULE_FIELDS = new Set<BankRuleField>(['description', 'merchant', 'amount']);
const VALID_BANK_RULE_OPS = new Set<BankRuleOp>(['contains', 'equals', 'regex', 'gt', 'lt']);

/** Map an `accounting.bank_accounts` row. `account` is the optionally-joined GL account. */
export function mapBankAccountRow(row: Row): BankAccount {
  const account = (row.account ?? null) as Row | null;
  const type = str(row.account_type) as BankAccountType;
  return {
    id: str(row.id),
    name: str(row.name),
    accountId: nstr(row.account_id),
    accountType: VALID_BANK_ACCOUNT_TYPES.has(type) ? type : null,
    institution: nstr(row.institution),
    mask: nstr(row.mask),
    currentBalance: num(row.current_balance),
    lastReconciledAt: nstr(row.last_reconciled_at),
    isActive: row.is_active !== false,
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
    glAccountName: account ? str(account.name) : undefined,
    glAccountNumber: account ? nstr(account.account_number) : undefined,
    // Plaid link columns (migration 20260617000200); null on a manual account.
    plaidItemId: nstr(row.plaid_item_id),
    plaidAccountId: nstr(row.plaid_account_id),
    plaidMask: nstr(row.plaid_mask),
    plaidSubtype: nstr(row.plaid_subtype),
  };
}

/**
 * Map an `accounting.bank_transactions` row. `amount` keeps its sign (positive =
 * deposit, negative = withdrawal). `category` is the optionally-joined GL account.
 */
export function mapBankTransactionRow(row: Row): BankTransaction {
  const category = (row.category ?? null) as Row | null;
  const status = str(row.status) as BankTransactionStatus;
  return {
    id: str(row.id),
    bankAccountId: str(row.bank_account_id),
    txnDate: str(row.txn_date),
    amount: num(row.amount),
    description: nstr(row.description),
    merchant: nstr(row.merchant),
    externalId: nstr(row.external_id),
    status: VALID_BANK_TXN_STATUS.has(status) ? status : 'unreviewed',
    categoryAccountId: nstr(row.category_account_id),
    matchedJournalEntryId: nstr(row.matched_journal_entry_id),
    matchedPaymentId: nstr(row.matched_payment_id),
    matchedBillId: nstr(row.matched_bill_id),
    reconciliationId: nstr(row.reconciliation_id),
    clearedAt: nstr(row.cleared_at),
    appliedRuleId: nstr(row.applied_rule_id),
    vendorId: nstr(row.vendor_id),
    importedAt: str(row.imported_at),
    createdAt: str(row.created_at),
    categoryAccountName: category ? str(category.name) : undefined,
  };
}

/** Map an `accounting.bank_rules` row. */
export function mapBankRuleRow(row: Row): BankRule {
  const field = str(row.match_field) as BankRuleField;
  const op = str(row.match_op) as BankRuleOp;
  return {
    id: str(row.id),
    bankAccountId: nstr(row.bank_account_id),
    matchField: VALID_BANK_RULE_FIELDS.has(field) ? field : null,
    matchOp: VALID_BANK_RULE_OPS.has(op) ? op : null,
    matchValue: nstr(row.match_value),
    setAccountId: nstr(row.set_account_id),
    setVendorId: nstr(row.set_vendor_id),
    priority: num(row.priority),
    isActive: row.is_active !== false,
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  };
}

// ── Reporting dimensions (B2) ─────────────────────────────────────────────────

const VALID_DIMENSION_TYPES = new Set<DimensionType>(['class', 'location', 'department']);

/** Narrow a raw dim_type cell to the DimensionType union (defaults to 'class'). */
function dimensionType(v: unknown): DimensionType {
  const s = str(v) as DimensionType;
  return VALID_DIMENSION_TYPES.has(s) ? s : 'class';
}

/** Map an `accounting.dimensions` row to the Dimension domain shape. */
export function mapDimensionRow(row: Row): Dimension {
  return {
    id: str(row.id),
    dimType: dimensionType(row.dim_type),
    name: str(row.name),
    code: nstr(row.code),
    parentId: nstr(row.parent_id),
    isActive: row.is_active !== false,
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  };
}

// ── Recurring transaction templates (B2) ─────────────────────────────────────

const VALID_RECURRING_KINDS = new Set<RecurringKind>(['invoice', 'bill', 'journal']);
const VALID_RECURRING_FREQUENCIES = new Set<RecurringFrequency>([
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'yearly',
]);

function recurringKind(v: unknown): RecurringKind {
  const s = str(v) as RecurringKind;
  return VALID_RECURRING_KINDS.has(s) ? s : 'journal';
}

function recurringFrequency(v: unknown): RecurringFrequency {
  const s = str(v) as RecurringFrequency;
  return VALID_RECURRING_FREQUENCIES.has(s) ? s : 'monthly';
}

/**
 * Coerce the jsonb `payload` cell into a RecurringPayload object. supabase-js returns
 * jsonb as a parsed object, but we defend against a stringified value (or null) so a
 * malformed cell degrades to an empty-lines payload rather than throwing. The payload
 * is stored verbatim in camelCase by the recurring service (it round-trips its own
 * shape), so no snake↔camel mapping is needed inside it.
 */
export function parseRecurringPayload(v: unknown): RecurringPayload {
  let obj: unknown = v;
  if (typeof v === 'string') {
    try {
      obj = JSON.parse(v);
    } catch {
      obj = null;
    }
  }
  if (obj && typeof obj === 'object') {
    const o = obj as Record<string, unknown>;
    if (!Array.isArray(o.lines)) o.lines = [];
    return o as unknown as RecurringPayload;
  }
  return { lines: [] } as RecurringPayload;
}

/** Map an `accounting.recurring_templates` row to the RecurringTemplate domain shape. */
export function mapRecurringTemplateRow(row: Row): RecurringTemplate {
  return {
    id: str(row.id),
    name: str(row.name),
    kind: recurringKind(row.kind),
    frequency: recurringFrequency(row.frequency),
    intervalCount: num(row.interval_count, 1),
    startDate: str(row.start_date),
    endDate: nstr(row.end_date),
    nextRunDate: str(row.next_run_date),
    dayOfMonth: row.day_of_month == null ? null : num(row.day_of_month),
    lastRunDate: nstr(row.last_run_date),
    lastGeneratedId: nstr(row.last_generated_id),
    occurrencesGenerated: num(row.occurrences_generated),
    payload: parseRecurringPayload(row.payload),
    active: row.active !== false,
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  };
}

// ── Inventory valuation (FIFO) → COGS (B3) ────────────────────────────────────

/**
 * Map an `accounting.v_inventory_valuation` row. The view exposes, per stock item:
 * source_inventory_id / inventory_name / item_id / qty_on_hand / asset_value /
 * avg_unit_cost / qty_received_total / qty_consumed_total / cogs_total — all money
 * columns numeric (asset/cogs are 2dp dollars; avg_unit_cost is 4dp). asset_value
 * ties to GL 1300 and cogs_total to lifetime 5000 postings.
 */
export function mapInventoryValuationRow(row: Row): InventoryValuationRow {
  return {
    sourceInventoryId: str(row.source_inventory_id),
    inventoryName: str(row.inventory_name),
    itemId: nstr(row.item_id),
    qtyOnHand: num(row.qty_on_hand),
    assetValue: num(row.asset_value),
    avgUnitCost: num(row.avg_unit_cost),
    qtyReceivedTotal: num(row.qty_received_total),
    qtyConsumedTotal: num(row.qty_consumed_total),
    cogsTotal: num(row.cogs_total),
  };
}

/**
 * Map an `accounting.inventory_cogs_events` row (one consumed stock item, tied to its
 * balanced COGS journal entry). `cost` is the extended COGS in dollars; `qty` the units
 * consumed. job_id / source_inventory_id are read-only links to the core consumption
 * moment and may be null after a set-null delete.
 */
export function mapInventoryCogsEventRow(row: Row): InventoryCogsEvent {
  return {
    id: str(row.id),
    itemId: nstr(row.item_id),
    journalEntryId: str(row.journal_entry_id),
    qty: num(row.qty),
    cost: num(row.cost),
    consumedAt: str(row.consumed_at),
    jobId: nstr(row.job_id),
    sourceInventoryId: nstr(row.source_inventory_id),
    createdAt: str(row.created_at),
  };
}

/** Map an `accounting.reconciliations` row. Money cells are nullable on this table. */
export function mapReconciliationRow(row: Row): Reconciliation {
  const status = str(row.status) as ReconciliationStatus;
  return {
    id: str(row.id),
    bankAccountId: str(row.bank_account_id),
    statementDate: str(row.statement_date),
    statementEndingBalance:
      row.statement_ending_balance == null ? null : num(row.statement_ending_balance),
    beginningBalance: row.beginning_balance == null ? null : num(row.beginning_balance),
    status: status === 'completed' ? 'completed' : 'in_progress',
    reconciledBy: nstr(row.reconciled_by),
    reconciledAt: nstr(row.reconciled_at),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  };
}

// ── Budgeting & forecasting (D2) ──────────────────────────────────────────────

const VALID_BUDGET_STATUSES = new Set<BudgetStatus>(['draft', 'active', 'archived']);

/** Narrow a raw budgets.status cell to the BudgetStatus union (defaults to 'draft'). */
function budgetStatus(v: unknown): BudgetStatus {
  const s = str(v) as BudgetStatus;
  return VALID_BUDGET_STATUSES.has(s) ? s : 'draft';
}

/** Map an `accounting.budgets` row (a named plan for a fiscal year) to the Budget shape. */
export function mapBudgetRow(row: Row): Budget {
  return {
    id: str(row.id),
    name: str(row.name),
    fiscalYear: num(row.fiscal_year),
    status: budgetStatus(row.status),
    description: nstr(row.description),
    createdBy: nstr(row.created_by),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  };
}

/**
 * Map an `accounting.budget_lines` row (one planned cell per budget/account/month) to
 * BudgetLine. `period_month` is a calendar month 1-12; `amount` is the planned dollars
 * (numeric(14,2) in the DB). `account` is the optionally-joined accounts row, used to
 * hydrate the display name/number for the editor grid and report rows.
 */
export function mapBudgetLineRow(row: Row): BudgetLine {
  const account = (row.account ?? null) as Row | null;
  return {
    id: str(row.id),
    budgetId: str(row.budget_id),
    accountId: str(row.account_id),
    periodMonth: num(row.period_month),
    amount: num(row.amount),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
    accountName: account ? str(account.name) : undefined,
    accountNumber: account ? nstr(account.account_number) : undefined,
  };
}

// ── Fixed assets & depreciation (D3) ──────────────────────────────────────────

const VALID_DEPRECIATION_METHODS = new Set<DepreciationMethod>([
  'straight_line',
  'declining_balance',
]);
const VALID_FIXED_ASSET_STATUSES = new Set<FixedAssetStatus>([
  'active',
  'fully_depreciated',
  'disposed',
]);

/** Narrow a raw method cell to the DepreciationMethod union (defaults to 'straight_line'). */
function depreciationMethod(v: unknown): DepreciationMethod {
  const s = str(v) as DepreciationMethod;
  return VALID_DEPRECIATION_METHODS.has(s) ? s : 'straight_line';
}

/** Narrow a raw status cell to the FixedAssetStatus union (defaults to 'active'). */
function fixedAssetStatus(v: unknown): FixedAssetStatus {
  const s = str(v) as FixedAssetStatus;
  return VALID_FIXED_ASSET_STATUSES.has(s) ? s : 'active';
}

/** Map an `accounting.fixed_assets` row (one capitalized asset) to the FixedAsset shape. */
export function mapFixedAssetRow(row: Row): FixedAsset {
  return {
    id: str(row.id),
    name: str(row.name),
    assetAccountId: str(row.asset_account_id),
    accumDeprAccountId: str(row.accum_depr_account_id),
    deprExpenseAccountId: str(row.depr_expense_account_id),
    cost: num(row.cost),
    salvageValue: num(row.salvage_value),
    usefulLifeMonths: num(row.useful_life_months),
    method: depreciationMethod(row.method),
    inServiceDate: str(row.in_service_date),
    status: fixedAssetStatus(row.status),
    createdBy: nstr(row.created_by),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  };
}

/**
 * Map an `accounting.depreciation_schedule` row (one planned/posted period) to the
 * DepreciationScheduleRow shape. `journal_entry_id` is null until the period is posted;
 * `posted` flips true when its balanced JE is booked.
 */
export function mapDepreciationScheduleRow(row: Row): DepreciationScheduleRow {
  return {
    id: str(row.id),
    fixedAssetId: str(row.fixed_asset_id),
    periodDate: str(row.period_date),
    amount: num(row.amount),
    journalEntryId: nstr(row.journal_entry_id),
    posted: bool(row.posted),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  };
}

/**
 * Map an `accounting.v_fixed_asset_register` row. The view exposes, per asset: cost,
 * salvage, accumulated_depreciation (Σ POSTED schedule rows), net_book_value (cost −
 * accumulated, floored at salvage — all computed in the view), plus the remaining
 * unposted plan. All money columns are numeric(14,2) dollars.
 */
export function mapFixedAssetRegisterRow(row: Row): FixedAssetRegisterRow {
  return {
    id: str(row.id),
    name: str(row.name),
    assetAccountId: str(row.asset_account_id),
    accumDeprAccountId: str(row.accum_depr_account_id),
    deprExpenseAccountId: str(row.depr_expense_account_id),
    cost: num(row.cost),
    salvageValue: num(row.salvage_value),
    usefulLifeMonths: num(row.useful_life_months),
    method: depreciationMethod(row.method),
    inServiceDate: str(row.in_service_date),
    status: fixedAssetStatus(row.status),
    accumulatedDepreciation: num(row.accumulated_depreciation),
    periodsPosted: num(row.periods_posted),
    netBookValue: num(row.net_book_value),
    remainingPlanned: num(row.remaining_planned),
    periodsRemaining: num(row.periods_remaining),
  };
}

// ── Custom fields on accounting entities (D4) ─────────────────────────────────

const VALID_CUSTOM_FIELD_ENTITY_TYPES = new Set<CustomFieldEntityType>([
  'invoice',
  'bill',
  'customer',
  'vendor',
  'account',
  'journal_entry',
]);
const VALID_CUSTOM_FIELD_DATA_TYPES = new Set<CustomFieldDataType>([
  'text',
  'number',
  'date',
  'boolean',
  'select',
]);

/** Narrow a raw entity_type cell to the union (defaults to 'invoice'). */
function customFieldEntityType(v: unknown): CustomFieldEntityType {
  const s = str(v) as CustomFieldEntityType;
  return VALID_CUSTOM_FIELD_ENTITY_TYPES.has(s) ? s : 'invoice';
}

/** Narrow a raw data_type cell to the union (defaults to 'text'). */
function customFieldDataType(v: unknown): CustomFieldDataType {
  const s = str(v) as CustomFieldDataType;
  return VALID_CUSTOM_FIELD_DATA_TYPES.has(s) ? s : 'text';
}

/**
 * Coerce the jsonb `options` cell of a custom_field_defs row into a clean
 * CustomFieldOption[] (the choice list for data_type='select'). supabase-js returns jsonb
 * pre-parsed, but we defend against a stringified array (or a null/garbage cell) so a
 * malformed value degrades to [] rather than throwing. Each entry must be an object with
 * a non-empty `value`; a missing `label` falls back to the value. Non-conforming entries
 * are dropped. This is the read-side guard that pairs with normalizeOptions on write.
 */
export function parseCustomFieldOptions(v: unknown): CustomFieldOption[] {
  let arr: unknown = v;
  if (typeof v === 'string') {
    try {
      arr = JSON.parse(v);
    } catch {
      arr = null;
    }
  }
  if (!Array.isArray(arr)) return [];
  const out: CustomFieldOption[] = [];
  for (const entry of arr) {
    if (!entry || typeof entry !== 'object') continue;
    const o = entry as Record<string, unknown>;
    const value = str(o.value);
    if (value === '') continue;
    const label = str(o.label) || value;
    out.push({ value, label });
  }
  return out;
}

/**
 * Coerce the jsonb `value` cell of a custom_field_values row into the CustomFieldValueJson
 * box. supabase-js returns jsonb pre-parsed, so a string/number/boolean comes through as
 * itself; we pass those through verbatim and map everything else (objects, arrays,
 * undefined) to null = "unset". A stringified scalar (defensive) is JSON-parsed first.
 */
export function parseCustomFieldValueJson(v: unknown): CustomFieldValueJson {
  if (v == null) return null;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') {
    // A jsonb scalar arrives parsed; but if a raw JSON string slipped through (e.g. '"x"'
    // or 'true'), unwrap it so the box holds the scalar, not its JSON text.
    if (typeof v === 'string') {
      const trimmed = v.trim();
      if (
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        trimmed === 'true' ||
        trimmed === 'false' ||
        /^-?\d+(\.\d+)?$/.test(trimmed)
      ) {
        try {
          const parsed = JSON.parse(trimmed);
          if (
            typeof parsed === 'number' ||
            typeof parsed === 'boolean' ||
            typeof parsed === 'string'
          ) {
            return parsed;
          }
        } catch {
          /* fall through to return the original string */
        }
      }
    }
    return v;
  }
  // Objects/arrays are not a valid scalar box → treat as unset.
  return null;
}

/** Map an `accounting.custom_field_defs` row to the CustomFieldDef domain shape. */
export function mapCustomFieldDefRow(row: Row): CustomFieldDef {
  return {
    id: str(row.id),
    entityType: customFieldEntityType(row.entity_type),
    key: str(row.key),
    label: str(row.label),
    dataType: customFieldDataType(row.data_type),
    options: parseCustomFieldOptions(row.options),
    helpText: nstr(row.help_text),
    sortOrder: num(row.sort_order),
    active: row.active !== false,
    createdBy: nstr(row.created_by),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  };
}

/** Map an `accounting.custom_field_values` row to the CustomFieldValue domain shape. */
export function mapCustomFieldValueRow(row: Row): CustomFieldValue {
  return {
    id: str(row.id),
    defId: str(row.def_id),
    entityType: customFieldEntityType(row.entity_type),
    entityId: str(row.entity_id),
    value: parseCustomFieldValueJson(row.value),
    createdBy: nstr(row.created_by),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  };
}

// ── TAX-SYNC: tax-table sources / snapshots / drift (migration 022) ───────────────────
// The accounting schema isn't in the generated Database types, so each row arrives as
// Record<string, unknown> and we narrow explicitly (same as every mapper above).

const VALID_TAX_TABLE_KINDS: ReadonlySet<string> = new Set<TaxTableKind>(['sales', 'payroll']);
const VALID_DRIFT_SEVERITIES: ReadonlySet<string> = new Set<TaxTableDriftSeverity>([
  'info',
  'warning',
  'critical',
]);
const VALID_DRIFT_STATUSES: ReadonlySet<string> = new Set<TaxTableDriftStatus>([
  'open',
  'reviewed',
  'applied',
  'dismissed',
]);

/** Narrow a raw kind cell to the union (defaults to 'sales'). */
function taxTableKind(v: unknown): TaxTableKind {
  const s = str(v) as TaxTableKind;
  return VALID_TAX_TABLE_KINDS.has(s) ? s : 'sales';
}

/** Narrow a raw severity cell to the union (defaults to 'warning'). */
function driftSeverity(v: unknown): TaxTableDriftSeverity {
  const s = str(v) as TaxTableDriftSeverity;
  return VALID_DRIFT_SEVERITIES.has(s) ? s : 'warning';
}

/** Narrow a raw status cell to the union (defaults to 'open'). */
function driftStatus(v: unknown): TaxTableDriftStatus {
  const s = str(v) as TaxTableDriftStatus;
  return VALID_DRIFT_STATUSES.has(s) ? s : 'open';
}

/**
 * Coerce the jsonb `parsed` cell of a snapshot (the normalized rate set the source parser
 * produced) into a clean TaxTableParsedEntry[]. supabase-js returns jsonb pre-parsed, but
 * we defend against a stringified array / null / garbage so a malformed value degrades to
 * [] rather than throwing. Each entry preserves any extra parser keys verbatim; the core
 * jurisdiction/rate/effectiveDate fields are normalized (rate → number|null).
 */
export function parseTaxTableSnapshotParsed(v: unknown): TaxTableParsedEntry[] {
  let arr: unknown = v;
  if (typeof v === 'string') {
    try {
      arr = JSON.parse(v);
    } catch {
      arr = null;
    }
  }
  if (!Array.isArray(arr)) return [];
  const out: TaxTableParsedEntry[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    const rateRaw = o.rate;
    const rate =
      typeof rateRaw === 'number'
        ? Number.isFinite(rateRaw)
          ? rateRaw
          : null
        : typeof rateRaw === 'string' && rateRaw.trim() !== '' && Number.isFinite(Number(rateRaw))
          ? Number(rateRaw)
          : null;
    out.push({
      ...o,
      jurisdiction: nstr(o.jurisdiction),
      rate,
      effectiveDate: nstr(o.effective_date ?? o.effectiveDate),
    });
  }
  return out;
}

/** Map an `accounting.tax_table_sources` row to the TaxTableSource domain shape. */
export function mapTaxTableSourceRow(row: Row): TaxTableSource {
  return {
    id: str(row.id),
    name: str(row.name),
    kind: taxTableKind(row.kind),
    jurisdiction: nstr(row.jurisdiction),
    url: nstr(row.url),
    officialFileUrl: nstr(row.official_file_url),
    checkFrequencyDays: num(row.check_frequency_days, 90),
    active: row.active !== false,
    lastCheckedAt: nstr(row.last_checked_at),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  };
}

/**
 * Map an `accounting.tax_table_snapshots` row to the TaxTableSnapshot domain shape.
 * `raw` is large + untrusted, so list reads typically omit the column (it arrives
 * undefined → mapped to null); the detail read can select it explicitly.
 */
export function mapTaxTableSnapshotRow(row: Row): TaxTableSnapshot {
  return {
    id: str(row.id),
    sourceId: str(row.source_id),
    fetchedAt: str(row.fetched_at),
    contentHash: nstr(row.content_hash),
    parsed: parseTaxTableSnapshotParsed(row.parsed),
    raw: nstr(row.raw),
    error: nstr(row.error),
    createdAt: str(row.created_at),
  };
}

/**
 * Map an `accounting.tax_table_drift` row to the TaxTableDrift domain shape. `diff` is
 * normalized via the pure parseDiff helper (the same normalizer the apply-preview + UI
 * use). When the read embeds the source (`source:tax_table_sources(name, kind)`), the
 * hydrated sourceName/sourceKind are filled for display.
 */
export function mapTaxTableDriftRow(row: Row): TaxTableDrift {
  const source = (row.source ?? null) as Row | null;
  return {
    id: str(row.id),
    sourceId: str(row.source_id),
    snapshotId: nstr(row.snapshot_id),
    detectedAt: str(row.detected_at),
    diff: parseDiff(row.diff),
    severity: driftSeverity(row.severity),
    status: driftStatus(row.status),
    reviewedBy: nstr(row.reviewed_by),
    reviewedAt: nstr(row.reviewed_at),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
    sourceName: source ? str(source.name) : undefined,
    sourceKind: source ? taxTableKind(source.kind) : undefined,
  };
}

/**
 * Map an `accounting.tax_rates` row to the TaxRate read shape (used by the drift detail to
 * show what Apply would change). accounting.tax_rates has NO updated_at column.
 */
export function mapTaxRateRow(row: Row): TaxRate {
  return {
    id: str(row.id),
    name: str(row.name),
    rate: num(row.rate),
    jurisdiction: nstr(row.jurisdiction),
    effectiveDate: nstr(row.effective_date),
    endDate: nstr(row.end_date),
    isActive: row.is_active !== false,
    createdAt: str(row.created_at),
  };
}

/** The W-9 federal tax classifications (accounting.vendor_tax_info.federal_entity_type). */
const VALID_FEDERAL_ENTITY_TYPES: ReadonlySet<FederalEntityType> = new Set([
  'individual',
  'sole_prop',
  'c_corp',
  's_corp',
  'partnership',
  'llc',
  'other',
]);

/** Narrow a raw entity-type cell to the union, or null when unset/unrecognized. */
function federalEntityType(v: unknown): FederalEntityType | null {
  if (v == null) return null;
  const s = String(v) as FederalEntityType;
  return VALID_FEDERAL_ENTITY_TYPES.has(s) ? s : null;
}

/**
 * Map an `accounting.vendor_tax_info` row (the #12 W-9 record) to the VendorTaxInfo domain
 * shape. `address` is jsonb (supabase-js returns it pre-parsed); a non-object value
 * degrades to null. tax_id is PII — it is mapped through here for the editor but the
 * 1099-NEC report shape never echoes it (only a "present?" flag).
 */
export function mapVendorTaxInfoRow(row: Row): VendorTaxInfo {
  const addr = row.address;
  return {
    vendorId: str(row.vendor_id),
    legalName: nstr(row.legal_name),
    taxId: nstr(row.tax_id),
    address:
      addr != null && typeof addr === 'object' && !Array.isArray(addr)
        ? (addr as Record<string, unknown>)
        : null,
    federalEntityType: federalEntityType(row.federal_entity_type),
    exempt: bool(row.exempt),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  };
}

/** Narrow a jsonb column to a plain object (degrades to {} on any other shape). */
function jsonObject<T>(v: unknown): Record<string, T> {
  return v != null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, T>) : {};
}

/** Numeric column that may be null (e.g. items.sales_price). */
const nnum = (v: unknown): number | null => {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Map an `accounting.items` row (products & services master). */
export function mapItemRow(row: Row): Item {
  return {
    id: str(row.id),
    name: str(row.name),
    sku: nstr(row.sku),
    itemType: (row.item_type as ItemType) ?? 'service',
    incomeAccountId: nstr(row.income_account_id),
    expenseAccountId: nstr(row.expense_account_id),
    inventoryAssetAccountId: nstr(row.inventory_asset_account_id),
    defaultTaxCodeId: nstr(row.default_tax_code_id),
    salesPrice: nnum(row.sales_price),
    purchaseCost: nnum(row.purchase_cost),
    isActive: bool(row.is_active, true),
    sourceInventoryId: nstr(row.source_inventory_id),
    sourcePartId: nstr(row.source_part_id),
    externalQboId: nstr(row.external_qbo_id),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  };
}

/** Map an `accounting.qbo_import_runs` row (QBO sync run tracking). */
export function mapQboImportRunRow(row: Row): QboImportRun {
  return {
    id: str(row.id),
    mode: (row.mode as QboSyncMode) ?? 'full',
    status: (row.status as QboRunStatus) ?? 'running',
    phase: nstr(row.phase),
    progress: jsonObject<QboPhaseProgress>(row.progress),
    counts: jsonObject<QboEntityCounts>(row.counts),
    error: nstr(row.error),
    changedSince: nstr(row.changed_since),
    startedBy: nstr(row.started_by),
    startedAt: str(row.started_at),
    finishedAt: nstr(row.finished_at),
    updatedAt: str(row.updated_at),
  };
}

/** Map an `accounting.qbo_import_log` row (per-record sync audit line). */
export function mapQboImportLogRow(row: Row): QboImportLogEntry {
  return {
    id: str(row.id),
    runId: str(row.run_id),
    entity: str(row.entity),
    qboId: nstr(row.qbo_id),
    action: (row.action as QboLogAction) ?? 'error',
    status: row.status === 'error' ? 'error' : 'ok',
    message: nstr(row.message),
    recordId: nstr(row.record_id),
    at: str(row.at),
  };
}

/**
 * WorkTrackAccounting domain types (camelCase). These mirror the `accounting`
 * Postgres schema; row<->domain mapping lives in src/services/api/accounting/mappers.ts.
 */

// ── Chart of accounts ────────────────────────────────────────────────────────
export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';
export type NormalBalance = 'debit' | 'credit';

export const ACCOUNT_TYPES: AccountType[] = ['asset', 'liability', 'equity', 'income', 'expense'];

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  asset: 'Asset',
  liability: 'Liability',
  equity: 'Equity',
  income: 'Income',
  expense: 'Expense',
};

/** Default normal balance for a given account type. */
export const DEFAULT_NORMAL_BALANCE: Record<AccountType, NormalBalance> = {
  asset: 'debit',
  liability: 'credit',
  equity: 'credit',
  income: 'credit',
  expense: 'debit',
};

export interface Account {
  id: string;
  accountNumber: string | null;
  name: string;
  accountType: AccountType;
  accountSubtype: string | null;
  parentAccountId: string | null;
  normalBalance: NormalBalance;
  currency: string;
  isActive: boolean;
  isSystem: boolean;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewAccountInput {
  accountNumber?: string | null;
  name: string;
  accountType: AccountType;
  accountSubtype?: string | null;
  parentAccountId?: string | null;
  normalBalance: NormalBalance;
  description?: string | null;
}

// ── General ledger ───────────────────────────────────────────────────────────
export type JournalStatus = 'draft' | 'posted' | 'void';

export type JournalSourceType =
  | 'manual'
  | 'invoice'
  | 'payment'
  | 'bill'
  | 'vendor_payment'
  | 'bank_txn'
  | 'payroll'
  | 'depreciation'
  | 'adjustment'
  | 'opening_balance';

export interface JournalLine {
  id: string;
  journalEntryId: string;
  accountId: string;
  debit: number;
  credit: number;
  jobId: string | null;
  customerId: string | null;
  vendorId: string | null;
  /** B2 reporting dimensions stamped onto the posting (nullable). */
  classId: string | null;
  locationId: string | null;
  departmentId: string | null;
  lineMemo: string | null;
  sortOrder: number;
  // Optional hydrated fields for display (joined from accounts)
  accountName?: string;
  accountNumber?: string | null;
}

export interface JournalEntry {
  id: string;
  entryNumber: number;
  entryDate: string;
  memo: string | null;
  sourceType: JournalSourceType;
  sourceId: string | null;
  status: JournalStatus;
  postedAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  reversalOfEntryId: string | null;
  createdAt: string;
  updatedAt: string;
  lines?: JournalLine[];
}

export interface NewJournalLineInput {
  accountId: string;
  debit: number;
  credit: number;
  lineMemo?: string | null;
  jobId?: string | null;
  /** Denormalized reporting dimensions (the authoritative party link lives on the source document). */
  customerId?: string | null;
  vendorId?: string | null;
  /** B2 reporting dimensions (class/location/department). Each must reference a
   * dimension of the matching type; the DB trigger assert_line_dimension_types enforces it. */
  classId?: string | null;
  locationId?: string | null;
  departmentId?: string | null;
}

export interface NewJournalEntryInput {
  entryDate: string;
  memo?: string | null;
  sourceType?: JournalSourceType;
  /** Optional document this entry was generated from (e.g. an invoice/payment id). */
  sourceId?: string | null;
  lines: NewJournalLineInput[];
}

// ── Customers (AR party master) ──────────────────────────────────────────────
export interface Customer {
  id: string;
  displayName: string;
  companyName: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  taxExempt: boolean;
  resaleCertificate: string | null;
  defaultTaxCodeId: string | null;
  terms: string | null;
  isActive: boolean;
  notes: string | null;
  sourceProposalId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewCustomerInput {
  displayName: string;
  companyName?: string | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  taxExempt?: boolean;
  resaleCertificate?: string | null;
  defaultTaxCodeId?: string | null;
  terms?: string | null;
  notes?: string | null;
  sourceProposalId?: string | null;
}

// ── Sales tax ────────────────────────────────────────────────────────────────
export interface TaxCode {
  id: string;
  name: string;
  description: string | null;
  isTaxable: boolean;
  isDefault: boolean;
  isActive: boolean;
  /** Combined rate as a decimal fraction (e.g. 0.0725 = 7.25%), summed from composing tax_rates. */
  rate: number;
  createdAt: string;
}

// ── Invoices (AR) ────────────────────────────────────────────────────────────
export type InvoiceStatus = 'draft' | 'sent' | 'partially_paid' | 'paid' | 'void';

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  partially_paid: 'Partially paid',
  paid: 'Paid',
  void: 'Void',
};

export interface InvoiceLine {
  id: string;
  invoiceId: string;
  itemId: string | null;
  description: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  discount: number;
  taxCodeId: string | null;
  taxable: boolean;
  incomeAccountId: string | null;
  jobId: string | null;
  /** B2 reporting dimensions carried on the AR line (stamped onto the income JE line). */
  classId: string | null;
  locationId: string | null;
  departmentId: string | null;
  sortOrder: number;
}

export interface Invoice {
  id: string;
  invoiceNumber: string | null;
  customerId: string;
  jobId: string | null;
  invoiceDate: string;
  dueDate: string | null;
  terms: string | null;
  status: InvoiceStatus;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  taxCodeId: string | null;
  journalEntryId: string | null;
  memo: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  // Optional hydrated fields for display
  lines?: InvoiceLine[];
  customerName?: string;
}

/** A line as supplied by the UI/job-importer before it has a DB id. */
export interface NewInvoiceLineInput {
  itemId?: string | null;
  description?: string | null;
  quantity: number;
  unitPrice: number;
  /** Optional explicit line total; defaults to quantity * unitPrice - discount. */
  lineTotal?: number;
  discount?: number;
  taxCodeId?: string | null;
  taxable?: boolean;
  incomeAccountId?: string | null;
  jobId?: string | null;
  /** B2 reporting dimensions (class/location/department). Persisted on the line and
   * stamped onto the income JE line on send. */
  classId?: string | null;
  locationId?: string | null;
  departmentId?: string | null;
}

export interface NewInvoiceInput {
  customerId: string;
  jobId?: string | null;
  invoiceDate?: string;
  dueDate?: string | null;
  terms?: string | null;
  /** Header-level tax code applied to taxable lines lacking their own code. */
  taxCodeId?: string | null;
  memo?: string | null;
  notes?: string | null;
  lines: NewInvoiceLineInput[];
}

/** Patch for a still-draft invoice (header + full line replacement). */
export interface UpdateInvoiceInput {
  customerId?: string;
  jobId?: string | null;
  invoiceDate?: string;
  dueDate?: string | null;
  terms?: string | null;
  taxCodeId?: string | null;
  memo?: string | null;
  notes?: string | null;
  lines?: NewInvoiceLineInput[];
}

// ── Customer payments (AR receipts) ──────────────────────────────────────────
export type PaymentMethod = 'cash' | 'check' | 'card' | 'ach' | 'other';

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  check: 'Check',
  card: 'Card',
  ach: 'ACH / bank transfer',
  other: 'Other',
};

export interface PaymentApplication {
  id: string;
  paymentId: string;
  invoiceId: string;
  amountApplied: number;
  createdAt: string;
}

export interface Payment {
  id: string;
  customerId: string;
  paymentDate: string;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  depositAccountId: string | null;
  unappliedAmount: number;
  journalEntryId: string | null;
  memo: string | null;
  createdAt: string;
  updatedAt: string;
  applications?: PaymentApplication[];
}

/** One invoice an incoming payment is applied against. */
export interface NewPaymentApplicationInput {
  invoiceId: string;
  amountApplied: number;
}

export interface NewPaymentInput {
  customerId: string;
  paymentDate?: string;
  amount: number;
  method?: PaymentMethod;
  reference?: string | null;
  /** Deposit/clearing account to debit. Defaults to Undeposited Funds when omitted. */
  depositAccountId?: string | null;
  memo?: string | null;
  applications: NewPaymentApplicationInput[];
}

// ── Vendors (AP party master) ────────────────────────────────────────────────
export interface Vendor {
  id: string;
  displayName: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  terms: string | null;
  /** GL expense account a bill line defaults to when neither the line nor its item names one. */
  defaultExpenseAccountId: string | null;
  taxId: string | null;
  is1099: boolean;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewVendorInput {
  displayName: string;
  companyName?: string | null;
  email?: string | null;
  phone?: string | null;
  terms?: string | null;
  defaultExpenseAccountId?: string | null;
  taxId?: string | null;
  is1099?: boolean;
  notes?: string | null;
}

// ── Bills (AP) ───────────────────────────────────────────────────────────────
export type BillStatus = 'draft' | 'open' | 'partially_paid' | 'paid' | 'void';

export const BILL_STATUS_LABELS: Record<BillStatus, string> = {
  draft: 'Draft',
  open: 'Open',
  partially_paid: 'Partially paid',
  paid: 'Paid',
  void: 'Void',
};

export interface BillLine {
  id: string;
  billId: string;
  /** Direct GL account (account-based line). Mutually exclusive at the DB with item-based. */
  accountId: string | null;
  /** Item whose expense/inventory-asset account resolves the debit (item-based line). */
  itemId: string | null;
  description: string | null;
  quantity: number;
  unitCost: number;
  lineTotal: number;
  jobId: string | null;
  /** B2 reporting dimensions carried on the AP line (stamped onto the expense JE line). */
  classId: string | null;
  locationId: string | null;
  departmentId: string | null;
  sourceInventoryId: string | null;
  sortOrder: number;
}

export interface Bill {
  id: string;
  vendorId: string;
  billNumber: string | null;
  billDate: string;
  dueDate: string | null;
  terms: string | null;
  status: BillStatus;
  subtotal: number;
  taxTotal: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  jobId: string | null;
  journalEntryId: string | null;
  memo: string | null;
  createdAt: string;
  updatedAt: string;
  // Optional hydrated fields for display
  lines?: BillLine[];
  vendorName?: string;
}

/** A bill line as supplied by the UI before it has a DB id. */
export interface NewBillLineInput {
  accountId?: string | null;
  itemId?: string | null;
  description?: string | null;
  quantity: number;
  unitCost: number;
  /** Optional explicit line total; defaults to quantity * unitCost. */
  lineTotal?: number;
  jobId?: string | null;
  /** B2 reporting dimensions (class/location/department). Persisted on the line and
   * stamped onto the expense JE line on post. */
  classId?: string | null;
  locationId?: string | null;
  departmentId?: string | null;
  sourceInventoryId?: string | null;
}

export interface NewBillInput {
  vendorId: string;
  billNumber?: string | null;
  billDate?: string;
  dueDate?: string | null;
  terms?: string | null;
  /** Sales/use tax charged on the bill, in dollars (bills tax at the header, not per line). */
  taxTotal?: number;
  jobId?: string | null;
  memo?: string | null;
  lines: NewBillLineInput[];
}

/** Patch for a still-draft bill (header + full line replacement). */
export interface UpdateBillInput {
  vendorId?: string;
  billNumber?: string | null;
  billDate?: string;
  dueDate?: string | null;
  terms?: string | null;
  taxTotal?: number;
  jobId?: string | null;
  memo?: string | null;
  lines?: NewBillLineInput[];
}

// ── Vendor payments (AP disbursements) ───────────────────────────────────────
export interface VendorPaymentApplication {
  id: string;
  vendorPaymentId: string;
  billId: string;
  amountApplied: number;
  createdAt: string;
}

export interface VendorPayment {
  id: string;
  vendorId: string;
  paymentDate: string;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  /** Cash/bank account the disbursement is drawn from (credited). */
  payFromAccountId: string | null;
  unappliedAmount: number;
  journalEntryId: string | null;
  memo: string | null;
  createdAt: string;
  updatedAt: string;
  applications?: VendorPaymentApplication[];
}

/** One bill an outgoing vendor payment is applied against. */
export interface NewVendorPaymentApplicationInput {
  billId: string;
  amountApplied: number;
}

export interface NewVendorPaymentInput {
  vendorId: string;
  paymentDate?: string;
  amount: number;
  method?: PaymentMethod;
  reference?: string | null;
  /** Account the disbursement is drawn from. Defaults to Cash when omitted. */
  payFromAccountId?: string | null;
  memo?: string | null;
  applications: NewVendorPaymentApplicationInput[];
}

/**
 * Default GL account ids resolved from accounting.settings -> 'default_accounts'.
 * Used by the posting layer so account numbers are not hardcoded in JS.
 */
export interface DefaultAccounts {
  cash: string | null;
  undepositedFunds: string | null;
  accountsReceivable: string | null;
  inventoryAsset: string | null;
  accountsPayable: string | null;
  salesTaxPayable: string | null;
  salesIncome: string | null;
  serviceIncome: string | null;
  cogs: string | null;
  operatingExpenses: string | null;
  /** D3 fixed-asset defaults (migration 20260601000018 extends the blob with these). */
  fixedAsset: string | null;
  accumulatedDepreciation: string | null;
  depreciationExpense: string | null;
  /**
   * COA-EXPAND structural defaults (migration 20260601000021 extends the blob with
   * these). They name the accounts later modules post against, without hardcoding ids:
   *   openingBalanceEquity     -> 3050  (import/migration equity offset; pairs with 2050)
   *   uncategorizedIncome      -> 4900  (bank-feed income inbox; A4 rules recategorize)
   *   uncategorizedExpense     -> 6900  (bank-feed expense inbox)
   *   paymentProcessorClearing -> 1260  (Stripe/PayPal settlement clearing; money in transit)
   */
  openingBalanceEquity: string | null;
  uncategorizedIncome: string | null;
  uncategorizedExpense: string | null;
  paymentProcessorClearing: string | null;
}

// ── Financial reports (A3) ───────────────────────────────────────────────────
//
// All report figures below are plain dollars (the DB columns are numeric(14,2)).
// The aggregation that produces them runs in integer cents in reportMath.ts so
// debits/credits and section subtotals never drift off floating-point error.

/**
 * An inclusive entry-date window for the period reports (Trial Balance, P&L,
 * Balance Sheet). Either bound may be omitted to mean "open-ended" — an empty
 * range therefore covers all posted activity to date. Dates are ISO `YYYY-MM-DD`.
 */
export interface DateRange {
  /** Inclusive start (entry_date >= from). Omit for "since inception". */
  from?: string | null;
  /** Inclusive end (entry_date <= to). Omit for "through today". */
  to?: string | null;
}

/**
 * One account's posted balance over a window. This is the row shape the service
 * derives from `accounting.v_trial_balance` (all-time) or, for a bounded window,
 * by aggregating posted journal_lines joined to accounts. `balance` is the signed
 * debit-minus-credit total in dollars; presentation flips sign by normal balance.
 */
export interface AccountBalanceRow {
  accountId: string;
  accountNumber: string | null;
  name: string;
  accountType: AccountType;
  normalBalance: NormalBalance;
  totalDebit: number;
  totalCredit: number;
  /** Signed: totalDebit - totalCredit, in dollars. */
  balance: number;
}

/** Trial Balance = the account rows plus the grand debit/credit totals. */
export interface TrialBalanceReport {
  range: DateRange;
  rows: AccountBalanceRow[];
  totalDebit: number;
  totalCredit: number;
  /** totalDebit - totalCredit; zero when the books balance. */
  difference: number;
  balanced: boolean;
}

/** One presented line on a financial statement (account + its statement amount). */
export interface ReportLine {
  accountId: string;
  accountNumber: string | null;
  name: string;
  /** Statement-positive amount in dollars (income/expense/section natural sign). */
  amount: number;
}

/** A named group of report lines with its own subtotal (e.g. all income accounts). */
export interface ReportSection {
  title: string;
  lines: ReportLine[];
  subtotal: number;
}

/**
 * Profit & Loss for a window: income (credit-natural, shown positive) minus
 * expense (debit-natural, shown positive) = net income.
 */
export interface ProfitAndLossReport {
  range: DateRange;
  income: ReportSection;
  expense: ReportSection;
  totalIncome: number;
  totalExpense: number;
  /** totalIncome - totalExpense, in dollars. */
  netIncome: number;
}

/**
 * Balance Sheet as of the window end: assets = liabilities + equity, where equity
 * includes period net income rolled in as a computed "Net income" line (it is a
 * presentation figure, not a posted entry). `balanced` is true when
 * assets == liabilities + equity (+ rolled-in net income) to the penny.
 */
export interface BalanceSheetReport {
  range: DateRange;
  assets: ReportSection;
  liabilities: ReportSection;
  equity: ReportSection;
  totalAssets: number;
  totalLiabilities: number;
  /** Equity incl. the rolled-in net-income line. */
  totalEquity: number;
  /** Net income for the period, folded into equity as a computed line. */
  netIncome: number;
  /** totalAssets - (totalLiabilities + totalEquity); zero when balanced. */
  difference: number;
  balanced: boolean;
}

/** Aging buckets shared by AR and AP aging, ordered oldest-last. */
export type AgingBucket = 'current' | '1-30' | '31-60' | '61-90' | '90+';

export const AGING_BUCKETS: AgingBucket[] = ['current', '1-30', '31-60', '61-90', '90+'];

export const AGING_BUCKET_LABELS: Record<AgingBucket, string> = {
  current: 'Current',
  '1-30': '1–30 days',
  '31-60': '31–60 days',
  '61-90': '61–90 days',
  '90+': '90+ days',
};

/** One open document (invoice or bill) on an aging report, point-in-time as of today. */
export interface AgingRow {
  /** Source document id (invoice_id for AR, bill_id for AP). */
  documentId: string;
  /** Document number (invoice_number / bill_number). */
  documentNumber: string | null;
  /** Party id (customer_id for AR, vendor_id for AP). */
  partyId: string;
  partyName: string;
  documentDate: string;
  dueDate: string | null;
  total: number;
  amountPaid: number;
  balanceDue: number;
  daysOverdue: number;
  bucket: AgingBucket;
}

/** Per-bucket balance-due totals plus the grand total for an aging report. */
export interface AgingSummary {
  byBucket: Record<AgingBucket, number>;
  total: number;
}

/** A full aging report: the open-document rows plus the bucket summary. */
export interface AgingReport {
  rows: AgingRow[];
  summary: AgingSummary;
}

// ── Sales-tax reporting & tax calendar (C1) ───────────────────────────────────
//
// REPORTING ONLY — no e-filing, no money movement, no payroll. Every figure ties
// back to the POSTED ledger: "tax collected" is the net CREDIT to the 2200 "Sales
// Tax Payable" account (credit − debit, in cents) on posted journal entries within
// a date range, attributed to a tax agency/jurisdiction through the source invoice's
// tax code. A 2200 credit that cannot be tied to a source invoice/agency is NOT
// guessed — it is surfaced in an explicit "Unattributed / review" bucket with a
// reconciliation delta (the C1 stop-condition: surface, do not guess).
//
// LEGAL (G9): seeded rates/cadences are REPRESENTATIVE only. Every C1 screen and
// export must show: "Not certified tax software. Always verify with a CPA/EA.
// Representative rates only." (enforced in the UI/export lane).

/** A tax agency / jurisdiction (accounting.tax_agencies) the report attributes to. */
export type TaxFilingFrequency = 'monthly' | 'quarterly' | 'annual';

export const TAX_FILING_FREQUENCY_LABELS: Record<TaxFilingFrequency, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annual: 'Annual',
};

/**
 * One tax agency row (accounting.tax_agencies), with its composing tax_rates summed
 * to a combined decimal `rate`. The report groups collected tax by agency; the rate
 * is used both for display and to PRO-RATE a multi-agency tax code's collected cents
 * across its agencies. `liabilityAccountId` is the GL liability account the agency's
 * tax accrues to (typically 2200).
 */
export interface TaxAgency {
  id: string;
  name: string;
  liabilityAccountId: string | null;
  filingFrequency: TaxFilingFrequency | null;
  /** Combined decimal rate of this agency's active rates (e.g. 0.0725). */
  rate: number;
  createdAt: string;
}

/**
 * One line of the sales-tax liability report: tax COLLECTED, attributed to a single
 * agency/jurisdiction. All money fields are dollars at the boundary (summed in cents
 * upstream). `taxableSales`/`nonTaxableSales` are the sales of the posted invoices
 * that drove this agency's tax (a multi-agency invoice contributes its full taxable
 * base to each of its agencies, so per-agency bases are NOT additive across agencies —
 * the report's headline taxable/non-taxable totals are de-duplicated per invoice).
 */
export interface SalesTaxAgencyLine {
  /** Agency id, or a sentinel for the unattributed bucket (see UNATTRIBUTED_AGENCY_ID). */
  agencyId: string;
  agencyName: string;
  /** Combined decimal rate of the agency (0 for the unattributed bucket). */
  rate: number;
  filingFrequency: TaxFilingFrequency | null;
  /** Tax collected = net credit to the liability account, attributed here (dollars). */
  taxCollected: number;
  /** Taxable sales base that drove this agency's tax, in dollars. */
  taxableSales: number;
  /** Non-taxable sales of the same invoices, in dollars. */
  nonTaxableSales: number;
  /**
   * True for the synthetic "Unattributed / review" bucket: collected tax that posted
   * to the liability account but could not be tied to a source invoice/agency (manual
   * JEs, voided/edited sources, codes with no agency). Surfaced, never guessed.
   */
  isUnattributed?: boolean;
}

/**
 * The CDTFA-style sales-tax liability report for a date range. `agencies` holds one
 * line per attributed agency plus (when nonzero) the unattributed bucket. The headline
 * `taxableSales`/`nonTaxableSales`/`grossSales` are de-duplicated per posted invoice
 * (each invoice counted once), so taxable + non-taxable = gross. `taxCollected` is the
 * total net credit to the liability account in range and MUST equal
 * Σ(agency.taxCollected) including the unattributed bucket — `reconciled` asserts that.
 */
export interface SalesTaxLiabilityReport {
  range: DateRange;
  /** GL account the report summed (the resolved 2200 "Sales Tax Payable"), or null. */
  liabilityAccountId: string | null;
  liabilityAccountNumber: string | null;
  agencies: SalesTaxAgencyLine[];
  /** Total tax collected (net credit to the liability account) in range, dollars. */
  taxCollected: number;
  /** Taxable sales across all posted invoices in range (de-duplicated), dollars. */
  taxableSales: number;
  /** Non-taxable sales across the same invoices, dollars. */
  nonTaxableSales: number;
  /** taxableSales + nonTaxableSales, dollars. */
  grossSales: number;
  /** Collected tax NOT tied to an agency (the unattributed bucket total), dollars. */
  unattributedTax: number;
  /**
   * taxCollected − Σ(agency.taxCollected); zero when every collected cent is accounted
   * for (the unattributed bucket absorbs the remainder, so this is normally 0). A
   * nonzero value is a hard reconciliation failure the UI must surface.
   */
  reconciliationDifference: number;
  reconciled: boolean;
}

/** Sentinel agency id used for the report's "Unattributed / review" bucket. */
export const UNATTRIBUTED_AGENCY_ID = '__unattributed__';

/**
 * One agency's filing-calendar configuration rule, parsed from the
 * `tax_filing_calendar` row in accounting.settings (seeded by migration 020). The
 * `agency` is matched to a tax_agencies row by name in the report layer; absent a
 * config rule the calendar falls back to the agency's own filing_frequency.
 */
export interface TaxFilingRule {
  /** Agency name this rule applies to (matches accounting.tax_agencies.name). */
  agency: string;
  frequency: TaxFilingFrequency;
  /** How periods align. Only 'calendar' is supported today. */
  periodBasis: 'calendar';
  /** Day-of-month the return is due (clamped to month length in the math). */
  dueDay: number;
  /** Months after period-end in which the due day falls (CDTFA quarterly = 1). */
  dueMonthOffset: number;
  notes: string | null;
}

/**
 * One computed upcoming/recent filing deadline for the read-only tax-calendar
 * dashboard. Derived purely from a TaxFilingRule (or an agency's frequency fallback)
 * relative to an "as of" date — NO notification is delivered (reporting only).
 */
export interface TaxCalendarEntry {
  agencyId: string | null;
  agencyName: string;
  frequency: TaxFilingFrequency;
  /** Human label for the filing period, e.g. "Q2 2026 (Apr–Jun)". */
  periodLabel: string;
  /** Inclusive period start `YYYY-MM-DD`. */
  periodStart: string;
  /** Inclusive period end `YYYY-MM-DD`. */
  periodEnd: string;
  /** The filing/payment due date `YYYY-MM-DD`. */
  dueDate: string;
  /** Whole days from "as of" to the due date (negative = past due). */
  daysUntilDue: number;
  /** True when dueDate is strictly before "as of" (overdue). */
  overdue: boolean;
  /** Notes from the config rule (representative-cadence caveat), if any. */
  notes: string | null;
}

/** The tax-calendar dashboard payload: computed deadlines, soonest due first. */
export interface TaxCalendar {
  /** The "as of" date the deadlines were computed against (`YYYY-MM-DD`). */
  asOf: string;
  entries: TaxCalendarEntry[];
}

// ── Banking (A4): bank accounts, feeds, rules & reconciliation ────────────────
//
// SIGN CONVENTION (matches accounting.bank_transactions.amount): a transaction's
// `amount` is signed from the bank's perspective —
//   positive  => money INTO the bank (deposit / credit / refund received),
//   negative  => money OUT of the bank (withdrawal / payment / fee).
// The posting layer (buildBankTransactionJournalLines) turns the sign into the
// Dr/Cr direction against the bank's GL account; the magnitude is what posts.

export type BankAccountType = 'checking' | 'savings' | 'credit_card';

export const BANK_ACCOUNT_TYPE_LABELS: Record<BankAccountType, string> = {
  checking: 'Checking',
  savings: 'Savings',
  credit_card: 'Credit card',
};

/**
 * A bank/credit-card account that wraps a GL account (accounting.bank_accounts).
 * `accountId` is the chart-of-accounts cash/credit-card account every imported
 * transaction posts against. `currentBalance` is a running feed balance (display
 * only — the authoritative balance is the GL account's posted total).
 */
export interface BankAccount {
  id: string;
  name: string;
  /** GL (chart-of-accounts) account this bank account posts against. */
  accountId: string | null;
  accountType: BankAccountType | null;
  institution: string | null;
  /** Masked account number (e.g. "••1234"). Encryption is a Phase E concern. */
  mask: string | null;
  currentBalance: number;
  lastReconciledAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /** Hydrated for display from the linked GL account. */
  glAccountName?: string;
  glAccountNumber?: string | null;
}

export interface NewBankAccountInput {
  name: string;
  /** GL cash/credit-card account to link (required to post categorizations). */
  accountId: string;
  accountType?: BankAccountType | null;
  institution?: string | null;
  mask?: string | null;
  /** Opening feed balance (display only); defaults to 0. */
  currentBalance?: number;
}

export interface UpdateBankAccountInput {
  name?: string;
  accountId?: string | null;
  accountType?: BankAccountType | null;
  institution?: string | null;
  mask?: string | null;
  currentBalance?: number;
  isActive?: boolean;
}

/** A feed row's review state. */
export type BankTransactionStatus = 'unreviewed' | 'categorized' | 'matched' | 'excluded';

export const BANK_TXN_STATUS_LABELS: Record<BankTransactionStatus, string> = {
  unreviewed: 'Unreviewed',
  categorized: 'Categorized',
  matched: 'Matched',
  excluded: 'Excluded',
};

/**
 * One imported bank-feed transaction (accounting.bank_transactions). Deduped on
 * (bankAccountId, externalId). `amount` follows the bank sign convention above.
 * When accepted/categorized, the service posts a balanced JE and stamps
 * `matchedJournalEntryId` + `categoryAccountId`, flipping status to `matched`.
 */
export interface BankTransaction {
  id: string;
  bankAccountId: string;
  txnDate: string;
  /** Signed amount (positive = deposit, negative = withdrawal). */
  amount: number;
  description: string | null;
  merchant: string | null;
  /** Stable id from the source file (FITID/refnum or a synthesized hash) for dedup. */
  externalId: string | null;
  status: BankTransactionStatus;
  /** GL account the other side of the entry hits (expense/income/transfer). */
  categoryAccountId: string | null;
  matchedJournalEntryId: string | null;
  matchedPaymentId: string | null;
  matchedBillId: string | null;
  /** Statement reconciliation this txn cleared into (migration 012). */
  reconciliationId: string | null;
  /** When the txn was cleared/reconciled (migration 012). */
  clearedAt: string | null;
  /** Which bank_rule auto-categorized this txn, for audit/explain (migration 012). */
  appliedRuleId: string | null;
  importedAt: string;
  createdAt: string;
  /** Hydrated for display from the category GL account. */
  categoryAccountName?: string;
}

/**
 * A parsed-but-not-yet-persisted feed row (the output of bankImportParsers). The
 * import service maps this to an insert, deriving `externalId` when the source
 * file did not provide one so dedup still works.
 */
export interface ParsedBankTransaction {
  txnDate: string;
  amount: number;
  description: string | null;
  merchant: string | null;
  externalId: string | null;
}

/** Field a bank rule matches against. */
export type BankRuleField = 'description' | 'merchant' | 'amount';
/** Comparison a bank rule uses. `gt`/`lt` compare the txn amount numerically. */
export type BankRuleOp = 'contains' | 'equals' | 'regex' | 'gt' | 'lt';

export const BANK_RULE_FIELD_LABELS: Record<BankRuleField, string> = {
  description: 'Description',
  merchant: 'Merchant',
  amount: 'Amount',
};

export const BANK_RULE_OP_LABELS: Record<BankRuleOp, string> = {
  contains: 'contains',
  equals: 'equals',
  regex: 'matches regex',
  gt: 'greater than',
  lt: 'less than',
};

/**
 * An auto-categorization rule (accounting.bank_rules). Higher `priority` wins;
 * the first matching active rule (by priority desc, then created order) sets the
 * category account and/or vendor on a transaction. A null `bankAccountId` means
 * the rule applies across every bank account.
 */
export interface BankRule {
  id: string;
  /** Scope to one bank account, or null for "all accounts". */
  bankAccountId: string | null;
  matchField: BankRuleField | null;
  matchOp: BankRuleOp | null;
  matchValue: string | null;
  /** GL account a match assigns as the transaction's category. */
  setAccountId: string | null;
  /** Vendor a match associates (informational; AP linkage is a later phase). */
  setVendorId: string | null;
  priority: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NewBankRuleInput {
  bankAccountId?: string | null;
  matchField: BankRuleField;
  matchOp: BankRuleOp;
  matchValue: string;
  setAccountId?: string | null;
  setVendorId?: string | null;
  priority?: number;
}

export interface UpdateBankRuleInput {
  bankAccountId?: string | null;
  matchField?: BankRuleField;
  matchOp?: BankRuleOp;
  matchValue?: string;
  setAccountId?: string | null;
  setVendorId?: string | null;
  priority?: number;
  isActive?: boolean;
}

/** The outcome of applying the rule set to a single transaction. */
export interface RuleMatch {
  /** GL account the matching rule assigns (null if the rule sets only a vendor). */
  setAccountId: string | null;
  setVendorId: string | null;
  /** The id of the rule that matched (stamped onto the txn as applied_rule_id). */
  ruleId: string;
}

export type ReconciliationStatus = 'in_progress' | 'completed';

/**
 * A statement reconciliation header (accounting.reconciliations). Transactions are
 * cleared against it (bank_transactions.reconciliation_id); it is `completed` when
 * the cleared total reconciles the statement's beginning→ending balance.
 */
export interface Reconciliation {
  id: string;
  bankAccountId: string;
  statementDate: string;
  statementEndingBalance: number | null;
  beginningBalance: number | null;
  status: ReconciliationStatus;
  reconciledBy: string | null;
  reconciledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewReconciliationInput {
  bankAccountId: string;
  statementDate: string;
  statementEndingBalance?: number | null;
  beginningBalance?: number | null;
}

/**
 * Live reconciliation math for the screen. All figures in dollars; the difference
 * is computed in integer cents so it is exactly zero when the statement reconciles.
 *   clearedBalance = beginningBalance + Σ(cleared txn amounts)
 *   difference     = statementEndingBalance − clearedBalance
 */
export interface ReconciliationSummary {
  beginningBalance: number;
  statementEndingBalance: number;
  /** Number of transactions currently marked cleared against this statement. */
  clearedCount: number;
  /** Signed sum of cleared transaction amounts (deposits positive). */
  clearedAmount: number;
  /** beginningBalance + clearedAmount. */
  clearedBalance: number;
  /** statementEndingBalance − clearedBalance; zero when reconciled. */
  difference: number;
  /** True when difference is exactly zero (to the penny). */
  reconciled: boolean;
}

// ── Job costing (B1) ─────────────────────────────────────────────────────────
//
// A read-only profitability row per job, sourced from the existing
// `accounting.v_job_costing` view (no new DB object). The view already reuses
// operational data: labor minutes from public.shifts, material_cost from
// public.job_inventory × public.inventory.price, revenue from non-void
// accounting.invoices, and the org labor_rate from public.organization_settings.
//
// CAVEATS surfaced for the UI to caption (per the DB lane's notes):
//  - `laborCost` is a reporting APPROXIMATION (worked minutes ÷ 60 × org
//    labor_rate). Authoritative job costing lives in src/lib/calculatePartQuote.ts.
//  - `revenue` sums lines of every non-void invoice (drafts included), so it can
//    exceed posted/sent revenue for jobs with unsent drafts.
// Money fields are plain dollars (the view columns are numeric); marginPct is
// derived in integer cents (see jobCosting.ts) so it never drifts on floats.
export interface JobCostingRow {
  jobId: string;
  /** Human job code (public.jobs.job_code); may be null on legacy rows. */
  jobCode: string | null;
  /** Job name/title (public.jobs.name). */
  name: string;
  /** Operational job status (public.jobs.status), passed through verbatim. */
  status: string | null;
  /** Total worked minutes across the job's clocked-out shifts. */
  laborMinutes: number;
  /** Approximate labor cost in dollars (minutes ÷ 60 × labor_rate). Estimate. */
  laborCost: number;
  /** Material cost in dollars (Σ consumed qty × inventory price). */
  materialCost: number;
  /** Revenue in dollars from the job's non-void invoice lines. */
  revenue: number;
  /** revenue − materialCost − laborCost, in dollars (DB-computed). */
  margin: number;
}

/** Sortable columns for the job-costing dashboard. */
export type JobCostingSortKey =
  | 'name'
  | 'status'
  | 'revenue'
  | 'materialCost'
  | 'laborCost'
  | 'margin'
  | 'marginPct';

// ── Reporting dimensions (B2) ─────────────────────────────────────────────────
//
// A dimension is a small reporting tag (class / location / department) that can be
// stamped onto journal/invoice/bill lines so postings can be sliced for reporting.
// They move NO money — they are pure tags (accounting.dimensions). The DB trigger
// assert_line_dimension_types enforces that a class_id points at a 'class' row, etc.

export type DimensionType = 'class' | 'location' | 'department';

export const DIMENSION_TYPES: DimensionType[] = ['class', 'location', 'department'];

export const DIMENSION_TYPE_LABELS: Record<DimensionType, string> = {
  class: 'Class',
  location: 'Location',
  department: 'Department',
};

/** Plural labels for section headers / pickers. */
export const DIMENSION_TYPE_LABELS_PLURAL: Record<DimensionType, string> = {
  class: 'Classes',
  location: 'Locations',
  department: 'Departments',
};

export interface Dimension {
  id: string;
  dimType: DimensionType;
  name: string;
  code: string | null;
  /** Optional self-hierarchy (a sub-dimension under a parent of the same type). */
  parentId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NewDimensionInput {
  dimType: DimensionType;
  name: string;
  code?: string | null;
  parentId?: string | null;
}

export interface UpdateDimensionInput {
  name?: string;
  code?: string | null;
  parentId?: string | null;
  isActive?: boolean;
}

/**
 * The three dimension ids a document/JE line can carry. Reused by the picker and the
 * recurring payload line shapes so a single object threads class/location/department.
 */
export interface LineDimensions {
  classId?: string | null;
  locationId?: string | null;
  departmentId?: string | null;
}

// ── Recurring transaction templates (B2) ─────────────────────────────────────
//
// A recurring template stores INTENT only (a schedule + a payload describing the
// next document/JE to materialize). It posts NO money itself — the app's
// "generate due" action builds the next invoice/bill/journal and routes every
// money movement through accounting.post_journal_entry (a balanced entry). The
// payload's numeric amounts become numeric(14,2) journal_lines via that RPC.

export type RecurringKind = 'invoice' | 'bill' | 'journal';

export const RECURRING_KINDS: RecurringKind[] = ['invoice', 'bill', 'journal'];

export const RECURRING_KIND_LABELS: Record<RecurringKind, string> = {
  invoice: 'Invoice',
  bill: 'Bill',
  journal: 'Journal entry',
};

export type RecurringFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export const RECURRING_FREQUENCIES: RecurringFrequency[] = [
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'yearly',
];

export const RECURRING_FREQUENCY_LABELS: Record<RecurringFrequency, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
};

/**
 * One line of a recurring INVOICE payload. Mirrors NewInvoiceLineInput so the
 * generator can hand it straight to the invoices service (which posts the revenue
 * JE). Amounts are plain dollars (validated in TS, cents-rounded by the posting layer).
 */
export interface RecurringInvoiceLine extends LineDimensions {
  itemId?: string | null;
  description?: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal?: number;
  discount?: number;
  taxCodeId?: string | null;
  taxable?: boolean;
  incomeAccountId?: string | null;
}

/** The payload for a `kind = 'invoice'` template. */
export interface RecurringInvoicePayload {
  customerId: string;
  jobId?: string | null;
  terms?: string | null;
  /** Days from the generation date to the invoice's due date (optional). */
  dueInDays?: number | null;
  taxCodeId?: string | null;
  memo?: string | null;
  notes?: string | null;
  lines: RecurringInvoiceLine[];
}

/** One line of a recurring BILL payload. Mirrors NewBillLineInput. */
export interface RecurringBillLine extends LineDimensions {
  accountId?: string | null;
  itemId?: string | null;
  description?: string | null;
  quantity: number;
  unitCost: number;
  lineTotal?: number;
  jobId?: string | null;
}

/** The payload for a `kind = 'bill'` template. */
export interface RecurringBillPayload {
  vendorId: string;
  jobId?: string | null;
  terms?: string | null;
  dueInDays?: number | null;
  /** Header sales/use tax in dollars (bills tax at the header). */
  taxTotal?: number;
  memo?: string | null;
  lines: RecurringBillLine[];
}

/**
 * One line of a recurring JOURNAL payload. Mirrors NewJournalLineInput — an explicit
 * Dr/Cr per account. The generator posts these directly via post_journal_entry, so
 * they must net to zero (the builder asserts balance before posting).
 */
export interface RecurringJournalLine extends LineDimensions {
  accountId: string;
  debit: number;
  credit: number;
  lineMemo?: string | null;
  jobId?: string | null;
  customerId?: string | null;
  vendorId?: string | null;
}

/** The payload for a `kind = 'journal'` template. */
export interface RecurringJournalPayload {
  memo?: string | null;
  lines: RecurringJournalLine[];
}

/** Discriminated union of the three payload shapes (narrow on the template's kind). */
export type RecurringPayload =
  | RecurringInvoicePayload
  | RecurringBillPayload
  | RecurringJournalPayload;

export interface RecurringTemplate {
  id: string;
  name: string;
  kind: RecurringKind;
  // schedule
  frequency: RecurringFrequency;
  /** How many `frequency` units between runs (e.g. 2 = every 2 months). >= 1. */
  intervalCount: number;
  startDate: string;
  /** Inclusive end; null = open-ended. */
  endDate: string | null;
  /** The next date this template is due to generate (the "due" cursor). */
  nextRunDate: string;
  /** Optional 1–31 anchor for monthly/quarterly/yearly schedules. */
  dayOfMonth: number | null;
  /** When it last generated (null until the first generation). */
  lastRunDate: string | null;
  /** The id of the last document/JE generated (kind-agnostic; no FK). */
  lastGeneratedId: string | null;
  occurrencesGenerated: number;
  /** The document/JE blueprint. Shape depends on `kind` (RecurringPayload). */
  payload: RecurringPayload;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NewRecurringTemplateInput {
  name: string;
  kind: RecurringKind;
  frequency: RecurringFrequency;
  intervalCount?: number;
  startDate: string;
  endDate?: string | null;
  /** Optional explicit first run; defaults to startDate. */
  nextRunDate?: string;
  dayOfMonth?: number | null;
  payload: RecurringPayload;
  active?: boolean;
}

export interface UpdateRecurringTemplateInput {
  name?: string;
  frequency?: RecurringFrequency;
  intervalCount?: number;
  startDate?: string;
  endDate?: string | null;
  nextRunDate?: string;
  dayOfMonth?: number | null;
  payload?: RecurringPayload;
  active?: boolean;
}

/** The outcome of a single "generate due" run against one template. */
export interface GenerateResult {
  templateId: string;
  /** The id of the document (invoice/bill) or journal entry that was created. */
  generatedId: string | null;
  /** For invoice/bill kinds, the linked posted JE id; for journal kind === generatedId. */
  journalEntryId: string | null;
  /** The schedule's new next_run_date after advancing (null when the template ended). */
  nextRunDate: string | null;
  /** True when the template hit its end_date and was deactivated. */
  ended: boolean;
  error?: string;
}

export type SortDirection = 'asc' | 'desc';

// ── Inventory valuation (FIFO) → COGS (B3) ────────────────────────────────────
//
// On receiving an inventory item via a posted bill, a FIFO cost LAYER is created
// (accounting.inventory_layers) from the bill line's unit_cost — no JE (the 1300
// debit was booked when the bill posted). On a job consuming stock (the existing
// public job-consumption moment, read READ-ONLY), the FIFO-consumed cost is relieved
// from inventory to COGS via ONE balanced JE (Dr 5000 COGS / Cr 1300 Inventory Asset)
// and an immutable consumption event is recorded (accounting.inventory_cogs_events).
//
// The DB RPCs are the single source of truth for the money math:
//   accounting.receive_inventory_layer(uuid) -> uuid        (the new/existing layer id)
//   accounting.consume_job_cogs(uuid)        -> uuid | null  (posted JE id, or null when
//                                                            nothing is costable)
//   accounting.v_inventory_valuation  (per stock-item valuation read-model)
//
// Money fields below are plain dollars (the DB columns are numeric(14,2)/(14,4));
// the pure consumeFifo helper (inventoryFifo.ts) and buildCogsJournalLines (posting.ts)
// do their depletion/JE math in integer cents so no float drift accumulates (G6).

/**
 * One row of accounting.v_inventory_valuation — per stock item (crosswalked to
 * public.inventory). `assetValue` ties to GL 1300; `avgUnitCost` is the weighted
 * average of OPEN layers; `cogsTotal` is lifetime COGS booked from consumption events.
 */
export interface InventoryValuationRow {
  /** public.inventory id this valuation row is for (the FIFO match key). */
  sourceInventoryId: string;
  /** public.inventory.name (read-only join); may be empty for an orphaned crosswalk. */
  inventoryName: string;
  /** Representative accounting.items id from an open layer (reporting only); nullable. */
  itemId: string | null;
  /** Units currently on hand = Σ qty_remaining across the item's open layers. */
  qtyOnHand: number;
  /** FIFO asset value in dollars = Σ(qty_remaining × unit_cost). Ties to GL 1300. */
  assetValue: number;
  /** Weighted-average unit cost of open layers (assetValue ÷ qtyOnHand), 0 when none. */
  avgUnitCost: number;
  /** Lifetime units received = Σ qty_received across all layers. */
  qtyReceivedTotal: number;
  /** Lifetime units consumed = Σ qty across consumption events. */
  qtyConsumedTotal: number;
  /** Lifetime COGS booked in dollars = Σ cost across consumption events. */
  cogsTotal: number;
}

/**
 * One immutable accounting.inventory_cogs_events row — a single consumed stock item
 * on a job, tied to the balanced COGS journal entry it produced. (A job that consumes
 * several stock items yields several events, all sharing the same journalEntryId.)
 */
export interface InventoryCogsEvent {
  id: string;
  /** Representative accounting.items id for the consumed line; nullable. */
  itemId: string | null;
  /** The balanced COGS journal entry this consumption produced (immutable proof). */
  journalEntryId: string;
  /** Units consumed (FIFO-costed) for this line. */
  qty: number;
  /** Extended COGS in dollars (cents-derived) for this line. */
  cost: number;
  /** When the underlying stock consumption happened (public.jobs.consumed_at). */
  consumedAt: string;
  /** The consuming job (public.jobs.id); nullable on a set-null delete. */
  jobId: string | null;
  /** The consumed stock item (public.inventory.id); nullable on a set-null delete. */
  sourceInventoryId: string | null;
  createdAt: string;
}

/**
 * A job that has consumed stock (public.jobs.consumed_at IS NOT NULL) — the work list
 * for COGS posting. `costed` is true once a COGS event exists for the job (consume is
 * a no-op then). Read-only projection of public.jobs joined against the COGS events.
 */
export interface ConsumableJob {
  jobId: string;
  /** public.jobs.job_code (human code); may be null on legacy rows. */
  jobCode: string | null;
  /** public.jobs.name. */
  name: string;
  /** Operational job status (public.jobs.status), passed through. */
  status: string | null;
  /** When the job's stock was consumed (public.jobs.consumed_at). */
  consumedAt: string;
  /** True once COGS has been posted for this job (an event exists). */
  costed: boolean;
  /** The posted COGS journal entry id, when costed; null otherwise. */
  journalEntryId: string | null;
}

/**
 * Result of posting a job's FIFO COGS (accounting.consume_job_cogs). `journalEntryId`
 * is the posted entry, or null when nothing was costable (no open layers / legacy stock
 * received outside a bill) — in which case `costed` is false and `uncosted` is true so
 * the UI can surface the job as needing an opening cost layer. `alreadyPosted` flags an
 * idempotent re-call (the prior entry is returned unchanged).
 */
export interface ConsumeJobCogsResult {
  jobId: string;
  /** Posted COGS JE id (Dr 5000 / Cr 1300), or null when nothing was costable. */
  journalEntryId: string | null;
  /** True when a COGS entry was posted (or already existed) for this job. */
  costed: boolean;
  /** True when no cost could be relieved (uncosted shortfall) — UI should flag it. */
  uncosted: boolean;
  error?: string;
}

/**
 * Result of seeding a FIFO cost layer from a posted bill line
 * (accounting.receive_inventory_layer). Idempotent: re-receiving a bill line returns
 * the existing layer id. No JE is posted on receive (the 1300 debit was at bill time).
 */
export interface ReceiveLayerResult {
  /** The created (or pre-existing) accounting.inventory_layers id. */
  layerId: string | null;
  error?: string;
}

/**
 * One open FIFO cost layer to deplete, as consumed by the pure consumeFifo helper.
 * Layers are presented oldest-received-first; `unitCost`/`qtyRemaining` are plain
 * dollars/units (the helper converts to integer cents internally).
 */
export interface FifoLayerInput {
  /** Stable layer id (echoed back in the depletion result). */
  id: string;
  /** Units still available on this layer. */
  qtyRemaining: number;
  /** Cost per unit for this layer (dollars). */
  unitCost: number;
}

/** How much was drawn from one layer by a FIFO consumption. */
export interface FifoDraw {
  layerId: string;
  /** Units taken from this layer. */
  qtyTaken: number;
  /** Extended cost taken from this layer, in integer cents. */
  costCents: number;
}

/**
 * Result of FIFO-consuming a requested quantity across ordered layers (pure). All cost
 * figures are integer cents so the caller can sum them exactly. `qtyShort` > 0 means the
 * open layers could not cover the request (an uncosted shortfall — no phantom cost).
 */
export interface FifoConsumeResult {
  /** Units actually costed from layers (= requested − qtyShort). */
  qtyCosted: number;
  /** Units that could NOT be costed (no open layer covered them). */
  qtyShort: number;
  /** Total extended cost of the costed quantity, in integer cents. */
  costCents: number;
  /** Per-layer draws (only layers that contributed). */
  draws: FifoDraw[];
}

// ── Budgeting & forecasting (D2) ──────────────────────────────────────────────
//
// A BUDGET is a named plan for a fiscal year (accounting.budgets). Its cells live in
// accounting.budget_lines — one row per (budget, account, calendar month 1-12) holding
// the planned `amount`. Budgets move NO money: they are planning artifacts, so nothing
// in this domain posts a journal entry (per invariant G3 the post-JE path is vacuous).
//
// The Budget-vs-Actual report compares each budgeted cell against the ACTUAL posted
// activity for that account in that month. "Actual" is computed at read time from
// POSTED journal lines on the SAME basis as accounting.v_trial_balance (status =
// 'posted'), aggregated by account and by entry-date month — so a BvA actual ties to
// the trial balance for the same window to the penny.
//
// The cash-flow FORECAST is independent of budgets: it projects expected cash IN from
// open AR (customer invoices, by due_date) minus expected cash OUT for open AP (vendor
// bills, by due_date), bucketed into upcoming periods. It reads the same open-document
// rows the AR/AP aging views expose (balance_due / due_date).
//
// MONEY (G6): budget amounts and actuals are plain dollars at the type boundary (the DB
// column is numeric(14,2)); all variance/forecast aggregation runs in integer cents in
// budgetMath.ts so nothing drifts off floating-point error.

/** Lifecycle of a budget. draft = being built; active = the plan in use; archived = kept for history. */
export type BudgetStatus = 'draft' | 'active' | 'archived';

export const BUDGET_STATUSES: BudgetStatus[] = ['draft', 'active', 'archived'];

export const BUDGET_STATUS_LABELS: Record<BudgetStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  archived: 'Archived',
};

/** The twelve calendar months a budget line can target (1 = January … 12 = December). */
export const BUDGET_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

export type BudgetMonth = (typeof BUDGET_MONTHS)[number];

/** Short month labels keyed by 1-12, for the editor grid + report column headers. */
export const BUDGET_MONTH_LABELS: Record<number, string> = {
  1: 'Jan',
  2: 'Feb',
  3: 'Mar',
  4: 'Apr',
  5: 'May',
  6: 'Jun',
  7: 'Jul',
  8: 'Aug',
  9: 'Sep',
  10: 'Oct',
  11: 'Nov',
  12: 'Dec',
};

/** A named budget header (accounting.budgets). One plan per fiscal year + name. */
export interface Budget {
  id: string;
  name: string;
  /** The calendar year this plan covers (e.g. 2026). */
  fiscalYear: number;
  status: BudgetStatus;
  description: string | null;
  /** public.profiles id of whoever created it (audit metadata); nullable on set-null. */
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * One budget cell (accounting.budget_lines): the planned `amount` for one account in
 * one calendar month of the budget's fiscal year. The unique key is
 * (budgetId, accountId, periodMonth) — the upsert target for the editor grid.
 */
export interface BudgetLine {
  id: string;
  budgetId: string;
  accountId: string;
  /** Calendar month 1-12. */
  periodMonth: number;
  /** Planned amount for that account/month in dollars. */
  amount: number;
  createdAt: string;
  updatedAt: string;
  /** Account name hydrated from the joined accounts row (list/grid display only). */
  accountName?: string;
  /** Account number hydrated from the joined accounts row (sorting/display only). */
  accountNumber?: string | null;
}

/** Create a budget header. fiscalYear + name must be unique together (DB constraint). */
export interface NewBudgetInput {
  name: string;
  fiscalYear: number;
  status?: BudgetStatus;
  description?: string | null;
}

/** Patch a budget header (name / fiscal year / status / description). */
export interface UpdateBudgetInput {
  name?: string;
  fiscalYear?: number;
  status?: BudgetStatus;
  description?: string | null;
}

/**
 * A single planned cell as the editor grid hands it back to the service for saving.
 * `amount` is dollars; a zero (or cleared) cell is treated as "no line" and deleted on
 * save, so the table only ever persists the non-zero plan.
 */
export interface BudgetCellInput {
  accountId: string;
  periodMonth: number;
  amount: number;
}

/**
 * One account's full year of planned cells, as the editor grid renders a row. `monthly`
 * is a dense 12-slot array indexed 0..11 (Jan..Dec) of planned dollars (0 where blank);
 * `total` is the row's annual planned total in dollars.
 */
export interface BudgetGridRow {
  accountId: string;
  accountNumber: string | null;
  accountName: string;
  accountType: AccountType;
  /** 12 planned amounts in dollars, index 0 = January … 11 = December. */
  monthly: number[];
  /** Σ of the 12 monthly cells, in dollars. */
  total: number;
}

/**
 * The editor grid's data: every account that can be budgeted (the active chart) with its
 * 12 planned cells, plus the budget header. Accounts with no saved lines come back with
 * all-zero `monthly` so the full grid is editable. The UI lane renders this with
 * CurrencyInput; this lane only assembles it.
 */
export interface BudgetGrid {
  budget: Budget;
  rows: BudgetGridRow[];
  /** Per-month column totals across all accounts (index 0..11), in dollars. */
  monthlyTotals: number[];
  /** Grand total of every planned cell, in dollars. */
  grandTotal: number;
}

/**
 * One line of the Budget-vs-Actual report: an account's annual budgeted total vs. its
 * annual posted actual, with the variance. Per-month detail rides alongside so the UI
 * can expand a row. `budget`/`actual`/`variance` are dollars; variance = actual − budget
 * (a positive variance means more actual than planned).
 */
export interface BudgetVsActualRow {
  accountId: string;
  accountNumber: string | null;
  accountName: string;
  accountType: AccountType;
  /** Annual planned total in dollars. */
  budget: number;
  /** Annual posted actual (same basis as the trial balance) in dollars. */
  actual: number;
  /** actual − budget, in dollars. */
  variance: number;
  /** Planned amounts per month (index 0..11), dollars. */
  budgetMonthly: number[];
  /** Posted actuals per month (index 0..11), dollars. */
  actualMonthly: number[];
}

/**
 * The Budget-vs-Actual report: one row per account that has either a budget line or
 * posted actuals for the fiscal year, plus the grand totals. Actuals are computed from
 * POSTED journal lines (status = 'posted') aggregated by account/month — the SAME basis
 * as accounting.v_trial_balance — so the report ties to the trial balance for the year.
 */
export interface BudgetVsActualReport {
  budgetId: string;
  budgetName: string;
  fiscalYear: number;
  rows: BudgetVsActualRow[];
  totalBudget: number;
  totalActual: number;
  /** totalActual − totalBudget, in dollars. */
  totalVariance: number;
}

/**
 * One open receivable/payable feeding the cash-flow forecast: its expected settlement
 * `dueDate` and the still-owed `amount` (balance due, dollars). `direction` is whether
 * the cash flows IN (an AR invoice we expect to collect) or OUT (an AP bill we expect to
 * pay). Documents with no due date are treated as due immediately (current period).
 */
export interface CashFlowItem {
  documentId: string;
  documentNumber: string | null;
  partyName: string;
  /** Expected settlement date (the document due_date); null = treat as due now. */
  dueDate: string | null;
  /** Still-owed balance in dollars (always positive). */
  amount: number;
  direction: 'inflow' | 'outflow';
}

/**
 * One forecast period bucket: expected inflows (open AR coming due) minus outflows (open
 * AP coming due) in the window, plus the running cash balance after this period. All
 * figures are dollars. The bucket spans [periodStart, periodEnd] inclusive.
 */
export interface CashFlowPeriod {
  /** Human label for the bucket (e.g. "Jun 2026" or "Overdue"). */
  label: string;
  /** Inclusive ISO start of the bucket. */
  periodStart: string;
  /** Inclusive ISO end of the bucket. */
  periodEnd: string;
  /** Expected cash in (Σ open AR due in window) in dollars. */
  inflow: number;
  /** Expected cash out (Σ open AP due in window) in dollars. */
  outflow: number;
  /** inflow − outflow for the bucket, in dollars. */
  net: number;
  /** Projected cash balance at the END of this bucket (opening + Σ net so far), dollars. */
  runningBalance: number;
}

/**
 * The cash-flow forecast: the opening cash position projected forward across N monthly
 * buckets using open AR/AP due dates. `endingBalance` is the projected position after the
 * last bucket. This is a PROJECTION from currently-open documents only — it books no
 * entry and reads only posted/open balances.
 */
export interface CashFlowForecast {
  /** Cash position the projection starts from (dollars). */
  openingBalance: number;
  periods: CashFlowPeriod[];
  /** Σ of all expected inflows across the horizon (dollars). */
  totalInflow: number;
  /** Σ of all expected outflows across the horizon (dollars). */
  totalOutflow: number;
  /** Projected cash position after the final bucket (dollars). */
  endingBalance: number;
}

// ── Fixed assets & depreciation (D3) ──────────────────────────────────────────
//
// A FIXED ASSET (accounting.fixed_assets) is one capitalized asset — its acquisition
// `cost`, expected `salvageValue`, `usefulLifeMonths`, depreciation `method`, the date it
// was placed `inServiceDate`, and the three GL accounts its depreciation touches (the
// asset account it sits in, the accumulated-depreciation contra-asset it credits, and the
// depreciation-expense account it debits). A DEPRECIATION SCHEDULE ROW
// (accounting.depreciation_schedule) is one planned/posted period of that asset's
// depreciation: a `periodDate` (period-END), the `amount` to recognize, and — once
// posted — the balanced journal entry that booked it.
//
// The ONLY money movement here is depreciation, and it is a single textbook entry:
//     Dr  Depreciation Expense            = period amount
//     Cr  1510 Accumulated Depreciation   = period amount   (contra-asset, credit)
// Equal by construction (one `amount` on both sides) → always balanced (G3). The DB RPC
// accounting.run_depreciation_for_period(date) posts each DUE row through
// accounting.post_journal_entry (never bypassing the balance trigger; the D1 books-closed
// lock is honored automatically) and stamps the row posted. Straight-line is implemented
// now; `declining_balance` is an accepted method but currently schedules straight-line.
//
// MONEY (G6): cost/salvage/amount are plain dollars at the type boundary (DB columns are
// numeric(14,2)); the straight-line split runs in INTEGER CENTS in depreciation.ts (the
// rounding remainder lands in the FINAL period) so the lifetime total ties to the
// depreciable base (cost − salvage) to the penny — mirroring the DB generator exactly.

/** Depreciation method. straight_line is implemented; declining_balance is reserved (schedules straight-line for now). */
export type DepreciationMethod = 'straight_line' | 'declining_balance';

export const DEPRECIATION_METHODS: DepreciationMethod[] = ['straight_line', 'declining_balance'];

export const DEPRECIATION_METHOD_LABELS: Record<DepreciationMethod, string> = {
  straight_line: 'Straight-line',
  declining_balance: 'Declining balance',
};

/** Lifecycle of a fixed asset. active = depreciating; fully_depreciated = at salvage; disposed = retired. */
export type FixedAssetStatus = 'active' | 'fully_depreciated' | 'disposed';

export const FIXED_ASSET_STATUSES: FixedAssetStatus[] = ['active', 'fully_depreciated', 'disposed'];

export const FIXED_ASSET_STATUS_LABELS: Record<FixedAssetStatus, string> = {
  active: 'Active',
  fully_depreciated: 'Fully depreciated',
  disposed: 'Disposed',
};

/** One capitalized asset (accounting.fixed_assets). All money fields are dollars. */
export interface FixedAsset {
  id: string;
  name: string;
  /** GL account the asset's cost sits in (e.g. 1500 Fixed Assets). */
  assetAccountId: string;
  /** Contra-asset GL account depreciation credits (defaults to 1510 Accumulated Depreciation). */
  accumDeprAccountId: string;
  /** Expense GL account depreciation debits (defaults to 6000 from settings). */
  deprExpenseAccountId: string;
  /** Acquisition cost in dollars (>= 0). */
  cost: number;
  /** Estimated end-of-life salvage value in dollars (0 <= salvage <= cost). */
  salvageValue: number;
  /** Depreciable life in whole months (> 0). */
  usefulLifeMonths: number;
  method: DepreciationMethod;
  /** Date the asset was placed in service (ISO YYYY-MM-DD); schedule periods start from its month. */
  inServiceDate: string;
  status: FixedAssetStatus;
  /** public.profiles id of the creator (audit metadata); nullable on set-null. */
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * One planned/posted depreciation period (accounting.depreciation_schedule). `periodDate`
 * is the period-END date; `amount` is the dollars to recognize that period. Until posted,
 * `journalEntryId` is null and `posted` is false; the period runner posts it as a balanced
 * Dr depreciation-expense / Cr accumulated-depreciation entry and flips both. The unique
 * key (fixedAssetId, periodDate) is the idempotency anchor (no double-create/double-post).
 */
export interface DepreciationScheduleRow {
  id: string;
  fixedAssetId: string;
  /** Period-END date this depreciation belongs to (ISO YYYY-MM-DD). */
  periodDate: string;
  /** Planned depreciation for the period in dollars. */
  amount: number;
  /** The balanced JE that booked this period, once posted; null while planned. */
  journalEntryId: string | null;
  posted: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * One row of the asset register (accounting.v_fixed_asset_register): an asset with its
 * cost, accumulated depreciation (Σ POSTED schedule rows), and net book value (cost −
 * accumulated, floored at salvage). `remainingPlanned` is the Σ of still-unposted schedule
 * rows. All money fields are dollars; NBV is clamped to never fall below salvage.
 */
export interface FixedAssetRegisterRow {
  id: string;
  name: string;
  assetAccountId: string;
  accumDeprAccountId: string;
  deprExpenseAccountId: string;
  cost: number;
  salvageValue: number;
  usefulLifeMonths: number;
  method: DepreciationMethod;
  inServiceDate: string;
  status: FixedAssetStatus;
  /** Σ of POSTED schedule-row amounts in dollars (lifetime depreciation booked so far). */
  accumulatedDepreciation: number;
  /** Number of POSTED periods. */
  periodsPosted: number;
  /** cost − accumulatedDepreciation, floored at salvageValue, in dollars. */
  netBookValue: number;
  /** Σ of still-UNPOSTED schedule-row amounts in dollars (the remaining plan). */
  remainingPlanned: number;
  /** Number of still-UNPOSTED periods. */
  periodsRemaining: number;
}

/** Create a fixed asset. method defaults to straight_line; salvageValue defaults to 0. */
export interface NewFixedAssetInput {
  name: string;
  assetAccountId: string;
  /** Defaults to the 1510 account (settings.accumulated_depreciation) when omitted. */
  accumDeprAccountId?: string | null;
  /** Defaults to the 6000 account (settings.depreciation_expense) when omitted. */
  deprExpenseAccountId?: string | null;
  cost: number;
  salvageValue?: number;
  usefulLifeMonths: number;
  method?: DepreciationMethod;
  inServiceDate: string;
  status?: FixedAssetStatus;
}

/** Patch a fixed asset. Editing cost/salvage/life/in-service/method re-generates the unposted plan. */
export interface UpdateFixedAssetInput {
  name?: string;
  assetAccountId?: string;
  accumDeprAccountId?: string;
  deprExpenseAccountId?: string;
  cost?: number;
  salvageValue?: number;
  usefulLifeMonths?: number;
  method?: DepreciationMethod;
  inServiceDate?: string;
  status?: FixedAssetStatus;
}

/**
 * One planned depreciation period as the pure straight-line generator computes it (the JS
 * analog of accounting.generate_depreciation_schedule). `periodDate` is the period-END ISO
 * date; `amountCents` is the integer-cents depreciation for the period — periods 1..N-1
 * each get floor(base/N) and the FINAL period absorbs the remainder, so Σ amountCents =
 * cost − salvage (in cents) exactly. `amount` is the same figure in dollars (convenience).
 */
export interface DepreciationPeriod {
  /** 1-based period number (1 = first month of service). */
  periodNumber: number;
  /** Period-END date (ISO YYYY-MM-DD). */
  periodDate: string;
  /** Depreciation for the period in integer cents (sums to the depreciable base exactly). */
  amountCents: number;
  /** The same period depreciation in dollars. */
  amount: number;
}

/**
 * One JE actually posted by accounting.run_depreciation_for_period — the schedule row, its
 * asset, the posted journal entry, and the amount (dollars). Zero-amount rows are consumed
 * by the runner but produce no result row.
 */
export interface RunDepreciationResultRow {
  scheduleId: string;
  fixedAssetId: string;
  journalEntryId: string;
  amount: number;
}

/**
 * Result of running depreciation for a period. `postedRows` is one entry per JE posted (so
 * `postedCount` = postedRows.length and `totalAmount` is their dollar sum). On a DB
 * rejection (RLS denial, a closed-period row) nothing is posted and `error` carries the
 * message; the runner is oldest-first so a closed-period failure stops at a clean point.
 */
export interface RunDepreciationResult {
  /** The period through which due rows were posted (ISO YYYY-MM-DD). */
  periodDate: string;
  postedRows: RunDepreciationResultRow[];
  /** Number of JEs posted (= postedRows.length). */
  postedCount: number;
  /** Σ of posted amounts in dollars. */
  totalAmount: number;
  error?: string;
}

/** Result of (re)generating an asset's straight-line schedule (the count of unposted rows written). */
export interface GenerateScheduleResult {
  /** Number of (unposted) schedule rows written, or null on a DB error. */
  rowsWritten: number | null;
  error?: string;
}

// ── Custom fields on accounting entities (D4) ─────────────────────────────────
//
// A CUSTOM FIELD DEFINITION (accounting.custom_field_defs) is an admin-defined extra
// field attached to one accounting entity type: its machine `key`, human `label`, a
// `dataType` that picks the editor/coercion, an `options` choice list (only for
// 'select'), a `sortOrder` for render order, and an `active` toggle that hides the
// field without deleting it (so historical values keep their definition). A CUSTOM
// FIELD VALUE (accounting.custom_field_values) is one boxed-JSON value per
// (definition, entity) pair, keyed by (entityType, entityId).
//
// These are pure METADATA — they move NO money, so NOTHING in this domain posts a
// journal entry (per invariant G3 the post-JE path is vacuous, exactly like dimensions
// B2 and budgets D2). The values live in their OWN table keyed by (entityType,
// entityId); no existing invoice/bill/customer/vendor row or its INSERT is touched, so
// rendering/editing custom fields is purely additive and cannot break existing forms.
//
// VALUE BOXING: the DB column is jsonb and the TS `value` is `CustomFieldValueJson` —
// a string for text/date and for a chosen select option, a number for number, a boolean
// for boolean, or null/absent for "unset". The pure coerceCustomFieldValue helper
// (customFields.ts) is the single source of truth for turning a raw form input into the
// correctly-typed JSON box (and back), so the boxing never drifts between screens.

/** Which accounting entity a custom field extends. Matches the DB CHECK on entity_type. */
export type CustomFieldEntityType =
  | 'invoice'
  | 'bill'
  | 'customer'
  | 'vendor'
  | 'account'
  | 'journal_entry';

export const CUSTOM_FIELD_ENTITY_TYPES: CustomFieldEntityType[] = [
  'invoice',
  'bill',
  'customer',
  'vendor',
  'account',
  'journal_entry',
];

export const CUSTOM_FIELD_ENTITY_TYPE_LABELS: Record<CustomFieldEntityType, string> = {
  invoice: 'Invoice',
  bill: 'Bill',
  customer: 'Customer',
  vendor: 'Vendor',
  account: 'Account',
  journal_entry: 'Journal entry',
};

/** The editor/coercion a custom field uses. Matches the DB CHECK on data_type. */
export type CustomFieldDataType = 'text' | 'number' | 'date' | 'boolean' | 'select';

export const CUSTOM_FIELD_DATA_TYPES: CustomFieldDataType[] = [
  'text',
  'number',
  'date',
  'boolean',
  'select',
];

export const CUSTOM_FIELD_DATA_TYPE_LABELS: Record<CustomFieldDataType, string> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  boolean: 'Yes / no',
  select: 'Select (choice list)',
};

/**
 * One choice for a `dataType = 'select'` field — a stored `value` (what lands in the
 * value box) and a human `label`. Persisted as the jsonb `options` array on the def.
 */
export interface CustomFieldOption {
  value: string;
  label: string;
}

/**
 * The JSON-boxed value a custom field can hold. text/date/select store a string,
 * number stores a number, boolean stores a boolean; null = unset. (The DB column is
 * jsonb; coerceCustomFieldValue is the canonical box/unbox.)
 */
export type CustomFieldValueJson = string | number | boolean | null;

/** One admin-defined custom field (accounting.custom_field_defs). */
export interface CustomFieldDef {
  id: string;
  entityType: CustomFieldEntityType;
  /** Machine-readable snake_case identifier, unique within an entityType. */
  key: string;
  /** Human caption shown on the form. */
  label: string;
  dataType: CustomFieldDataType;
  /** Choice list for dataType='select'; empty array for every other type. */
  options: CustomFieldOption[];
  /** Optional helper caption rendered under the field. */
  helpText: string | null;
  /** Render order within an entityType (ascending). */
  sortOrder: number;
  /** When false the field is hidden on forms but its definition + values are kept. */
  active: boolean;
  /** public.profiles id of the creator (audit metadata); nullable on set-null. */
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * One stored value for a custom field on a specific entity row
 * (accounting.custom_field_values). The unique key (defId, entityId) is the upsert
 * target. `entityType` is denormalized for indexing and is asserted to equal the def's
 * entityType by a DB trigger.
 */
export interface CustomFieldValue {
  id: string;
  defId: string;
  entityType: CustomFieldEntityType;
  entityId: string;
  /** JSON-boxed value (see CustomFieldValueJson); null/absent means unset. */
  value: CustomFieldValueJson;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Create a custom field definition. sortOrder/active/options default in the service. */
export interface NewCustomFieldDefInput {
  entityType: CustomFieldEntityType;
  key: string;
  label: string;
  dataType: CustomFieldDataType;
  options?: CustomFieldOption[];
  helpText?: string | null;
  sortOrder?: number;
  active?: boolean;
}

/**
 * Patch a custom field definition. `entityType`, `key` and `dataType` are intentionally
 * NOT updatable — changing them would re-interpret or orphan existing values; the admin
 * deactivates and recreates instead (mirrors how dimensions forbid re-typing).
 */
export interface UpdateCustomFieldDefInput {
  label?: string;
  options?: CustomFieldOption[];
  helpText?: string | null;
  sortOrder?: number;
  active?: boolean;
}

/**
 * One (defId → value) pair the editor hands back for an entity. `value` is the already
 * raw/typed input; the service coerces+validates it against the def before boxing it as
 * jsonb. A null/empty value deletes the stored row ("unset"), so the table only ever
 * holds set values.
 */
export interface CustomFieldValueInput {
  defId: string;
  value: CustomFieldValueJson;
}

/**
 * A definition paired with its current value for one entity — the shape the UI lane
 * renders/edits as a single field. `value` is null when the entity has no stored value
 * for the def yet. Assembled by customFieldsService.listForEntity.
 */
export interface CustomFieldWithValue {
  def: CustomFieldDef;
  value: CustomFieldValueJson;
}

/** The outcome of validating a raw value against its definition (pure; see customFields.ts). */
export interface CustomFieldValidationResult {
  /** True when the (coerced) value is acceptable for the def. */
  valid: boolean;
  /** The canonically-boxed value to persist when valid (null = unset/delete). */
  coerced: CustomFieldValueJson;
  /** Human message when invalid (e.g. "Amount must be a number."); undefined when valid. */
  error?: string;
}

// ── TAX-SYNC: quarterly tax-table auto-refresh + drift alert (ADVISORY-ONLY) ──────────
// Domain types for the three accounting.tax_table_* tables (migration 022). This module is
// ADVISORY-ONLY: a quarterly Netlify scheduled function (server-env-gated) pulls fresh
// CDTFA/EDD tables, snapshots them, diffs them against the active accounting.tax_rates, and
// on mismatch records a DRIFT row (status 'open') — that row IS the admin alert and lives
// entirely within accounting.*. A stored rate is NEVER changed automatically; only the
// explicit, accounting_admin-only Apply path (apply_tax_table_drift RPC) mutates tax_rates.
// G9: "Not certified tax software. Always verify with a CPA/EA." is enforced on every
// TAX-SYNC screen by the UI lane.

/** What a tax-table source publishes: sales/use tax rates, or payroll rate tables. */
export type TaxTableKind = 'sales' | 'payroll';

export const TAX_TABLE_KIND_LABELS: Record<TaxTableKind, string> = {
  sales: 'Sales & use tax',
  payroll: 'Payroll',
};

/** How serious a detected drift is (drives the badge tone). Matches the DB CHECK. */
export type TaxTableDriftSeverity = 'info' | 'warning' | 'critical';

export const TAX_TABLE_DRIFT_SEVERITY_LABELS: Record<TaxTableDriftSeverity, string> = {
  info: 'Info',
  warning: 'Warning',
  critical: 'Critical',
};

/**
 * Review lifecycle of a drift row. Matches the DB CHECK. `open` is the actionable
 * inbox state (powers the badge); `applied`/`dismissed` are terminal. `reviewed` is a
 * reserved intermediate the admin RPCs accept but the v1 UI does not yet set.
 */
export type TaxTableDriftStatus = 'open' | 'reviewed' | 'applied' | 'dismissed';

export const TAX_TABLE_DRIFT_STATUS_LABELS: Record<TaxTableDriftStatus, string> = {
  open: 'Open',
  reviewed: 'Reviewed',
  applied: 'Applied',
  dismissed: 'Dismissed',
};

/** Drift statuses that may still be acted on (apply/dismiss). Terminal states are excluded. */
export const TAX_TABLE_DRIFT_ACTIONABLE_STATUSES: ReadonlySet<TaxTableDriftStatus> = new Set([
  'open',
  'reviewed',
]);

/**
 * One tax-table source (accounting.tax_table_sources): what to pull and from where.
 * `url` is the human landing page; `officialFileUrl` is the downloadable data file the
 * fetcher prefers over fragile HTML scraping. `lastCheckedAt` is stamped by the scheduled
 * function on each pull (null until the first run). Seeded with CDTFA (sales) + CA EDD
 * (payroll).
 */
export interface TaxTableSource {
  id: string;
  name: string;
  kind: TaxTableKind;
  jurisdiction: string | null;
  url: string | null;
  officialFileUrl: string | null;
  /** Cadence in days the scheduled function honors per source (default 90). */
  checkFrequencyDays: number;
  active: boolean;
  /** ISO timestamp of the most recent pull, or null before the first run. */
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * One append-only snapshot of a pull (accounting.tax_table_snapshots). `contentHash` is
 * the sha-256 of the normalized parsed payload (no-op/dedupe detection); `parsed` is the
 * normalized [{ jurisdiction, rate, effective_date, ... }] set; `raw` is the size-capped,
 * untrusted fetched text; `error` is non-null when the pull failed (fail-safe — a failed
 * pull is RECORDED, never silent). History rows are never mutated.
 */
export interface TaxTableSnapshot {
  id: string;
  sourceId: string;
  fetchedAt: string;
  contentHash: string | null;
  /** Normalized parsed payload (array of rate entries) as returned by the source parser. */
  parsed: TaxTableParsedEntry[];
  /** Size-capped raw fetched text (may be omitted from list reads to keep payloads small). */
  raw: string | null;
  /** Non-null fetch/parse error message when the pull failed. */
  error: string | null;
  createdAt: string;
}

/**
 * One normalized rate entry inside a snapshot's `parsed` payload. The scheduled
 * function's parsers produce these from the official file. Shape is intentionally loose
 * (best-effort external data) — `jurisdiction`/`rate`/`effectiveDate` are the core fields
 * the diff compares; extra keys are preserved verbatim for the UI/debugging.
 */
export interface TaxTableParsedEntry {
  jurisdiction: string | null;
  /** Decimal rate (e.g. 0.0725), or null when the parser could not read it. */
  rate: number | null;
  /** Effective date `YYYY-MM-DD`, or null. */
  effectiveDate: string | null;
  /** Any additional parser-provided fields (label, county, etc.), kept verbatim. */
  [key: string]: unknown;
}

/**
 * One proposed rate change inside a drift's `diff` payload, rendered old-vs-new in the UI.
 * The JS diff layer (and the apply RPC) key off `rateName` — the EXACT accounting.tax_rates
 * row name to target. `currentRate` is what is stored now (null when the rate does not yet
 * exist → an INSERT on apply); `newRate` is the proposed value; `effectiveDate` is optional.
 * `label` is an optional human description of the change.
 */
export interface TaxTableDriftDiffEntry {
  /** The accounting.tax_rates.name the apply RPC matches/creates. Required to be applied. */
  rateName: string;
  jurisdiction: string | null;
  /** Currently-stored decimal rate, or null when no active rate of this name exists. */
  currentRate: number | null;
  /** Proposed decimal rate. Required (numeric) for the entry to be applied. */
  newRate: number | null;
  /** Proposed effective date `YYYY-MM-DD`, or null. */
  effectiveDate: string | null;
  /** Optional human description (e.g. "rate increased 0.0725 → 0.0775"). */
  label: string | null;
}

/**
 * One detected mismatch (accounting.tax_table_drift) — THE admin alert. `diff` is the
 * old-vs-new detail the UI renders side-by-side and the apply RPC consumes. `status`
 * drives the badge/list. `sourceName`/`sourceKind` are hydrated from the joined source
 * for display. `reviewedBy` is a public.profiles id (set when applied/dismissed).
 */
export interface TaxTableDrift {
  id: string;
  sourceId: string;
  snapshotId: string | null;
  detectedAt: string;
  diff: TaxTableDriftDiffEntry[];
  severity: TaxTableDriftSeverity;
  status: TaxTableDriftStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Hydrated from the joined source row (read embed); undefined when not joined. */
  sourceName?: string;
  sourceKind?: TaxTableKind;
}

/**
 * One active stored tax rate (accounting.tax_rates) — the read shape the drift detail
 * uses to show what Apply would change. accounting.tax_rates has NO updated_at column
 * (created via _apply_standard_table('tax_rates', false)).
 */
export interface TaxRate {
  id: string;
  name: string;
  /** Decimal rate (e.g. 0.0725). */
  rate: number;
  jurisdiction: string | null;
  effectiveDate: string | null;
  endDate: string | null;
  isActive: boolean;
  createdAt: string;
}

/**
 * Pure double-entry posting helpers for AR (A1) and AP (A2) documents.
 *
 * These functions translate an invoice, a bill, or a payment into the *balanced*
 * set of journal lines that `accounting.post_journal_entry` will accept. They are
 * deliberately free of React/Supabase so the double-entry math is trivially
 * unit-testable (see posting.test.ts).
 *
 * MONEY: every amount that reaches the ledger is rounded through integer cents
 * (accountingViewModel.toCents) before being split into debit/credit lines, so the
 * debit and credit totals match to the penny and the DB balance trigger passes.
 * The values handed back to the service are plain dollars (numeric(14,2) in the DB).
 */
import { toCents } from './accountingViewModel';
import type {
  DefaultAccounts,
  LineDimensions,
  NewBillLineInput,
  NewInvoiceLineInput,
  NewJournalLineInput,
  NewPaymentApplicationInput,
  NewVendorPaymentApplicationInput,
  ReconciliationSummary,
} from './types';

const centsToAmount = (cents: number): number => Math.round(cents) / 100;

/** Pull the three nullable dimension ids off any line-like object (null when absent). */
function pickDimensions(line: LineDimensions): {
  classId: string | null;
  locationId: string | null;
  departmentId: string | null;
} {
  return {
    classId: line.classId ?? null,
    locationId: line.locationId ?? null,
    departmentId: line.departmentId ?? null,
  };
}

/**
 * A stable string key for an (account + class + location + department) tuple. Income
 * and expense lines are grouped by this composite key — NOT just the account — so a
 * posting can be sliced by dimension: each distinct (account × class × location ×
 * department) combination becomes its own balanced journal line. '∅' marks a null
 * dimension so it never collides with a real id.
 */
function dimGroupKey(
  accountId: string,
  dims: { classId: string | null; locationId: string | null; departmentId: string | null }
): string {
  return [accountId, dims.classId ?? '∅', dims.locationId ?? '∅', dims.departmentId ?? '∅'].join('|');
}

/** Only spread dimension ids that are non-null, so JE lines stay clean. */
function dimsSpread(dims: {
  classId: string | null;
  locationId: string | null;
  departmentId: string | null;
}): LineDimensions {
  const out: LineDimensions = {};
  if (dims.classId) out.classId = dims.classId;
  if (dims.locationId) out.locationId = dims.locationId;
  if (dims.departmentId) out.departmentId = dims.departmentId;
  return out;
}

/** A single invoice line reduced to the figures the ledger cares about. */
export interface ComputedInvoiceLine {
  /** Income account this line credits; falls back to the document default. */
  incomeAccountId: string | null;
  /** Net of discount, in cents. */
  netCents: number;
  /** Whether this line participates in sales tax. */
  taxable: boolean;
  /** Tax owed on this line, in cents. */
  taxCents: number;
  jobId: string | null;
  /** B2 reporting dimensions carried from the source line onto the income JE line. */
  classId: string | null;
  locationId: string | null;
  departmentId: string | null;
}

export interface InvoiceTotals {
  /** Sum of line nets (after per-line discount), in cents. */
  subtotalCents: number;
  /** Sum of per-line discounts, in cents. */
  discountCents: number;
  /** Sum of line tax, in cents. */
  taxCents: number;
  /** subtotal + tax, in cents. */
  totalCents: number;
  lines: ComputedInvoiceLine[];
}

/**
 * Net (post-discount) amount of one input line, in cents. When an explicit
 * `lineTotal` is supplied it is taken as the already-net amount (the job importer
 * passes a part's quote total directly). Otherwise it is quantity * unitPrice with
 * any per-line discount subtracted. Never negative.
 */
export function lineNetCents(line: NewInvoiceLineInput): number {
  if (line.lineTotal != null) {
    const net = toCents(line.lineTotal);
    return net > 0 ? net : 0;
  }
  const discountCents = toCents(line.discount ?? 0);
  const grossCents = Math.round((toCents(line.quantity) * toCents(line.unitPrice)) / 100);
  const net = grossCents - discountCents;
  return net > 0 ? net : 0;
}

/**
 * Roll an invoice's input lines up into ledger-ready totals. `defaultIncomeAccountId`
 * is used when a line does not name its own income account. `taxRateByCode` resolves
 * a tax-code id to its decimal rate (e.g. 0.0725); the header `taxCodeId` is the
 * fallback for taxable lines that don't carry their own code. Tax is computed
 * per-line then summed so rounding matches a line-item invoice.
 */
export function computeInvoiceTotals(params: {
  lines: NewInvoiceLineInput[];
  defaultIncomeAccountId: string | null;
  headerTaxCodeId?: string | null;
  taxRateByCode: (taxCodeId: string | null | undefined) => number;
  /** When true (tax-exempt customer/code), no line is taxed regardless of flags. */
  taxExempt?: boolean;
}): InvoiceTotals {
  const { lines, defaultIncomeAccountId, headerTaxCodeId, taxRateByCode, taxExempt } = params;
  let subtotalCents = 0;
  let discountCents = 0;
  let taxCents = 0;
  const computed: ComputedInvoiceLine[] = [];

  for (const line of lines) {
    const netCents = lineNetCents(line);
    const lineDiscountCents = toCents(line.discount ?? 0);
    const taxable = line.taxable !== false; // default taxable
    const codeForLine = line.taxCodeId ?? headerTaxCodeId ?? null;
    const rate = taxExempt || !taxable ? 0 : taxRateByCode(codeForLine);
    const lineTaxCents = rate > 0 ? Math.round((netCents * rate * 100) / 100) : 0;

    subtotalCents += netCents;
    discountCents += lineDiscountCents;
    taxCents += lineTaxCents;
    computed.push({
      incomeAccountId: line.incomeAccountId ?? defaultIncomeAccountId,
      netCents,
      taxable: taxable && !taxExempt,
      taxCents: lineTaxCents,
      jobId: line.jobId ?? null,
      ...pickDimensions(line),
    });
  }

  return {
    subtotalCents,
    discountCents,
    taxCents,
    totalCents: subtotalCents + taxCents,
    lines: computed,
  };
}

export interface InvoiceJournalResult {
  lines: NewJournalLineInput[];
  /** Convenience dollar totals for persisting to the invoice header. */
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
}

/**
 * Build the revenue journal for an invoice being sent:
 *   Dr 1200 Accounts Receivable  (grand total)
 *   Cr 4000/4100 Income          (per income account, net of tax)
 *   Cr 2200 Sales Tax Payable    (total tax, if any)
 *
 * Income credits are grouped by income account so a multi-account invoice still
 * posts one credit per account. Throws if the resulting entry would be unbalanced
 * or trivial (the DB enforces the same, but we fail fast with a clear message).
 */
export function buildInvoiceRevenueJournalLines(
  totals: InvoiceTotals,
  accounts: Pick<DefaultAccounts, 'accountsReceivable' | 'salesIncome' | 'salesTaxPayable'>,
  opts?: { customerId?: string | null }
): InvoiceJournalResult {
  const arAccount = accounts.accountsReceivable;
  if (!arAccount) {
    throw new Error('Accounts Receivable account is not configured (default_accounts).');
  }
  const totalCents = totals.totalCents;
  if (totalCents <= 0) {
    throw new Error('Cannot post an invoice with a zero or negative total.');
  }

  const customerId = opts?.customerId ?? null;
  const lines: NewJournalLineInput[] = [];

  // Dr Accounts Receivable for the grand total.
  lines.push({
    accountId: arAccount,
    debit: centsToAmount(totalCents),
    credit: 0,
    lineMemo: 'Accounts receivable',
  });

  // Cr Income, grouped by (income account × dimensions) so the revenue can be sliced
  // by class/location/department. Each distinct combination posts its own credit line.
  const incomeByGroup = new Map<string, { accountId: string; cents: number; dims: ReturnType<typeof pickDimensions> }>();
  for (const line of totals.lines) {
    const acct = line.incomeAccountId ?? accounts.salesIncome;
    if (!acct) {
      throw new Error('No income account configured for an invoice line (default_accounts.sales_income).');
    }
    const dims = pickDimensions(line);
    const key = dimGroupKey(acct, dims);
    const existing = incomeByGroup.get(key);
    if (existing) existing.cents += line.netCents;
    else incomeByGroup.set(key, { accountId: acct, cents: line.netCents, dims });
  }
  for (const { accountId, cents, dims } of incomeByGroup.values()) {
    if (cents <= 0) continue;
    lines.push({
      accountId,
      debit: 0,
      credit: centsToAmount(cents),
      lineMemo: 'Revenue',
      ...dimsSpread(dims),
    });
  }

  // Cr Sales Tax Payable for the aggregate tax.
  if (totals.taxCents > 0) {
    const taxAccount = accounts.salesTaxPayable;
    if (!taxAccount) {
      throw new Error('Sales Tax Payable account is not configured (default_accounts.sales_tax_payable).');
    }
    lines.push({
      accountId: taxAccount,
      debit: 0,
      credit: centsToAmount(totals.taxCents),
      lineMemo: 'Sales tax payable',
    });
  }

  // Stamp the customer dimension on every line for AR reporting.
  const stamped = customerId
    ? lines.map((l) => ({ ...l, customerId }))
    : lines;

  assertBalanced(stamped);

  return {
    lines: stamped,
    subtotal: centsToAmount(totals.subtotalCents),
    discountTotal: centsToAmount(totals.discountCents),
    taxTotal: centsToAmount(totals.taxCents),
    total: centsToAmount(totalCents),
  };
}

/**
 * Build the receipt journal for a customer payment:
 *   Dr 1000 Cash / 1050 Undeposited Funds  (amount received)
 *   Cr 1200 Accounts Receivable            (amount applied to invoices)
 *
 * For Phase A every payment is fully applied to invoices, so the debit (deposit)
 * equals the credit (AR relief). `applications` is summed to derive the AR credit;
 * the caller validates that it equals the payment amount.
 */
export function buildPaymentJournalLines(params: {
  amount: number;
  depositAccountId: string | null;
  accountsReceivableId: string | null;
  applications: NewPaymentApplicationInput[];
  customerId?: string | null;
}): NewJournalLineInput[] {
  const { amount, depositAccountId, accountsReceivableId, applications, customerId } = params;
  if (!depositAccountId) {
    throw new Error('No deposit account configured for the payment (cash/undeposited funds).');
  }
  if (!accountsReceivableId) {
    throw new Error('Accounts Receivable account is not configured (default_accounts).');
  }
  const amountCents = toCents(amount);
  if (amountCents <= 0) {
    throw new Error('Payment amount must be greater than zero.');
  }
  const appliedCents = applications.reduce((s, a) => s + toCents(a.amountApplied), 0);
  if (appliedCents !== amountCents) {
    throw new Error('Applied amount must equal the payment amount (no unapplied receipts in Phase A).');
  }

  const lines: NewJournalLineInput[] = [
    {
      accountId: depositAccountId,
      debit: centsToAmount(amountCents),
      credit: 0,
      lineMemo: 'Customer payment received',
    },
    {
      accountId: accountsReceivableId,
      debit: 0,
      credit: centsToAmount(appliedCents),
      lineMemo: 'Applied to accounts receivable',
    },
  ];
  const stamped = customerId ? lines.map((l) => ({ ...l, customerId })) : lines;
  assertBalanced(stamped);
  return stamped;
}

// ── AP side (A2): bills & vendor payments ────────────────────────────────────

/**
 * A single bill line reduced to the figures the ledger cares about. `debitAccountId`
 * is the GL account this line debits — already resolved by the service (item-based
 * lines resolve through item.expense_account_id / inventory_asset_account_id →
 * vendor.default_expense_account_id → settings.operating_expenses; account-based
 * lines debit their own account_id). Kept here as a plain id so this module stays
 * free of any DB lookups.
 */
export interface ComputedBillLine {
  debitAccountId: string | null;
  /** Line extended cost (quantity * unitCost, or an explicit lineTotal), in cents. */
  netCents: number;
  jobId: string | null;
  /** B2 reporting dimensions carried from the source line onto the expense JE line. */
  classId: string | null;
  locationId: string | null;
  departmentId: string | null;
}

export interface BillTotals {
  /** Sum of line nets, in cents. */
  subtotalCents: number;
  /** Header-level tax charged on the bill, in cents. */
  taxCents: number;
  /** subtotal + tax, in cents. */
  totalCents: number;
  lines: ComputedBillLine[];
}

/**
 * Net (extended) cost of one bill input line, in cents. An explicit `lineTotal` is
 * taken as the already-extended amount; otherwise it is quantity * unitCost. Never
 * negative. (Bills carry no per-line discount — that lives at the header as tax.)
 */
export function billLineNetCents(line: NewBillLineInput): number {
  if (line.lineTotal != null) {
    const net = toCents(line.lineTotal);
    return net > 0 ? net : 0;
  }
  const grossCents = Math.round((toCents(line.quantity) * toCents(line.unitCost)) / 100);
  return grossCents > 0 ? grossCents : 0;
}

/**
 * Roll a bill's input lines up into ledger-ready totals. `resolveDebitAccount` maps
 * one input line to the GL account it debits (the service supplies the item/vendor/
 * default resolution); `taxTotal` is the header tax in dollars. Bills are not taxed
 * per line, so tax is a single header figure folded into the expense debit by
 * buildBillExpenseJournalLines.
 */
export function computeBillTotals(params: {
  lines: NewBillLineInput[];
  resolveDebitAccount: (line: NewBillLineInput) => string | null;
  taxTotal?: number | null;
}): BillTotals {
  const { lines, resolveDebitAccount, taxTotal } = params;
  let subtotalCents = 0;
  const computed: ComputedBillLine[] = [];

  for (const line of lines) {
    const netCents = billLineNetCents(line);
    subtotalCents += netCents;
    computed.push({
      debitAccountId: resolveDebitAccount(line),
      netCents,
      jobId: line.jobId ?? null,
      ...pickDimensions(line),
    });
  }

  const taxCents = taxTotal ? Math.max(0, toCents(taxTotal)) : 0;
  return {
    subtotalCents,
    taxCents,
    totalCents: subtotalCents + taxCents,
    lines: computed,
  };
}

export interface BillJournalResult {
  lines: NewJournalLineInput[];
  /** Convenience dollar totals for persisting to the bill header. */
  subtotal: number;
  taxTotal: number;
  total: number;
}

/**
 * Build the expense journal for a bill being posted:
 *   Dr 6000/5000/1300 Expense or Inventory-asset  (per resolved account, net)
 *   Cr 2000 Accounts Payable                       (grand total = subtotal + tax)
 *
 * Debits are grouped by (account × dimensions) so a multi-account or multi-dimension
 * bill posts one debit per distinct combination — letting expenses be sliced by
 * class/location/department. Header tax (non-recoverable sales/use tax) has no line of
 * its own on a bill, so it is folded into the *largest* expense debit group — the
 * bill's primary expense — which keeps the entry balanced (Σ debits == AP credit).
 * Throws if the entry would be unbalanced or trivial (the DB enforces the same; we
 * fail fast with a clear msg).
 */
export function buildBillExpenseJournalLines(
  totals: BillTotals,
  accounts: Pick<DefaultAccounts, 'accountsPayable' | 'operatingExpenses'>,
  opts?: { vendorId?: string | null; jobId?: string | null }
): BillJournalResult {
  const apAccount = accounts.accountsPayable;
  if (!apAccount) {
    throw new Error('Accounts Payable account is not configured (default_accounts.accounts_payable).');
  }
  const totalCents = totals.totalCents;
  if (totalCents <= 0) {
    throw new Error('Cannot post a bill with a zero or negative total.');
  }

  // Group line debits by (resolved expense/asset account × dimensions), net of tax.
  const debitByGroup = new Map<
    string,
    { accountId: string; cents: number; dims: ReturnType<typeof pickDimensions> }
  >();
  for (const line of totals.lines) {
    const acct = line.debitAccountId ?? accounts.operatingExpenses;
    if (!acct) {
      throw new Error(
        'No expense account configured for a bill line (default_accounts.operating_expenses).'
      );
    }
    const dims = pickDimensions(line);
    const key = dimGroupKey(acct, dims);
    const existing = debitByGroup.get(key);
    if (existing) existing.cents += line.netCents;
    else debitByGroup.set(key, { accountId: acct, cents: line.netCents, dims });
  }

  // Fold header tax into the largest debit group (the bill's primary expense). With
  // no positive-net line there is nowhere to book tax — reject rather than unbalance.
  if (totals.taxCents > 0) {
    let largestKey: string | null = null;
    let largestCents = -1;
    for (const [key, g] of debitByGroup) {
      if (g.cents > largestCents) {
        largestCents = g.cents;
        largestKey = key;
      }
    }
    if (!largestKey) {
      throw new Error('Cannot book bill tax without at least one expense line.');
    }
    const g = debitByGroup.get(largestKey)!;
    g.cents += totals.taxCents;
  }

  const vendorId = opts?.vendorId ?? null;
  const jobId = opts?.jobId ?? null;
  const lines: NewJournalLineInput[] = [];

  // Dr each (expense/asset account × dimensions) group for its (tax-folded) net.
  for (const { accountId, cents, dims } of debitByGroup.values()) {
    if (cents <= 0) continue;
    lines.push({
      accountId,
      debit: centsToAmount(cents),
      credit: 0,
      lineMemo: 'Expense',
      ...dimsSpread(dims),
    });
  }

  // Cr Accounts Payable for the grand total.
  lines.push({
    accountId: apAccount,
    debit: 0,
    credit: centsToAmount(totalCents),
    lineMemo: 'Accounts payable',
  });

  // Stamp vendor (always) and job (when the bill is job-linked) dimensions for reporting.
  const stamped = lines.map((l) => ({
    ...l,
    ...(vendorId ? { vendorId } : {}),
    ...(jobId ? { jobId } : {}),
  }));

  assertBalanced(stamped);

  return {
    lines: stamped,
    subtotal: centsToAmount(totals.subtotalCents),
    taxTotal: centsToAmount(totals.taxCents),
    total: centsToAmount(totalCents),
  };
}

/**
 * Build the disbursement journal for a vendor payment:
 *   Dr 2000 Accounts Payable  (amount applied to bills)
 *   Cr 1000 Cash / bank        (amount paid out)
 *
 * For Phase A every payment is fully applied to bills, so the AP debit equals the
 * cash credit. `applications` is summed to derive the AP relief; the caller validates
 * it equals the payment amount.
 */
export function buildVendorPaymentJournalLines(params: {
  amount: number;
  payFromAccountId: string | null;
  accountsPayableId: string | null;
  applications: NewVendorPaymentApplicationInput[];
  vendorId?: string | null;
}): NewJournalLineInput[] {
  const { amount, payFromAccountId, accountsPayableId, applications, vendorId } = params;
  if (!payFromAccountId) {
    throw new Error('No pay-from account configured for the vendor payment (cash/bank).');
  }
  if (!accountsPayableId) {
    throw new Error('Accounts Payable account is not configured (default_accounts.accounts_payable).');
  }
  const amountCents = toCents(amount);
  if (amountCents <= 0) {
    throw new Error('Vendor payment amount must be greater than zero.');
  }
  const appliedCents = applications.reduce((s, a) => s + toCents(a.amountApplied), 0);
  if (appliedCents !== amountCents) {
    throw new Error('Applied amount must equal the payment amount (no unapplied payments in Phase A).');
  }

  const lines: NewJournalLineInput[] = [
    {
      accountId: accountsPayableId,
      debit: centsToAmount(appliedCents),
      credit: 0,
      lineMemo: 'Applied to accounts payable',
    },
    {
      accountId: payFromAccountId,
      debit: 0,
      credit: centsToAmount(amountCents),
      lineMemo: 'Vendor payment paid',
    },
  ];
  const stamped = vendorId ? lines.map((l) => ({ ...l, vendorId })) : lines;
  assertBalanced(stamped);
  return stamped;
}

// ── Inventory valuation (B3): FIFO COGS relief on job consumption ─────────────

export interface CogsJournalResult {
  lines: NewJournalLineInput[];
  /** The FIFO-consumed cost that posted on both sides, in dollars. */
  amount: number;
}

/**
 * Build the COGS relief journal for a job consuming FIFO-costed inventory:
 *   Dr 5000 Cost of Goods Sold   = FIFO-consumed cost
 *   Cr 1300 Inventory Asset      = FIFO-consumed cost
 *
 * Equal by construction — a single FIFO-cost figure books on both sides — so the
 * entry is always balanced (the DB balance trigger is the final gate). This mirrors
 * exactly what accounting.consume_job_cogs posts; the RPC is authoritative (it depletes
 * the cost layers atomically under row locks, which JS cannot do safely), and this pure
 * builder exists so the lines can be previewed and the balance is unit-testable.
 *
 * `costCents` is the integer-cents FIFO cost (from consumeFifo, summed across the job's
 * consumed lines). A zero or negative cost has nothing to relieve — callers must not
 * post (the RPC returns NULL in that case), so this throws rather than emit a degenerate
 * 0/0 entry. `jobId` is stamped on both lines for job-costing reporting.
 */
export function buildCogsJournalLines(
  costCents: number,
  accounts: Pick<DefaultAccounts, 'cogs' | 'inventoryAsset'>,
  opts?: { jobId?: string | null }
): CogsJournalResult {
  const cogsAccount = accounts.cogs;
  if (!cogsAccount) {
    throw new Error('Cost of Goods Sold account is not configured (default_accounts.cogs).');
  }
  const inventoryAccount = accounts.inventoryAsset;
  if (!inventoryAccount) {
    throw new Error('Inventory Asset account is not configured (default_accounts.inventory_asset).');
  }
  if (!Number.isFinite(costCents) || costCents <= 0) {
    throw new Error('Cannot post COGS with a zero or negative cost.');
  }

  const value = centsToAmount(costCents);
  const jobId = opts?.jobId ?? null;
  const lines: NewJournalLineInput[] = [
    {
      accountId: cogsAccount,
      debit: value,
      credit: 0,
      lineMemo: 'FIFO COGS',
    },
    {
      accountId: inventoryAccount,
      debit: 0,
      credit: value,
      lineMemo: 'FIFO inventory relief',
    },
  ];
  const stamped = jobId ? lines.map((l) => ({ ...l, jobId })) : lines;
  assertBalanced(stamped);

  return { lines: stamped, amount: value };
}

// ── Fixed assets (D3): depreciation for one period ────────────────────────────

export interface DepreciationJournalResult {
  lines: NewJournalLineInput[];
  /** The depreciation amount that posted on both sides, in dollars. */
  amount: number;
}

/**
 * Build the depreciation journal for ONE period of a fixed asset:
 *   Dr  Depreciation Expense            = period amount
 *   Cr  Accumulated Depreciation (1510) = period amount   (contra-asset, credit)
 *
 * Equal by construction — a single period amount books on both sides — so the entry is
 * always balanced (the DB balance trigger is the final gate). This mirrors exactly what
 * accounting.post_depreciation_row posts; the RPC is authoritative (it posts through
 * accounting.post_journal_entry under a row lock, honoring the books-closed period lock,
 * and stamps the schedule row), and this pure builder exists so the lines can be previewed
 * and the balance is unit-testable.
 *
 * `amountCents` is the integer-cents depreciation for the period (from
 * computeStraightLineSchedule). A zero or negative amount has nothing to recognize and
 * cannot form a balanced ≥2-line entry, so this throws rather than emit a degenerate 0/0
 * entry (the RPC marks such a row posted without a JE). Both account ids are required.
 */
export function buildDepreciationJournalLines(
  amountCents: number,
  accounts: { depreciationExpenseAccountId: string | null; accumulatedDepreciationAccountId: string | null }
): DepreciationJournalResult {
  const expenseAccount = accounts.depreciationExpenseAccountId;
  if (!expenseAccount) {
    throw new Error('Depreciation Expense account is not configured for the asset.');
  }
  const accumAccount = accounts.accumulatedDepreciationAccountId;
  if (!accumAccount) {
    throw new Error('Accumulated Depreciation account is not configured (default_accounts.accumulated_depreciation).');
  }
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new Error('Cannot post depreciation with a zero or negative amount.');
  }

  const value = centsToAmount(amountCents);
  const lines: NewJournalLineInput[] = [
    {
      accountId: expenseAccount,
      debit: value,
      credit: 0,
      lineMemo: 'Depreciation expense',
    },
    {
      accountId: accumAccount,
      debit: 0,
      credit: value,
      lineMemo: 'Accumulated depreciation',
    },
  ];
  assertBalanced(lines);

  return { lines, amount: value };
}

// ── Banking (A4): categorizing a bank-feed transaction ───────────────────────

export interface BankTransactionJournalResult {
  lines: NewJournalLineInput[];
  /** Positive magnitude that posted, in dollars (the JE debit == credit == this). */
  amount: number;
  /** 'deposit' (money into the bank) or 'withdrawal' (money out). */
  direction: 'deposit' | 'withdrawal';
}

/**
 * Build the journal for accepting/categorizing one imported bank transaction. The
 * entry is always two balanced lines — the transaction's category account vs. the
 * bank's GL (cash / credit-card) account — using the bank sign convention
 * (positive = deposit into the bank, negative = withdrawal):
 *
 *   WITHDRAWAL (amount < 0)  Dr <category>      |  Cr <bank GL>
 *       money left the bank → record the expense/asset, reduce cash.
 *   DEPOSIT    (amount > 0)  Dr <bank GL>       |  Cr <category>
 *       money entered the bank → increase cash, record the income/credit.
 *
 * The magnitude posts (the sign only chooses the direction), so the debit and
 * credit are equal by construction and the DB balance trigger passes. A zero amount,
 * a missing category account, a missing bank GL account, or category == bank are all
 * rejected with a clear message (the same conditions the DB would reject, surfaced
 * early). `vendorId` is stamped on both lines when provided (a rule may set it).
 */
export function buildBankTransactionJournalLines(params: {
  amount: number;
  /** The GL account the bank account wraps (cash / credit card). Always one side. */
  bankGlAccountId: string | null;
  /** The category (expense/income/transfer) account — the other side. */
  categoryAccountId: string | null;
  vendorId?: string | null;
  memo?: string | null;
}): BankTransactionJournalResult {
  const { amount, bankGlAccountId, categoryAccountId, vendorId, memo } = params;
  if (!bankGlAccountId) {
    throw new Error('The bank account is not linked to a GL account — link one before categorizing.');
  }
  if (!categoryAccountId) {
    throw new Error('Choose a category account before posting this transaction.');
  }
  if (bankGlAccountId === categoryAccountId) {
    throw new Error('The category account must differ from the bank account.');
  }
  const amountCents = toCents(amount);
  if (amountCents === 0) {
    throw new Error('Cannot post a zero-amount transaction.');
  }

  const magnitude = Math.abs(amountCents);
  const direction: 'deposit' | 'withdrawal' = amountCents > 0 ? 'deposit' : 'withdrawal';
  const value = centsToAmount(magnitude);

  // Withdrawal: Dr category / Cr bank. Deposit: Dr bank / Cr category.
  const debitAccountId = direction === 'withdrawal' ? categoryAccountId : bankGlAccountId;
  const creditAccountId = direction === 'withdrawal' ? bankGlAccountId : categoryAccountId;

  const lines: NewJournalLineInput[] = [
    {
      accountId: debitAccountId,
      debit: value,
      credit: 0,
      lineMemo: memo ?? (direction === 'withdrawal' ? 'Bank withdrawal' : 'Bank deposit'),
    },
    {
      accountId: creditAccountId,
      debit: 0,
      credit: value,
      lineMemo: memo ?? (direction === 'withdrawal' ? 'Bank withdrawal' : 'Bank deposit'),
    },
  ];
  const stamped = vendorId ? lines.map((l) => ({ ...l, vendorId })) : lines;
  assertBalanced(stamped);

  return { lines: stamped, amount: value, direction };
}

/**
 * Compute live reconciliation math for the reconcile screen. Pure (cents-based) so
 * the "difference" is exactly zero when the statement reconciles, never off by a
 * floating-point penny:
 *   clearedAmount = Σ(signed amounts of the cleared transactions)
 *   clearedBalance = beginningBalance + clearedAmount
 *   difference     = statementEndingBalance − clearedBalance
 * `clearedAmounts` are the signed amounts (deposits positive, withdrawals negative)
 * of the transactions currently marked cleared against the statement.
 */
export function computeReconciliationSummary(params: {
  beginningBalance: number | null | undefined;
  statementEndingBalance: number | null | undefined;
  clearedAmounts: number[];
}): ReconciliationSummary {
  const beginningCents = toCents(params.beginningBalance ?? 0);
  const endingCents = toCents(params.statementEndingBalance ?? 0);
  const clearedCents = params.clearedAmounts.reduce((s, a) => s + toCents(a), 0);
  const clearedBalanceCents = beginningCents + clearedCents;
  const differenceCents = endingCents - clearedBalanceCents;
  return {
    beginningBalance: centsToAmount(beginningCents),
    statementEndingBalance: centsToAmount(endingCents),
    clearedCount: params.clearedAmounts.length,
    clearedAmount: centsToAmount(clearedCents),
    clearedBalance: centsToAmount(clearedBalanceCents),
    difference: centsToAmount(differenceCents),
    reconciled: differenceCents === 0,
  };
}

/**
 * Guard: throws unless the lines net to zero (debits === credits in cents) and
 * there are at least two of them. Mirrors accounting.guard_journal_entry so a
 * malformed entry never reaches the DB round-trip.
 */
export function assertBalanced(lines: NewJournalLineInput[]): void {
  if (lines.length < 2) {
    throw new Error('A journal entry needs at least two lines.');
  }
  let debit = 0;
  let credit = 0;
  for (const l of lines) {
    const d = toCents(l.debit);
    const c = toCents(l.credit);
    if (d > 0 && c > 0) throw new Error('A journal line cannot have both a debit and a credit.');
    debit += d;
    credit += c;
  }
  if (debit !== credit) {
    throw new Error(`Journal entry is unbalanced: debits ${debit / 100} <> credits ${credit / 100}.`);
  }
  if (debit === 0) {
    throw new Error('Journal entry has no amounts.');
  }
}

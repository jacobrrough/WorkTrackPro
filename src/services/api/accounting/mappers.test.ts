import { describe, it, expect } from 'vitest';
import {
  mapAccountBalanceRow,
  mapApAgingRow,
  mapArAgingRow,
  mapBankAccountRow,
  mapBankRuleRow,
  mapBankTransactionRow,
  mapBudgetRow,
  mapBudgetLineRow,
  mapBillRow,
  mapBillLineRow,
  mapCustomFieldDefRow,
  mapCustomFieldValueRow,
  mapCustomerRow,
  mapDepreciationScheduleRow,
  mapDimensionRow,
  mapFixedAssetRow,
  mapFixedAssetRegisterRow,
  mapInventoryCogsEventRow,
  mapInventoryPriceHistoryRow,
  mapInventoryReconciliationHeaderRow,
  mapInventoryReconciliationRow,
  mapInventoryRevaluationRow,
  mapInventoryValuationRow,
  mapInvoiceRow,
  mapInvoiceLineRow,
  mapJobCostingRow,
  mapPaymentRow,
  mapPaymentApplicationRow,
  mapReconciliationRow,
  mapRecurringTemplateRow,
  mapTaxAgencyRow,
  mapTaxCodeRow,
  mapTaxRateRow,
  mapTaxTableDriftRow,
  mapTaxTableSnapshotRow,
  mapTaxTableSourceRow,
  mapVendorRow,
  mapVendorPaymentRow,
  mapVendorPaymentApplicationRow,
  parseCustomFieldOptions,
  parseCustomFieldValueJson,
  parseRecurringPayload,
  parseTaxFilingRules,
  parseTaxTableSnapshotParsed,
} from './mappers';
import type { RecurringInvoicePayload } from '../../../features/accounting/types';
import { mapClosedThroughDate, mapDefaultAccounts } from './settings';

describe('mapCustomerRow', () => {
  it('maps snake_case columns to the camelCase domain shape', () => {
    const c = mapCustomerRow({
      id: 'c1',
      display_name: 'Acme Co',
      company_name: 'Acme Holdings',
      contact_name: 'Jane',
      email: 'jane@acme.test',
      phone: '555',
      tax_exempt: true,
      resale_certificate: 'RC-1',
      default_tax_code_id: 'tax-1',
      terms: 'Net 30',
      is_active: true,
      notes: 'vip',
      source_proposal_id: 'prop-1',
      created_at: '2026-01-01',
      updated_at: '2026-01-02',
    });
    expect(c).toMatchObject({
      id: 'c1',
      displayName: 'Acme Co',
      companyName: 'Acme Holdings',
      taxExempt: true,
      defaultTaxCodeId: 'tax-1',
      isActive: true,
      sourceProposalId: 'prop-1',
    });
  });

  it('defaults is_active to true and nulls missing optionals', () => {
    const c = mapCustomerRow({ id: 'c2', display_name: 'Bob' });
    expect(c.isActive).toBe(true);
    expect(c.email).toBeNull();
    expect(c.taxExempt).toBe(false);
  });
});

describe('mapTaxCodeRow', () => {
  it('uses the rate override (combined rate) when provided', () => {
    const t = mapTaxCodeRow(
      { id: 't1', name: 'CA - LA (9.5%)', is_taxable: true, is_default: false, is_active: true },
      0.095
    );
    expect(t.rate).toBeCloseTo(0.095, 5);
    expect(t.isTaxable).toBe(true);
  });

  it('treats is_taxable as true by default', () => {
    const t = mapTaxCodeRow({ id: 't2', name: 'X' });
    expect(t.isTaxable).toBe(true);
  });
});

describe('mapInvoiceRow', () => {
  it('maps header money fields and sorts hydrated lines by sort_order', () => {
    const inv = mapInvoiceRow({
      id: 'inv1',
      invoice_number: 'INV-1',
      customer_id: 'c1',
      job_id: 'job1',
      invoice_date: '2026-06-01',
      status: 'sent',
      subtotal: 100,
      discount_total: 0,
      tax_total: 8.5,
      total: 108.5,
      amount_paid: 0,
      balance_due: 108.5,
      journal_entry_id: 'je1',
      created_at: '2026-06-01',
      updated_at: '2026-06-01',
      customer: { display_name: 'Acme Co' },
      lines: [
        {
          id: 'l2',
          invoice_id: 'inv1',
          sort_order: 1,
          line_total: 8.5,
          quantity: 1,
          unit_price: 8.5,
        },
        {
          id: 'l1',
          invoice_id: 'inv1',
          sort_order: 0,
          line_total: 100,
          quantity: 1,
          unit_price: 100,
        },
      ],
    });
    expect(inv.total).toBe(108.5);
    expect(inv.status).toBe('sent');
    expect(inv.journalEntryId).toBe('je1');
    expect(inv.customerName).toBe('Acme Co');
    expect(inv.lines?.map((l) => l.id)).toEqual(['l1', 'l2']); // re-sorted
  });

  it('defaults status to draft and leaves lines undefined when not joined', () => {
    const inv = mapInvoiceRow({ id: 'inv2', customer_id: 'c1' });
    expect(inv.status).toBe('draft');
    expect(inv.lines).toBeUndefined();
  });
});

describe('mapInvoiceLineRow', () => {
  it('maps a line and defaults taxable to true', () => {
    const l = mapInvoiceLineRow({
      id: 'l1',
      invoice_id: 'inv1',
      description: 'Widget',
      quantity: 2,
      unit_price: 10,
      line_total: 20,
      income_account_id: 'acc-sales',
      job_id: 'job1',
      sort_order: 0,
    });
    expect(l).toMatchObject({
      id: 'l1',
      quantity: 2,
      unitPrice: 10,
      lineTotal: 20,
      taxable: true,
      incomeAccountId: 'acc-sales',
      jobId: 'job1',
    });
  });

  it('maps B2 dimension columns (null when absent, value when present)', () => {
    const bare = mapInvoiceLineRow({ id: 'l1', invoice_id: 'inv1', quantity: 1, unit_price: 1 });
    expect(bare.classId).toBeNull();
    expect(bare.locationId).toBeNull();
    expect(bare.departmentId).toBeNull();

    const tagged = mapInvoiceLineRow({
      id: 'l2',
      invoice_id: 'inv1',
      quantity: 1,
      unit_price: 1,
      class_id: 'dim-class',
      location_id: 'dim-loc',
      department_id: 'dim-dept',
    });
    expect(tagged.classId).toBe('dim-class');
    expect(tagged.locationId).toBe('dim-loc');
    expect(tagged.departmentId).toBe('dim-dept');
  });
});

describe('mapPaymentRow', () => {
  it('maps a payment with hydrated applications', () => {
    const p = mapPaymentRow({
      id: 'p1',
      customer_id: 'c1',
      payment_date: '2026-06-01',
      amount: 108.5,
      method: 'check',
      reference: '1234',
      deposit_account_id: 'acc-undeposited',
      unapplied_amount: 0,
      journal_entry_id: 'je2',
      created_at: '2026-06-01',
      updated_at: '2026-06-01',
      applications: [
        {
          id: 'pa1',
          payment_id: 'p1',
          invoice_id: 'inv1',
          amount_applied: 108.5,
          created_at: '2026-06-01',
        },
      ],
    });
    expect(p.amount).toBe(108.5);
    expect(p.method).toBe('check');
    expect(p.journalEntryId).toBe('je2');
    expect(p.applications).toHaveLength(1);
    expect(p.applications?.[0].amountApplied).toBe(108.5);
  });

  it('defaults method to other', () => {
    const p = mapPaymentRow({ id: 'p2', customer_id: 'c1', amount: 10 });
    expect(p.method).toBe('other');
  });
});

describe('mapPaymentApplicationRow', () => {
  it('maps an application row', () => {
    const a = mapPaymentApplicationRow({
      id: 'pa1',
      payment_id: 'p1',
      invoice_id: 'inv1',
      amount_applied: 50,
      created_at: '2026-06-01',
    });
    expect(a).toMatchObject({ id: 'pa1', paymentId: 'p1', invoiceId: 'inv1', amountApplied: 50 });
  });
});

describe('mapDefaultAccounts', () => {
  it('maps the seeded default_accounts blob to camelCase ids', () => {
    const d = mapDefaultAccounts({
      cash: 'a-cash',
      undeposited_funds: 'a-und',
      accounts_receivable: 'a-ar',
      sales_income: 'a-sales',
      sales_tax_payable: 'a-tax',
    });
    expect(d.cash).toBe('a-cash');
    expect(d.undepositedFunds).toBe('a-und');
    expect(d.accountsReceivable).toBe('a-ar');
    expect(d.salesIncome).toBe('a-sales');
    expect(d.salesTaxPayable).toBe('a-tax');
    // absent keys are null, not undefined
    expect(d.cogs).toBeNull();
  });

  it('maps the D3 fixed-asset default keys to camelCase ids', () => {
    const d = mapDefaultAccounts({
      fixed_asset: 'a-1500',
      accumulated_depreciation: 'a-1510',
      depreciation_expense: 'a-6000',
    });
    expect(d.fixedAsset).toBe('a-1500');
    expect(d.accumulatedDepreciation).toBe('a-1510');
    expect(d.depreciationExpense).toBe('a-6000');
  });

  it('maps the COA-EXPAND structural default keys to camelCase ids', () => {
    // The four keys migration 20260601000021 merges into the default_accounts blob:
    // opening_balance_equity->3050, uncategorized_income->4900,
    // uncategorized_expense->6900, payment_processor_clearing->1260.
    const d = mapDefaultAccounts({
      opening_balance_equity: 'a-3050',
      uncategorized_income: 'a-4900',
      uncategorized_expense: 'a-6900',
      payment_processor_clearing: 'a-1260',
    });
    expect(d.openingBalanceEquity).toBe('a-3050');
    expect(d.uncategorizedIncome).toBe('a-4900');
    expect(d.uncategorizedExpense).toBe('a-6900');
    expect(d.paymentProcessorClearing).toBe('a-1260');
  });

  it('resolves the COA-EXPAND keys alongside the legacy keys (additive blob)', () => {
    // Proves the new keys coexist with the migration-003 keys exactly as the on-disk
    // blob does after the additive `||` merge — no key clobbers another.
    const d = mapDefaultAccounts({
      cash: 'a-cash',
      accounts_receivable: 'a-ar',
      opening_balance_equity: 'a-3050',
      payment_processor_clearing: 'a-1260',
    });
    expect(d.cash).toBe('a-cash');
    expect(d.accountsReceivable).toBe('a-ar');
    expect(d.openingBalanceEquity).toBe('a-3050');
    expect(d.paymentProcessorClearing).toBe('a-1260');
    // A key absent from this partial blob is still null, not undefined.
    expect(d.uncategorizedIncome).toBeNull();
  });

  it('returns an all-null shape for an empty/missing blob', () => {
    const d = mapDefaultAccounts(null);
    expect(d.accountsReceivable).toBeNull();
    expect(d.salesIncome).toBeNull();
    expect(d.accumulatedDepreciation).toBeNull();
    expect(d.depreciationExpense).toBeNull();
    // COA-EXPAND keys are null too when the blob is missing.
    expect(d.openingBalanceEquity).toBeNull();
    expect(d.uncategorizedIncome).toBeNull();
    expect(d.uncategorizedExpense).toBeNull();
    expect(d.paymentProcessorClearing).toBeNull();
  });
});

// ── Books-closed (period lock) date (D1) ──────────────────────────────────────
describe('mapClosedThroughDate', () => {
  it('returns a bare YYYY-MM-DD date string unchanged', () => {
    // supabase-js surfaces the jsonb value already parsed, so a date arrives as a JS string.
    expect(mapClosedThroughDate('2026-01-31')).toBe('2026-01-31');
  });

  it('returns null when the books are open (JSON null → JS null)', () => {
    expect(mapClosedThroughDate(null)).toBeNull();
  });

  it('returns null when the setting row is missing', () => {
    // accountingSettingsService.getSetting yields null for an absent key.
    expect(mapClosedThroughDate(undefined)).toBeNull();
  });

  it('takes the date portion of a stray ISO timestamp (no timezone math)', () => {
    expect(mapClosedThroughDate('2026-01-31T00:00:00Z')).toBe('2026-01-31');
  });

  it('returns null for a non-date or non-string value', () => {
    expect(mapClosedThroughDate('garbage')).toBeNull();
    expect(mapClosedThroughDate(42)).toBeNull();
    expect(mapClosedThroughDate({})).toBeNull();
  });
});

// ── AP-side (A2) ─────────────────────────────────────────────────────────────
describe('mapVendorRow', () => {
  it('maps snake_case columns to the camelCase domain shape', () => {
    const v = mapVendorRow({
      id: 'v1',
      display_name: 'Bolt Supply',
      company_name: 'Bolt Supply Inc',
      email: 'ar@bolt.test',
      phone: '555',
      terms: 'Net 15',
      default_expense_account_id: 'acc-opex',
      tax_id: '12-3456789',
      is_1099: true,
      is_active: true,
      notes: 'preferred',
      created_at: '2026-01-01',
      updated_at: '2026-01-02',
    });
    expect(v).toMatchObject({
      id: 'v1',
      displayName: 'Bolt Supply',
      companyName: 'Bolt Supply Inc',
      defaultExpenseAccountId: 'acc-opex',
      taxId: '12-3456789',
      is1099: true,
      isActive: true,
    });
  });

  it('defaults is_active to true and is_1099 to false, nulls missing optionals', () => {
    const v = mapVendorRow({ id: 'v2', display_name: 'Sole Trader' });
    expect(v.isActive).toBe(true);
    expect(v.is1099).toBe(false);
    expect(v.email).toBeNull();
    expect(v.defaultExpenseAccountId).toBeNull();
  });
});

describe('mapBillRow', () => {
  it('maps header money fields and sorts hydrated lines by sort_order', () => {
    const bill = mapBillRow({
      id: 'b1',
      vendor_id: 'v1',
      bill_number: 'BILL-1',
      bill_date: '2026-06-01',
      due_date: '2026-07-01',
      status: 'open',
      subtotal: 140,
      tax_total: 10,
      total: 150,
      amount_paid: 0,
      balance_due: 150,
      journal_entry_id: 'je1',
      created_at: '2026-06-01',
      updated_at: '2026-06-01',
      vendor: { display_name: 'Bolt Supply' },
      lines: [
        {
          id: 'l2',
          bill_id: 'b1',
          sort_order: 1,
          line_total: 40,
          quantity: 1,
          unit_cost: 40,
          account_id: 'acc-cogs',
        },
        {
          id: 'l1',
          bill_id: 'b1',
          sort_order: 0,
          line_total: 100,
          quantity: 1,
          unit_cost: 100,
          account_id: 'acc-opex',
        },
      ],
    });
    expect(bill.total).toBe(150);
    expect(bill.taxTotal).toBe(10);
    expect(bill.status).toBe('open');
    expect(bill.journalEntryId).toBe('je1');
    expect(bill.vendorName).toBe('Bolt Supply');
    expect(bill.lines?.map((l) => l.id)).toEqual(['l1', 'l2']); // re-sorted
  });

  it('defaults status to open and leaves lines undefined when not joined', () => {
    const bill = mapBillRow({ id: 'b2', vendor_id: 'v1' });
    expect(bill.status).toBe('open');
    expect(bill.lines).toBeUndefined();
  });
});

describe('mapBillLineRow', () => {
  it('maps an account-based line (unit_cost, not unit_price)', () => {
    const l = mapBillLineRow({
      id: 'l1',
      bill_id: 'b1',
      account_id: 'acc-opex',
      description: 'Shop rent',
      quantity: 1,
      unit_cost: 1200,
      line_total: 1200,
      source_inventory_id: null,
      sort_order: 0,
    });
    expect(l).toMatchObject({
      id: 'l1',
      accountId: 'acc-opex',
      itemId: null,
      quantity: 1,
      unitCost: 1200,
      lineTotal: 1200,
    });
  });

  it('maps an item-based line carrying its inventory source', () => {
    const l = mapBillLineRow({
      id: 'l2',
      bill_id: 'b1',
      item_id: 'item-7',
      quantity: 10,
      unit_cost: 4.5,
      line_total: 45,
      source_inventory_id: 'inv-9',
      sort_order: 1,
    });
    expect(l.itemId).toBe('item-7');
    expect(l.accountId).toBeNull();
    expect(l.sourceInventoryId).toBe('inv-9');
  });

  it('maps B2 dimension columns', () => {
    const l = mapBillLineRow({
      id: 'l3',
      bill_id: 'b1',
      account_id: 'acc-opex',
      quantity: 1,
      unit_cost: 10,
      line_total: 10,
      class_id: 'dim-class',
      location_id: 'dim-loc',
      department_id: 'dim-dept',
      sort_order: 2,
    });
    expect(l.classId).toBe('dim-class');
    expect(l.locationId).toBe('dim-loc');
    expect(l.departmentId).toBe('dim-dept');
    // absent → null
    expect(
      mapBillLineRow({ id: 'l4', bill_id: 'b1', quantity: 1, unit_cost: 1 }).classId
    ).toBeNull();
  });
});

describe('mapVendorPaymentRow', () => {
  it('maps a vendor payment with hydrated applications (pay_from_account_id)', () => {
    const p = mapVendorPaymentRow({
      id: 'vp1',
      vendor_id: 'v1',
      payment_date: '2026-06-02',
      amount: 90,
      method: 'check',
      reference: '5678',
      pay_from_account_id: 'acc-cash',
      unapplied_amount: 0,
      journal_entry_id: 'je2',
      created_at: '2026-06-02',
      updated_at: '2026-06-02',
      applications: [
        {
          id: 'vpa1',
          vendor_payment_id: 'vp1',
          bill_id: 'b1',
          amount_applied: 90,
          created_at: '2026-06-02',
        },
      ],
    });
    expect(p.amount).toBe(90);
    expect(p.method).toBe('check');
    expect(p.payFromAccountId).toBe('acc-cash');
    expect(p.journalEntryId).toBe('je2');
    expect(p.applications).toHaveLength(1);
    expect(p.applications?.[0].amountApplied).toBe(90);
  });

  it('defaults method to other', () => {
    const p = mapVendorPaymentRow({ id: 'vp2', vendor_id: 'v1', amount: 10 });
    expect(p.method).toBe('other');
  });
});

describe('mapVendorPaymentApplicationRow', () => {
  it('maps an application row (vendor_payment_id + bill_id)', () => {
    const a = mapVendorPaymentApplicationRow({
      id: 'vpa1',
      vendor_payment_id: 'vp1',
      bill_id: 'b1',
      amount_applied: 50,
      created_at: '2026-06-02',
    });
    expect(a).toMatchObject({
      id: 'vpa1',
      vendorPaymentId: 'vp1',
      billId: 'b1',
      amountApplied: 50,
    });
  });
});

// ── Financial reports (A3) ─────────────────────────────────────────────────
describe('mapAccountBalanceRow', () => {
  it('maps a v_trial_balance row and keeps the DB-computed balance', () => {
    const r = mapAccountBalanceRow({
      account_id: 'a-cash',
      account_number: '1000',
      name: 'Cash',
      account_type: 'asset',
      normal_balance: 'debit',
      total_debit: 1085,
      total_credit: 0,
      balance: 1085,
    });
    expect(r).toMatchObject({
      accountId: 'a-cash',
      accountNumber: '1000',
      name: 'Cash',
      accountType: 'asset',
      normalBalance: 'debit',
      totalDebit: 1085,
      totalCredit: 0,
      balance: 1085,
    });
  });

  it('derives balance = debit - credit when the column is absent (date-range aggregate)', () => {
    const r = mapAccountBalanceRow({
      account_id: 'a-tax',
      account_number: '2200',
      name: 'Sales Tax Payable',
      account_type: 'liability',
      normal_balance: 'credit',
      total_debit: 0,
      total_credit: 85,
      // no balance column
    });
    expect(r.balance).toBe(-85);
  });

  it('defaults type/normal_balance defensively', () => {
    const r = mapAccountBalanceRow({ account_id: 'x', name: 'Mystery' });
    expect(r.accountType).toBe('asset');
    expect(r.normalBalance).toBe('debit');
    expect(r.totalDebit).toBe(0);
    expect(r.balance).toBe(0);
  });
});

describe('mapArAgingRow', () => {
  it('maps a v_ar_aging row to the shared AgingRow shape', () => {
    const r = mapArAgingRow({
      invoice_id: 'inv1',
      invoice_number: 'INV-1',
      customer_id: 'c1',
      customer_name: 'Acme Co',
      invoice_date: '2026-05-01',
      due_date: '2026-05-31',
      total: 108.5,
      amount_paid: 0,
      balance_due: 108.5,
      days_overdue: 5,
      aging_bucket: '1-30',
    });
    expect(r).toMatchObject({
      documentId: 'inv1',
      documentNumber: 'INV-1',
      partyId: 'c1',
      partyName: 'Acme Co',
      documentDate: '2026-05-01',
      dueDate: '2026-05-31',
      total: 108.5,
      balanceDue: 108.5,
      daysOverdue: 5,
      bucket: '1-30',
    });
  });

  it('falls back to the current bucket on an unexpected value', () => {
    const r = mapArAgingRow({
      invoice_id: 'inv2',
      customer_id: 'c1',
      balance_due: 10,
      aging_bucket: 'weird',
    });
    expect(r.bucket).toBe('current');
  });
});

describe('mapApAgingRow', () => {
  it('maps a v_ap_aging row (bill_id / vendor_id) to AgingRow', () => {
    const r = mapApAgingRow({
      bill_id: 'b1',
      bill_number: 'BILL-1',
      vendor_id: 'v1',
      vendor_name: 'Bolt Supply',
      bill_date: '2026-04-01',
      due_date: '2026-05-01',
      total: 150,
      amount_paid: 50,
      balance_due: 100,
      days_overdue: 62,
      aging_bucket: '61-90',
    });
    expect(r).toMatchObject({
      documentId: 'b1',
      documentNumber: 'BILL-1',
      partyId: 'v1',
      partyName: 'Bolt Supply',
      balanceDue: 100,
      daysOverdue: 62,
      bucket: '61-90',
    });
  });
});

// ── Job costing (B1) ───────────────────────────────────────────────────────
describe('mapJobCostingRow', () => {
  it('maps a v_job_costing row to the camelCase JobCostingRow shape', () => {
    const r = mapJobCostingRow({
      job_id: 'job-1',
      job_code: 'WO-1024',
      name: 'Kitchen remodel',
      status: 'in_progress',
      labor_minutes: 480,
      labor_cost: 320,
      material_cost: 1250.5,
      revenue: 4000,
      margin: 2429.5,
    });
    expect(r).toMatchObject({
      jobId: 'job-1',
      jobCode: 'WO-1024',
      name: 'Kitchen remodel',
      status: 'in_progress',
      laborMinutes: 480,
      laborCost: 320,
      materialCost: 1250.5,
      revenue: 4000,
      margin: 2429.5,
    });
  });

  it('nulls a missing job_code/status and defaults money fields to 0', () => {
    const r = mapJobCostingRow({ job_id: 'job-2', name: 'Bare job' });
    expect(r.jobCode).toBeNull();
    expect(r.status).toBeNull();
    expect(r.laborMinutes).toBe(0);
    expect(r.laborCost).toBe(0);
    expect(r.materialCost).toBe(0);
    expect(r.revenue).toBe(0);
    expect(r.margin).toBe(0);
  });

  it('preserves a negative margin (over-budget job)', () => {
    const r = mapJobCostingRow({
      job_id: 'job-3',
      name: 'Loss leader',
      revenue: 500,
      material_cost: 400,
      labor_cost: 300,
      margin: -200,
    });
    expect(r.margin).toBe(-200);
  });
});

// ── Banking (A4) ───────────────────────────────────────────────────────────
describe('mapBankAccountRow', () => {
  it('maps columns and hydrates the joined GL account', () => {
    const a = mapBankAccountRow({
      id: 'ba1',
      name: 'Operating Checking',
      account_id: 'gl-1000',
      account_type: 'checking',
      institution: 'First Bank',
      mask: '••1234',
      current_balance: 5230.55,
      last_reconciled_at: '2026-05-31',
      is_active: true,
      created_at: '2026-01-01',
      updated_at: '2026-01-02',
      account: { name: 'Cash', account_number: '1000' },
    });
    expect(a).toMatchObject({
      id: 'ba1',
      name: 'Operating Checking',
      accountId: 'gl-1000',
      accountType: 'checking',
      institution: 'First Bank',
      mask: '••1234',
      currentBalance: 5230.55,
      isActive: true,
      glAccountName: 'Cash',
      glAccountNumber: '1000',
    });
  });

  it('nulls an unknown account_type and defaults is_active to true', () => {
    const a = mapBankAccountRow({ id: 'ba2', name: 'Mystery', account_type: 'crypto' });
    expect(a.accountType).toBeNull();
    expect(a.isActive).toBe(true);
    expect(a.currentBalance).toBe(0);
    expect(a.glAccountName).toBeUndefined();
  });
});

describe('mapBankTransactionRow', () => {
  it('keeps the signed amount and maps the migration-012 columns', () => {
    const t = mapBankTransactionRow({
      id: 'bt1',
      bank_account_id: 'ba1',
      txn_date: '2026-06-01',
      amount: -42.5,
      description: 'ACME HARDWARE',
      merchant: 'Acme Hardware',
      external_id: 'FIT-1',
      status: 'matched',
      category_account_id: 'gl-6000',
      matched_journal_entry_id: 'je-9',
      reconciliation_id: 'rec-1',
      cleared_at: '2026-06-02',
      applied_rule_id: 'rule-7',
      vendor_id: 'v-9',
      imported_at: '2026-06-01',
      created_at: '2026-06-01',
      category: { name: 'Operating Expenses' },
    });
    expect(t).toMatchObject({
      id: 'bt1',
      bankAccountId: 'ba1',
      amount: -42.5,
      externalId: 'FIT-1',
      status: 'matched',
      categoryAccountId: 'gl-6000',
      matchedJournalEntryId: 'je-9',
      reconciliationId: 'rec-1',
      clearedAt: '2026-06-02',
      appliedRuleId: 'rule-7',
      vendorId: 'v-9',
      categoryAccountName: 'Operating Expenses',
    });
  });

  it('defaults an unknown status to unreviewed and nulls optionals', () => {
    const t = mapBankTransactionRow({
      id: 'bt2',
      bank_account_id: 'ba1',
      txn_date: '2026-06-01',
      amount: 100,
      status: 'bogus',
    });
    expect(t.status).toBe('unreviewed');
    expect(t.amount).toBe(100);
    expect(t.reconciliationId).toBeNull();
    expect(t.appliedRuleId).toBeNull();
    expect(t.vendorId).toBeNull();
  });
});

describe('mapBankRuleRow', () => {
  it('maps a rule and narrows field/op', () => {
    const r = mapBankRuleRow({
      id: 'rule-1',
      bank_account_id: 'ba1',
      match_field: 'description',
      match_op: 'contains',
      match_value: 'SHELL',
      set_account_id: 'gl-6100',
      set_vendor_id: 'v-1',
      priority: 10,
      is_active: true,
      created_at: '2026-01-01',
      updated_at: '2026-01-02',
    });
    expect(r).toMatchObject({
      id: 'rule-1',
      bankAccountId: 'ba1',
      matchField: 'description',
      matchOp: 'contains',
      matchValue: 'SHELL',
      setAccountId: 'gl-6100',
      setVendorId: 'v-1',
      priority: 10,
      isActive: true,
    });
  });

  it('nulls unknown field/op and treats a null bank_account_id as all-accounts', () => {
    const r = mapBankRuleRow({ id: 'rule-2', match_field: 'x', match_op: 'y', priority: 0 });
    expect(r.matchField).toBeNull();
    expect(r.matchOp).toBeNull();
    expect(r.bankAccountId).toBeNull();
  });
});

describe('mapReconciliationRow', () => {
  it('maps a reconciliation header, preserving null money cells', () => {
    const rec = mapReconciliationRow({
      id: 'rec-1',
      bank_account_id: 'ba1',
      statement_date: '2026-05-31',
      statement_ending_balance: 5230.55,
      beginning_balance: 5000,
      status: 'completed',
      reconciled_by: 'user-1',
      reconciled_at: '2026-06-01',
      created_at: '2026-05-31',
      updated_at: '2026-06-01',
    });
    expect(rec).toMatchObject({
      id: 'rec-1',
      bankAccountId: 'ba1',
      statementEndingBalance: 5230.55,
      beginningBalance: 5000,
      status: 'completed',
      reconciledBy: 'user-1',
    });
  });

  it('keeps null balances null and defaults status to in_progress', () => {
    const rec = mapReconciliationRow({
      id: 'rec-2',
      bank_account_id: 'ba1',
      statement_date: '2026-06-30',
    });
    expect(rec.statementEndingBalance).toBeNull();
    expect(rec.beginningBalance).toBeNull();
    expect(rec.status).toBe('in_progress');
  });
});

// ── Reporting dimensions (B2) ────────────────────────────────────────────────
describe('mapDimensionRow', () => {
  it('maps a dimension row and narrows dim_type', () => {
    const d = mapDimensionRow({
      id: 'dim-1',
      dim_type: 'location',
      name: 'San Diego',
      code: 'SD',
      parent_id: 'dim-parent',
      is_active: true,
      created_at: '2026-01-01',
      updated_at: '2026-01-02',
    });
    expect(d).toMatchObject({
      id: 'dim-1',
      dimType: 'location',
      name: 'San Diego',
      code: 'SD',
      parentId: 'dim-parent',
      isActive: true,
    });
  });

  it('defaults an unknown dim_type to class, is_active to true, nulls optionals', () => {
    const d = mapDimensionRow({ id: 'dim-2', dim_type: 'bogus', name: 'X' });
    expect(d.dimType).toBe('class');
    expect(d.isActive).toBe(true);
    expect(d.code).toBeNull();
    expect(d.parentId).toBeNull();
  });
});

// ── Recurring transaction templates (B2) ─────────────────────────────────────
describe('parseRecurringPayload', () => {
  it('passes through an object payload, defaulting missing lines to []', () => {
    const p = parseRecurringPayload({ customerId: 'c1' }) as RecurringInvoicePayload;
    expect(p.customerId).toBe('c1');
    expect(p.lines).toEqual([]);
  });

  it('parses a stringified jsonb payload', () => {
    const p = parseRecurringPayload(
      '{"customerId":"c2","lines":[{"quantity":1,"unitPrice":10}]}'
    ) as RecurringInvoicePayload;
    expect(p.customerId).toBe('c2');
    expect(p.lines).toHaveLength(1);
  });

  it('degrades a null/garbage payload to empty lines', () => {
    expect(parseRecurringPayload(null).lines).toEqual([]);
    expect(parseRecurringPayload('not json').lines).toEqual([]);
    expect(parseRecurringPayload(42).lines).toEqual([]);
  });
});

describe('mapRecurringTemplateRow', () => {
  it('maps schedule + bookkeeping columns and parses the payload', () => {
    const t = mapRecurringTemplateRow({
      id: 'rt-1',
      name: 'Monthly retainer',
      kind: 'invoice',
      frequency: 'monthly',
      interval_count: 1,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      next_run_date: '2026-06-01',
      day_of_month: 1,
      last_run_date: '2026-05-01',
      last_generated_id: 'inv-9',
      occurrences_generated: 5,
      payload: { customerId: 'c1', lines: [{ quantity: 1, unitPrice: 500 }] },
      active: true,
      created_at: '2026-01-01',
      updated_at: '2026-05-01',
    });
    expect(t).toMatchObject({
      id: 'rt-1',
      name: 'Monthly retainer',
      kind: 'invoice',
      frequency: 'monthly',
      intervalCount: 1,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      nextRunDate: '2026-06-01',
      dayOfMonth: 1,
      lastRunDate: '2026-05-01',
      lastGeneratedId: 'inv-9',
      occurrencesGenerated: 5,
      active: true,
    });
    expect((t.payload as RecurringInvoicePayload).customerId).toBe('c1');
    expect(t.payload.lines).toHaveLength(1);
  });

  it('defaults unknown kind/frequency, nulls optional schedule cells, defaults active true', () => {
    const t = mapRecurringTemplateRow({
      id: 'rt-2',
      name: 'Bare',
      kind: 'bogus',
      frequency: 'fortnightly',
      start_date: '2026-01-01',
      next_run_date: '2026-01-01',
    });
    expect(t.kind).toBe('journal');
    expect(t.frequency).toBe('monthly');
    expect(t.intervalCount).toBe(1);
    expect(t.endDate).toBeNull();
    expect(t.dayOfMonth).toBeNull();
    expect(t.lastRunDate).toBeNull();
    expect(t.lastGeneratedId).toBeNull();
    expect(t.occurrencesGenerated).toBe(0);
    expect(t.active).toBe(true);
    expect(t.payload.lines).toEqual([]);
  });
});

// ── Inventory valuation (FIFO) → COGS (B3) ─────────────────────────────────
describe('mapInventoryValuationRow', () => {
  it('maps a v_inventory_valuation row to the camelCase shape', () => {
    const r = mapInventoryValuationRow({
      source_inventory_id: 'inv-9',
      inventory_name: 'M8 Bolt',
      item_id: 'item-7',
      qty_on_hand: 10,
      asset_value: 125,
      avg_unit_cost: 12.5,
      qty_received_total: 40,
      qty_consumed_total: 30,
      cogs_total: 325,
    });
    expect(r).toMatchObject({
      sourceInventoryId: 'inv-9',
      inventoryName: 'M8 Bolt',
      itemId: 'item-7',
      qtyOnHand: 10,
      assetValue: 125,
      avgUnitCost: 12.5,
      qtyReceivedTotal: 40,
      qtyConsumedTotal: 30,
      cogsTotal: 325,
    });
  });

  it('nulls a missing item_id and defaults numeric cells to 0', () => {
    const r = mapInventoryValuationRow({ source_inventory_id: 'inv-1', inventory_name: 'Widget' });
    expect(r.itemId).toBeNull();
    expect(r.qtyOnHand).toBe(0);
    expect(r.assetValue).toBe(0);
    expect(r.avgUnitCost).toBe(0);
    expect(r.qtyReceivedTotal).toBe(0);
    expect(r.qtyConsumedTotal).toBe(0);
    expect(r.cogsTotal).toBe(0);
  });
});

describe('mapInventoryCogsEventRow', () => {
  it('maps an inventory_cogs_events row, tying it to its journal entry', () => {
    const e = mapInventoryCogsEventRow({
      id: 'ev-1',
      item_id: 'item-7',
      journal_entry_id: 'je-cogs-1',
      qty: 30,
      cost: 325,
      consumed_at: '2026-06-01T12:00:00Z',
      job_id: 'job-9',
      source_inventory_id: 'inv-9',
      created_at: '2026-06-01T12:00:01Z',
    });
    expect(e).toMatchObject({
      id: 'ev-1',
      itemId: 'item-7',
      journalEntryId: 'je-cogs-1',
      qty: 30,
      cost: 325,
      consumedAt: '2026-06-01T12:00:00Z',
      jobId: 'job-9',
      sourceInventoryId: 'inv-9',
    });
  });

  it('nulls optional links (item/job/source) on a set-null delete', () => {
    const e = mapInventoryCogsEventRow({
      id: 'ev-2',
      journal_entry_id: 'je-2',
      qty: 1,
      cost: 4,
      consumed_at: '2026-06-01',
      created_at: '2026-06-01',
    });
    expect(e.itemId).toBeNull();
    expect(e.jobId).toBeNull();
    expect(e.sourceInventoryId).toBeNull();
    expect(e.journalEntryId).toBe('je-2');
  });
});

// ── Inventory ↔ Accounting reconciliation & cost sync ─────────────────────────

describe('mapInventoryReconciliationRow', () => {
  it('maps a v_inventory_reconciliation row, including flags and variances', () => {
    const r = mapInventoryReconciliationRow({
      source_inventory_id: 'inv-9',
      inventory_name: 'M8 Bolt',
      unit: 'ea',
      vendor: 'Acme Fasteners',
      in_stock: 10,
      unit_price: 8,
      op_value: 80,
      qty_on_hand: 10,
      asset_value: 50,
      avg_unit_cost: 5,
      qty_variance: 0,
      value_variance: 30,
      pending_reval_amount: 30,
      pending_reval_count: 1,
      uncosted: false,
      null_price: false,
      negative_stock: false,
      qty_mismatch: false,
    });
    expect(r).toMatchObject({
      sourceInventoryId: 'inv-9',
      inventoryName: 'M8 Bolt',
      unit: 'ea',
      vendor: 'Acme Fasteners',
      inStock: 10,
      unitPrice: 8,
      opValue: 80,
      qtyOnHand: 10,
      assetValue: 50,
      avgUnitCost: 5,
      qtyVariance: 0,
      valueVariance: 30,
      pendingRevalAmount: 30,
      pendingRevalCount: 1,
      uncosted: false,
      nullPrice: false,
      negativeStock: false,
      qtyMismatch: false,
    });
  });

  it('keeps a null unit_price null (the null_price flag still narrows to boolean)', () => {
    const r = mapInventoryReconciliationRow({
      source_inventory_id: 'inv-1',
      inventory_name: 'Uncosted item',
      in_stock: 5,
      unit_price: null,
      qty_on_hand: 0,
      null_price: true,
      uncosted: true,
    });
    expect(r.unitPrice).toBeNull();
    expect(r.nullPrice).toBe(true);
    expect(r.uncosted).toBe(true);
    // numeric cells default to 0; unset flags default to false.
    expect(r.opValue).toBe(0);
    expect(r.assetValue).toBe(0);
    expect(r.negativeStock).toBe(false);
    expect(r.qtyMismatch).toBe(false);
  });

  it('coerces stringified numerics from PostgREST (negative stock)', () => {
    const r = mapInventoryReconciliationRow({
      source_inventory_id: 'inv-2',
      inventory_name: 'Backorder',
      in_stock: '-3',
      unit_price: '4',
      qty_variance: '-3',
      value_variance: '-12',
      negative_stock: true,
    });
    expect(r.inStock).toBe(-3);
    expect(r.unitPrice).toBe(4);
    expect(r.qtyVariance).toBe(-3);
    expect(r.valueVariance).toBe(-12);
    expect(r.negativeStock).toBe(true);
  });
});

describe('mapInventoryReconciliationHeaderRow', () => {
  it('maps the header tie row', () => {
    const h = mapInventoryReconciliationHeaderRow({
      total_asset_value: 300,
      total_op_value: 330,
      total_pending_reval: 30,
      gl_1300_balance: 300,
      asset_value_vs_gl_variance: 0,
    });
    expect(h).toEqual({
      totalAssetValue: 300,
      totalOpValue: 330,
      totalPendingReval: 30,
      gl1300Balance: 300,
      assetValueVsGlVariance: 0,
    });
  });

  it('defaults all cells to 0 on an empty row', () => {
    const h = mapInventoryReconciliationHeaderRow({});
    expect(h).toEqual({
      totalAssetValue: 0,
      totalOpValue: 0,
      totalPendingReval: 0,
      gl1300Balance: 0,
      assetValueVsGlVariance: 0,
    });
  });
});

describe('mapInventoryRevaluationRow', () => {
  it('maps an inventory_revaluations row (pending)', () => {
    const r = mapInventoryRevaluationRow({
      id: 'rv-1',
      source_inventory_id: 'inv-9',
      item_id: 'item-7',
      old_cost: 5,
      new_cost: 8,
      on_hand_qty: 10,
      delta_amount: 30,
      status: 'pending',
      journal_entry_id: null,
      reason: 'Manual cost edit',
      enqueued_at: '2026-06-16T10:00:00Z',
      posted_at: null,
      created_by: 'user-1',
      created_at: '2026-06-16T10:00:00Z',
      updated_at: '2026-06-16T10:00:00Z',
    });
    expect(r).toMatchObject({
      id: 'rv-1',
      sourceInventoryId: 'inv-9',
      itemId: 'item-7',
      oldCost: 5,
      newCost: 8,
      onHandQty: 10,
      deltaAmount: 30,
      status: 'pending',
      journalEntryId: null,
      reason: 'Manual cost edit',
      postedAt: null,
      createdBy: 'user-1',
    });
  });

  it('maps a posted row with its journal entry and falls back to pending for an unknown status', () => {
    const posted = mapInventoryRevaluationRow({
      id: 'rv-2',
      source_inventory_id: 'inv-9',
      status: 'posted',
      journal_entry_id: 'je-reval-1',
      posted_at: '2026-06-16T11:00:00Z',
    });
    expect(posted.status).toBe('posted');
    expect(posted.journalEntryId).toBe('je-reval-1');
    expect(posted.postedAt).toBe('2026-06-16T11:00:00Z');

    const weird = mapInventoryRevaluationRow({
      id: 'rv-3',
      source_inventory_id: 'x',
      status: 'zzz',
    });
    expect(weird.status).toBe('pending');
    // numeric cost cells default to 0; optional links null.
    expect(weird.oldCost).toBe(0);
    expect(weird.itemId).toBeNull();
  });
});

describe('mapInventoryPriceHistoryRow', () => {
  it('maps an inventory_price_history row with its source', () => {
    const e = mapInventoryPriceHistoryRow({
      id: 'ph-1',
      inventory_id: 'inv-9',
      old_price: 5,
      new_price: 8,
      change_amount: 3,
      source: 'manual',
      user_id: 'user-1',
      reason: 'Vendor increase',
      created_at: '2026-06-16T10:00:00Z',
    });
    expect(e).toEqual({
      id: 'ph-1',
      inventoryId: 'inv-9',
      oldPrice: 5,
      newPrice: 8,
      changeAmount: 3,
      source: 'manual',
      userId: 'user-1',
      reason: 'Vendor increase',
      createdAt: '2026-06-16T10:00:00Z',
    });
  });

  it('keeps a null old_price null (first-ever price) and narrows an unknown source to manual', () => {
    const e = mapInventoryPriceHistoryRow({
      id: 'ph-2',
      inventory_id: 'inv-9',
      old_price: null,
      new_price: 8,
      change_amount: 8,
      source: 'not-a-source',
      created_at: '2026-06-16T10:00:00Z',
    });
    expect(e.oldPrice).toBeNull();
    expect(e.newPrice).toBe(8);
    expect(e.source).toBe('manual');
    expect(e.userId).toBeNull();
    expect(e.reason).toBeNull();
  });

  it('preserves each valid source label (bill / seed / reval)', () => {
    expect(mapInventoryPriceHistoryRow({ source: 'bill' }).source).toBe('bill');
    expect(mapInventoryPriceHistoryRow({ source: 'seed' }).source).toBe('seed');
    expect(mapInventoryPriceHistoryRow({ source: 'reval' }).source).toBe('reval');
  });
});

// ── Budgeting & forecasting (D2) ──────────────────────────────────────────────

describe('mapBudgetRow', () => {
  it('maps an accounting.budgets row to the camelCase Budget shape', () => {
    const b = mapBudgetRow({
      id: 'bud-1',
      name: 'FY2026 Operating',
      fiscal_year: 2026,
      status: 'active',
      description: 'Annual operating plan',
      created_by: 'user-1',
      created_at: '2026-01-01',
      updated_at: '2026-01-02',
    });
    expect(b).toEqual({
      id: 'bud-1',
      name: 'FY2026 Operating',
      fiscalYear: 2026,
      status: 'active',
      description: 'Annual operating plan',
      createdBy: 'user-1',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-02',
    });
  });

  it('defaults an unknown status to draft and nulls optional fields', () => {
    const b = mapBudgetRow({ id: 'bud-2', name: 'Plan', fiscal_year: 2027, status: 'frozen' });
    expect(b.status).toBe('draft');
    expect(b.description).toBeNull();
    expect(b.createdBy).toBeNull();
    expect(b.fiscalYear).toBe(2027);
  });

  it('coerces a numeric-string fiscal_year', () => {
    expect(mapBudgetRow({ id: 'b', name: 'n', fiscal_year: '2025' }).fiscalYear).toBe(2025);
  });
});

describe('mapBudgetLineRow', () => {
  it('maps a budget_lines row (period_month + amount) to the camelCase shape', () => {
    const l = mapBudgetLineRow({
      id: 'bl-1',
      budget_id: 'bud-1',
      account_id: 'acc-1',
      period_month: 3,
      amount: 1500.5,
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    });
    expect(l).toMatchObject({
      id: 'bl-1',
      budgetId: 'bud-1',
      accountId: 'acc-1',
      periodMonth: 3,
      amount: 1500.5,
    });
    // No joined account → display fields are undefined (not present).
    expect(l.accountName).toBeUndefined();
    expect(l.accountNumber).toBeUndefined();
  });

  it('hydrates account name/number from a joined accounts row', () => {
    const l = mapBudgetLineRow({
      id: 'bl-2',
      budget_id: 'bud-1',
      account_id: 'acc-2',
      period_month: 12,
      amount: 0,
      account: { id: 'acc-2', name: 'Office Supplies', account_number: '6100' },
    });
    expect(l.accountName).toBe('Office Supplies');
    expect(l.accountNumber).toBe('6100');
    expect(l.amount).toBe(0);
  });

  it('defaults a missing amount to 0', () => {
    const l = mapBudgetLineRow({ id: 'bl-3', budget_id: 'b', account_id: 'a', period_month: 1 });
    expect(l.amount).toBe(0);
  });
});

// ── Fixed assets & depreciation (D3) ──────────────────────────────────────────
describe('mapFixedAssetRow', () => {
  it('maps a fixed_assets row to the camelCase domain shape', () => {
    const a = mapFixedAssetRow({
      id: 'fa-1',
      name: 'Delivery Van',
      asset_account_id: 'acc-1500',
      accum_depr_account_id: 'acc-1510',
      depr_expense_account_id: 'acc-6000',
      cost: 10000,
      salvage_value: 1000,
      useful_life_months: 60,
      method: 'straight_line',
      in_service_date: '2026-01-15',
      status: 'active',
      created_by: 'user-1',
      created_at: '2026-01-01',
      updated_at: '2026-01-02',
    });
    expect(a).toMatchObject({
      id: 'fa-1',
      name: 'Delivery Van',
      assetAccountId: 'acc-1500',
      accumDeprAccountId: 'acc-1510',
      deprExpenseAccountId: 'acc-6000',
      cost: 10000,
      salvageValue: 1000,
      usefulLifeMonths: 60,
      method: 'straight_line',
      inServiceDate: '2026-01-15',
      status: 'active',
      createdBy: 'user-1',
    });
  });

  it('narrows an unknown method/status to the safe defaults', () => {
    const a = mapFixedAssetRow({
      id: 'fa-2',
      name: 'Mystery',
      asset_account_id: 'a',
      accum_depr_account_id: 'b',
      depr_expense_account_id: 'c',
      cost: 1,
      salvage_value: 0,
      useful_life_months: 12,
      method: 'sum_of_years',
      status: 'haunted',
      in_service_date: '2026-01-01',
    });
    expect(a.method).toBe('straight_line');
    expect(a.status).toBe('active');
  });

  it('accepts the declining_balance method verbatim', () => {
    const a = mapFixedAssetRow({
      id: 'fa-3',
      name: 'Press',
      asset_account_id: 'a',
      accum_depr_account_id: 'b',
      depr_expense_account_id: 'c',
      cost: 5000,
      salvage_value: 0,
      useful_life_months: 36,
      method: 'declining_balance',
      status: 'disposed',
      in_service_date: '2025-06-01',
    });
    expect(a.method).toBe('declining_balance');
    expect(a.status).toBe('disposed');
  });
});

describe('mapDepreciationScheduleRow', () => {
  it('maps a planned (unposted) schedule row', () => {
    const r = mapDepreciationScheduleRow({
      id: 's-1',
      fixed_asset_id: 'fa-1',
      period_date: '2026-01-31',
      amount: 1285.71,
      journal_entry_id: null,
      posted: false,
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    });
    expect(r).toMatchObject({
      id: 's-1',
      fixedAssetId: 'fa-1',
      periodDate: '2026-01-31',
      amount: 1285.71,
      journalEntryId: null,
      posted: false,
    });
  });

  it('maps a posted schedule row carrying its journal entry', () => {
    const r = mapDepreciationScheduleRow({
      id: 's-2',
      fixed_asset_id: 'fa-1',
      period_date: '2026-02-28',
      amount: 1285.71,
      journal_entry_id: 'je-9',
      posted: true,
    });
    expect(r.journalEntryId).toBe('je-9');
    expect(r.posted).toBe(true);
  });
});

describe('mapFixedAssetRegisterRow', () => {
  it('maps a v_fixed_asset_register row with accumulated depreciation + NBV', () => {
    const r = mapFixedAssetRegisterRow({
      id: 'fa-1',
      name: 'Delivery Van',
      asset_account_id: 'acc-1500',
      accum_depr_account_id: 'acc-1510',
      depr_expense_account_id: 'acc-6000',
      cost: 10000,
      salvage_value: 1000,
      useful_life_months: 7,
      method: 'straight_line',
      in_service_date: '2026-01-15',
      status: 'active',
      accumulated_depreciation: 1285.71,
      periods_posted: 1,
      net_book_value: 8714.29,
      remaining_planned: 7714.29,
      periods_remaining: 6,
    });
    expect(r).toMatchObject({
      id: 'fa-1',
      cost: 10000,
      salvageValue: 1000,
      accumulatedDepreciation: 1285.71,
      periodsPosted: 1,
      netBookValue: 8714.29,
      remainingPlanned: 7714.29,
      periodsRemaining: 6,
      status: 'active',
      method: 'straight_line',
    });
  });

  it('defaults the aggregate columns to 0 when the asset has no schedule yet', () => {
    const r = mapFixedAssetRegisterRow({
      id: 'fa-2',
      name: 'New Asset',
      asset_account_id: 'a',
      accum_depr_account_id: 'b',
      depr_expense_account_id: 'c',
      cost: 500,
      salvage_value: 0,
      useful_life_months: 12,
      method: 'straight_line',
      in_service_date: '2026-06-01',
      status: 'active',
    });
    expect(r.accumulatedDepreciation).toBe(0);
    expect(r.periodsPosted).toBe(0);
    expect(r.remainingPlanned).toBe(0);
    expect(r.periodsRemaining).toBe(0);
    expect(r.netBookValue).toBe(0);
  });
});

// ── Custom fields (D4) ─────────────────────────────────────────────────────────

describe('parseCustomFieldOptions', () => {
  it('passes through a clean pre-parsed array (label defaults to value)', () => {
    expect(parseCustomFieldOptions([{ value: 'hi', label: 'High' }, { value: 'lo' }])).toEqual([
      { value: 'hi', label: 'High' },
      { value: 'lo', label: 'lo' },
    ]);
  });
  it('parses a stringified jsonb array', () => {
    expect(parseCustomFieldOptions('[{"value":"a","label":"Apple"}]')).toEqual([
      { value: 'a', label: 'Apple' },
    ]);
  });
  it('drops malformed entries and degrades garbage to []', () => {
    expect(parseCustomFieldOptions([{ value: '' }, null, 42, { label: 'noval' }])).toEqual([]);
    expect(parseCustomFieldOptions('not json')).toEqual([]);
    expect(parseCustomFieldOptions(null)).toEqual([]);
    expect(parseCustomFieldOptions({})).toEqual([]);
  });
});

describe('parseCustomFieldValueJson', () => {
  it('passes through scalar boxes verbatim', () => {
    expect(parseCustomFieldValueJson('hello')).toBe('hello');
    expect(parseCustomFieldValueJson(42)).toBe(42);
    expect(parseCustomFieldValueJson(true)).toBe(true);
    expect(parseCustomFieldValueJson(false)).toBe(false);
    expect(parseCustomFieldValueJson(0)).toBe(0);
  });
  it('treats null/undefined and non-scalar values as unset (null)', () => {
    expect(parseCustomFieldValueJson(null)).toBeNull();
    expect(parseCustomFieldValueJson(undefined)).toBeNull();
    expect(parseCustomFieldValueJson({ a: 1 })).toBeNull();
    expect(parseCustomFieldValueJson([1, 2])).toBeNull();
  });
  it('unwraps a stray JSON-encoded scalar string', () => {
    expect(parseCustomFieldValueJson('"quoted"')).toBe('quoted');
    expect(parseCustomFieldValueJson('true')).toBe(true);
    expect(parseCustomFieldValueJson('123')).toBe(123);
  });
});

describe('mapCustomFieldDefRow', () => {
  it('maps snake_case columns + jsonb options to the camelCase domain shape', () => {
    const d = mapCustomFieldDefRow({
      id: 'cfd-1',
      entity_type: 'invoice',
      key: 'po_number',
      label: 'PO Number',
      data_type: 'select',
      options: [
        { value: 'a', label: 'Alpha' },
        { value: 'b', label: 'Beta' },
      ],
      help_text: 'Buyer purchase-order ref',
      sort_order: 3,
      active: true,
      created_by: 'user-1',
      created_at: '2026-01-01',
      updated_at: '2026-01-02',
    });
    expect(d).toMatchObject({
      id: 'cfd-1',
      entityType: 'invoice',
      key: 'po_number',
      label: 'PO Number',
      dataType: 'select',
      helpText: 'Buyer purchase-order ref',
      sortOrder: 3,
      active: true,
      createdBy: 'user-1',
    });
    expect(d.options).toEqual([
      { value: 'a', label: 'Alpha' },
      { value: 'b', label: 'Beta' },
    ]);
  });

  it('defaults active=true, options=[], and narrows an unknown entity/data type', () => {
    const d = mapCustomFieldDefRow({
      id: 'cfd-2',
      entity_type: 'nonsense',
      key: 'k',
      label: 'L',
      data_type: 'bogus',
    });
    expect(d.active).toBe(true);
    expect(d.options).toEqual([]);
    expect(d.entityType).toBe('invoice'); // fallback
    expect(d.dataType).toBe('text'); // fallback
    expect(d.helpText).toBeNull();
    expect(d.sortOrder).toBe(0);
  });
});

describe('mapCustomFieldValueRow', () => {
  it('maps a boxed value row, narrowing entity_type', () => {
    const v = mapCustomFieldValueRow({
      id: 'cfv-1',
      def_id: 'cfd-1',
      entity_type: 'bill',
      entity_id: 'bill-9',
      value: 1234,
      created_by: 'user-1',
      created_at: '2026-01-01',
      updated_at: '2026-01-02',
    });
    expect(v).toMatchObject({
      id: 'cfv-1',
      defId: 'cfd-1',
      entityType: 'bill',
      entityId: 'bill-9',
      value: 1234,
      createdBy: 'user-1',
    });
  });

  it('maps an unset (null) value', () => {
    const v = mapCustomFieldValueRow({
      id: 'cfv-2',
      def_id: 'cfd-1',
      entity_type: 'customer',
      entity_id: 'cust-1',
      value: null,
    });
    expect(v.value).toBeNull();
    expect(v.entityType).toBe('customer');
  });
});

// ── Tax agencies & filing calendar (C1) ──────────────────────────────────────

describe('mapTaxAgencyRow', () => {
  it('maps snake_case columns and takes the combined rate override', () => {
    const a = mapTaxAgencyRow(
      {
        id: 'cdtfa',
        name: 'CDTFA',
        liability_account_id: 'acct-2200',
        filing_frequency: 'quarterly',
        created_at: '2026-01-01',
      },
      0.095
    );
    expect(a).toMatchObject({
      id: 'cdtfa',
      name: 'CDTFA',
      liabilityAccountId: 'acct-2200',
      filingFrequency: 'quarterly',
      rate: 0.095,
      createdAt: '2026-01-01',
    });
  });

  it('falls back to the row rate when no override is given', () => {
    const a = mapTaxAgencyRow({ id: 'x', name: 'X', rate: 0.05 });
    expect(a.rate).toBe(0.05);
  });

  it('null-coerces a missing liability account and rejects an invalid frequency', () => {
    const a = mapTaxAgencyRow({
      id: 'x',
      name: 'X',
      liability_account_id: null,
      filing_frequency: 'weekly',
    });
    expect(a.liabilityAccountId).toBeNull();
    expect(a.filingFrequency).toBeNull();
  });
});

describe('parseTaxFilingRules', () => {
  it('parses the seeded CDTFA calendar array to camelCase rules', () => {
    const rules = parseTaxFilingRules([
      {
        agency: 'CDTFA',
        frequency: 'quarterly',
        period_basis: 'calendar',
        due_day: 31,
        due_month_offset: 1,
        notes: 'CA sales & use tax.',
      },
    ]);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toEqual({
      agency: 'CDTFA',
      frequency: 'quarterly',
      periodBasis: 'calendar',
      dueDay: 31,
      dueMonthOffset: 1,
      notes: 'CA sales & use tax.',
    });
  });

  it('parses a stringified JSON array (defensive) and defaults missing fields', () => {
    const rules = parseTaxFilingRules(JSON.stringify([{ agency: 'CDTFA' }]));
    expect(rules[0]).toMatchObject({
      agency: 'CDTFA',
      frequency: 'quarterly', // default
      periodBasis: 'calendar',
      dueDay: 31, // default
      dueMonthOffset: 1, // default
      notes: null,
    });
  });

  it('drops rules with no agency name and normalizes an invalid frequency', () => {
    const rules = parseTaxFilingRules([
      { agency: '', frequency: 'monthly' }, // dropped (no name)
      { agency: 'Other', frequency: 'biweekly', due_day: 15, due_month_offset: 0 }, // freq → quarterly
    ]);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      agency: 'Other',
      frequency: 'quarterly',
      dueDay: 15,
      dueMonthOffset: 0,
    });
  });

  it('returns [] for null / non-array / garbage', () => {
    expect(parseTaxFilingRules(null)).toEqual([]);
    expect(parseTaxFilingRules('not json')).toEqual([]);
    expect(parseTaxFilingRules({ not: 'an array' })).toEqual([]);
    expect(parseTaxFilingRules(42)).toEqual([]);
  });
});

// ── TAX-SYNC mappers (migration 022) ──────────────────────────────────────────────────

describe('mapTaxTableSourceRow', () => {
  it('maps a seeded source (snake_case → camelCase)', () => {
    const s = mapTaxTableSourceRow({
      id: 'src-1',
      name: 'CDTFA — CA Sales & Use Tax',
      kind: 'sales',
      jurisdiction: 'CA',
      url: 'https://cdtfa.ca.gov/taxes-and-fees/sales-use-tax-rates.htm',
      official_file_url: 'https://cdtfa.ca.gov/dataportal/dataset.htm?url=SalesTaxRates',
      check_frequency_days: 90,
      active: true,
      last_checked_at: null,
      created_at: '2026-06-01T00:00:00Z',
      updated_at: '2026-06-01T00:00:00Z',
    });
    expect(s).toEqual({
      id: 'src-1',
      name: 'CDTFA — CA Sales & Use Tax',
      kind: 'sales',
      jurisdiction: 'CA',
      url: 'https://cdtfa.ca.gov/taxes-and-fees/sales-use-tax-rates.htm',
      officialFileUrl: 'https://cdtfa.ca.gov/dataportal/dataset.htm?url=SalesTaxRates',
      checkFrequencyDays: 90,
      active: true,
      lastCheckedAt: null,
      createdAt: '2026-06-01T00:00:00Z',
      updatedAt: '2026-06-01T00:00:00Z',
    });
  });

  it('defaults an unknown kind to "sales", frequency to 90, and treats missing active as true', () => {
    const s = mapTaxTableSourceRow({ id: 'x', name: 'X', kind: 'weird' });
    expect(s.kind).toBe('sales');
    expect(s.checkFrequencyDays).toBe(90);
    expect(s.active).toBe(true);
    expect(s.jurisdiction).toBeNull();
    expect(s.officialFileUrl).toBeNull();
    expect(s.lastCheckedAt).toBeNull();
  });

  it('keeps a payroll kind and a false active flag', () => {
    const s = mapTaxTableSourceRow({ id: 'x', name: 'EDD', kind: 'payroll', active: false });
    expect(s.kind).toBe('payroll');
    expect(s.active).toBe(false);
  });
});

describe('parseTaxTableSnapshotParsed', () => {
  it('normalizes each entry and preserves extra parser keys', () => {
    const parsed = parseTaxTableSnapshotParsed([
      { jurisdiction: 'CA', rate: 0.0725, effective_date: '2026-07-01', county: 'Statewide' },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      jurisdiction: 'CA',
      rate: 0.0725,
      effectiveDate: '2026-07-01',
      county: 'Statewide', // extra key kept verbatim
    });
  });

  it('coerces a numeric-string rate and nulls a non-numeric one', () => {
    const parsed = parseTaxTableSnapshotParsed([
      { jurisdiction: 'A', rate: '0.05' },
      { jurisdiction: 'B', rate: 'n/a' },
    ]);
    expect(parsed[0].rate).toBe(0.05);
    expect(parsed[1].rate).toBeNull();
  });

  it('parses a stringified array and degrades garbage / null to []', () => {
    expect(parseTaxTableSnapshotParsed('[{"jurisdiction":"A","rate":0.01}]')[0].rate).toBe(0.01);
    expect(parseTaxTableSnapshotParsed(null)).toEqual([]);
    expect(parseTaxTableSnapshotParsed('{bad json')).toEqual([]);
    expect(parseTaxTableSnapshotParsed({ not: 'array' })).toEqual([]);
  });
});

describe('mapTaxTableSnapshotRow', () => {
  it('maps a successful snapshot and parses its payload', () => {
    const snap = mapTaxTableSnapshotRow({
      id: 'snap-1',
      source_id: 'src-1',
      fetched_at: '2026-07-01T06:00:00Z',
      content_hash: 'abc123',
      parsed: [{ jurisdiction: 'CA', rate: 0.0725, effective_date: '2026-07-01' }],
      raw: 'jurisdiction,rate\nCA,0.0725',
      error: null,
      created_at: '2026-07-01T06:00:00Z',
    });
    expect(snap.id).toBe('snap-1');
    expect(snap.sourceId).toBe('src-1');
    expect(snap.contentHash).toBe('abc123');
    expect(snap.parsed).toHaveLength(1);
    expect(snap.parsed[0].rate).toBe(0.0725);
    expect(snap.raw).toContain('0.0725');
    expect(snap.error).toBeNull();
  });

  it('maps a failed pull (error recorded, parsed empty) — fail-safe', () => {
    const snap = mapTaxTableSnapshotRow({
      id: 'snap-2',
      source_id: 'src-1',
      fetched_at: '2026-07-01T06:00:00Z',
      content_hash: null,
      parsed: null,
      raw: null,
      error: 'HTTP 503 from CDTFA',
      created_at: '2026-07-01T06:00:00Z',
    });
    expect(snap.error).toBe('HTTP 503 from CDTFA');
    expect(snap.parsed).toEqual([]);
    expect(snap.contentHash).toBeNull();
    expect(snap.raw).toBeNull();
  });

  it('maps a list-read row that omitted the raw column (raw → null)', () => {
    const snap = mapTaxTableSnapshotRow({
      id: 'snap-3',
      source_id: 'src-1',
      fetched_at: '2026-07-01T06:00:00Z',
      content_hash: 'h',
      parsed: [],
      error: null,
      created_at: '2026-07-01T06:00:00Z',
    });
    expect(snap.raw).toBeNull();
  });
});

describe('mapTaxTableDriftRow', () => {
  it('maps a drift row, normalizes its diff, and hydrates the embedded source', () => {
    const d = mapTaxTableDriftRow({
      id: 'drift-1',
      source_id: 'src-1',
      snapshot_id: 'snap-1',
      detected_at: '2026-07-01T06:00:00Z',
      diff: [
        {
          rate_name: 'CA Statewide Base',
          jurisdiction: 'state',
          current_rate: 0.0725,
          new_rate: 0.0775,
          effective_date: '2026-07-01',
          label: 'rate up',
        },
      ],
      severity: 'warning',
      status: 'open',
      reviewed_by: null,
      reviewed_at: null,
      created_at: '2026-07-01T06:00:00Z',
      updated_at: '2026-07-01T06:00:00Z',
      source: { name: 'CDTFA — CA Sales & Use Tax', kind: 'sales' },
    });
    expect(d.id).toBe('drift-1');
    expect(d.snapshotId).toBe('snap-1');
    expect(d.severity).toBe('warning');
    expect(d.status).toBe('open');
    expect(d.diff).toHaveLength(1);
    expect(d.diff[0]).toMatchObject({
      rateName: 'CA Statewide Base',
      currentRate: 0.0725,
      newRate: 0.0775,
      effectiveDate: '2026-07-01',
    });
    expect(d.sourceName).toBe('CDTFA — CA Sales & Use Tax');
    expect(d.sourceKind).toBe('sales');
  });

  it('defaults an unknown severity/status, and leaves source fields undefined without an embed', () => {
    const d = mapTaxTableDriftRow({
      id: 'drift-2',
      source_id: 'src-1',
      detected_at: '2026-07-01T06:00:00Z',
      diff: null,
      severity: 'apocalyptic', // invalid → 'warning'
      status: 'frozen', // invalid → 'open'
      created_at: '2026-07-01T06:00:00Z',
      updated_at: '2026-07-01T06:00:00Z',
    });
    expect(d.severity).toBe('warning');
    expect(d.status).toBe('open');
    expect(d.diff).toEqual([]); // null diff → []
    expect(d.snapshotId).toBeNull();
    expect(d.sourceName).toBeUndefined();
    expect(d.sourceKind).toBeUndefined();
  });

  it('carries a terminal status + reviewer through', () => {
    const d = mapTaxTableDriftRow({
      id: 'drift-3',
      source_id: 'src-1',
      detected_at: '2026-07-01T06:00:00Z',
      diff: [],
      severity: 'critical',
      status: 'applied',
      reviewed_by: 'user-9',
      reviewed_at: '2026-07-02T10:00:00Z',
      created_at: '2026-07-01T06:00:00Z',
      updated_at: '2026-07-02T10:00:00Z',
    });
    expect(d.status).toBe('applied');
    expect(d.severity).toBe('critical');
    expect(d.reviewedBy).toBe('user-9');
    expect(d.reviewedAt).toBe('2026-07-02T10:00:00Z');
  });
});

describe('mapTaxRateRow', () => {
  it('maps an active stored rate (no updated_at column on tax_rates)', () => {
    const r = mapTaxRateRow({
      id: 'rate-1',
      name: 'CA Statewide Base',
      rate: 0.0725,
      jurisdiction: 'state',
      effective_date: '2025-01-01',
      end_date: null,
      is_active: true,
      created_at: '2026-06-01T00:00:00Z',
    });
    expect(r).toEqual({
      id: 'rate-1',
      name: 'CA Statewide Base',
      rate: 0.0725,
      jurisdiction: 'state',
      effectiveDate: '2025-01-01',
      endDate: null,
      isActive: true,
      createdAt: '2026-06-01T00:00:00Z',
    });
  });

  it('coerces a numeric-string rate and treats missing is_active as true', () => {
    const r = mapTaxRateRow({ id: 'x', name: 'X', rate: '0.0225' });
    expect(r.rate).toBe(0.0225);
    expect(r.isActive).toBe(true);
    expect(r.jurisdiction).toBeNull();
  });
});

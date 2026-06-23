import { describe, it, expect } from 'vitest';
import {
  assertBalanced,
  billLineNetCents,
  buildBankTransactionJournalLines,
  buildBillExpenseJournalLines,
  buildCogsJournalLines,
  buildDepreciationJournalLines,
  buildInvoiceRevenueJournalLines,
  buildPaymentJournalLines,
  buildVendorPaymentJournalLines,
  computeBillTotals,
  computeInvoiceTotals,
  computeReconciliationSummary,
  journalLinesEquivalent,
  lineNetCents,
} from './posting';
import { toCents } from './accountingViewModel';
import type { DefaultAccounts, NewBillLineInput, NewInvoiceLineInput } from './types';

const ACCOUNTS: DefaultAccounts = {
  cash: 'acc-cash',
  undepositedFunds: 'acc-undeposited',
  accountsReceivable: 'acc-ar',
  retainageReceivable: 'acc-retainage',
  inventoryAsset: 'acc-inv',
  accountsPayable: 'acc-ap',
  salesTaxPayable: 'acc-tax',
  salesIncome: 'acc-sales',
  serviceIncome: 'acc-service',
  cogs: 'acc-cogs',
  operatingExpenses: 'acc-opex',
  fixedAsset: 'acc-fixed',
  accumulatedDepreciation: 'acc-accum-depr',
  depreciationExpense: 'acc-depr-exp',
  openingBalanceEquity: 'acc-obe',
  uncategorizedIncome: 'acc-uninc',
  uncategorizedExpense: 'acc-unexp',
  paymentProcessorClearing: 'acc-ppc',
};

const sumDebit = (lines: { debit: number }[]) => lines.reduce((s, l) => s + toCents(l.debit), 0);
const sumCredit = (lines: { credit: number }[]) => lines.reduce((s, l) => s + toCents(l.credit), 0);

describe('lineNetCents', () => {
  it('uses quantity * unitPrice minus discount', () => {
    expect(lineNetCents({ quantity: 3, unitPrice: 10, discount: 5 })).toBe(2500);
  });
  it('takes an explicit lineTotal as the net amount', () => {
    expect(lineNetCents({ quantity: 1, unitPrice: 0, lineTotal: 123.45 })).toBe(12345);
  });
  it('never returns negative', () => {
    expect(lineNetCents({ quantity: 1, unitPrice: 1, discount: 100 })).toBe(0);
  });
});

describe('computeInvoiceTotals', () => {
  const rate = (id: string | null | undefined) => (id === 'tax-7.25' ? 0.0725 : 0);

  it('sums net lines and applies per-line tax', () => {
    const lines: NewInvoiceLineInput[] = [
      { quantity: 1, unitPrice: 100, taxable: true },
      { quantity: 2, unitPrice: 50, taxable: true },
    ];
    const totals = computeInvoiceTotals({
      lines,
      defaultIncomeAccountId: 'acc-sales',
      headerTaxCodeId: 'tax-7.25',
      taxRateByCode: rate,
    });
    expect(totals.subtotalCents).toBe(20000); // 100 + 100
    expect(totals.taxCents).toBe(1450); // 7.25% of 200
    expect(totals.totalCents).toBe(21450);
  });

  it('does not tax non-taxable lines', () => {
    const totals = computeInvoiceTotals({
      lines: [{ quantity: 1, unitPrice: 100, taxable: false }],
      defaultIncomeAccountId: 'acc-sales',
      headerTaxCodeId: 'tax-7.25',
      taxRateByCode: rate,
    });
    expect(totals.taxCents).toBe(0);
    expect(totals.totalCents).toBe(10000);
  });

  it('does not tax when the customer is tax-exempt', () => {
    const totals = computeInvoiceTotals({
      lines: [{ quantity: 1, unitPrice: 100, taxable: true }],
      defaultIncomeAccountId: 'acc-sales',
      headerTaxCodeId: 'tax-7.25',
      taxRateByCode: rate,
      taxExempt: true,
    });
    expect(totals.taxCents).toBe(0);
  });

  it('assigns a line its own income account when present', () => {
    const totals = computeInvoiceTotals({
      lines: [{ quantity: 1, unitPrice: 100, incomeAccountId: 'acc-service' }],
      defaultIncomeAccountId: 'acc-sales',
      taxRateByCode: () => 0,
    });
    expect(totals.lines[0].incomeAccountId).toBe('acc-service');
  });

  it('ignores the header discount on a line carrying an explicit lineTotal', () => {
    // lineTotal is already net-of-discount (lineNetCents takes it verbatim), so a
    // stray discount must NOT inflate discountCents or change the total.
    const totals = computeInvoiceTotals({
      lines: [{ quantity: 1, unitPrice: 0, lineTotal: 200, discount: 50, taxable: true }],
      defaultIncomeAccountId: 'acc-sales',
      headerTaxCodeId: 'tax-7.25',
      taxRateByCode: rate,
    });
    expect(totals.subtotalCents).toBe(20000);
    expect(totals.discountCents).toBe(0); // explicit lineTotal forces zero header discount
    expect(totals.taxCents).toBe(1450); // 7.25% of 200
    expect(totals.totalCents).toBe(totals.subtotalCents + totals.taxCents);
  });
});

describe('buildInvoiceRevenueJournalLines', () => {
  it('posts a balanced Dr AR / Cr Sales / Cr Sales Tax entry', () => {
    const totals = computeInvoiceTotals({
      lines: [{ quantity: 1, unitPrice: 100, taxable: true }],
      defaultIncomeAccountId: 'acc-sales',
      headerTaxCodeId: 'tax',
      taxRateByCode: () => 0.085,
    });
    const result = buildInvoiceRevenueJournalLines(totals, ACCOUNTS, { customerId: 'cust-1' });

    // Dr AR 108.50 / Cr Sales 100.00 / Cr Sales Tax 8.50
    expect(sumDebit(result.lines)).toBe(sumCredit(result.lines));
    expect(result.total).toBe(108.5);
    expect(result.subtotal).toBe(100);
    expect(result.taxTotal).toBe(8.5);

    const ar = result.lines.find((l) => l.accountId === 'acc-ar');
    const sales = result.lines.find((l) => l.accountId === 'acc-sales');
    const tax = result.lines.find((l) => l.accountId === 'acc-tax');
    expect(ar?.debit).toBe(108.5);
    expect(sales?.credit).toBe(100);
    expect(tax?.credit).toBe(8.5);
    // every line carries the customer dimension
    expect(result.lines.every((l) => l.customerId === 'cust-1')).toBe(true);
  });

  it('omits the tax line when there is no tax', () => {
    const totals = computeInvoiceTotals({
      lines: [{ quantity: 1, unitPrice: 250, taxable: false }],
      defaultIncomeAccountId: 'acc-sales',
      taxRateByCode: () => 0,
    });
    const result = buildInvoiceRevenueJournalLines(totals, ACCOUNTS);
    expect(result.lines).toHaveLength(2);
    expect(result.lines.some((l) => l.accountId === 'acc-tax')).toBe(false);
    expect(sumDebit(result.lines)).toBe(sumCredit(result.lines));
  });

  it('groups credits by income account for a multi-account invoice', () => {
    const totals = computeInvoiceTotals({
      lines: [
        { quantity: 1, unitPrice: 100, incomeAccountId: 'acc-sales', taxable: false },
        { quantity: 1, unitPrice: 40, incomeAccountId: 'acc-service', taxable: false },
        { quantity: 1, unitPrice: 60, incomeAccountId: 'acc-sales', taxable: false },
      ],
      defaultIncomeAccountId: 'acc-sales',
      taxRateByCode: () => 0,
    });
    const result = buildInvoiceRevenueJournalLines(totals, ACCOUNTS);
    const salesCredit = result.lines.filter((l) => l.accountId === 'acc-sales');
    const serviceCredit = result.lines.filter((l) => l.accountId === 'acc-service');
    expect(salesCredit).toHaveLength(1); // 100 + 60 merged
    expect(salesCredit[0].credit).toBe(160);
    expect(serviceCredit[0].credit).toBe(40);
    expect(sumDebit(result.lines)).toBe(sumCredit(result.lines));
  });

  it('rejects a zero-total invoice', () => {
    const totals = computeInvoiceTotals({
      lines: [{ quantity: 1, unitPrice: 0 }],
      defaultIncomeAccountId: 'acc-sales',
      taxRateByCode: () => 0,
    });
    expect(() => buildInvoiceRevenueJournalLines(totals, ACCOUNTS)).toThrow(/zero or negative/i);
  });

  it('throws when AR is not configured', () => {
    const totals = computeInvoiceTotals({
      lines: [{ quantity: 1, unitPrice: 100, taxable: false }],
      defaultIncomeAccountId: 'acc-sales',
      taxRateByCode: () => 0,
    });
    expect(() =>
      buildInvoiceRevenueJournalLines(totals, { ...ACCOUNTS, accountsReceivable: null })
    ).toThrow(/Accounts Receivable/i);
  });

  it('does not drift on a repeating-decimal tax (3 x $33.33 @ 7.25%)', () => {
    const totals = computeInvoiceTotals({
      lines: [
        { quantity: 1, unitPrice: 33.33, taxable: true },
        { quantity: 1, unitPrice: 33.33, taxable: true },
        { quantity: 1, unitPrice: 33.33, taxable: true },
      ],
      defaultIncomeAccountId: 'acc-sales',
      headerTaxCodeId: 'tax',
      taxRateByCode: () => 0.0725,
    });
    const result = buildInvoiceRevenueJournalLines(totals, ACCOUNTS);
    expect(sumDebit(result.lines)).toBe(sumCredit(result.lines));
  });
});

describe('buildPaymentJournalLines', () => {
  it('posts a balanced Dr deposit / Cr AR entry', () => {
    const lines = buildPaymentJournalLines({
      amount: 108.5,
      depositAccountId: 'acc-undeposited',
      accountsReceivableId: 'acc-ar',
      applications: [{ invoiceId: 'inv-1', amountApplied: 108.5 }],
      customerId: 'cust-1',
    });
    expect(lines).toHaveLength(2);
    expect(sumDebit(lines)).toBe(sumCredit(lines));
    const deposit = lines.find((l) => l.accountId === 'acc-undeposited');
    const ar = lines.find((l) => l.accountId === 'acc-ar');
    expect(deposit?.debit).toBe(108.5);
    expect(ar?.credit).toBe(108.5);
    expect(lines.every((l) => l.customerId === 'cust-1')).toBe(true);
  });

  it('sums multiple applications to the AR credit', () => {
    const lines = buildPaymentJournalLines({
      amount: 150,
      depositAccountId: 'acc-cash',
      accountsReceivableId: 'acc-ar',
      applications: [
        { invoiceId: 'inv-1', amountApplied: 100 },
        { invoiceId: 'inv-2', amountApplied: 50 },
      ],
    });
    expect(sumDebit(lines)).toBe(15000);
    expect(sumCredit(lines)).toBe(15000);
  });

  it('rejects when applied total does not equal the payment amount', () => {
    expect(() =>
      buildPaymentJournalLines({
        amount: 100,
        depositAccountId: 'acc-cash',
        accountsReceivableId: 'acc-ar',
        applications: [{ invoiceId: 'inv-1', amountApplied: 90 }],
      })
    ).toThrow(/equal the payment amount/i);
  });

  it('rejects a non-positive amount', () => {
    expect(() =>
      buildPaymentJournalLines({
        amount: 0,
        depositAccountId: 'acc-cash',
        accountsReceivableId: 'acc-ar',
        applications: [],
      })
    ).toThrow(/greater than zero/i);
  });
});

// ── AP side (A2): bills & vendor payments ────────────────────────────────────

describe('billLineNetCents', () => {
  it('uses quantity * unitCost', () => {
    expect(billLineNetCents({ quantity: 10, unitCost: 4.5 })).toBe(4500);
  });
  it('takes an explicit lineTotal as the extended amount', () => {
    expect(billLineNetCents({ quantity: 1, unitCost: 0, lineTotal: 1200.5 })).toBe(120050);
  });
  it('never returns negative', () => {
    expect(billLineNetCents({ quantity: 1, unitCost: -5 })).toBe(0);
  });
});

describe('computeBillTotals', () => {
  it('sums line nets and carries header tax', () => {
    const lines: NewBillLineInput[] = [
      { quantity: 1, unitCost: 100, accountId: 'acc-opex' },
      { quantity: 1, unitCost: 40, accountId: 'acc-cogs' },
    ];
    const totals = computeBillTotals({
      lines,
      resolveDebitAccount: (l) => l.accountId ?? null,
      taxTotal: 10,
    });
    expect(totals.subtotalCents).toBe(14000);
    expect(totals.taxCents).toBe(1000);
    expect(totals.totalCents).toBe(15000);
    expect(totals.lines[0].debitAccountId).toBe('acc-opex');
    expect(totals.lines[1].debitAccountId).toBe('acc-cogs');
  });

  it('treats a missing/zero tax as no tax', () => {
    const totals = computeBillTotals({
      lines: [{ quantity: 2, unitCost: 25, accountId: 'acc-opex' }],
      resolveDebitAccount: (l) => l.accountId ?? null,
    });
    expect(totals.taxCents).toBe(0);
    expect(totals.totalCents).toBe(5000);
  });

  it('runs the service-supplied account resolver for item-based lines', () => {
    const totals = computeBillTotals({
      lines: [{ quantity: 1, unitCost: 80, itemId: 'item-7' }],
      resolveDebitAccount: (l) => (l.itemId === 'item-7' ? 'acc-inv' : null),
    });
    expect(totals.lines[0].debitAccountId).toBe('acc-inv');
  });
});

describe('buildBillExpenseJournalLines', () => {
  it('posts a balanced Dr Expense / Cr AP entry with tax folded into the largest expense', () => {
    const totals = computeBillTotals({
      lines: [
        { quantity: 1, unitCost: 100, accountId: 'acc-opex' },
        { quantity: 1, unitCost: 40, accountId: 'acc-cogs' },
      ],
      resolveDebitAccount: (l) => l.accountId ?? null,
      taxTotal: 10,
    });
    const result = buildBillExpenseJournalLines(totals, ACCOUNTS, { vendorId: 'v1' });

    // Dr opex 110 (100 + 10 tax) / Dr cogs 40 / Cr AP 150
    expect(sumDebit(result.lines)).toBe(sumCredit(result.lines));
    expect(result.total).toBe(150);
    expect(result.subtotal).toBe(140);
    expect(result.taxTotal).toBe(10);

    const opex = result.lines.find((l) => l.accountId === 'acc-opex');
    const cogs = result.lines.find((l) => l.accountId === 'acc-cogs');
    const ap = result.lines.find((l) => l.accountId === 'acc-ap');
    expect(opex?.debit).toBe(110); // tax folded into the primary (largest) expense
    expect(cogs?.debit).toBe(40);
    expect(ap?.credit).toBe(150);
    // every line carries the vendor dimension
    expect(result.lines.every((l) => l.vendorId === 'v1')).toBe(true);
  });

  it('groups debits by account for a multi-line single-account bill', () => {
    const totals = computeBillTotals({
      lines: [
        { quantity: 1, unitCost: 100, accountId: 'acc-opex' },
        { quantity: 1, unitCost: 60, accountId: 'acc-opex' },
      ],
      resolveDebitAccount: (l) => l.accountId ?? null,
    });
    const result = buildBillExpenseJournalLines(totals, ACCOUNTS);
    const opexLines = result.lines.filter((l) => l.accountId === 'acc-opex');
    expect(opexLines).toHaveLength(1); // 100 + 60 merged
    expect(opexLines[0].debit).toBe(160);
    expect(sumDebit(result.lines)).toBe(sumCredit(result.lines));
  });

  it('omits a job stamp unless the bill is job-linked, and stamps it when present', () => {
    const totals = computeBillTotals({
      lines: [{ quantity: 1, unitCost: 100, accountId: 'acc-opex' }],
      resolveDebitAccount: (l) => l.accountId ?? null,
    });
    const noJob = buildBillExpenseJournalLines(totals, ACCOUNTS, { vendorId: 'v1' });
    expect(noJob.lines.every((l) => l.jobId == null)).toBe(true);
    const withJob = buildBillExpenseJournalLines(totals, ACCOUNTS, {
      vendorId: 'v1',
      jobId: 'job-9',
    });
    expect(withJob.lines.every((l) => l.jobId === 'job-9')).toBe(true);
  });

  it('falls back to operating_expenses when a line resolves no account', () => {
    const totals = computeBillTotals({
      lines: [{ quantity: 1, unitCost: 100 }],
      resolveDebitAccount: () => null, // nothing resolved
    });
    const result = buildBillExpenseJournalLines(totals, ACCOUNTS);
    const opex = result.lines.find((l) => l.accountId === 'acc-opex');
    expect(opex?.debit).toBe(100);
    expect(sumDebit(result.lines)).toBe(sumCredit(result.lines));
  });

  it('rejects a zero-total bill', () => {
    const totals = computeBillTotals({
      lines: [{ quantity: 1, unitCost: 0, accountId: 'acc-opex' }],
      resolveDebitAccount: (l) => l.accountId ?? null,
    });
    expect(() => buildBillExpenseJournalLines(totals, ACCOUNTS)).toThrow(/zero or negative/i);
  });

  it('throws when Accounts Payable is not configured', () => {
    const totals = computeBillTotals({
      lines: [{ quantity: 1, unitCost: 100, accountId: 'acc-opex' }],
      resolveDebitAccount: (l) => l.accountId ?? null,
    });
    expect(() =>
      buildBillExpenseJournalLines(totals, { ...ACCOUNTS, accountsPayable: null })
    ).toThrow(/Accounts Payable/i);
  });

  it('does not drift on a repeating-decimal split (3 x $33.33 + tax)', () => {
    const totals = computeBillTotals({
      lines: [
        { quantity: 1, unitCost: 33.33, accountId: 'acc-opex' },
        { quantity: 1, unitCost: 33.33, accountId: 'acc-cogs' },
        { quantity: 1, unitCost: 33.33, accountId: 'acc-opex' },
      ],
      resolveDebitAccount: (l) => l.accountId ?? null,
      taxTotal: 7.25,
    });
    const result = buildBillExpenseJournalLines(totals, ACCOUNTS);
    expect(sumDebit(result.lines)).toBe(sumCredit(result.lines));
  });

  // ── Header tax must NOT be capitalized into an inventory-asset debit (1300), even
  // when that inventory line is the LARGEST debit group. Keeping the 1300 debit equal
  // to the FIFO-costed amount is what lets v_inventory_valuation tie to GL 1300.
  it('keeps header tax off the inventory-asset default even when it is the largest debit (id guard)', () => {
    // Inventory line ($100 → acc-inv, the configured inventory-asset default) is larger
    // than the supplies expense ($30 → acc-opex). Tax must land on the expense, not 1300.
    const totals = computeBillTotals({
      lines: [
        { quantity: 1, unitCost: 100, accountId: 'acc-inv' },
        { quantity: 1, unitCost: 30, accountId: 'acc-opex' },
      ],
      resolveDebitAccount: (l) => l.accountId ?? null,
      taxTotal: 10,
    });
    const result = buildBillExpenseJournalLines(totals, ACCOUNTS, { vendorId: 'v1' });
    const inv = result.lines.find((l) => l.accountId === 'acc-inv')!;
    const opex = result.lines.find((l) => l.accountId === 'acc-opex')!;
    const ap = result.lines.find((l) => l.accountId === 'acc-ap')!;
    expect(inv.debit).toBe(100); // FIFO cost only — tax NOT capitalized into inventory
    expect(opex.debit).toBe(40); // 30 + 10 tax folded into the expense instead
    expect(ap.credit).toBe(140); // 130 subtotal + 10 tax; equals 100 + 40 debits
    expect(sumDebit(result.lines)).toBe(sumCredit(result.lines));
  });

  it('keeps header tax off an inventory-asset group identified by resolved account type', () => {
    // A per-item inventory-asset account ('acc-custom-inv') that is NOT the configured
    // default is still recognized as inventory via its threaded type ('asset').
    const lines: NewBillLineInput[] = [
      { quantity: 1, unitCost: 100, accountId: 'acc-custom-inv' },
      { quantity: 1, unitCost: 30, accountId: 'acc-opex' },
    ];
    const typeByAccount: Record<string, 'asset' | 'expense'> = {
      'acc-custom-inv': 'asset',
      'acc-opex': 'expense',
    };
    const totals = computeBillTotals({
      lines,
      resolveDebitAccount: (l) => l.accountId ?? null,
      resolveDebitAccountType: (l) => (l.accountId ? (typeByAccount[l.accountId] ?? null) : null),
      taxTotal: 10,
    });
    const result = buildBillExpenseJournalLines(totals, ACCOUNTS);
    const inv = result.lines.find((l) => l.accountId === 'acc-custom-inv')!;
    const opex = result.lines.find((l) => l.accountId === 'acc-opex')!;
    expect(inv.debit).toBe(100); // capitalized cost untouched
    expect(opex.debit).toBe(40); // tax folded into the expense group
    expect(sumDebit(result.lines)).toBe(sumCredit(result.lines));
  });

  // The GL tie-out bug (accounting-math audit): a bill whose ONLY line maps to a CUSTOM
  // inventory-asset account (id != the configured 1300 default) plus header tax. Before
  // the type was threaded through bills.ts the builder matched inventory only by the
  // default id, so a custom account looked like a plain expense and tax was folded into
  // it — capitalizing $110 and breaking v_inventory_valuation ↔ GL by the tax amount.
  // With the resolved type ('asset') threaded, the custom inventory debit stays at the
  // FIFO cost ($100) and the $10 tax posts to its own operating-expenses line.
  it('does not capitalize header tax into a custom inventory-asset account (id != default 1300)', () => {
    const lines: NewBillLineInput[] = [
      // 1 unit @ $100 → a custom inventory-asset account, NOT the configured 1300 default.
      { quantity: 1, unitCost: 100, accountId: 'acc-custom-inv-1305' },
    ];
    const typeByAccount: Record<string, 'asset' | 'expense'> = {
      'acc-custom-inv-1305': 'asset',
    };
    const totals = computeBillTotals({
      lines,
      resolveDebitAccount: (l) => l.accountId ?? null,
      resolveDebitAccountType: (l) => (l.accountId ? (typeByAccount[l.accountId] ?? null) : null),
      taxTotal: 10,
    });
    const result = buildBillExpenseJournalLines(totals, ACCOUNTS, { vendorId: 'v1' });
    const inv = result.lines.find((l) => l.accountId === 'acc-custom-inv-1305')!;
    const opex = result.lines.find((l) => l.accountId === 'acc-opex')!;
    const ap = result.lines.find((l) => l.accountId === 'acc-ap')!;
    expect(inv.debit).toBe(100); // FIFO cost only — tax is NOT capitalized ($100, not $110)
    expect(opex.debit).toBe(10); // $10 tax booked to operating expenses, not the asset
    expect(ap.credit).toBe(110); // 100 subtotal + 10 tax; equals 100 + 10 debits
    expect(sumDebit(result.lines)).toBe(sumCredit(result.lines)); // JE stays balanced
  });

  it('books tax on a dedicated operating-expenses line when every debit is inventory-asset', () => {
    // Both lines are inventory-asset (the default 1300): there is no expense group to
    // absorb tax. Rather than capitalize it into 1300, it posts as its own opex debit.
    const totals = computeBillTotals({
      lines: [
        { quantity: 1, unitCost: 100, accountId: 'acc-inv' },
        { quantity: 1, unitCost: 50, accountId: 'acc-inv' },
      ],
      resolveDebitAccount: (l) => l.accountId ?? null,
      taxTotal: 12,
    });
    const result = buildBillExpenseJournalLines(totals, ACCOUNTS);
    const inv = result.lines.find((l) => l.accountId === 'acc-inv')!;
    const opex = result.lines.find((l) => l.accountId === 'acc-opex')!;
    const ap = result.lines.find((l) => l.accountId === 'acc-ap')!;
    expect(inv.debit).toBe(150); // 100 + 50 merged — FIFO cost only, no tax
    expect(opex.debit).toBe(12); // tax on its own line, NOT capitalized into inventory
    expect(ap.credit).toBe(162);
    expect(sumDebit(result.lines)).toBe(sumCredit(result.lines));
  });

  it('throws if the only debit is inventory-asset and no operating-expenses account exists', () => {
    const totals = computeBillTotals({
      lines: [{ quantity: 1, unitCost: 100, accountId: 'acc-inv' }],
      resolveDebitAccount: (l) => l.accountId ?? null,
      taxTotal: 8,
    });
    expect(() =>
      buildBillExpenseJournalLines(totals, { ...ACCOUNTS, operatingExpenses: null })
    ).toThrow(/cannot be capitalized into inventory/i);
  });
});

describe('buildVendorPaymentJournalLines', () => {
  it('posts a balanced Dr AP / Cr Cash entry', () => {
    const lines = buildVendorPaymentJournalLines({
      amount: 90,
      payFromAccountId: 'acc-cash',
      accountsPayableId: 'acc-ap',
      applications: [{ billId: 'b1', amountApplied: 90 }],
      vendorId: 'v1',
    });
    expect(lines).toHaveLength(2);
    expect(sumDebit(lines)).toBe(sumCredit(lines));
    const ap = lines.find((l) => l.accountId === 'acc-ap');
    const cash = lines.find((l) => l.accountId === 'acc-cash');
    expect(ap?.debit).toBe(90);
    expect(cash?.credit).toBe(90);
    expect(lines.every((l) => l.vendorId === 'v1')).toBe(true);
  });

  it('sums multiple applications to the AP debit', () => {
    const lines = buildVendorPaymentJournalLines({
      amount: 150,
      payFromAccountId: 'acc-cash',
      accountsPayableId: 'acc-ap',
      applications: [
        { billId: 'b1', amountApplied: 100 },
        { billId: 'b2', amountApplied: 50 },
      ],
    });
    expect(sumDebit(lines)).toBe(15000);
    expect(sumCredit(lines)).toBe(15000);
  });

  it('rejects when applied total does not equal the payment amount', () => {
    expect(() =>
      buildVendorPaymentJournalLines({
        amount: 100,
        payFromAccountId: 'acc-cash',
        accountsPayableId: 'acc-ap',
        applications: [{ billId: 'b1', amountApplied: 90 }],
      })
    ).toThrow(/equal the payment amount/i);
  });

  it('rejects a non-positive amount', () => {
    expect(() =>
      buildVendorPaymentJournalLines({
        amount: 0,
        payFromAccountId: 'acc-cash',
        accountsPayableId: 'acc-ap',
        applications: [],
      })
    ).toThrow(/greater than zero/i);
  });

  it('throws when the pay-from account is missing', () => {
    expect(() =>
      buildVendorPaymentJournalLines({
        amount: 50,
        payFromAccountId: null,
        accountsPayableId: 'acc-ap',
        applications: [{ billId: 'b1', amountApplied: 50 }],
      })
    ).toThrow(/pay-from account/i);
  });
});

describe('buildCogsJournalLines (B3 FIFO COGS relief)', () => {
  it('posts a balanced Dr 5000 COGS / Cr 1300 Inventory Asset for the consumed cost', () => {
    // 32500 cents == $325.00 — the DB FIFO smoke-test figure (20@$10 + 10@$12.50).
    const result = buildCogsJournalLines(32500, ACCOUNTS, { jobId: 'job-9' });
    expect(result.lines).toHaveLength(2);
    expect(result.amount).toBe(325);
    expect(sumDebit(result.lines)).toBe(sumCredit(result.lines));
    expect(sumDebit(result.lines)).toBe(32500);

    const cogs = result.lines.find((l) => l.accountId === 'acc-cogs')!;
    const inv = result.lines.find((l) => l.accountId === 'acc-inv')!;
    expect(cogs.debit).toBe(325);
    expect(cogs.credit).toBe(0);
    expect(inv.credit).toBe(325);
    expect(inv.debit).toBe(0);
    // The job dimension is stamped on both lines for job costing.
    expect(result.lines.every((l) => l.jobId === 'job-9')).toBe(true);
  });

  it('omits the job stamp when no job id is supplied', () => {
    const result = buildCogsJournalLines(1000, ACCOUNTS);
    expect(result.lines.every((l) => l.jobId == null)).toBe(true);
  });

  it('produces an entry assertBalanced accepts', () => {
    const result = buildCogsJournalLines(98765, ACCOUNTS, { jobId: 'j' });
    expect(() => assertBalanced(result.lines)).not.toThrow();
  });

  it('rejects a zero or negative cost (nothing to relieve → RPC posts nothing)', () => {
    expect(() => buildCogsJournalLines(0, ACCOUNTS)).toThrow(/zero or negative/i);
    expect(() => buildCogsJournalLines(-50, ACCOUNTS)).toThrow(/zero or negative/i);
  });

  it('throws when the COGS account is not configured', () => {
    expect(() => buildCogsJournalLines(1000, { ...ACCOUNTS, cogs: null })).toThrow(
      /Cost of Goods Sold/i
    );
  });

  it('throws when the Inventory Asset account is not configured', () => {
    expect(() => buildCogsJournalLines(1000, { ...ACCOUNTS, inventoryAsset: null })).toThrow(
      /Inventory Asset/i
    );
  });
});

describe('buildDepreciationJournalLines (D3 depreciation period)', () => {
  const DEP_ACCOUNTS = {
    depreciationExpenseAccountId: 'acc-depr-exp',
    accumulatedDepreciationAccountId: 'acc-accum-depr',
  };

  it('posts a balanced Dr depreciation-expense / Cr accumulated-depreciation entry', () => {
    // 128571 cents == $1,285.71 — the DB straight-line smoke-test period figure.
    const result = buildDepreciationJournalLines(128571, DEP_ACCOUNTS);
    expect(result.lines).toHaveLength(2);
    expect(result.amount).toBe(1285.71);
    // Balanced by construction: debit total === credit total to the cent.
    expect(sumDebit(result.lines)).toBe(sumCredit(result.lines));
    expect(sumDebit(result.lines)).toBe(128571);

    const exp = result.lines.find((l) => l.accountId === 'acc-depr-exp')!;
    const accum = result.lines.find((l) => l.accountId === 'acc-accum-depr')!;
    expect(exp.debit).toBe(1285.71);
    expect(exp.credit).toBe(0);
    expect(accum.credit).toBe(1285.71);
    expect(accum.debit).toBe(0);
  });

  it('produces an entry assertBalanced accepts', () => {
    const result = buildDepreciationJournalLines(98765, DEP_ACCOUNTS);
    expect(() => assertBalanced(result.lines)).not.toThrow();
  });

  it('rejects a zero or negative amount (a 0/0 entry cannot be balanced ≥2 lines)', () => {
    expect(() => buildDepreciationJournalLines(0, DEP_ACCOUNTS)).toThrow(/zero or negative/i);
    expect(() => buildDepreciationJournalLines(-100, DEP_ACCOUNTS)).toThrow(/zero or negative/i);
  });

  it('throws when the depreciation-expense account is not configured', () => {
    expect(() =>
      buildDepreciationJournalLines(1000, { ...DEP_ACCOUNTS, depreciationExpenseAccountId: null })
    ).toThrow(/Depreciation Expense/i);
  });

  it('throws when the accumulated-depreciation account is not configured', () => {
    expect(() =>
      buildDepreciationJournalLines(1000, {
        ...DEP_ACCOUNTS,
        accumulatedDepreciationAccountId: null,
      })
    ).toThrow(/Accumulated Depreciation/i);
  });
});

describe('assertBalanced (the guard the DB also enforces)', () => {
  it('accepts a balanced two-line entry', () => {
    expect(() =>
      assertBalanced([
        { accountId: 'a', debit: 100, credit: 0 },
        { accountId: 'b', debit: 0, credit: 100 },
      ])
    ).not.toThrow();
  });

  it('rejects an unbalanced entry', () => {
    expect(() =>
      assertBalanced([
        { accountId: 'a', debit: 100, credit: 0 },
        { accountId: 'b', debit: 0, credit: 90 },
      ])
    ).toThrow(/unbalanced/i);
  });

  it('rejects a single-line entry', () => {
    expect(() => assertBalanced([{ accountId: 'a', debit: 100, credit: 0 }])).toThrow(/two lines/i);
  });

  it('rejects a line with both a debit and a credit', () => {
    expect(() =>
      assertBalanced([
        { accountId: 'a', debit: 50, credit: 50 },
        { accountId: 'b', debit: 0, credit: 50 },
      ])
    ).toThrow(/both a debit and a credit/i);
  });

  it('rejects a line with a negative debit or credit', () => {
    expect(() =>
      assertBalanced([
        { accountId: 'a', debit: -100, credit: 0 },
        { accountId: 'b', debit: 0, credit: -100 },
      ])
    ).toThrow(/cannot be negative/i);
  });

  it('rejects a zero/zero line (no debit and no credit)', () => {
    expect(() =>
      assertBalanced([
        { accountId: 'a', debit: 100, credit: 0 },
        { accountId: 'b', debit: 0, credit: 100 },
        { accountId: 'c', debit: 0, credit: 0 },
      ])
    ).toThrow(/needs a debit or a credit/i);
  });
});

describe('buildBankTransactionJournalLines (A4 categorize/accept)', () => {
  const BANK = 'gl-bank-1000';
  const CATEGORY = 'gl-opex-6000';

  it('posts a WITHDRAWAL as Dr category / Cr bank (magnitude of a negative amount)', () => {
    const res = buildBankTransactionJournalLines({
      amount: -42.5,
      bankGlAccountId: BANK,
      categoryAccountId: CATEGORY,
    });
    expect(res.direction).toBe('withdrawal');
    expect(res.amount).toBe(42.5);
    expect(res.lines).toHaveLength(2);
    const debitLine = res.lines.find((l) => l.debit > 0)!;
    const creditLine = res.lines.find((l) => l.credit > 0)!;
    expect(debitLine.accountId).toBe(CATEGORY);
    expect(creditLine.accountId).toBe(BANK);
    expect(sumDebit(res.lines)).toBe(sumCredit(res.lines)); // balanced
    expect(sumDebit(res.lines)).toBe(4250);
  });

  it('posts a DEPOSIT as Dr bank / Cr category (positive amount)', () => {
    const res = buildBankTransactionJournalLines({
      amount: 1000,
      bankGlAccountId: BANK,
      categoryAccountId: 'gl-income-4000',
    });
    expect(res.direction).toBe('deposit');
    const debitLine = res.lines.find((l) => l.debit > 0)!;
    const creditLine = res.lines.find((l) => l.credit > 0)!;
    expect(debitLine.accountId).toBe(BANK);
    expect(creditLine.accountId).toBe('gl-income-4000');
    expect(sumDebit(res.lines)).toBe(sumCredit(res.lines));
    expect(sumDebit(res.lines)).toBe(100000);
  });

  it('stamps the vendor dimension on both lines when provided', () => {
    const res = buildBankTransactionJournalLines({
      amount: -10,
      bankGlAccountId: BANK,
      categoryAccountId: CATEGORY,
      vendorId: 'v-7',
    });
    expect(res.lines.every((l) => l.vendorId === 'v-7')).toBe(true);
  });

  it('produces an entry assertBalanced accepts', () => {
    const res = buildBankTransactionJournalLines({
      amount: -123.45,
      bankGlAccountId: BANK,
      categoryAccountId: CATEGORY,
    });
    expect(() => assertBalanced(res.lines)).not.toThrow();
  });

  it('rejects a zero amount (would be a trivial/unbalanced entry)', () => {
    expect(() =>
      buildBankTransactionJournalLines({
        amount: 0,
        bankGlAccountId: BANK,
        categoryAccountId: CATEGORY,
      })
    ).toThrow(/zero-amount/i);
  });

  it('rejects a missing bank GL account', () => {
    expect(() =>
      buildBankTransactionJournalLines({
        amount: -10,
        bankGlAccountId: null,
        categoryAccountId: CATEGORY,
      })
    ).toThrow(/linked to a GL account/i);
  });

  it('rejects a missing category account', () => {
    expect(() =>
      buildBankTransactionJournalLines({
        amount: -10,
        bankGlAccountId: BANK,
        categoryAccountId: null,
      })
    ).toThrow(/category account/i);
  });

  it('rejects category === bank (would not represent a real movement)', () => {
    expect(() =>
      buildBankTransactionJournalLines({
        amount: -10,
        bankGlAccountId: BANK,
        categoryAccountId: BANK,
      })
    ).toThrow(/must differ/i);
  });
});

describe('computeReconciliationSummary (A4 reconcile screen)', () => {
  it('reconciles to zero when beginning + cleared deposits/withdrawals == ending', () => {
    const s = computeReconciliationSummary({
      beginningBalance: 5000,
      statementEndingBalance: 5957.5,
      // +1000 deposit, -42.50 withdrawal → net +957.50
      clearedAmounts: [1000, -42.5],
    });
    expect(s.clearedAmount).toBe(957.5);
    expect(s.clearedBalance).toBe(5957.5);
    expect(s.difference).toBe(0);
    expect(s.reconciled).toBe(true);
    expect(s.clearedCount).toBe(2);
  });

  it('reports a non-zero signed difference when out of balance', () => {
    const s = computeReconciliationSummary({
      beginningBalance: 0,
      statementEndingBalance: 100,
      clearedAmounts: [40],
    });
    expect(s.difference).toBe(60); // still 60 to clear
    expect(s.reconciled).toBe(false);
  });

  it('treats null beginning/ending as zero and handles an empty cleared set', () => {
    const s = computeReconciliationSummary({
      beginningBalance: null,
      statementEndingBalance: null,
      clearedAmounts: [],
    });
    expect(s.beginningBalance).toBe(0);
    expect(s.clearedAmount).toBe(0);
    expect(s.difference).toBe(0);
    expect(s.reconciled).toBe(true);
  });

  it('stays penny-exact across many fractional amounts (no float drift)', () => {
    const s = computeReconciliationSummary({
      beginningBalance: 0,
      statementEndingBalance: 0.3,
      clearedAmounts: [0.1, 0.1, 0.1],
    });
    expect(s.difference).toBe(0);
    expect(s.reconciled).toBe(true);
  });
});

// ── Reporting dimensions (B2): they must flow onto the posted JE lines and never ──
// break the balance. The income/expense credit/debit lines group by (account ×
// class × location × department), so distinct dimensions split into distinct lines.
describe('dimension threading on invoice revenue lines (B2)', () => {
  it('stamps class/location/department on the income credit line', () => {
    const totals = computeInvoiceTotals({
      lines: [
        {
          quantity: 1,
          unitPrice: 100,
          taxable: false,
          classId: 'cl-1',
          locationId: 'lo-1',
          departmentId: 'de-1',
        },
      ],
      defaultIncomeAccountId: 'acc-sales',
      taxRateByCode: () => 0,
    });
    const result = buildInvoiceRevenueJournalLines(totals, ACCOUNTS, { customerId: 'cust-1' });
    const income = result.lines.find((l) => l.accountId === 'acc-sales')!;
    expect(income.classId).toBe('cl-1');
    expect(income.locationId).toBe('lo-1');
    expect(income.departmentId).toBe('de-1');
    // The AR debit (an aggregate) carries no line dimension.
    const ar = result.lines.find((l) => l.accountId === 'acc-ar')!;
    expect(ar.classId).toBeUndefined();
    expect(sumDebit(result.lines)).toBe(sumCredit(result.lines));
  });

  it('splits the same income account into two credits for two different classes', () => {
    const totals = computeInvoiceTotals({
      lines: [
        { quantity: 1, unitPrice: 100, taxable: false, classId: 'cl-1' },
        { quantity: 1, unitPrice: 60, taxable: false, classId: 'cl-2' },
      ],
      defaultIncomeAccountId: 'acc-sales',
      taxRateByCode: () => 0,
    });
    const result = buildInvoiceRevenueJournalLines(totals, ACCOUNTS);
    const salesLines = result.lines.filter((l) => l.accountId === 'acc-sales');
    expect(salesLines).toHaveLength(2); // not merged — different class dimensions
    expect(salesLines.find((l) => l.classId === 'cl-1')?.credit).toBe(100);
    expect(salesLines.find((l) => l.classId === 'cl-2')?.credit).toBe(60);
    expect(sumDebit(result.lines)).toBe(sumCredit(result.lines));
  });

  it('merges lines that share both account AND dimensions', () => {
    const totals = computeInvoiceTotals({
      lines: [
        { quantity: 1, unitPrice: 100, taxable: false, classId: 'cl-1' },
        { quantity: 1, unitPrice: 50, taxable: false, classId: 'cl-1' },
      ],
      defaultIncomeAccountId: 'acc-sales',
      taxRateByCode: () => 0,
    });
    const result = buildInvoiceRevenueJournalLines(totals, ACCOUNTS);
    const salesLines = result.lines.filter((l) => l.accountId === 'acc-sales');
    expect(salesLines).toHaveLength(1);
    expect(salesLines[0].credit).toBe(150);
    expect(salesLines[0].classId).toBe('cl-1');
  });
});

describe('dimension threading on bill expense lines (B2)', () => {
  it('stamps class/location/department on the expense debit line', () => {
    const totals = computeBillTotals({
      lines: [
        {
          quantity: 1,
          unitCost: 100,
          accountId: 'acc-opex',
          classId: 'cl-1',
          locationId: 'lo-1',
          departmentId: 'de-1',
        },
      ],
      resolveDebitAccount: (l) => l.accountId ?? null,
    });
    const result = buildBillExpenseJournalLines(totals, ACCOUNTS, { vendorId: 'v1' });
    const expense = result.lines.find((l) => l.accountId === 'acc-opex')!;
    expect(expense.classId).toBe('cl-1');
    expect(expense.locationId).toBe('lo-1');
    expect(expense.departmentId).toBe('de-1');
    // AP credit (aggregate) carries no line dimension.
    const ap = result.lines.find((l) => l.accountId === 'acc-ap')!;
    expect(ap.classId).toBeUndefined();
    expect(sumDebit(result.lines)).toBe(sumCredit(result.lines));
  });

  it('splits one expense account into two debits for two locations and stays balanced', () => {
    const totals = computeBillTotals({
      lines: [
        { quantity: 1, unitCost: 100, accountId: 'acc-opex', locationId: 'lo-1' },
        { quantity: 1, unitCost: 40, accountId: 'acc-opex', locationId: 'lo-2' },
      ],
      resolveDebitAccount: (l) => l.accountId ?? null,
    });
    const result = buildBillExpenseJournalLines(totals, ACCOUNTS);
    const opexLines = result.lines.filter((l) => l.accountId === 'acc-opex');
    expect(opexLines).toHaveLength(2);
    expect(opexLines.find((l) => l.locationId === 'lo-1')?.debit).toBe(100);
    expect(opexLines.find((l) => l.locationId === 'lo-2')?.debit).toBe(40);
    expect(sumDebit(result.lines)).toBe(sumCredit(result.lines));
  });

  it('folds header tax into the largest dimension group, keeping balance', () => {
    const totals = computeBillTotals({
      lines: [
        { quantity: 1, unitCost: 100, accountId: 'acc-opex', locationId: 'lo-1' },
        { quantity: 1, unitCost: 40, accountId: 'acc-opex', locationId: 'lo-2' },
      ],
      resolveDebitAccount: (l) => l.accountId ?? null,
      taxTotal: 10,
    });
    const result = buildBillExpenseJournalLines(totals, ACCOUNTS);
    const lo1 = result.lines.find((l) => l.accountId === 'acc-opex' && l.locationId === 'lo-1')!;
    const lo2 = result.lines.find((l) => l.accountId === 'acc-opex' && l.locationId === 'lo-2')!;
    expect(lo1.debit).toBe(110); // tax folded into the larger (lo-1) group
    expect(lo2.debit).toBe(40);
    expect(result.total).toBe(150);
    expect(sumDebit(result.lines)).toBe(sumCredit(result.lines));
  });
});

describe('journalLinesEquivalent (ledger-neutral in-place-edit detection)', () => {
  const ar = { accountId: 'acc-ar', debit: 100, credit: 0, customerId: 'c1' };
  const rev = { accountId: 'acc-sales', debit: 0, credit: 100, customerId: 'c1' };

  it('is order-independent', () => {
    expect(journalLinesEquivalent([ar, rev], [rev, ar])).toBe(true);
  });

  it('ignores line memos and other non-ledger fields', () => {
    const arMemo = { ...ar, lineMemo: 'Accounts receivable' };
    expect(journalLinesEquivalent([arMemo, rev], [ar, rev])).toBe(true);
  });

  it('treats float-vs-rounded amounts equal to the cent as equivalent', () => {
    expect(journalLinesEquivalent([{ ...ar, debit: 100.0 }, rev], [ar, rev])).toBe(true);
  });

  it('detects a one-cent amount change (must reverse + re-post)', () => {
    expect(journalLinesEquivalent([{ ...ar, debit: 100.01 }, rev], [ar, rev])).toBe(false);
  });

  it('detects an account change', () => {
    expect(journalLinesEquivalent([{ ...ar, accountId: 'acc-other' }, rev], [ar, rev])).toBe(false);
  });

  it('detects a reporting-dimension change (e.g. the customer moved)', () => {
    const moved = [
      { ...ar, customerId: 'c2' },
      { ...rev, customerId: 'c2' },
    ];
    expect(journalLinesEquivalent([ar, rev], moved)).toBe(false);
  });

  it('detects a differing line count', () => {
    expect(journalLinesEquivalent([ar, rev], [ar])).toBe(false);
  });
});

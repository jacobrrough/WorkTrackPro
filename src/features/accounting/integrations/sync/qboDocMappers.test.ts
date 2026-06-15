import { describe, it, expect } from 'vitest';
import {
  centsOf,
  foldDelta,
  mapQboBill,
  mapQboBillPayment,
  mapQboEstimate,
  mapQboInvoice,
  mapQboPayment,
  type DocResolvers,
} from './qboDocMappers';
import type { SyncItemInfo } from './syncShared';

const widget: SyncItemInfo = {
  id: 'item-widget',
  itemType: 'inventory',
  incomeAccountId: 'acct-sales',
  expenseAccountId: 'acct-cogs',
  inventoryAssetAccountId: 'acct-inv-asset',
};
const service: SyncItemInfo = {
  id: 'item-service',
  itemType: 'service',
  incomeAccountId: 'acct-service-income',
  expenseAccountId: 'acct-sub',
  inventoryAssetAccountId: null,
};

const r: DocResolvers = {
  customerId: (id) => (id === '63' ? 'cust-63' : null),
  vendorId: (id) => (id === '41' ? 'vend-41' : null),
  item: (id) => (id === '11' ? widget : id === '12' ? service : null),
  accountId: (id) => (id === '35' ? 'acct-checking' : id === '80' ? 'acct-materials' : null),
};

describe('centsOf / foldDelta', () => {
  it('rounds dollars to integer cents', () => {
    expect(centsOf(1234.56)).toBe(123456);
    expect(centsOf('10.005')).toBe(1001);
    expect(centsOf(undefined)).toBe(0);
  });
  it('folds a residue into the largest line and rejects impossible folds', () => {
    const lines = [{ netCents: 1000 }, { netCents: 5000 }];
    expect(foldDelta(lines, -300)).toBe(true);
    expect(lines[1].netCents).toBe(4700);
    expect(foldDelta(lines, -99999)).toBe(false);
    expect(foldDelta([], 100)).toBe(false);
    expect(foldDelta(lines, 0)).toBe(true);
  });
});

describe('mapQboInvoice', () => {
  const baseInvoice = {
    Id: '500',
    DocNumber: '1042',
    CustomerRef: { value: '63' },
    TxnDate: '2024-03-15',
    DueDate: '2024-04-14',
    TotalAmt: 1087.25,
    Balance: 587.25,
    TxnTaxDetail: { TotalTax: 87.25 },
    Line: [
      {
        DetailType: 'SalesItemLineDetail',
        Amount: 750,
        Description: 'Widgets',
        SalesItemLineDetail: {
          ItemRef: { value: '11' },
          Qty: 30,
          UnitPrice: 25,
          TaxCodeRef: { value: 'TAX' },
        },
      },
      {
        DetailType: 'SalesItemLineDetail',
        Amount: 250,
        Description: 'Install labor',
        SalesItemLineDetail: {
          ItemRef: { value: '12' },
          Qty: 2,
          UnitPrice: 125,
          TaxCodeRef: { value: 'NON' },
        },
      },
      { DetailType: 'SubTotalLineDetail', Amount: 1000 },
    ],
  };

  it('maps lines, tax, and balances exactly', () => {
    const doc = mapQboInvoice(baseInvoice, r);
    expect(doc.problem).toBeNull();
    expect(doc.voided).toBe(false);
    expect(doc.customerRowId).toBe('cust-63');
    expect(doc.totalCents).toBe(108725);
    expect(doc.taxCents).toBe(8725);
    expect(doc.balanceCents).toBe(58725);
    expect(doc.lineRows).toHaveLength(2);
    expect(doc.lineRows[0]).toMatchObject({ itemId: 'item-widget', taxable: true, lineTotal: 750 });
    expect(doc.lineRows[1]).toMatchObject({ itemId: 'item-service', taxable: false });
    // Income side ties exactly: subtotal == total − tax, split per item income account.
    expect(doc.totals?.subtotalCents).toBe(100000);
    expect(doc.totals?.lines.map((l) => [l.incomeAccountId, l.netCents])).toEqual([
      ['acct-sales', 75000],
      ['acct-service-income', 25000],
    ]);
  });

  it('folds header discounts/shipping into the largest line so totals still tie', () => {
    const discounted = {
      ...baseInvoice,
      TotalAmt: 987.25, // $100 header discount off the $1000 lines (+ tax 87.25)
      Balance: 0,
    };
    const doc = mapQboInvoice(discounted, r);
    expect(doc.problem).toBeNull();
    expect(doc.totals?.subtotalCents).toBe(90000);
    // Largest line absorbed the −100.00.
    expect(doc.totals?.lines.map((l) => l.netCents)).toEqual([65000, 25000]);
    expect(doc.totals?.totalCents).toBe(98725);
  });

  it('synthesizes one income line when QBO returns no itemized lines', () => {
    const bare = {
      ...baseInvoice,
      Line: [],
      TotalAmt: 500,
      TxnTaxDetail: { TotalTax: 0 },
      Balance: 500,
    };
    const doc = mapQboInvoice(bare, r);
    expect(doc.problem).toBeNull();
    expect(doc.totals?.lines).toEqual([
      expect.objectContaining({ incomeAccountId: null, netCents: 50000 }),
    ]);
  });

  it('treats a zero-total invoice as voided (header-only, no posting)', () => {
    const voided = {
      ...baseInvoice,
      TotalAmt: 0,
      Balance: 0,
      TxnTaxDetail: { TotalTax: 0 },
      Line: [],
    };
    const doc = mapQboInvoice(voided, r);
    expect(doc.voided).toBe(true);
    expect(doc.totals).toBeNull();
    expect(doc.problem).toBeNull();
  });

  it('flags an unknown customer', () => {
    const doc = mapQboInvoice({ ...baseInvoice, CustomerRef: { value: '999' } }, r);
    expect(doc.problem).toContain('Customer not found');
  });
});

describe('mapQboBill', () => {
  const baseBill = {
    Id: '700',
    DocNumber: 'B-88',
    VendorRef: { value: '41' },
    TxnDate: '2024-05-01',
    TotalAmt: 1100,
    Balance: 1100,
    Line: [
      {
        DetailType: 'AccountBasedExpenseLineDetail',
        Amount: 600,
        Description: 'Materials',
        AccountBasedExpenseLineDetail: { AccountRef: { value: '80' } },
      },
      {
        DetailType: 'ItemBasedExpenseLineDetail',
        Amount: 400,
        Description: 'Widgets for stock',
        ItemBasedExpenseLineDetail: { ItemRef: { value: '11' }, Qty: 16, UnitPrice: 25 },
      },
    ],
  };

  it('maps account- and item-based lines with inventory capitalization', () => {
    const doc = mapQboBill(baseBill, r);
    expect(doc.problem).toBeNull();
    expect(doc.vendorRowId).toBe('vend-41');
    expect(doc.lineRows).toHaveLength(2);
    expect(doc.lineRows[0]).toMatchObject({ accountId: 'acct-materials', itemId: null });
    expect(doc.lineRows[1]).toMatchObject({ accountId: null, itemId: 'item-widget' });
    // $100 residue (freight/tax) rides as header tax; inventory line is asset-typed.
    expect(doc.totals?.taxCents).toBe(10000);
    expect(doc.totals?.lines[1]).toMatchObject({
      debitAccountId: 'acct-inv-asset',
      debitAccountType: 'asset',
    });
    expect(doc.totals?.totalCents).toBe(110000);
  });

  it('folds a negative residue into the largest line', () => {
    const credited = { ...baseBill, TotalAmt: 950 }; // lines sum 1000, total 950
    const doc = mapQboBill(credited, r);
    expect(doc.problem).toBeNull();
    expect(doc.totals?.taxCents).toBe(0);
    expect(doc.totals?.lines.map((l) => l.netCents)).toEqual([55000, 40000]);
  });

  it('treats a zero-total bill as voided', () => {
    const doc = mapQboBill({ ...baseBill, TotalAmt: 0, Line: [] }, r);
    expect(doc.voided).toBe(true);
  });
});

describe('mapQboEstimate', () => {
  const baseEstimate = {
    Id: '300',
    DocNumber: 'E-12',
    CustomerRef: { value: '63' },
    TxnDate: '2024-02-01',
    ExpirationDate: '2024-03-01',
    TxnStatus: 'Pending',
    TotalAmt: 540,
    TxnTaxDetail: { TotalTax: 40 },
    Line: [
      {
        DetailType: 'SalesItemLineDetail',
        Amount: 500,
        SalesItemLineDetail: {
          ItemRef: { value: '11' },
          Qty: 20,
          UnitPrice: 25,
          TaxCodeRef: { value: 'TAX' },
        },
      },
    ],
  };

  it('maps a pending estimate to sent', () => {
    const doc = mapQboEstimate(baseEstimate, r);
    expect(doc.problem).toBeNull();
    expect(doc.status).toBe('sent');
    expect(doc.subtotalCents).toBe(50000);
    expect(doc.taxCents).toBe(4000);
    expect(doc.lineRows).toHaveLength(1);
  });

  it('marks converted when a linked invoice exists, declined when rejected', () => {
    const converted = mapQboEstimate(
      { ...baseEstimate, TxnStatus: 'Closed', LinkedTxn: [{ TxnId: '500', TxnType: 'Invoice' }] },
      r
    );
    expect(converted.status).toBe('converted');
    expect(converted.linkedInvoiceQboId).toBe('500');
    const rejected = mapQboEstimate({ ...baseEstimate, TxnStatus: 'Rejected' }, r);
    expect(rejected.status).toBe('declined');
  });
});

describe('mapQboPayment', () => {
  const resolveInvoice = (id: string | null) =>
    id === '500' ? 'inv-500' : id === '501' ? 'inv-501' : null;

  const basePayment = {
    Id: '900',
    CustomerRef: { value: '63' },
    TxnDate: '2024-04-01',
    TotalAmt: 500,
    PaymentRefNum: '1001',
    DepositToAccountRef: { value: '35' },
    Line: [
      { Amount: 300, LinkedTxn: [{ TxnId: '500', TxnType: 'Invoice' }] },
      { Amount: 200, LinkedTxn: [{ TxnId: '501', TxnType: 'Invoice' }] },
    ],
  };

  it('maps applications and the deposit account', () => {
    const doc = mapQboPayment(basePayment, resolveInvoice, r);
    expect(doc.problem).toBeNull();
    expect(doc.depositAccountRowId).toBe('acct-checking');
    expect(doc.applications).toEqual([
      { invoiceRowId: 'inv-500', amountCents: 30000 },
      { invoiceRowId: 'inv-501', amountCents: 20000 },
    ]);
    expect(doc.creditPortionCents).toBe(0);
  });

  it('shaves the credit-memo-funded portion off the largest application', () => {
    // $500 cash but $650 applied to invoices ($150 funded by a credit memo).
    const withCredit = {
      ...basePayment,
      Line: [
        { Amount: 450, LinkedTxn: [{ TxnId: '500', TxnType: 'Invoice' }] },
        { Amount: 200, LinkedTxn: [{ TxnId: '501', TxnType: 'Invoice' }] },
        { Amount: 150, LinkedTxn: [{ TxnId: '77', TxnType: 'CreditMemo' }] },
      ],
    };
    const doc = mapQboPayment(withCredit, resolveInvoice, r);
    expect(doc.problem).toBeNull();
    expect(doc.creditPortionCents).toBe(15000);
    const total = doc.applications.reduce((s, a) => s + a.amountCents, 0);
    expect(total).toBe(50000); // never exceeds the cash amount
  });

  it('reports unresolved invoices and skips zero-amount (credit-only) payments', () => {
    const doc = mapQboPayment(
      {
        ...basePayment,
        Line: [{ Amount: 500, LinkedTxn: [{ TxnId: '999', TxnType: 'Invoice' }] }],
      },
      resolveInvoice,
      r
    );
    expect(doc.unresolvedInvoiceQboIds).toEqual(['999']);
    expect(doc.applications).toEqual([]);

    const creditOnly = mapQboPayment({ ...basePayment, TotalAmt: 0, Line: [] }, resolveInvoice, r);
    expect(creditOnly.problem).toContain('No money');
  });
});

describe('mapQboBillPayment', () => {
  const resolveBill = (id: string | null) => (id === '700' ? 'bill-700' : null);

  it('maps a check payment with its bank account and applications', () => {
    const doc = mapQboBillPayment(
      {
        Id: '950',
        VendorRef: { value: '41' },
        TxnDate: '2024-05-15',
        TotalAmt: 1100,
        PayType: 'Check',
        DocNumber: '2055',
        CheckPayment: { BankAccountRef: { value: '35' } },
        Line: [{ Amount: 1100, LinkedTxn: [{ TxnId: '700', TxnType: 'Bill' }] }],
      },
      resolveBill,
      r
    );
    expect(doc.problem).toBeNull();
    expect(doc.payFromAccountRowId).toBe('acct-checking');
    expect(doc.applications).toEqual([{ billRowId: 'bill-700', amountCents: 110000 }]);
  });
});

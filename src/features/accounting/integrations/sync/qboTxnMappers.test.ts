import { describe, it, expect } from 'vitest';
import type { DefaultAccounts } from '../../types';
import { assertBalanced } from '../../posting';
import type { DocResolvers } from './qboDocMappers';
import type { SyncItemInfo } from './syncShared';
import {
  mapQboCreditMemo,
  mapQboDeposit,
  mapQboJournalEntry,
  mapQboPurchase,
  mapQboRefundReceipt,
  mapQboSalesReceipt,
  mapQboTransfer,
  mapQboVendorCredit,
} from './qboTxnMappers';

const widget: SyncItemInfo = {
  id: 'item-widget',
  itemType: 'inventory',
  incomeAccountId: 'acct-sales',
  expenseAccountId: 'acct-cogs',
  inventoryAssetAccountId: 'acct-inv-asset',
};

const r: DocResolvers = {
  customerId: (id) => (id === '63' ? 'cust-63' : null),
  vendorId: (id) => (id === '41' ? 'vend-41' : null),
  item: (id) => (id === '11' ? widget : null),
  accountId: (id) =>
    id === '35'
      ? 'acct-checking'
      : id === '36'
        ? 'acct-savings'
        : id === '80'
          ? 'acct-materials'
          : id === '90'
            ? 'acct-cc'
            : null,
};

const d: DefaultAccounts = {
  cash: 'acct-cash',
  undepositedFunds: 'acct-uf',
  accountsReceivable: 'acct-ar',
  retainageReceivable: null,
  inventoryAsset: 'acct-inv-asset',
  accountsPayable: 'acct-ap',
  salesTaxPayable: 'acct-tax',
  salesIncome: 'acct-sales',
  serviceIncome: null,
  cogs: 'acct-cogs',
  operatingExpenses: 'acct-opex',
  fixedAsset: null,
  accumulatedDepreciation: null,
  depreciationExpense: null,
  openingBalanceEquity: null,
  uncategorizedIncome: null,
  uncategorizedExpense: null,
  paymentProcessorClearing: null,
};

describe('mapQboJournalEntry', () => {
  it('maps a 1:1 manual journal entry with entity stamping', () => {
    const je = mapQboJournalEntry(
      {
        Id: '20',
        TxnDate: '2023-01-15',
        DocNumber: 'JE-9',
        Line: [
          {
            DetailType: 'JournalEntryLineDetail',
            Amount: 250,
            Description: 'Reclass',
            JournalEntryLineDetail: { PostingType: 'Debit', AccountRef: { value: '80' } },
          },
          {
            DetailType: 'JournalEntryLineDetail',
            Amount: 250,
            JournalEntryLineDetail: {
              PostingType: 'Credit',
              AccountRef: { value: '35' },
              Entity: { Type: 'Customer', EntityRef: { value: '63' } },
            },
          },
        ],
      },
      r
    );
    expect(je.problem).toBeNull();
    expect(je.lines).toHaveLength(2);
    expect(je.lines[0]).toMatchObject({ accountId: 'acct-materials', debit: 250 });
    expect(je.lines[1]).toMatchObject({
      accountId: 'acct-checking',
      credit: 250,
      customerId: 'cust-63',
    });
    expect(() => assertBalanced(je.lines)).not.toThrow();
  });

  it('fails on an unmapped account', () => {
    const je = mapQboJournalEntry(
      {
        Id: '21',
        TxnDate: '2023-01-15',
        Line: [
          {
            DetailType: 'JournalEntryLineDetail',
            Amount: 10,
            JournalEntryLineDetail: { PostingType: 'Debit', AccountRef: { value: '404' } },
          },
        ],
      },
      r
    );
    expect(je.problem).toContain('unmapped account');
  });

  it('skips a voided/zero entry (all lines $0) as fewer than two mappable lines', () => {
    // QBO keeps voided/empty JEs (e.g. "AJE17.2 VOID: Recisy") at $0 on every line; they carry
    // no posting, so the mapper correctly flags them out rather than creating an empty entry.
    const je = mapQboJournalEntry(
      {
        Id: '22',
        TxnDate: '2017-06-30',
        DocNumber: 'AJE17.2',
        Line: [
          {
            DetailType: 'JournalEntryLineDetail',
            Amount: 0,
            JournalEntryLineDetail: { PostingType: 'Debit', AccountRef: { value: '80' } },
          },
          {
            DetailType: 'JournalEntryLineDetail',
            Amount: 0,
            JournalEntryLineDetail: { PostingType: 'Debit', AccountRef: { value: '35' } },
          },
        ],
      },
      r
    );
    expect(je.problem).toContain('Fewer than two mappable lines');
    expect(je.lines).toHaveLength(0);
  });
});

describe('mapQboDeposit', () => {
  it('moves undeposited funds for linked lines and credits accounts for direct lines', () => {
    const je = mapQboDeposit(
      {
        Id: '30',
        TxnDate: '2023-02-01',
        TotalAmt: 800,
        DepositToAccountRef: { value: '35' },
        Line: [
          { Amount: 500, LinkedTxn: [{ TxnId: '900', TxnType: 'Payment' }] },
          { Amount: 300, DepositLineDetail: { AccountRef: { value: '80' } } },
        ],
      },
      r,
      d
    );
    expect(je.problem).toBeNull();
    expect(je.lines[0]).toMatchObject({ accountId: 'acct-checking', debit: 800 });
    expect(je.lines).toContainEqual(expect.objectContaining({ accountId: 'acct-uf', credit: 500 }));
    expect(je.lines).toContainEqual(
      expect.objectContaining({ accountId: 'acct-materials', credit: 300 })
    );
    expect(() => assertBalanced(je.lines)).not.toThrow();
  });

  it('handles cash back as an extra debit', () => {
    const je = mapQboDeposit(
      {
        Id: '31',
        TxnDate: '2023-02-02',
        TotalAmt: 450,
        DepositToAccountRef: { value: '35' },
        CashBack: { Amount: 50, AccountRef: { value: '90' } },
        Line: [{ Amount: 500, LinkedTxn: [{ TxnId: '901', TxnType: 'Payment' }] }],
      },
      r,
      d
    );
    expect(je.problem).toBeNull();
    expect(() => assertBalanced(je.lines)).not.toThrow();
    expect(je.lines).toContainEqual(expect.objectContaining({ accountId: 'acct-cc', debit: 50 }));
  });

  it('maps a negative add-funds line (cash over/short) as a debit and still balances', () => {
    // Deposit #1945 shape: $500 of payments banked, less a $150 cash-over/short adjustment,
    // nets to a $350 deposit. The negative line must post as a debit, not be dropped.
    const je = mapQboDeposit(
      {
        Id: '32',
        TxnDate: '2023-02-03',
        TotalAmt: 350,
        DepositToAccountRef: { value: '35' },
        Line: [
          { Amount: 500, LinkedTxn: [{ TxnId: '902', TxnType: 'Payment' }] },
          { Amount: -150, DepositLineDetail: { AccountRef: { value: '80' } } },
        ],
      },
      r,
      d
    );
    expect(je.problem).toBeNull();
    expect(je.lines).toContainEqual(
      expect.objectContaining({ accountId: 'acct-checking', debit: 350 })
    );
    expect(je.lines).toContainEqual(expect.objectContaining({ accountId: 'acct-uf', credit: 500 }));
    expect(je.lines).toContainEqual(
      expect.objectContaining({ accountId: 'acct-materials', debit: 150 })
    );
    expect(() => assertBalanced(je.lines)).not.toThrow();
  });
});

describe('mapQboTransfer', () => {
  it('debits the destination and credits the source', () => {
    const je = mapQboTransfer(
      {
        Id: '40',
        TxnDate: '2023-03-01',
        Amount: 1000,
        FromAccountRef: { value: '35' },
        ToAccountRef: { value: '36' },
      },
      r
    );
    expect(je.problem).toBeNull();
    expect(je.lines).toEqual([
      expect.objectContaining({ accountId: 'acct-savings', debit: 1000 }),
      expect.objectContaining({ accountId: 'acct-checking', credit: 1000 }),
    ]);
  });
});

describe('mapQboCreditMemo', () => {
  it('reverses an invoice: Dr income + tax / Cr AR', () => {
    const je = mapQboCreditMemo(
      {
        Id: '50',
        DocNumber: 'CM-1',
        TxnDate: '2023-04-01',
        CustomerRef: { value: '63' },
        TotalAmt: 108.75,
        TxnTaxDetail: { TotalTax: 8.75 },
        Line: [
          {
            DetailType: 'SalesItemLineDetail',
            Amount: 100,
            SalesItemLineDetail: { ItemRef: { value: '11' } },
          },
        ],
      },
      r,
      d
    );
    expect(je.problem).toBeNull();
    expect(je.lines).toContainEqual(
      expect.objectContaining({ accountId: 'acct-sales', debit: 100 })
    );
    expect(je.lines).toContainEqual(
      expect.objectContaining({ accountId: 'acct-tax', debit: 8.75 })
    );
    expect(je.lines).toContainEqual(
      expect.objectContaining({ accountId: 'acct-ar', credit: 108.75, customerId: 'cust-63' })
    );
    expect(() => assertBalanced(je.lines)).not.toThrow();
  });
});

describe('mapQboSalesReceipt / mapQboRefundReceipt', () => {
  const receipt = {
    Id: '60',
    DocNumber: 'SR-1',
    TxnDate: '2023-05-01',
    CustomerRef: { value: '63' },
    TotalAmt: 217.5,
    TxnTaxDetail: { TotalTax: 17.5 },
    DepositToAccountRef: { value: '35' },
    Line: [
      {
        DetailType: 'SalesItemLineDetail',
        Amount: 200,
        SalesItemLineDetail: { ItemRef: { value: '11' } },
      },
    ],
  };

  it('sales receipt: Dr bank / Cr income + tax', () => {
    const je = mapQboSalesReceipt(receipt, r, d);
    expect(je.problem).toBeNull();
    expect(je.lines[0]).toMatchObject({ accountId: 'acct-checking', debit: 217.5 });
    expect(() => assertBalanced(je.lines)).not.toThrow();
  });

  it('refund receipt mirrors the sales receipt', () => {
    const je = mapQboRefundReceipt(receipt, r, d);
    expect(je.problem).toBeNull();
    expect(je.memo).toContain('Refund receipt');
    expect(je.lines[0]).toMatchObject({ accountId: 'acct-checking', credit: 217.5 });
    expect(() => assertBalanced(je.lines)).not.toThrow();
  });
});

describe('mapQboVendorCredit', () => {
  it('reverses a bill: Dr AP / Cr expense', () => {
    const je = mapQboVendorCredit(
      {
        Id: '70',
        TxnDate: '2023-06-01',
        VendorRef: { value: '41' },
        TotalAmt: 150,
        Line: [
          {
            DetailType: 'AccountBasedExpenseLineDetail',
            Amount: 150,
            AccountBasedExpenseLineDetail: { AccountRef: { value: '80' } },
          },
        ],
      },
      r,
      d
    );
    expect(je.problem).toBeNull();
    expect(je.lines[0]).toMatchObject({ accountId: 'acct-ap', debit: 150, vendorId: 'vend-41' });
    expect(je.lines[1]).toMatchObject({ accountId: 'acct-materials', credit: 150 });
  });
});

describe('mapQboPurchase', () => {
  const purchase = {
    Id: '80',
    TxnDate: '2023-07-01',
    AccountRef: { value: '35' },
    EntityRef: { value: '41' },
    TotalAmt: 320,
    Line: [
      {
        DetailType: 'AccountBasedExpenseLineDetail',
        Amount: 300,
        AccountBasedExpenseLineDetail: { AccountRef: { value: '80' } },
      },
    ],
  };

  it('posts Dr expenses / Cr bank, folding the residue', () => {
    const je = mapQboPurchase(purchase, r, d);
    expect(je.problem).toBeNull();
    // 20.00 residue folded into the materials line.
    expect(je.lines).toContainEqual(
      expect.objectContaining({ accountId: 'acct-materials', debit: 320 })
    );
    expect(je.lines).toContainEqual(
      expect.objectContaining({ accountId: 'acct-checking', credit: 320, vendorId: 'vend-41' })
    );
    expect(() => assertBalanced(je.lines)).not.toThrow();
  });

  it('reverses a card/bank refund (Credit: true)', () => {
    const je = mapQboPurchase({ ...purchase, Credit: true }, r, d);
    expect(je.problem).toBeNull();
    expect(je.lines).toContainEqual(
      expect.objectContaining({ accountId: 'acct-checking', debit: 320 })
    );
    expect(je.lines).toContainEqual(
      expect.objectContaining({ accountId: 'acct-materials', credit: 320 })
    );
  });

  it('synthesizes an operating-expense line when QBO gives no lines', () => {
    const je = mapQboPurchase({ ...purchase, Line: [] }, r, d);
    expect(je.problem).toBeNull();
    expect(je.lines).toContainEqual(
      expect.objectContaining({ accountId: 'acct-opex', debit: 320 })
    );
  });

  it('maps a negative contra line (e.g. owner distribution) as an opposite-side credit', () => {
    // Check #9616 shape: $500 of expenses less a $300 S-corp distribution nets to a $200
    // check. Positive lines debit expense; the negative contra line flips to a credit.
    const je = mapQboPurchase(
      {
        Id: '81',
        TxnDate: '2023-07-02',
        AccountRef: { value: '35' },
        EntityRef: { value: '41' },
        TotalAmt: 200,
        Line: [
          {
            DetailType: 'AccountBasedExpenseLineDetail',
            Amount: 500,
            AccountBasedExpenseLineDetail: { AccountRef: { value: '80' } },
          },
          {
            DetailType: 'AccountBasedExpenseLineDetail',
            Amount: -300,
            AccountBasedExpenseLineDetail: { AccountRef: { value: '36' } },
          },
        ],
      },
      r,
      d
    );
    expect(je.problem).toBeNull();
    expect(je.lines).toContainEqual(
      expect.objectContaining({ accountId: 'acct-materials', debit: 500 })
    );
    expect(je.lines).toContainEqual(
      expect.objectContaining({ accountId: 'acct-savings', credit: 300 })
    );
    expect(je.lines).toContainEqual(
      expect.objectContaining({ accountId: 'acct-checking', credit: 200, vendorId: 'vend-41' })
    );
    expect(() => assertBalanced(je.lines)).not.toThrow();
  });
});

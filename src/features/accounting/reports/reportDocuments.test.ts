import { describe, it, expect } from 'vitest';
import {
  agingDocument,
  balanceSheetDocument,
  profitAndLossDocument,
  salesTaxLiabilityDocument,
  taxCalendarDocument,
  trialBalanceDocument,
} from './reportDocuments';
import {
  REPORT_DISCLAIMER,
  SALES_TAX_DISCLAIMER,
  reportToCsv,
  reportToHtml,
  type ReportDocument,
} from './reportExport';
import { formatAccounting } from './reportFormat';
import type {
  AgingReport,
  BalanceSheetReport,
  ProfitAndLossReport,
  SalesTaxLiabilityReport,
  TaxCalendar,
  TrialBalanceReport,
} from '../types';
import { UNATTRIBUTED_AGENCY_ID } from '../types';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const trialBalance: TrialBalanceReport = {
  range: { from: '2026-01-01', to: '2026-03-31' },
  rows: [
    {
      accountId: 'a1',
      accountNumber: '1000',
      name: 'Cash',
      accountType: 'asset',
      normalBalance: 'debit',
      totalDebit: 500,
      totalCredit: 0,
      balance: 500,
    },
    {
      accountId: 'a2',
      accountNumber: '4000',
      name: 'Sales Income',
      accountType: 'income',
      normalBalance: 'credit',
      totalDebit: 0,
      totalCredit: 500,
      balance: -500,
    },
  ],
  totalDebit: 500,
  totalCredit: 500,
  difference: 0,
  balanced: true,
};

const pnl: ProfitAndLossReport = {
  range: {},
  income: {
    title: 'Income',
    lines: [{ accountId: 'i1', accountNumber: '4000', name: 'Sales', amount: 1000 }],
    subtotal: 1000,
  },
  expense: {
    title: 'Expenses',
    lines: [{ accountId: 'e1', accountNumber: '5000', name: 'COGS', amount: 400 }],
    subtotal: 400,
  },
  totalIncome: 1000,
  totalExpense: 400,
  netIncome: 600,
};

const balanceSheet: BalanceSheetReport = {
  range: { to: '2026-06-01' },
  assets: {
    title: 'Assets',
    lines: [{ accountId: 'a1', accountNumber: '1000', name: 'Cash', amount: 600 }],
    subtotal: 600,
  },
  liabilities: { title: 'Liabilities', lines: [], subtotal: 0 },
  equity: {
    title: 'Equity',
    lines: [{ accountId: '__net_income__', accountNumber: null, name: 'Net income', amount: 600 }],
    subtotal: 600,
  },
  totalAssets: 600,
  totalLiabilities: 0,
  totalEquity: 600,
  netIncome: 600,
  difference: 0,
  balanced: true,
};

const aging: AgingReport = {
  rows: [
    {
      documentId: 'inv1',
      documentNumber: 'INV-001',
      partyId: 'c1',
      partyName: 'Acme Co',
      documentDate: '2026-01-01',
      dueDate: '2026-01-31',
      total: 100,
      amountPaid: 0,
      balanceDue: 100,
      daysOverdue: 45,
      bucket: '31-60',
    },
  ],
  summary: {
    byBucket: { current: 0, '1-30': 0, '31-60': 100, '61-90': 0, '90+': 0 },
    total: 100,
  },
};

const salesTax: SalesTaxLiabilityReport = {
  range: { from: '2026-01-01', to: '2026-03-31' },
  liabilityAccountId: 'acc-2200',
  liabilityAccountNumber: '2200',
  agencies: [
    {
      agencyId: 'ag-state',
      agencyName: 'CA State (CDTFA)',
      rate: 0.0725,
      filingFrequency: 'quarterly',
      taxCollected: 72.5,
      taxableSales: 1000,
      nonTaxableSales: 200,
    },
    {
      agencyId: 'ag-district',
      agencyName: 'LA District',
      rate: 0.0225,
      filingFrequency: 'quarterly',
      taxCollected: 22.5,
      taxableSales: 1000,
      nonTaxableSales: 200,
    },
  ],
  taxCollected: 95,
  taxableSales: 1000,
  nonTaxableSales: 200,
  grossSales: 1200,
  unattributedTax: 0,
  reconciliationDifference: 0,
  reconciled: true,
};

const taxCalendar: TaxCalendar = {
  asOf: '2026-06-01',
  entries: [
    {
      agencyId: 'ag-state',
      agencyName: 'CA State (CDTFA)',
      frequency: 'quarterly',
      periodLabel: 'Q1 2026 (Jan–Mar)',
      periodStart: '2026-01-01',
      periodEnd: '2026-03-31',
      dueDate: '2026-04-30',
      daysUntilDue: -32,
      overdue: true,
      notes: null,
    },
    {
      agencyId: 'ag-state',
      agencyName: 'CA State (CDTFA)',
      frequency: 'quarterly',
      periodLabel: 'Q2 2026 (Apr–Jun)',
      periodStart: '2026-04-01',
      periodEnd: '2026-06-30',
      dueDate: '2026-07-31',
      daysUntilDue: 60,
      overdue: false,
      notes: null,
    },
  ],
};

// ── formatAccounting ─────────────────────────────────────────────────────────

describe('formatAccounting', () => {
  it('formats positives as currency', () => {
    expect(formatAccounting(1234.5)).toBe('$1,234.50');
  });
  it('parenthesizes negatives (accounting style)', () => {
    expect(formatAccounting(-42)).toBe('($42.00)');
  });
  it('coerces non-finite to zero', () => {
    expect(formatAccounting(Number.NaN)).toBe('$0.00');
  });
});

// ── Document builders ────────────────────────────────────────────────────────

describe('trialBalanceDocument', () => {
  const doc = trialBalanceDocument(trialBalance);
  it('titles and dates the report', () => {
    expect(doc.title).toBe('Trial Balance');
    expect(doc.subtitle).toBe('2026-01-01 to 2026-03-31');
  });
  it('lists each account then both grand totals', () => {
    const rows = doc.sections[0].rows;
    expect(rows).toHaveLength(4); // 2 accounts + total debits + total credits
    expect(rows[2]).toMatchObject({ amount: 500, isTotal: true });
    expect(rows[3]).toMatchObject({ amount: 500, isTotal: true });
  });
  it('reports the in-balance status', () => {
    expect(doc.status).toContain('In balance');
  });
  it('slugs the filename with the range', () => {
    expect(doc.filenameBase).toBe('trial-balance_2026-01-01_to_2026-03-31');
  });
});

describe('profitAndLossDocument', () => {
  const doc = profitAndLossDocument(pnl);
  it('has income, expense, and summary sections', () => {
    expect(doc.sections.map((s) => s.title)).toEqual(['Income', 'Expenses', 'Summary']);
  });
  it('carries net income in the status and summary', () => {
    expect(doc.status).toBe('Net income 600.00');
    const summary = doc.sections[2].rows[0];
    expect(summary).toMatchObject({ cells: ['Net income'], amount: 600, isTotal: true });
  });
  it('uses all-time slug when range is empty', () => {
    expect(doc.filenameBase).toBe('profit-and-loss_all-time');
  });
});

describe('balanceSheetDocument', () => {
  const doc = balanceSheetDocument(balanceSheet);
  it('renders the synthetic net-income equity line', () => {
    const equity = doc.sections.find((s) => s.title === 'Equity');
    expect(equity?.rows[0].cells[0]).toContain('Net income');
  });
  it('summary asserts assets vs liabilities + equity', () => {
    const summary = doc.sections.find((s) => s.title === 'Summary');
    expect(summary?.rows).toHaveLength(2);
    expect(summary?.rows[0]).toMatchObject({ amount: 600 });
    expect(summary?.rows[1]).toMatchObject({ amount: 600 }); // liabilities(0) + equity(600)
  });
});

describe('agingDocument', () => {
  it('labels AR with Customer/Invoice headers', () => {
    const doc = agingDocument(aging, 'ar');
    expect(doc.title).toBe('A/R Aging');
    expect(doc.sections[0].columns).toEqual(['Invoice', 'Customer', 'Due', 'Days overdue', 'Bucket']);
    expect(doc.filenameBase).toBe('ar-aging');
  });
  it('labels AP with Vendor/Bill headers', () => {
    const doc = agingDocument(aging, 'ap');
    expect(doc.title).toBe('A/P Aging');
    expect(doc.sections[0].columns[1]).toBe('Vendor');
    expect(doc.filenameBase).toBe('ap-aging');
  });
  it('summarizes buckets with a grand total row', () => {
    const doc = agingDocument(aging, 'ar');
    const summary = doc.sections[1];
    const totalRow = summary.rows[summary.rows.length - 1];
    expect(totalRow).toMatchObject({ cells: ['Total outstanding'], amount: 100, isTotal: true });
  });
});

// ── Export serializers carry the G9 disclaimer ───────────────────────────────

describe('export embeds the G9 disclaimer', () => {
  const docs: ReportDocument[] = [
    trialBalanceDocument(trialBalance),
    profitAndLossDocument(pnl),
    balanceSheetDocument(balanceSheet),
    agingDocument(aging, 'ar'),
    agingDocument(aging, 'ap'),
  ];

  it('CSV output begins with the disclaimer', () => {
    for (const doc of docs) {
      const csv = reportToCsv(doc);
      expect(csv).toContain(REPORT_DISCLAIMER);
      expect(csv.split('\r\n')[0]).toContain('DISCLAIMER');
    }
  });

  it('HTML/PDF output contains the disclaimer', () => {
    for (const doc of docs) {
      expect(reportToHtml(doc)).toContain(REPORT_DISCLAIMER);
    }
  });

  it('CSV writes amounts as plain 2-dp numbers, not currency', () => {
    const csv = reportToCsv(trialBalanceDocument(trialBalance));
    expect(csv).toContain('"500.00"');
    expect(csv).not.toContain('$500');
  });

  it('HTML escapes angle brackets in account names', () => {
    const doc = trialBalanceDocument({
      ...trialBalance,
      rows: [{ ...trialBalance.rows[0], name: 'Cash <x>' }],
    });
    const html = reportToHtml(doc);
    expect(html).toContain('Cash &lt;x&gt;');
    expect(html).not.toContain('Cash <x>');
  });
});

// ── C1 sales-tax document builders ───────────────────────────────────────────

describe('salesTaxLiabilityDocument', () => {
  const doc = salesTaxLiabilityDocument(salesTax);

  it('titles and dates the report', () => {
    expect(doc.title).toBe('Sales-Tax Liability');
    expect(doc.subtitle).toBe('2026-01-01 to 2026-03-31');
    expect(doc.filenameBase).toBe('sales-tax-liability_2026-01-01_to_2026-03-31');
  });

  it('has a summary section with gross/taxable/non-taxable/tax-collected', () => {
    const summary = doc.sections.find((s) => s.title === 'Summary');
    expect(summary?.rows.map((r) => r.cells[0])).toEqual([
      'Gross sales',
      'Taxable sales',
      'Non-taxable sales',
      'Tax collected',
    ]);
    expect(summary?.rows[0].amount).toBe(1200); // gross
    expect(summary?.rows[3].amount).toBe(95); // tax collected
  });

  it('lists each agency with its rate, then a grand-total row', () => {
    const agencies = doc.sections.find((s) => s.title === 'By agency / jurisdiction');
    expect(agencies?.columns).toEqual(['Agency', 'Rate', 'Taxable sales', 'Non-taxable sales']);
    // two agencies + total
    expect(agencies?.rows).toHaveLength(3);
    expect(agencies?.rows[0]).toMatchObject({ cells: ['CA State (CDTFA)', '7.25%', '1000.00', '200.00'], amount: 72.5 });
    const total = agencies?.rows[2];
    expect(total).toMatchObject({ cells: ['Total tax collected', '', '', ''], amount: 95, isTotal: true });
  });

  it('reports an all-tied status when reconciled with no unattributed tax', () => {
    expect(doc.status).toBe('All collected tax tied to an agency');
  });

  it('flags the reconciliation failure in the status', () => {
    const broken = salesTaxLiabilityDocument({
      ...salesTax,
      reconciled: false,
      reconciliationDifference: 1.23,
    });
    expect(broken.status).toContain('RECONCILIATION FAILED');
    expect(broken.status).toContain('1.23');
  });

  it('surfaces the unattributed / review bucket and warns in the status', () => {
    const withUnattributed = salesTaxLiabilityDocument({
      ...salesTax,
      agencies: [
        ...salesTax.agencies,
        {
          agencyId: UNATTRIBUTED_AGENCY_ID,
          agencyName: 'Unattributed / review',
          rate: 0,
          filingFrequency: null,
          taxCollected: 5,
          taxableSales: 0,
          nonTaxableSales: 0,
          isUnattributed: true,
        },
      ],
      taxCollected: 100,
      unattributedTax: 5,
    });
    const agencies = withUnattributed.sections.find((s) => s.title === 'By agency / jurisdiction');
    expect(agencies?.rows.some((r) => r.cells[0] === 'Unattributed / review (review)')).toBe(true);
    expect(withUnattributed.status).toContain('unattributed');
    const summary = withUnattributed.sections.find((s) => s.title === 'Summary');
    expect(summary?.rows.some((r) => r.cells[0] === 'Unattributed / review')).toBe(true);
  });

  it('carries the Representative-rates G9 disclaimer', () => {
    expect(doc.disclaimer).toBe(SALES_TAX_DISCLAIMER);
    expect(reportToCsv(doc)).toContain('Representative rates only.');
    expect(reportToHtml(doc)).toContain('Representative rates only.');
  });
});

describe('taxCalendarDocument', () => {
  const doc = taxCalendarDocument(taxCalendar);

  it('titles, dates and counts the deadlines', () => {
    expect(doc.title).toBe('Tax Calendar');
    expect(doc.subtitle).toBe('As of 2026-06-01');
    expect(doc.status).toBe('2 filing deadlines');
    expect(doc.filenameBase).toBe('tax-calendar_2026-06-01');
  });

  it('renders one row per deadline with an Overdue/Upcoming status', () => {
    const section = doc.sections[0];
    expect(section.columns).toEqual([
      'Agency',
      'Frequency',
      'Period',
      'Due date',
      'Days until due',
      'Status',
    ]);
    expect(section.rows[0].cells).toEqual([
      'CA State (CDTFA)',
      'Quarterly',
      'Q1 2026 (Jan–Mar)',
      '2026-04-30',
      '-32',
      'Overdue',
    ]);
    expect(section.rows[1].cells[5]).toBe('Upcoming');
  });

  it('singularizes the status for one deadline', () => {
    const one = taxCalendarDocument({ ...taxCalendar, entries: [taxCalendar.entries[0]] });
    expect(one.status).toBe('1 filing deadline');
  });

  it('carries the Representative-rates G9 disclaimer', () => {
    expect(doc.disclaimer).toBe(SALES_TAX_DISCLAIMER);
    expect(reportToCsv(doc)).toContain('Representative rates only.');
    expect(reportToHtml(doc)).toContain('Representative rates only.');
  });
});

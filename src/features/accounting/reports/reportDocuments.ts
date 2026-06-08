/**
 * Pure adapters from the typed report shapes (reportMath output) into the generic
 * `ReportDocument` the exporter consumes. Kept React/DOM-free so the PDF/CSV layout
 * is unit-testable and identical to what the on-screen tables show.
 */
import type {
  AccountLedgerReport,
  AgingReport,
  BalanceSheetReport,
  BudgetVsActualReport,
  CashFlowForecast,
  CashFlowStatementReport,
  Form1099Report,
  ProfitAndLossReport,
  PurchasesByVendorReport,
  SalesByCustomerReport,
  SalesByItemReport,
  SalesTaxLiabilityReport,
  TaxCalendar,
  TrialBalanceReport,
} from '../types';
import { AGING_BUCKETS, AGING_BUCKET_LABELS, TAX_FILING_FREQUENCY_LABELS } from '../types';
import { describeRange, asOfToday, rangeSlug } from './reportFormat';
import {
  REPORT_DISCLAIMER,
  SALES_TAX_DISCLAIMER,
  type ReportDocument,
  type ReportRow,
} from './reportExport';

/** Render a decimal rate (0.0725) as a percent string ("7.25%"); blank for 0/none. */
function formatRate(rate: number): string {
  if (!Number.isFinite(rate) || rate === 0) return '';
  // Trim trailing zeros: 0.0725 -> "7.25%", 0.06 -> "6%".
  return `${parseFloat((rate * 100).toFixed(4))}%`;
}

/** "12345 · Cash" style account label, gracefully omitting a missing number. */
function accountLabel(accountNumber: string | null, name: string): string {
  return accountNumber ? `${accountNumber} · ${name}` : name;
}

export function trialBalanceDocument(report: TrialBalanceReport): ReportDocument {
  const rows: ReportRow[] = report.rows.map((r) => ({
    cells: [accountLabel(r.accountNumber, r.name)],
    // Trial balance shows the signed debit-minus-credit balance per account.
    amount: r.balance,
  }));
  rows.push({ cells: ['Total debits'], amount: report.totalDebit, isTotal: true });
  rows.push({ cells: ['Total credits'], amount: report.totalCredit, isTotal: true });

  return {
    title: 'Trial Balance',
    subtitle: describeRange(report.range),
    status: report.balanced
      ? 'In balance (debits = credits)'
      : `Out of balance by ${report.difference.toFixed(2)}`,
    sections: [{ columns: ['Account'], rows }],
    filenameBase: `trial-balance_${rangeSlug(report.range)}`,
  };
}

export function profitAndLossDocument(report: ProfitAndLossReport): ReportDocument {
  const incomeRows: ReportRow[] = report.income.lines.map((l) => ({
    cells: [accountLabel(l.accountNumber, l.name)],
    amount: l.amount,
  }));
  incomeRows.push({ cells: ['Total income'], amount: report.totalIncome, isTotal: true });

  const expenseRows: ReportRow[] = report.expense.lines.map((l) => ({
    cells: [accountLabel(l.accountNumber, l.name)],
    amount: l.amount,
  }));
  expenseRows.push({ cells: ['Total expenses'], amount: report.totalExpense, isTotal: true });

  return {
    title: 'Profit & Loss',
    subtitle: describeRange(report.range),
    status: `Net income ${report.netIncome.toFixed(2)}`,
    sections: [
      { title: 'Income', columns: ['Account'], rows: incomeRows },
      { title: 'Expenses', columns: ['Account'], rows: expenseRows },
      {
        title: 'Summary',
        columns: [''],
        rows: [{ cells: ['Net income'], amount: report.netIncome, isTotal: true }],
      },
    ],
    filenameBase: `profit-and-loss_${rangeSlug(report.range)}`,
  };
}

export function balanceSheetDocument(report: BalanceSheetReport): ReportDocument {
  const assetRows: ReportRow[] = report.assets.lines.map((l) => ({
    cells: [accountLabel(l.accountNumber, l.name)],
    amount: l.amount,
  }));
  assetRows.push({ cells: ['Total assets'], amount: report.totalAssets, isTotal: true });

  const liabilityRows: ReportRow[] = report.liabilities.lines.map((l) => ({
    cells: [accountLabel(l.accountNumber, l.name)],
    amount: l.amount,
  }));
  liabilityRows.push({
    cells: ['Total liabilities'],
    amount: report.totalLiabilities,
    isTotal: true,
  });

  const equityRows: ReportRow[] = report.equity.lines.map((l) => ({
    cells: [accountLabel(l.accountNumber, l.name)],
    amount: l.amount,
  }));
  equityRows.push({ cells: ['Total equity'], amount: report.totalEquity, isTotal: true });

  return {
    title: 'Balance Sheet',
    subtitle: describeRange(report.range),
    status: report.balanced
      ? 'In balance (assets = liabilities + equity)'
      : `Out of balance by ${report.difference.toFixed(2)}`,
    sections: [
      { title: 'Assets', columns: ['Account'], rows: assetRows },
      { title: 'Liabilities', columns: ['Account'], rows: liabilityRows },
      { title: 'Equity', columns: ['Account'], rows: equityRows },
      {
        title: 'Summary',
        columns: [''],
        rows: [
          { cells: ['Total assets'], amount: report.totalAssets, isTotal: true },
          {
            cells: ['Total liabilities + equity'],
            amount: report.totalLiabilities + report.totalEquity,
            isTotal: true,
          },
        ],
      },
    ],
    filenameBase: `balance-sheet_${rangeSlug(report.range)}`,
  };
}

/**
 * Aging shares one document shape for AR and AP — `kind` only changes the title,
 * the party column header, and the filename. Each open document is one row with its
 * bucket; a trailing summary section gives the per-bucket totals.
 */
export function agingDocument(report: AgingReport, kind: 'ar' | 'ap'): ReportDocument {
  const partyHeader = kind === 'ar' ? 'Customer' : 'Vendor';
  const docHeader = kind === 'ar' ? 'Invoice' : 'Bill';

  const rows: ReportRow[] = report.rows.map((r) => ({
    cells: [
      r.documentNumber || '—',
      r.partyName || r.partyId,
      r.dueDate ?? r.documentDate,
      String(r.daysOverdue),
      AGING_BUCKET_LABELS[r.bucket],
    ],
    amount: r.balanceDue,
  }));

  const summaryRows: ReportRow[] = AGING_BUCKETS.map((b) => ({
    cells: [AGING_BUCKET_LABELS[b]],
    amount: report.summary.byBucket[b],
  }));
  summaryRows.push({ cells: ['Total outstanding'], amount: report.summary.total, isTotal: true });

  return {
    title: kind === 'ar' ? 'A/R Aging' : 'A/P Aging',
    subtitle: asOfToday(),
    sections: [
      {
        title: 'Open items',
        columns: [docHeader, partyHeader, 'Due', 'Days overdue', 'Bucket'],
        rows,
      },
      { title: 'Summary by bucket', columns: ['Bucket'], rows: summaryRows },
    ],
    filenameBase: kind === 'ar' ? 'ar-aging' : 'ap-aging',
  };
}

/**
 * Budget-vs-Actual (D2): one row per account with its annual budget, actual (posted
 * journal lines, same basis as the trial balance) and variance (actual − budget). The
 * amount column carries the variance; budget and actual ride in the leading label cells
 * so the CSV/PDF stay single-amount like the other reports. A trailing summary section
 * gives the grand budget/actual/variance.
 */
export function budgetVsActualDocument(report: BudgetVsActualReport): ReportDocument {
  const rows: ReportRow[] = report.rows.map((r) => ({
    cells: [accountLabel(r.accountNumber, r.accountName), r.budget.toFixed(2), r.actual.toFixed(2)],
    amount: r.variance,
  }));

  const summaryRows: ReportRow[] = [
    { cells: ['Total budget'], amount: report.totalBudget, isTotal: true },
    { cells: ['Total actual'], amount: report.totalActual, isTotal: true },
    { cells: ['Total variance'], amount: report.totalVariance, isTotal: true },
  ];

  return {
    title: 'Budget vs Actual',
    subtitle: `${report.budgetName} · FY ${report.fiscalYear}`,
    status: `Variance ${report.totalVariance.toFixed(2)} (actual − budget)`,
    sections: [
      {
        title: 'By account',
        columns: ['Account', 'Budget', 'Actual'],
        rows,
      },
      { title: 'Summary', columns: [''], rows: summaryRows },
    ],
    filenameBase: `budget-vs-actual_fy${report.fiscalYear}`,
  };
}

/**
 * Cash-flow forecast (D2): one row per monthly bucket with expected inflow, outflow, net
 * and the projected running balance (which rides in the amount column). A leading summary
 * section states the opening/ending position and the horizon totals. This is a projection
 * from currently-open AR/AP — it books no entry.
 */
export function cashFlowForecastDocument(report: CashFlowForecast): ReportDocument {
  const periodRows: ReportRow[] = report.periods.map((p) => ({
    cells: [p.label, p.inflow.toFixed(2), p.outflow.toFixed(2), p.net.toFixed(2)],
    amount: p.runningBalance,
  }));

  const summaryRows: ReportRow[] = [
    { cells: ['Opening balance'], amount: report.openingBalance, isTotal: true },
    { cells: ['Total expected inflow'], amount: report.totalInflow, isTotal: true },
    { cells: ['Total expected outflow'], amount: report.totalOutflow, isTotal: true },
    { cells: ['Projected ending balance'], amount: report.endingBalance, isTotal: true },
  ];

  return {
    title: 'Cash-Flow Forecast',
    subtitle: asOfToday(),
    status: `Projected ending balance ${report.endingBalance.toFixed(2)}`,
    sections: [
      { title: 'Summary', columns: [''], rows: summaryRows },
      {
        title: 'By period',
        columns: ['Period', 'Inflow', 'Outflow', 'Net'],
        rows: periodRows,
      },
    ],
    filenameBase: 'cash-flow-forecast',
  };
}

/**
 * Sales-Tax Liability (C1): tax COLLECTED grouped by agency/jurisdiction, with the
 * CDTFA-style taxable/non-taxable summary. The amount column carries each agency's tax
 * collected; the agency's combined rate and its sales bases ride in the leading label
 * cells so the CSV/PDF stay single-amount like the other reports. The "Unattributed /
 * review" bucket (untied tax surfaced, not guessed) is just another row, labelled so it
 * reads as needing review. A leading summary section states gross/taxable/non-taxable
 * sales and the grand tax collected; the status surfaces any reconciliation failure.
 *
 * G9: this document sets the SALES_TAX_DISCLAIMER ("…Representative rates only.") so the
 * export carries the required sales-tax caveat verbatim.
 */
export function salesTaxLiabilityDocument(report: SalesTaxLiabilityReport): ReportDocument {
  const agencyRows: ReportRow[] = report.agencies.map((a) => ({
    cells: [
      a.isUnattributed ? `${a.agencyName} (review)` : a.agencyName,
      formatRate(a.rate),
      a.taxableSales.toFixed(2),
      a.nonTaxableSales.toFixed(2),
    ],
    amount: a.taxCollected,
  }));
  agencyRows.push({
    cells: ['Total tax collected', '', '', ''],
    amount: report.taxCollected,
    isTotal: true,
  });

  const summaryRows: ReportRow[] = [
    { cells: ['Gross sales'], amount: report.grossSales, isTotal: true },
    { cells: ['Taxable sales'], amount: report.taxableSales, isTotal: true },
    { cells: ['Non-taxable sales'], amount: report.nonTaxableSales, isTotal: true },
    { cells: ['Tax collected'], amount: report.taxCollected, isTotal: true },
  ];
  if (report.unattributedTax !== 0) {
    summaryRows.push({
      cells: ['Unattributed / review'],
      amount: report.unattributedTax,
      isTotal: true,
    });
  }

  const status = !report.reconciled
    ? `RECONCILIATION FAILED — off by ${report.reconciliationDifference.toFixed(2)} (figures could not be fully tied to the posted ledger)`
    : report.unattributedTax !== 0
      ? `Includes ${report.unattributedTax.toFixed(2)} unattributed tax — review before filing`
      : 'All collected tax tied to an agency';

  return {
    title: 'Sales-Tax Liability',
    subtitle: describeRange(report.range),
    status,
    disclaimer: SALES_TAX_DISCLAIMER,
    sections: [
      { title: 'Summary', columns: [''], rows: summaryRows },
      {
        title: 'By agency / jurisdiction',
        columns: ['Agency', 'Rate', 'Taxable sales', 'Non-taxable sales'],
        rows: agencyRows,
      },
    ],
    filenameBase: `sales-tax-liability_${rangeSlug(report.range)}`,
  };
}

/**
 * Tax Calendar (C1): the read-only list of upcoming/recent filing deadlines, soonest due
 * first. No money column — each row is an agency's filing period, its due date, days
 * until due (negative = overdue) and a status word. This is REPORTING ONLY (no
 * notification is delivered). G9: carries the SALES_TAX_DISCLAIMER caveat.
 */
export function taxCalendarDocument(calendar: TaxCalendar): ReportDocument {
  const rows: ReportRow[] = calendar.entries.map((e) => ({
    cells: [
      e.agencyName,
      TAX_FILING_FREQUENCY_LABELS[e.frequency],
      e.periodLabel,
      e.dueDate,
      String(e.daysUntilDue),
      e.overdue ? 'Overdue' : 'Upcoming',
    ],
  }));

  return {
    title: 'Tax Calendar',
    subtitle: `As of ${calendar.asOf}`,
    status: `${calendar.entries.length} filing deadline${calendar.entries.length === 1 ? '' : 's'}`,
    disclaimer: SALES_TAX_DISCLAIMER,
    sections: [
      {
        title: 'Filing deadlines',
        columns: ['Agency', 'Frequency', 'Period', 'Due date', 'Days until due', 'Status'],
        rows,
      },
    ],
    filenameBase: `tax-calendar_${calendar.asOf}`,
  };
}

/**
 * General-ledger account register (#3): the opening balance row, one row per posted
 * line (date / entry # / memo, with debit and credit riding in the leading label cells
 * so the export stays single-amount), and a closing-balance total. The amount column
 * carries the running natural-signed balance.
 */
export function accountLedgerDocument(report: AccountLedgerReport): ReportDocument {
  const rows: ReportRow[] = [
    {
      cells: ['Opening balance', '', '', ''],
      amount: report.openingBalance,
      isTotal: true,
    },
  ];
  for (const l of report.lines) {
    rows.push({
      cells: [l.date, String(l.entryNumber), l.memo ?? '', l.debit.toFixed(2), l.credit.toFixed(2)],
      amount: l.balance,
    });
  }
  rows.push({
    cells: ['Closing balance', '', '', ''],
    amount: report.closingBalance,
    isTotal: true,
  });

  return {
    title: 'General Ledger',
    subtitle: `${accountLabel(report.accountNumber, report.accountName)} · ${describeRange(report.range)}`,
    status: `Closing balance ${report.closingBalance.toFixed(2)}`,
    sections: [
      {
        title: 'Transactions',
        columns: ['Date', 'Entry #', 'Memo', 'Debit', 'Credit'],
        rows,
      },
    ],
    filenameBase: `general-ledger_${report.accountNumber ?? report.accountId}_${rangeSlug(report.range)}`,
  };
}

/**
 * Statement of Cash Flows (#5, indirect): the three activity sections each with their
 * lines + subtotal, then a reconciliation summary (net change implied by the sections
 * vs. the actual change in cash). The amount column carries each figure.
 */
export function cashFlowStatementDocument(report: CashFlowStatementReport): ReportDocument {
  const sectionDoc = (
    title: string,
    lines: { name: string; amount: number }[],
    subtotal: number
  ) => {
    const rows: ReportRow[] = lines.map((l) => ({ cells: [l.name], amount: l.amount }));
    rows.push({ cells: [`Net cash from ${title.toLowerCase()}`], amount: subtotal, isTotal: true });
    return { title, columns: ['Item'], rows };
  };

  const summaryRows: ReportRow[] = [
    { cells: ['Net change in cash'], amount: report.netChangeInCash, isTotal: true },
    { cells: ['Change in cash accounts'], amount: report.cashChange, isTotal: true },
  ];

  return {
    title: 'Statement of Cash Flows',
    subtitle: describeRange(report.range),
    status: report.balanced
      ? 'Reconciled (net change ties to the change in cash)'
      : `Does not reconcile — off by ${report.difference.toFixed(2)}`,
    sections: [
      sectionDoc('Operating activities', report.operating.lines, report.netOperating),
      sectionDoc('Investing activities', report.investing.lines, report.netInvesting),
      sectionDoc('Financing activities', report.financing.lines, report.netFinancing),
      { title: 'Summary', columns: [''], rows: summaryRows },
    ],
    filenameBase: `cash-flow-statement_${rangeSlug(report.range)}`,
  };
}

/** Sales by Customer (#4): one row per customer (with its invoice-line count) + total. */
export function salesByCustomerDocument(report: SalesByCustomerReport): ReportDocument {
  const rows: ReportRow[] = report.rows.map((r) => ({
    cells: [r.customerName, String(r.invoiceCount)],
    amount: r.amount,
  }));
  rows.push({ cells: ['Total sales', ''], amount: report.total, isTotal: true });

  return {
    title: 'Sales by Customer',
    subtitle: describeRange(report.range),
    status: `Total sales ${report.total.toFixed(2)} (pre-tax)`,
    sections: [{ title: 'By customer', columns: ['Customer', 'Lines'], rows }],
    filenameBase: `sales-by-customer_${rangeSlug(report.range)}`,
  };
}

/** Sales by Item (#4): one row per item (with its line count) + total. */
export function salesByItemDocument(report: SalesByItemReport): ReportDocument {
  const rows: ReportRow[] = report.rows.map((r) => ({
    cells: [r.itemName, String(r.lineCount)],
    amount: r.amount,
  }));
  rows.push({ cells: ['Total sales', ''], amount: report.total, isTotal: true });

  return {
    title: 'Sales by Item',
    subtitle: describeRange(report.range),
    status: `Total sales ${report.total.toFixed(2)} (pre-tax)`,
    sections: [{ title: 'By item', columns: ['Item', 'Lines'], rows }],
    filenameBase: `sales-by-item_${rangeSlug(report.range)}`,
  };
}

/** Purchases by Vendor (#4): one row per vendor (with its bill-line count) + total. */
export function purchasesByVendorDocument(report: PurchasesByVendorReport): ReportDocument {
  const rows: ReportRow[] = report.rows.map((r) => ({
    cells: [r.vendorName, String(r.billCount)],
    amount: r.amount,
  }));
  rows.push({ cells: ['Total purchases', ''], amount: report.total, isTotal: true });

  return {
    title: 'Purchases by Vendor',
    subtitle: describeRange(report.range),
    status: `Total purchases ${report.total.toFixed(2)} (pre-tax)`,
    sections: [{ title: 'By vendor', columns: ['Vendor', 'Lines'], rows }],
    filenameBase: `purchases-by-vendor_${rangeSlug(report.range)}`,
  };
}

/**
 * 1099-NEC worklist (#12): the reportable vendors for a calendar year — every 1099 vendor
 * AT OR OVER the $600 threshold, ranked by total paid, each with its W-9 legal name, a
 * "Tax ID present?" flag (the actual TIN is never exported), an "exempt?" flag, the payment
 * count and the total. A leading summary states the threshold, the reportable total, and
 * how many reportable vendors still need a complete W-9. ADVISORY ONLY — this is a worklist,
 * not a filing; card / third-party-network payments are excluded (1099-K, not 1099-NEC),
 * and no e-file is included. Carries the base G9 disclaimer.
 */
export function form1099WorklistDocument(report: Form1099Report): ReportDocument {
  const rows: ReportRow[] = report.rows.map((r) => ({
    cells: [
      r.vendorName,
      r.legalName ?? '',
      r.hasTaxId ? 'Yes' : 'No',
      r.exempt ? 'Yes' : 'No',
      String(r.paymentCount),
    ],
    amount: r.amount,
  }));
  rows.push({
    cells: ['Total reportable', '', '', '', ''],
    amount: report.reportableTotal,
    isTotal: true,
  });

  const summaryRows: ReportRow[] = [
    { cells: ['Reportable threshold (at or over)'], amount: report.thresholdAmount, isTotal: true },
    { cells: ['Total reportable payments'], amount: report.reportableTotal, isTotal: true },
  ];

  const status =
    report.incompleteCount > 0
      ? `${report.rows.length} reportable vendor${report.rows.length === 1 ? '' : 's'} — ${report.incompleteCount} missing a complete W-9 (legal name + TIN)`
      : `${report.rows.length} reportable vendor${report.rows.length === 1 ? '' : 's'}`;

  return {
    title: `1099-NEC Worklist — ${report.year}`,
    subtitle: `Calendar year ${report.year} · vendors at or over ${report.thresholdAmount.toFixed(2)}`,
    status,
    // Base G9 notice (not the sales-tax "representative rates" variant). Card / third-party
    // payments are excluded upstream (1099-K), and no e-file is included.
    disclaimer: `${REPORT_DISCLAIMER} Card / third-party-network payments are excluded (reported on 1099-K by the processor). Reporting only — no e-file.`,
    sections: [
      { title: 'Summary', columns: [''], rows: summaryRows },
      {
        title: 'Reportable vendors',
        columns: ['Vendor', 'Legal name', 'Tax ID?', 'Exempt?', 'Payments'],
        rows,
      },
    ],
    filenameBase: `1099-nec-worklist_${report.year}`,
  };
}

/**
 * Pure aggregation helpers for the #4 management reports (Sales by Customer, Sales by
 * Item, Purchases by Vendor).
 *
 * Like reportMath.ts these take already-fetched, pre-grouped line inputs and roll them
 * into the ranked report shapes the UI renders. They are deliberately free of
 * React/Supabase so the math is unit-testable and reused by both the on-screen tables
 * and the PDF/CSV exporters.
 *
 * MONEY: every sum runs in integer cents (accountingViewModel.toCents) and is converted
 * back to dollars only at the boundary, so line amounts and the grand total tie to the
 * penny. The figures are PRE-TAX (each line carries `line_total`, already net of any
 * line discount) — these are management/operational reports, not tax filings.
 */
import { toCents } from '../accountingViewModel';
import type {
  PurchasesByVendorReport,
  PurchasesByVendorRow,
  SalesByCustomerReport,
  SalesByCustomerRow,
  SalesByItemReport,
  SalesByItemRow,
  DateRange,
} from '../types';

/** Cents -> dollars at the presentation boundary (rounds half-up like the DB). */
const centsToAmount = (cents: number): number => Math.round(cents) / 100;

/** Fallback label for a line with no item/party (item_id null, etc.). */
export const UNCATEGORIZED_LABEL = 'Uncategorized';

/**
 * One pre-grouped input row for a management report: a grouping key (customer/item/
 * vendor id, or a sentinel for "uncategorized"), the human name to display, and one
 * source line's pre-tax amount in dollars. The service emits one of these per source
 * line; the builders sum + rank them.
 */
export interface ManagementLineInput {
  /** Stable grouping key. Use UNCATEGORIZED_KEY when the source has no id. */
  key: string;
  /** Display name for the group (e.g. customer display_name, item name). */
  name: string;
  /** This line's pre-tax amount in dollars (invoice_lines/bill_lines line_total). */
  amount: number;
}

/** Sentinel grouping key for lines with no customer/item/vendor id. */
export const UNCATEGORIZED_KEY = '__uncategorized__';

interface Group {
  key: string;
  name: string;
  amountCents: number;
  count: number;
}

/**
 * Group raw line inputs by key, summing amounts in cents and counting source lines.
 * Returns groups sorted by amount DESC (ties broken by name) plus the grand-total cents.
 * Shared by all three reports — only the row/report field names differ at the boundary.
 */
function group(rows: ManagementLineInput[]): { groups: Group[]; totalCents: number } {
  const byKey = new Map<string, Group>();
  let totalCents = 0;
  for (const row of rows) {
    const cents = toCents(row.amount);
    totalCents += cents;
    let g = byKey.get(row.key);
    if (!g) {
      g = { key: row.key, name: row.name, amountCents: 0, count: 0 };
      byKey.set(row.key, g);
    }
    g.amountCents += cents;
    g.count += 1;
    // Keep the first non-empty name we see (the service supplies a stable name per key).
    if (!g.name && row.name) g.name = row.name;
  }
  const groups = Array.from(byKey.values()).sort(
    (a, b) => b.amountCents - a.amountCents || a.name.localeCompare(b.name)
  );
  return { groups, totalCents };
}

/** Build the Sales-by-Customer report (ranked desc by revenue, with a grand total). */
export function buildSalesByCustomer(
  rows: ManagementLineInput[],
  range: DateRange = {}
): SalesByCustomerReport {
  const { groups, totalCents } = group(rows);
  const out: SalesByCustomerRow[] = groups.map((g) => ({
    customerId: g.key === UNCATEGORIZED_KEY ? null : g.key,
    customerName: g.name || UNCATEGORIZED_LABEL,
    invoiceCount: g.count,
    amount: centsToAmount(g.amountCents),
  }));
  return { range, rows: out, total: centsToAmount(totalCents) };
}

/** Build the Sales-by-Item report (ranked desc by revenue, with a grand total). */
export function buildSalesByItem(
  rows: ManagementLineInput[],
  range: DateRange = {}
): SalesByItemReport {
  const { groups, totalCents } = group(rows);
  const out: SalesByItemRow[] = groups.map((g) => ({
    itemId: g.key === UNCATEGORIZED_KEY ? null : g.key,
    itemName: g.name || UNCATEGORIZED_LABEL,
    lineCount: g.count,
    amount: centsToAmount(g.amountCents),
  }));
  return { range, rows: out, total: centsToAmount(totalCents) };
}

/** Build the Purchases-by-Vendor report (ranked desc by spend, with a grand total). */
export function buildPurchasesByVendor(
  rows: ManagementLineInput[],
  range: DateRange = {}
): PurchasesByVendorReport {
  const { groups, totalCents } = group(rows);
  const out: PurchasesByVendorRow[] = groups.map((g) => ({
    vendorId: g.key === UNCATEGORIZED_KEY ? null : g.key,
    vendorName: g.name || UNCATEGORIZED_LABEL,
    billCount: g.count,
    amount: centsToAmount(g.amountCents),
  }));
  return { range, rows: out, total: centsToAmount(totalCents) };
}

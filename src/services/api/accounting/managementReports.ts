import type {
  DateRange,
  PurchasesByVendorReport,
  SalesByCustomerReport,
  SalesByItemReport,
} from '../../../features/accounting/types';
import {
  buildPurchasesByVendor,
  buildSalesByCustomer,
  buildSalesByItem,
  UNCATEGORIZED_KEY,
  UNCATEGORIZED_LABEL,
  type ManagementLineInput,
} from '../../../features/accounting/reports/managementReportMath';
import { acct } from './accountingClient';
import type { Row } from './mappers';

/**
 * #4 — management reports (Sales by Customer, Sales by Item, Purchases by Vendor).
 * READ-ONLY: nothing here writes (reads THROW so React Query surfaces them).
 *
 * No new DB view. Mirroring salesTax.ts, each report does a raw-line fetch with an
 * inner-join on the parent document (so PostgREST filters by the document's date +
 * status server-side) and groups the lines in pure TS via the managementReportMath
 * builders. This gives free date filtering with no migration.
 *
 * BASIS: figures are PRE-TAX and use each line's `line_total` (already net of any line
 * discount). Only NON-VOID documents count (status <> 'void') — drafts are included so
 * the operational picture matches the job-costing revenue basis (a draft invoice is
 * still expected sales). A null item_id groups under "Uncategorized" rather than being
 * dropped.
 *
 * NAMES: customer/vendor display names ride along on the invoice/bill join; item names
 * are resolved in a second chunked fetch keyed by the distinct item ids seen.
 */

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Chunk size for a follow-up IN(...) lookup (matches salesTax.ts). */
const CHUNK = 100;

/**
 * Resolve accounting.items names for a set of item ids (chunked IN). Returns a Map of
 * id -> name; ids with no row simply stay absent (the caller falls back to a label).
 */
async function fetchItemNames(itemIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < itemIds.length; i += CHUNK) {
    const slice = itemIds.slice(i, i + CHUNK);
    const { data, error } = await acct().from('items').select('id, name').in('id', slice);
    if (error) throw error;
    for (const raw of (data ?? []) as Row[]) {
      out.set(String(raw.id), String(raw.name ?? ''));
    }
  }
  return out;
}

export const managementReportsService = {
  /**
   * Sales by Customer: non-void invoice line revenue (pre-tax line_total) grouped by the
   * invoice's customer, ranked desc. The customer display_name rides on the invoice join.
   */
  async getSalesByCustomer(range: DateRange = {}): Promise<SalesByCustomerReport> {
    let q = acct()
      .from('invoice_lines')
      .select(
        'line_total, invoice:invoices!inner(customer_id, status, invoice_date, customer:customers(display_name))'
      )
      .neq('invoice.status', 'void');
    if (range.from) q = q.gte('invoice.invoice_date', range.from);
    if (range.to) q = q.lte('invoice.invoice_date', range.to);

    const { data, error } = await q;
    if (error) throw error;

    const inputs: ManagementLineInput[] = [];
    for (const raw of (data ?? []) as unknown as Row[]) {
      const invoice = (raw.invoice ?? null) as Row | null;
      if (!invoice) continue;
      const customerId = invoice.customer_id == null ? null : String(invoice.customer_id);
      const customer = (invoice.customer ?? null) as Row | null;
      const name = customer?.display_name == null ? '' : String(customer.display_name);
      inputs.push({
        key: customerId ?? UNCATEGORIZED_KEY,
        name: name || (customerId ? '' : UNCATEGORIZED_LABEL),
        amount: num(raw.line_total),
      });
    }

    return buildSalesByCustomer(inputs, range);
  },

  /**
   * Sales by Item: non-void invoice line revenue (pre-tax line_total) grouped by the
   * line's item, ranked desc. Item names are resolved in a chunked follow-up fetch; a
   * line with no item_id groups under "Uncategorized".
   */
  async getSalesByItem(range: DateRange = {}): Promise<SalesByItemReport> {
    let q = acct()
      .from('invoice_lines')
      .select('item_id, line_total, invoice:invoices!inner(status, invoice_date)')
      .neq('invoice.status', 'void');
    if (range.from) q = q.gte('invoice.invoice_date', range.from);
    if (range.to) q = q.lte('invoice.invoice_date', range.to);

    const { data, error } = await q;
    if (error) throw error;

    interface Raw {
      itemId: string | null;
      amount: number;
    }
    const rawRows: Raw[] = [];
    const itemIds = new Set<string>();
    for (const raw of (data ?? []) as unknown as Row[]) {
      const invoice = (raw.invoice ?? null) as Row | null;
      if (!invoice) continue;
      const itemId = raw.item_id == null ? null : String(raw.item_id);
      if (itemId) itemIds.add(itemId);
      rawRows.push({ itemId, amount: num(raw.line_total) });
    }

    const names =
      itemIds.size > 0 ? await fetchItemNames(Array.from(itemIds)) : new Map<string, string>();
    const inputs: ManagementLineInput[] = rawRows.map((r) => ({
      key: r.itemId ?? UNCATEGORIZED_KEY,
      name: r.itemId ? (names.get(r.itemId) ?? '') : UNCATEGORIZED_LABEL,
      amount: r.amount,
    }));

    return buildSalesByItem(inputs, range);
  },

  /**
   * Purchases by Vendor: non-void bill line spend (line_total) grouped by the bill's
   * vendor, ranked desc. The vendor display_name rides on the bill join.
   */
  async getPurchasesByVendor(range: DateRange = {}): Promise<PurchasesByVendorReport> {
    let q = acct()
      .from('bill_lines')
      .select(
        'line_total, bill:bills!inner(vendor_id, status, bill_date, vendor:vendors(display_name))'
      )
      .neq('bill.status', 'void');
    if (range.from) q = q.gte('bill.bill_date', range.from);
    if (range.to) q = q.lte('bill.bill_date', range.to);

    const { data, error } = await q;
    if (error) throw error;

    const inputs: ManagementLineInput[] = [];
    for (const raw of (data ?? []) as unknown as Row[]) {
      const bill = (raw.bill ?? null) as Row | null;
      if (!bill) continue;
      const vendorId = bill.vendor_id == null ? null : String(bill.vendor_id);
      const vendor = (bill.vendor ?? null) as Row | null;
      const name = vendor?.display_name == null ? '' : String(vendor.display_name);
      inputs.push({
        key: vendorId ?? UNCATEGORIZED_KEY,
        name: name || (vendorId ? '' : UNCATEGORIZED_LABEL),
        amount: num(raw.line_total),
      });
    }

    return buildPurchasesByVendor(inputs, range);
  },
};

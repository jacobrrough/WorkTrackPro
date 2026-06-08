import type {
  Bill,
  PurchaseOrder,
  PurchaseOrderLine,
  PoStatus,
  NewPurchaseOrderInput,
  NewPurchaseOrderLineInput,
  UpdatePurchaseOrderInput,
  PoLineVariance,
} from '../../../features/accounting/types';
import { acct } from './accountingClient';
import { mapBillRow, type Row } from './mappers';

/**
 * Purchase orders (accounting.purchase_orders / purchase_order_lines). A PO is a
 * COMMITMENT to buy — it mirrors an AP bill's header + lines and computed money fields,
 * but posts NOTHING to the ledger. Money posts only when its converted bill is later
 * POSTED (the existing bills.post flow posts the balanced expense JE Dr Expense /
 * Cr Accounts Payable).
 *
 * Lifecycle: draft → open → partially_received/received → closed, and (from anything but
 * cancelled) cancelled. `convertToBill` calls accounting.convert_po_to_bill, which clones
 * a DRAFT bill atomically, stamps each new bill line's po_line_id (the 3-way-match link),
 * and accrues the billed quantity onto quantity_received; the UI then navigates to that
 * bill. `receive` records per-line quantity_received and advances status without billing.
 *
 * Reads throw (React Query surfaces them); writes return a result object whose `error`
 * carries the DB message so the UI can show it. createDraft cleans up a half-created
 * header if its line insert fails (mirrors billsService.createDraft).
 */

const SELECT_DETAIL = '*, lines:purchase_order_lines(*), vendor:vendors(display_name)';

const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const str = (v: unknown): string => (v == null ? '' : String(v));
const nstr = (v: unknown): string | null => (v == null ? null : String(v));

const VALID_PO_STATUSES = new Set<PoStatus>([
  'draft',
  'open',
  'partially_received',
  'received',
  'closed',
  'cancelled',
]);

function poStatus(v: unknown): PoStatus {
  const s = str(v) as PoStatus;
  return VALID_PO_STATUSES.has(s) ? s : 'draft';
}

function mapPurchaseOrderLineRow(row: Row): PurchaseOrderLine {
  return {
    id: str(row.id),
    poId: str(row.po_id),
    itemId: nstr(row.item_id),
    accountId: nstr(row.account_id),
    description: nstr(row.description),
    quantityOrdered: num(row.quantity_ordered, 1),
    unitCost: num(row.unit_cost),
    quantityReceived: num(row.quantity_received),
    lineTotal: num(row.line_total),
    jobId: nstr(row.job_id),
    classId: nstr(row.class_id),
    locationId: nstr(row.location_id),
    departmentId: nstr(row.department_id),
    sortOrder: num(row.sort_order),
  };
}

function mapPurchaseOrderRow(row: Row): PurchaseOrder {
  const rawLines = (row.lines ?? row.purchase_order_lines ?? null) as Row[] | null;
  const vendor = (row.vendor ?? null) as Row | null;
  return {
    id: str(row.id),
    vendorId: str(row.vendor_id),
    poNumber: nstr(row.po_number),
    orderDate: str(row.order_date),
    expectedDate: nstr(row.expected_date),
    status: poStatus(row.status),
    jobId: nstr(row.job_id),
    subtotal: num(row.subtotal),
    taxTotal: num(row.tax_total),
    total: num(row.total),
    memo: nstr(row.memo),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
    lines: rawLines
      ? rawLines.map(mapPurchaseOrderLineRow).sort((a, b) => a.sortOrder - b.sortOrder)
      : undefined,
    vendorName: vendor ? str(vendor.display_name) : undefined,
  };
}

/** A PO line's persisted money total in cents (explicit override or qty × unit cost). */
function lineCents(l: { quantityOrdered?: number; unitCost?: number; lineTotal?: number }): number {
  if (l.lineTotal != null) return Math.round(l.lineTotal * 100);
  return Math.max(0, Math.round((l.quantityOrdered || 0) * (l.unitCost || 0) * 100));
}

/**
 * Pure money totals for a set of PO input lines. Like a bill, a PO taxes at the HEADER
 * (a single tax amount in dollars), not per line. All math is integer cents so the
 * persisted total never drifts on floating-point error.
 */
export function computePurchaseOrderTotals(
  lines: NewPurchaseOrderLineInput[],
  taxTotal: number | null | undefined
): { subtotalCents: number; taxCents: number; totalCents: number } {
  const subtotalCents = lines.reduce((sum, l) => sum + lineCents(l), 0);
  const taxCents = Math.max(0, Math.round((taxTotal ?? 0) * 100));
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}

function lineRows(poId: string, lines: NewPurchaseOrderLineInput[]): Record<string, unknown>[] {
  return lines.map((l, i) => ({
    po_id: poId,
    item_id: l.itemId ?? null,
    account_id: l.accountId ?? null,
    description: l.description ?? null,
    quantity_ordered: l.quantityOrdered ?? 1,
    unit_cost: l.unitCost ?? 0,
    quantity_received: l.quantityReceived ?? 0,
    line_total: Math.round(lineCents(l)) / 100,
    job_id: l.jobId ?? null,
    // B2 reporting dimensions, persisted on the line and copied onto the bill line on convert.
    class_id: l.classId ?? null,
    location_id: l.locationId ?? null,
    department_id: l.departmentId ?? null,
    sort_order: i,
  }));
}

/** Adapt a persisted PurchaseOrderLine back to the create/update input shape. */
function toLineInput(l: PurchaseOrderLine): NewPurchaseOrderLineInput {
  return {
    itemId: l.itemId,
    accountId: l.accountId,
    description: l.description,
    quantityOrdered: l.quantityOrdered,
    unitCost: l.unitCost,
    quantityReceived: l.quantityReceived,
    lineTotal: l.lineTotal,
    jobId: l.jobId,
    classId: l.classId,
    locationId: l.locationId,
    departmentId: l.departmentId,
  };
}

/**
 * Compute per-line 3-way-match variance for a PO against the bill lines that fulfil it.
 * Pure: the caller supplies the PO (with lines) and the bills whose lines carry a
 * po_line_id. For each PO line:
 *   - quantity variance = received − ordered (negative = short, positive = over-received),
 *   - cost variance = billed unit cost − PO unit cost when a linked bill line exists.
 * A PO line with no linked bill line reports a null billedUnitCost / costVariance
 * (nothing billed against it yet — surfaced, never guessed).
 */
export function computePoVariances(po: PurchaseOrder, bills: Bill[]): PoLineVariance[] {
  // Index linked bill lines by the PO line they fulfil (a line may be billed in parts).
  const billedByPoLine = new Map<
    string,
    { unitCostSum: number; qty: number; billIds: Set<string> }
  >();
  for (const bill of bills) {
    for (const bl of bill.lines ?? []) {
      if (!bl.poLineId) continue;
      const agg = billedByPoLine.get(bl.poLineId) ?? {
        unitCostSum: 0,
        qty: 0,
        billIds: new Set<string>(),
      };
      // Quantity-weighted so multiple partial bills average correctly.
      agg.unitCostSum += bl.unitCost * bl.quantity;
      agg.qty += bl.quantity;
      agg.billIds.add(bill.id);
      billedByPoLine.set(bl.poLineId, agg);
    }
  }

  return (po.lines ?? []).map((line) => {
    const agg = billedByPoLine.get(line.id);
    const billedUnitCost = agg && agg.qty > 0 ? agg.unitCostSum / agg.qty : null;
    const billedQuantity = agg ? agg.qty : 0;
    const quantityVariance = line.quantityReceived - line.quantityOrdered;
    const costVariance = billedUnitCost == null ? null : billedUnitCost - line.unitCost;
    return {
      poLineId: line.id,
      description: line.description,
      quantityOrdered: line.quantityOrdered,
      quantityReceived: line.quantityReceived,
      quantityVariance,
      poUnitCost: line.unitCost,
      billedUnitCost,
      costVariance,
      billedQuantity,
      billCount: agg ? agg.billIds.size : 0,
      fullyReceived: line.quantityReceived >= line.quantityOrdered,
    };
  });
}

export const purchaseOrdersService = {
  async list(limit = 200): Promise<PurchaseOrder[]> {
    const { data, error } = await acct()
      .from('purchase_orders')
      .select('*, vendor:vendors(display_name)')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapPurchaseOrderRow);
  },

  async getById(id: string): Promise<PurchaseOrder | null> {
    const { data, error } = await acct()
      .from('purchase_orders')
      .select(SELECT_DETAIL)
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    return mapPurchaseOrderRow(data as Row);
  },

  /** Insert a draft PO + its lines, with money fields computed from the lines. */
  async createDraft(
    input: NewPurchaseOrderInput
  ): Promise<{ purchaseOrder: PurchaseOrder | null; error?: string }> {
    if (!input.lines.length)
      return { purchaseOrder: null, error: 'A purchase order needs at least one line.' };
    const totals = computePurchaseOrderTotals(input.lines, input.taxTotal);
    const cents = (c: number) => Math.round(c) / 100;

    const { data: header, error: hErr } = await acct()
      .from('purchase_orders')
      .insert({
        vendor_id: input.vendorId,
        po_number: input.poNumber ?? null,
        order_date: input.orderDate ?? new Date().toISOString().slice(0, 10),
        expected_date: input.expectedDate ?? null,
        status: input.status ?? 'draft',
        job_id: input.jobId ?? null,
        subtotal: cents(totals.subtotalCents),
        tax_total: cents(totals.taxCents),
        total: cents(totals.totalCents),
        memo: input.memo ?? null,
      })
      .select('*')
      .single();
    if (hErr || !header)
      return { purchaseOrder: null, error: hErr?.message ?? 'Failed to create purchase order.' };

    const poId = (header as Row).id as string;
    const { error: lErr } = await acct()
      .from('purchase_order_lines')
      .insert(lineRows(poId, input.lines));
    if (lErr) {
      await acct().from('purchase_orders').delete().eq('id', poId);
      return { purchaseOrder: null, error: lErr.message };
    }
    return { purchaseOrder: await this.getById(poId) };
  },

  /**
   * Replace a PO's header + lines and recompute money fields. Permitted while the PO is
   * still `draft` or `open` (nothing has been received yet); a partially/fully received
   * PO is locked from line edits to keep receipt accruals consistent.
   */
  async updateDraft(
    id: string,
    input: UpdatePurchaseOrderInput
  ): Promise<{ purchaseOrder: PurchaseOrder | null; error?: string }> {
    const existing = await this.getById(id);
    if (!existing) return { purchaseOrder: null, error: 'Purchase order not found.' };
    if (existing.status !== 'draft' && existing.status !== 'open') {
      return {
        purchaseOrder: null,
        error: `Only draft or open purchase orders can be edited (this one is ${existing.status}).`,
      };
    }
    const lines = input.lines ?? existing.lines?.map(toLineInput) ?? [];
    const taxTotal = input.taxTotal !== undefined ? input.taxTotal : existing.taxTotal;
    const totals = computePurchaseOrderTotals(lines, taxTotal);
    const cents = (c: number) => Math.round(c) / 100;

    const patch: Record<string, unknown> = {
      subtotal: cents(totals.subtotalCents),
      tax_total: cents(totals.taxCents),
      total: cents(totals.totalCents),
    };
    if (input.vendorId !== undefined) patch.vendor_id = input.vendorId;
    if (input.poNumber !== undefined) patch.po_number = input.poNumber;
    if (input.orderDate !== undefined) patch.order_date = input.orderDate;
    if (input.expectedDate !== undefined) patch.expected_date = input.expectedDate;
    if (input.status !== undefined) patch.status = input.status;
    if (input.jobId !== undefined) patch.job_id = input.jobId;
    if (input.memo !== undefined) patch.memo = input.memo;

    const { error: uErr } = await acct().from('purchase_orders').update(patch).eq('id', id);
    if (uErr) return { purchaseOrder: null, error: uErr.message };

    if (input.lines) {
      await acct().from('purchase_order_lines').delete().eq('po_id', id);
      const { error: lErr } = await acct()
        .from('purchase_order_lines')
        .insert(lineRows(id, input.lines));
      if (lErr) return { purchaseOrder: null, error: lErr.message };
    }
    return { purchaseOrder: await this.getById(id) };
  },

  /** Mark a draft PO `open` (issued to the vendor). No money moves (a PO posts no JE). */
  async issue(id: string): Promise<{ purchaseOrder: PurchaseOrder | null; error?: string }> {
    const po = await this.getById(id);
    if (!po) return { purchaseOrder: null, error: 'Purchase order not found.' };
    if (po.status !== 'draft') {
      return {
        purchaseOrder: null,
        error: `Only a draft purchase order can be issued (this one is ${po.status}).`,
      };
    }
    if (!po.lines || po.lines.length === 0) {
      return { purchaseOrder: null, error: 'Cannot issue a purchase order with no lines.' };
    }
    const { error } = await acct().from('purchase_orders').update({ status: 'open' }).eq('id', id);
    if (error) return { purchaseOrder: null, error: error.message };
    return { purchaseOrder: await this.getById(id) };
  },

  /**
   * Record received quantities per line and advance status (no money posts — receiving a
   * PO books nothing; the bill it converts into posts the expense). `received` maps each
   * po_line_id to its NEW total quantity_received (clamped at ordered). Status becomes
   * `received` when every line is fully received, else `partially_received`.
   */
  async receive(
    id: string,
    received: { poLineId: string; quantityReceived: number }[]
  ): Promise<{ purchaseOrder: PurchaseOrder | null; error?: string }> {
    const po = await this.getById(id);
    if (!po) return { purchaseOrder: null, error: 'Purchase order not found.' };
    if (po.status === 'cancelled' || po.status === 'closed') {
      return {
        purchaseOrder: null,
        error: `Cannot receive against a ${po.status} purchase order.`,
      };
    }
    const byId = new Map((po.lines ?? []).map((l) => [l.id, l]));
    for (const r of received) {
      const line = byId.get(r.poLineId);
      if (!line) continue;
      const clamped = Math.min(Math.max(0, r.quantityReceived), line.quantityOrdered);
      const { error } = await acct()
        .from('purchase_order_lines')
        .update({ quantity_received: clamped })
        .eq('id', r.poLineId);
      if (error) return { purchaseOrder: null, error: error.message };
      line.quantityReceived = clamped;
    }

    // Recompute status from the (locally-updated) lines.
    const lines = po.lines ?? [];
    const allReceived =
      lines.length > 0 && lines.every((l) => l.quantityReceived >= l.quantityOrdered);
    const anyReceived = lines.some((l) => l.quantityReceived > 0);
    const nextStatus: PoStatus = allReceived
      ? 'received'
      : anyReceived
        ? 'partially_received'
        : po.status === 'draft'
          ? 'draft'
          : 'open';
    const { error: sErr } = await acct()
      .from('purchase_orders')
      .update({ status: nextStatus })
      .eq('id', id);
    if (sErr) return { purchaseOrder: null, error: sErr.message };
    return { purchaseOrder: await this.getById(id) };
  },

  /** Mark a PO `closed` (no more receipts/bills expected). No money moves. */
  async close(id: string): Promise<{ purchaseOrder: PurchaseOrder | null; error?: string }> {
    const po = await this.getById(id);
    if (!po) return { purchaseOrder: null, error: 'Purchase order not found.' };
    if (po.status === 'cancelled') {
      return { purchaseOrder: null, error: 'A cancelled purchase order cannot be closed.' };
    }
    const { error } = await acct()
      .from('purchase_orders')
      .update({ status: 'closed' })
      .eq('id', id);
    if (error) return { purchaseOrder: null, error: error.message };
    return { purchaseOrder: await this.getById(id) };
  },

  /** Mark a PO `cancelled`. Refused once anything has been received (unwind the bill first). */
  async cancel(id: string): Promise<{ purchaseOrder: PurchaseOrder | null; error?: string }> {
    const po = await this.getById(id);
    if (!po) return { purchaseOrder: null, error: 'Purchase order not found.' };
    if (po.status === 'cancelled') return { purchaseOrder: po };
    if ((po.lines ?? []).some((l) => l.quantityReceived > 0)) {
      return {
        purchaseOrder: null,
        error: 'This purchase order has received lines — void its bill(s) before cancelling.',
      };
    }
    const { error } = await acct()
      .from('purchase_orders')
      .update({ status: 'cancelled' })
      .eq('id', id);
    if (error) return { purchaseOrder: null, error: error.message };
    return { purchaseOrder: await this.getById(id) };
  },

  /**
   * Convert a PO into a DRAFT bill via accounting.convert_po_to_bill (atomic). Returns the
   * new bill id so the UI can navigate to it; the bill still needs POSTING to record its
   * expense JE (no money posts at convert time). The RPC stamps each new bill line's
   * po_line_id (the 3-way-match link) and accrues quantity_received.
   */
  async convertToBill(id: string): Promise<{ billId: string | null; error?: string }> {
    const { data, error } = await acct().rpc('convert_po_to_bill', { p_po_id: id });
    if (error) return { billId: null, error: error.message };
    const billId = typeof data === 'string' ? data : nstr(data);
    if (!billId) return { billId: null, error: 'Conversion did not return a bill.' };
    return { billId };
  },

  /**
   * The bills produced from a PO (for the variance panel): every bill carrying a line whose
   * po_line_id belongs to this PO. Returns full bills (header + lines) so the caller can run
   * computePoVariances. Two-step (line ids → bill ids → bills) because PostgREST cannot
   * filter a parent by a grandchild column in one query.
   */
  async listBillsForPo(poId: string): Promise<Bill[]> {
    const po = await this.getById(poId);
    const lineIds = (po?.lines ?? []).map((l) => l.id);
    if (lineIds.length === 0) return [];

    const { data: linkRows, error: lErr } = await acct()
      .from('bill_lines')
      .select('bill_id, po_line_id')
      .in('po_line_id', lineIds);
    if (lErr) throw lErr;
    const billIds = Array.from(
      new Set(((linkRows ?? []) as Row[]).map((r) => str(r.bill_id)).filter(Boolean))
    );
    if (billIds.length === 0) return [];

    const { data, error } = await acct()
      .from('bills')
      .select('*, lines:bill_lines(*), vendor:vendors(display_name)')
      .in('id', billIds)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapBillRow);
  },
};

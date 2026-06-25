/**
 * Pure domain → SalesDocumentData mappers for the shared <SalesDocument /> renderer.
 *
 * This is the ONE place allowed to import the accounting domain `../types`; the
 * component and salesDocumentTypes stay portal-safe (no domain/client imports). No
 * side effects, no I/O — given an Invoice/Estimate, return the plain render shape.
 *
 * The per-document `layout` (invoices.layout / estimates.layout) and each line's
 * `partId` (invoice_lines.part_id / estimate_lines.part_id) are threaded through from
 * the domain objects; both fall back to null when unset.
 */

import type { Invoice, Estimate } from '../types';
import { INVOICE_STATUS_LABELS, ESTIMATE_STATUS_LABELS } from '../types';
import type { SalesDocumentData, SalesDocLine } from './salesDocumentTypes';

/** Structural shape shared by InvoiceLine and EstimateLine for mapping purposes. */
type DocLineRow = {
  id: string;
  partId: string | null;
  description: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  discount: number;
  taxable: boolean;
  taxCodeId: string | null;
  sortOrder: number;
};

/** Lines sorted by sortOrder asc, mapped to the renderer's SalesDocLine shape. */
function toSalesDocLines(rows: DocLineRow[] | undefined): SalesDocLine[] {
  return [...(rows ?? [])]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((line, index) => ({
      key: line.id ?? String(index),
      id: line.id,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      lineTotal: line.lineTotal,
      discount: line.discount,
      taxable: line.taxable,
      taxCodeId: line.taxCodeId,
      partId: line.partId ?? null,
    }));
}

/** Map a domain Invoice to the plain SalesDocumentData the renderer consumes. */
export function invoiceToSalesDocumentData(invoice: Invoice): SalesDocumentData {
  return {
    kind: 'invoice',
    number: invoice.invoiceNumber,
    date: invoice.invoiceDate,
    secondaryDate: invoice.dueDate,
    terms: invoice.terms,
    statusLabel: INVOICE_STATUS_LABELS[invoice.status],
    status: invoice.status,
    customerName: invoice.customerName ?? '',
    subtotal: invoice.subtotal,
    discountTotal: invoice.discountTotal,
    taxTotal: invoice.taxTotal,
    total: invoice.total,
    amountPaid: invoice.amountPaid,
    balanceDue: invoice.balanceDue,
    memo: invoice.memo,
    notes: invoice.notes,
    lines: toSalesDocLines(invoice.lines),
    layout: invoice.layout ?? null,
  };
}

/** Map a domain Estimate to the plain SalesDocumentData the renderer consumes. */
export function estimateToSalesDocumentData(estimate: Estimate): SalesDocumentData {
  return {
    kind: 'estimate',
    number: estimate.estimateNumber,
    date: estimate.estimateDate,
    secondaryDate: estimate.expiryDate,
    terms: estimate.terms,
    statusLabel: ESTIMATE_STATUS_LABELS[estimate.status],
    status: estimate.status,
    customerName: estimate.customerName ?? '',
    poNumber: estimate.poNumber,
    salesRep: estimate.salesRep,
    subtotal: estimate.subtotal,
    discountTotal: estimate.discountTotal,
    taxTotal: estimate.taxTotal,
    total: estimate.total,
    // Estimates have no payments block.
    amountPaid: null,
    balanceDue: null,
    // `memo` is the internal "memo on statement" — hidden from the customer-facing estimate, so it
    // is intentionally NOT passed to the renderer. `notes` is the "Note to customer" and prints.
    memo: null,
    notes: estimate.notes,
    lines: toSalesDocLines(estimate.lines),
    layout: estimate.layout ?? null,
  };
}

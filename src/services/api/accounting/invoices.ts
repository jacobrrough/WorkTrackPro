import type {
  Invoice,
  NewInvoiceInput,
  NewInvoiceLineInput,
  UpdateInvoiceInput,
} from '../../../features/accounting/types';
import {
  buildInvoiceRevenueJournalLines,
  computeInvoiceTotals,
  type InvoiceTotals,
} from '../../../features/accounting/posting';
import { acct } from './accountingClient';
import { mapInvoiceRow, type Row } from './mappers';
import { journalService } from './journal';
import { accountingSettingsService } from './settings';
import { taxService } from './tax';

/**
 * AR invoices (accounting.invoices/invoice_lines). Invoices are created as `draft`
 * with their line items and computed money fields. Sending an invoice posts a
 * BALANCED revenue journal entry through accounting.post_journal_entry
 * (Dr 1200 Accounts Receivable / Cr 4000|4100 Income / Cr 2200 Sales Tax Payable),
 * links journal_entry_id back onto the invoice, and flips status to `sent`.
 *
 * Reads throw (React Query surfaces them); writes return a result object whose
 * `error` carries the DB message (e.g. an unbalanced-entry rejection) so the UI can
 * show it without the orphan draft JE leaking — journalService.createAndPost cleans
 * up a failed post for us.
 */

const SELECT_DETAIL = '*, lines:invoice_lines(*), customer:customers(display_name)';

/** Build a tax-rate resolver (code id -> decimal rate) from the seeded tax codes. */
async function taxRateResolver(): Promise<(id: string | null | undefined) => number> {
  const codes = await taxService.getAll(true);
  const byId = new Map(codes.map((c) => [c.id, c.isTaxable ? c.rate : 0]));
  return (id) => (id ? (byId.get(id) ?? 0) : 0);
}

/** Compute money totals for a set of input lines (shared by create + send). */
async function computeTotalsFor(
  lines: NewInvoiceLineInput[],
  headerTaxCodeId: string | null | undefined,
  customerTaxExempt: boolean
): Promise<InvoiceTotals> {
  const [defaults, rateOf] = await Promise.all([
    accountingSettingsService.getDefaultAccounts(),
    taxRateResolver(),
  ]);
  return computeInvoiceTotals({
    lines,
    defaultIncomeAccountId: defaults.salesIncome,
    headerTaxCodeId,
    taxRateByCode: rateOf,
    taxExempt: customerTaxExempt,
  });
}

function lineRows(invoiceId: string, lines: NewInvoiceLineInput[]): Record<string, unknown>[] {
  return lines.map((l, i) => {
    const explicitTotal = l.lineTotal != null;
    const lineTotal = explicitTotal
      ? l.lineTotal!
      : Math.max(0, (l.quantity || 0) * (l.unitPrice || 0) - (l.discount ?? 0));
    return {
      invoice_id: invoiceId,
      item_id: l.itemId ?? null,
      description: l.description ?? null,
      quantity: l.quantity ?? 1,
      unit_price: l.unitPrice ?? 0,
      line_total: Math.round(lineTotal * 100) / 100,
      discount: l.discount ?? 0,
      tax_code_id: l.taxCodeId ?? null,
      taxable: l.taxable !== false,
      income_account_id: l.incomeAccountId ?? null,
      job_id: l.jobId ?? null,
      // B2 reporting dimensions, persisted on the AR line and stamped onto the income JE.
      class_id: l.classId ?? null,
      location_id: l.locationId ?? null,
      department_id: l.departmentId ?? null,
      sort_order: i,
    };
  });
}

export const invoicesService = {
  async list(limit = 200): Promise<Invoice[]> {
    const { data, error } = await acct()
      .from('invoices')
      .select('*, customer:customers(display_name)')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapInvoiceRow);
  },

  async getById(id: string): Promise<Invoice | null> {
    const { data, error } = await acct()
      .from('invoices')
      .select(SELECT_DETAIL)
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    return mapInvoiceRow(data as Row);
  },

  /** Resolve an invoice by its number → a light ref for job-card deep links. */
  async findByNumber(
    invoiceNumber: string
  ): Promise<{ id: string; status: string; customerName: string | null } | null> {
    const num = invoiceNumber.trim();
    if (!num) return null;
    const { data, error } = await acct()
      .from('invoices')
      .select('id, status, customer:customers(display_name)')
      .eq('invoice_number', num)
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as Row;
    const customer = (row.customer ?? null) as Row | null;
    return {
      id: String(row.id),
      status: String(row.status ?? ''),
      customerName: customer?.display_name ? String(customer.display_name) : null,
    };
  },

  /**
   * Invoices billed against a given job (for the B1 job-costing detail screen).
   * Header rows only (no lines) — newest first. Mirrors billsService.listForVendor.
   */
  async listForJob(jobId: string, limit = 200): Promise<Invoice[]> {
    const { data, error } = await acct()
      .from('invoices')
      .select('*, customer:customers(display_name)')
      .eq('job_id', jobId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapInvoiceRow);
  },

  /** Insert a draft invoice + its lines, with money fields computed from the lines. */
  async createDraft(
    input: NewInvoiceInput,
    opts?: { customerTaxExempt?: boolean }
  ): Promise<{ invoice: Invoice | null; error?: string }> {
    if (!input.lines.length) return { invoice: null, error: 'An invoice needs at least one line.' };
    const totals = await computeTotalsFor(
      input.lines,
      input.taxCodeId,
      opts?.customerTaxExempt ?? false
    );
    const cents = (c: number) => Math.round(c) / 100;

    const { data: header, error: hErr } = await acct()
      .from('invoices')
      .insert({
        customer_id: input.customerId,
        job_id: input.jobId ?? null,
        invoice_date: input.invoiceDate ?? new Date().toISOString().slice(0, 10),
        due_date: input.dueDate ?? null,
        terms: input.terms ?? null,
        status: 'draft',
        subtotal: cents(totals.subtotalCents),
        discount_total: cents(totals.discountCents),
        tax_total: cents(totals.taxCents),
        total: cents(totals.totalCents),
        balance_due: cents(totals.totalCents),
        tax_code_id: input.taxCodeId ?? null,
        memo: input.memo ?? null,
        notes: input.notes ?? null,
      })
      .select('*')
      .single();
    if (hErr || !header)
      return { invoice: null, error: hErr?.message ?? 'Failed to create invoice.' };

    const invoiceId = (header as Row).id as string;
    const { error: lErr } = await acct()
      .from('invoice_lines')
      .insert(lineRows(invoiceId, input.lines));
    if (lErr) {
      await acct().from('invoices').delete().eq('id', invoiceId);
      return { invoice: null, error: lErr.message };
    }
    const created = await this.getById(invoiceId);
    return { invoice: created };
  },

  /**
   * Replace a draft invoice's header + lines and recompute money fields. Only
   * permitted while the invoice is still `draft` (a sent invoice has a posted JE and
   * is corrected by void + reissue). Returns an error otherwise.
   */
  async updateDraft(
    id: string,
    input: UpdateInvoiceInput,
    opts?: { customerTaxExempt?: boolean }
  ): Promise<{ invoice: Invoice | null; error?: string }> {
    const existing = await this.getById(id);
    if (!existing) return { invoice: null, error: 'Invoice not found.' };
    if (existing.status !== 'draft') {
      return {
        invoice: null,
        error: `Only draft invoices can be edited (this one is ${existing.status}).`,
      };
    }
    const lines = input.lines ?? existing.lines?.map(toLineInput) ?? [];
    const headerTaxCode = input.taxCodeId !== undefined ? input.taxCodeId : existing.taxCodeId;
    const totals = await computeTotalsFor(lines, headerTaxCode, opts?.customerTaxExempt ?? false);
    const cents = (c: number) => Math.round(c) / 100;

    const patch: Record<string, unknown> = {
      subtotal: cents(totals.subtotalCents),
      discount_total: cents(totals.discountCents),
      tax_total: cents(totals.taxCents),
      total: cents(totals.totalCents),
      balance_due: cents(totals.totalCents),
    };
    if (input.customerId !== undefined) patch.customer_id = input.customerId;
    if (input.jobId !== undefined) patch.job_id = input.jobId;
    if (input.invoiceDate !== undefined) patch.invoice_date = input.invoiceDate;
    if (input.dueDate !== undefined) patch.due_date = input.dueDate;
    if (input.terms !== undefined) patch.terms = input.terms;
    if (input.taxCodeId !== undefined) patch.tax_code_id = input.taxCodeId;
    if (input.memo !== undefined) patch.memo = input.memo;
    if (input.notes !== undefined) patch.notes = input.notes;

    const { error: uErr } = await acct().from('invoices').update(patch).eq('id', id);
    if (uErr) return { invoice: null, error: uErr.message };

    if (input.lines) {
      await acct().from('invoice_lines').delete().eq('invoice_id', id);
      const { error: lErr } = await acct().from('invoice_lines').insert(lineRows(id, input.lines));
      if (lErr) return { invoice: null, error: lErr.message };
    }
    return { invoice: await this.getById(id) };
  },

  /**
   * Post the revenue JE for a draft invoice and mark it `sent`. The JE is built from
   * the (re-fetched) lines so it always reflects what is stored. If posting fails
   * (unbalanced, RLS, missing accounts) the invoice stays `draft` and the DB message
   * is returned; createAndPost removes any half-created draft entry.
   */
  async send(id: string): Promise<{ invoice: Invoice | null; error?: string }> {
    const invoice = await this.getById(id);
    if (!invoice) return { invoice: null, error: 'Invoice not found.' };
    if (invoice.status !== 'draft') {
      return {
        invoice: null,
        error: `Only draft invoices can be sent (this one is ${invoice.status}).`,
      };
    }
    if (!invoice.lines || invoice.lines.length === 0) {
      return { invoice: null, error: 'Cannot send an invoice with no lines.' };
    }

    // Resolve the customer's tax-exempt flag so we never tax an exempt sale.
    let taxExempt = false;
    const { data: cust } = await acct()
      .from('customers')
      .select('tax_exempt')
      .eq('id', invoice.customerId)
      .maybeSingle();
    if (cust) taxExempt = (cust as Row).tax_exempt === true;

    const totals = await computeTotalsFor(
      invoice.lines.map(toLineInput),
      invoice.taxCodeId,
      taxExempt
    );
    const defaults = await accountingSettingsService.getDefaultAccounts();

    let je;
    try {
      je = buildInvoiceRevenueJournalLines(totals, defaults, { customerId: invoice.customerId });
    } catch (e) {
      return {
        invoice: null,
        error: e instanceof Error ? e.message : 'Unable to build the revenue entry.',
      };
    }

    // Stamp the job dimension on the AR line for job-costing when the invoice is job-linked.
    const lines = invoice.jobId ? je.lines.map((l) => ({ ...l, jobId: invoice.jobId })) : je.lines;

    const posted = await journalService.createAndPost({
      entryDate: invoice.invoiceDate || new Date().toISOString().slice(0, 10),
      memo: `Invoice ${invoice.invoiceNumber ?? id}`,
      sourceType: 'invoice',
      sourceId: id,
      lines,
    });
    if (!posted.entryId) {
      return { invoice: null, error: posted.error ?? 'Failed to post the revenue journal entry.' };
    }

    const { error: uErr } = await acct()
      .from('invoices')
      .update({
        status: 'sent',
        journal_entry_id: posted.entryId,
        subtotal: je.subtotal,
        discount_total: je.discountTotal,
        tax_total: je.taxTotal,
        total: je.total,
        balance_due: je.total,
      })
      .eq('id', id);
    if (uErr) {
      // The JE is posted but the link failed; void the entry to avoid a dangling post.
      await journalService.voidEntry(posted.entryId, 'Invoice send failed after posting');
      return { invoice: null, error: uErr.message };
    }
    return { invoice: await this.getById(id) };
  },

  /**
   * Void a sent invoice: reverse its posted revenue JE (if any) and mark it `void`.
   * Draft invoices are simply marked void (no JE exists yet).
   */
  async voidInvoice(id: string, reason: string): Promise<{ ok: boolean; error?: string }> {
    const invoice = await this.getById(id);
    if (!invoice) return { ok: false, error: 'Invoice not found.' };
    if (invoice.status === 'void') return { ok: true };
    if (invoice.amountPaid > 0) {
      return { ok: false, error: 'Unapply payments before voiding this invoice.' };
    }
    if (invoice.journalEntryId) {
      const v = await journalService.voidEntry(invoice.journalEntryId, reason || 'Invoice voided');
      if (!v.ok) return { ok: false, error: v.error };
    }
    const { error } = await acct().from('invoices').update({ status: 'void' }).eq('id', id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },
};

/** Adapt a persisted InvoiceLine back to the create/update input shape. */
function toLineInput(l: {
  itemId: string | null;
  description: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  discount: number;
  taxCodeId: string | null;
  taxable: boolean;
  incomeAccountId: string | null;
  jobId: string | null;
  classId: string | null;
  locationId: string | null;
  departmentId: string | null;
}): NewInvoiceLineInput {
  return {
    itemId: l.itemId,
    description: l.description,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    lineTotal: l.lineTotal,
    discount: l.discount,
    taxCodeId: l.taxCodeId,
    taxable: l.taxable,
    incomeAccountId: l.incomeAccountId,
    jobId: l.jobId,
    classId: l.classId,
    locationId: l.locationId,
    departmentId: l.departmentId,
  };
}

import type {
  Invoice,
  NewInvoiceInput,
  NewInvoiceLineInput,
  UpdateInvoiceInput,
} from '../../../features/accounting/types';
import {
  buildInvoiceRevenueJournalLines,
  computeInvoiceTotals,
  journalLinesEquivalent,
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
      part_id: l.partId ?? null,
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

  /** Invoices for a given customer (the Customers hub AR list). Header rows only, newest first. */
  async listByCustomer(customerId: string, limit = 200): Promise<Invoice[]> {
    const { data, error } = await acct()
      .from('invoices')
      .select('*, customer:customers(display_name)')
      .eq('customer_id', customerId)
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
    // Snapshot the pre-edit state so this change can be reverted (best-effort; never block the save).
    try {
      await acct().rpc('capture_document_snapshot', {
        p_type: 'invoice',
        p_id: id,
        p_note: 'before edit',
      });
    } catch {
      /* version snapshot is best-effort */
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
    if (input.layout !== undefined) patch.layout = input.layout;

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
   * Link (or unlink) this invoice to a job by setting ONLY invoices.job_id. The job link is a
   * pure organizational/reporting tag — it posts NOTHING and moves no money — so, unlike
   * updateDraft (draft-only; it rewrites lines + recomputes totals), this is allowed at ANY
   * status. That lets an already-sent or paid invoice be filed against the right job after the
   * fact. accounting.v_job_costing rolls revenue up by invoices.job_id, so the job's
   * costing/billing reflects the change immediately. Pass null to unlink.
   *
   * NOTE: the per-line job_id and the dimension stamped on an ALREADY-POSTED revenue JE are
   * left untouched (re-stamping a posted entry is out of scope for a link action); the job's
   * revenue rollup keys off the header job_id, which this sets.
   */
  async setJob(id: string, jobId: string | null): Promise<{ ok: boolean; error?: string }> {
    const { error } = await acct().from('invoices').update({ job_id: jobId }).eq('id', id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  /**
   * Manually set (or clear) an invoice's number. Numbers are normally auto-assigned and
   * sequential (a DB trigger stamps INV-NNNNN on insert); this is the deliberate override for
   * reconciling against QuickBooks while both systems run side by side. invoice_number is UNIQUE,
   * so a clash is rejected with a clear message. Pass an empty string to clear it.
   */
  async setNumber(id: string, invoiceNumber: string): Promise<{ ok: boolean; error?: string }> {
    const trimmed = invoiceNumber.trim();
    const { error } = await acct()
      .from('invoices')
      .update({ invoice_number: trimmed || null })
      .eq('id', id);
    if (error) {
      const dup = /duplicate|unique/i.test(error.message);
      return {
        ok: false,
        error: dup ? `Invoice number "${trimmed}" is already in use.` : error.message,
      };
    }
    return { ok: true };
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
    // Pin a 'sent' snapshot + stamp the sent-version hash so the UI can show whether the customer
    // holds the current copy. Best-effort — never fail a successful send over this bookkeeping.
    try {
      await acct().rpc('record_document_sent', { p_type: 'invoice', p_id: id });
    } catch {
      /* sent-version tracking is best-effort */
    }
    return { invoice: await this.getById(id) };
  },

  /**
   * Edit a POSTED invoice in place (QuickBooks-style). Drafts route to updateDraft; a void invoice
   * is rejected (reissue instead). When the rebuilt revenue JE is identical to the one already
   * posted AND the invoice date is unchanged, the edit is ledger-neutral (memo/notes/terms/etc.)
   * so we just rewrite the header + lines — no GL churn. Otherwise we REVERSE + RE-POST: post a
   * fresh balanced revenue JE, then atomically swap header/lines + relink + void the old entry via
   * accounting.apply_posted_invoice_edit. If that atomic step fails, the just-posted replacement is
   * voided so the trial balance never drifts. A financial edit requires an unpaid invoice (and an
   * open period — the post/void RPCs enforce the books-closed lock and surface a clear message).
   */
  async editPosted(
    id: string,
    input: UpdateInvoiceInput,
    opts?: { customerTaxExempt?: boolean }
  ): Promise<{ invoice: Invoice | null; error?: string }> {
    const existing = await this.getById(id);
    if (!existing) return { invoice: null, error: 'Invoice not found.' };
    if (existing.status === 'void') {
      return {
        invoice: null,
        error: 'A void invoice cannot be edited — reissue a new one instead.',
      };
    }
    if (existing.status === 'draft') {
      return this.updateDraft(id, input, opts);
    }

    const lines = input.lines ?? existing.lines?.map(toLineInput) ?? [];
    if (!lines.length) return { invoice: null, error: 'An invoice needs at least one line.' };

    const customerId = input.customerId !== undefined ? input.customerId : existing.customerId;
    const headerTaxCode = input.taxCodeId !== undefined ? input.taxCodeId : existing.taxCodeId;
    const invoiceDate = input.invoiceDate !== undefined ? input.invoiceDate : existing.invoiceDate;
    const jobId = input.jobId !== undefined ? input.jobId : existing.jobId;

    // Resolve the customer's tax-exempt flag so we never tax an exempt sale (mirror send()).
    let taxExempt = opts?.customerTaxExempt ?? false;
    if (opts?.customerTaxExempt === undefined) {
      const { data: cust } = await acct()
        .from('customers')
        .select('tax_exempt')
        .eq('id', customerId)
        .maybeSingle();
      if (cust) taxExempt = (cust as Row).tax_exempt === true;
    }

    const totals = await computeTotalsFor(lines, headerTaxCode, taxExempt);
    const defaults = await accountingSettingsService.getDefaultAccounts();
    let je;
    try {
      je = buildInvoiceRevenueJournalLines(totals, defaults, { customerId });
    } catch (e) {
      return {
        invoice: null,
        error: e instanceof Error ? e.message : 'Unable to build the revenue entry.',
      };
    }
    const jeLines = jobId ? je.lines.map((l) => ({ ...l, jobId })) : je.lines;

    // Header payload (snake_case) shared by both paths; lines reuse the create/update row builder.
    const header: Record<string, unknown> = {
      customer_id: customerId,
      job_id: jobId,
      invoice_date: invoiceDate,
      due_date: input.dueDate !== undefined ? input.dueDate : existing.dueDate,
      terms: input.terms !== undefined ? input.terms : existing.terms,
      tax_code_id: headerTaxCode,
      memo: input.memo !== undefined ? input.memo : existing.memo,
      notes: input.notes !== undefined ? input.notes : existing.notes,
      subtotal: je.subtotal,
      discount_total: je.discountTotal,
      tax_total: je.taxTotal,
      total: je.total,
      layout: input.layout !== undefined ? input.layout : existing.layout,
    };
    const linePayload = lineRows(id, lines);

    // Ledger-neutral edit? Rebuilt JE identical to the posted one AND the (JE-dating) date unchanged.
    const existingJe = existing.journalEntryId
      ? await journalService.getById(existing.journalEntryId)
      : null;
    const ledgerUnchanged =
      existingJe != null &&
      existingJe.status === 'posted' &&
      invoiceDate === existing.invoiceDate &&
      journalLinesEquivalent(existingJe.lines ?? [], jeLines);

    if (ledgerUnchanged) {
      // No GL change: pin the pre-edit version, then rewrite header + lines only.
      try {
        await acct().rpc('capture_document_snapshot', {
          p_type: 'invoice',
          p_id: id,
          p_note: 'before edit',
        });
      } catch {
        /* version snapshot is best-effort */
      }
      const patch = {
        ...header,
        balance_due: Math.round((je.total - existing.amountPaid) * 100) / 100,
      };
      const { error: uErr } = await acct().from('invoices').update(patch).eq('id', id);
      if (uErr) return { invoice: null, error: uErr.message };
      await acct().from('invoice_lines').delete().eq('invoice_id', id);
      const { error: lErr } = await acct().from('invoice_lines').insert(linePayload);
      if (lErr) return { invoice: null, error: lErr.message };
      return { invoice: await this.getById(id) };
    }

    // Financial edit: only on an unpaid invoice. Post the replacement JE first, then atomically swap.
    if (existing.amountPaid > 0) {
      return {
        invoice: null,
        error: 'Unapply payments before changing the amounts on this invoice.',
      };
    }
    const posted = await journalService.createAndPost({
      entryDate: invoiceDate || new Date().toISOString().slice(0, 10),
      memo: `Invoice ${existing.invoiceNumber ?? id}`,
      sourceType: 'invoice',
      sourceId: id,
      lines: jeLines,
    });
    if (!posted.entryId) {
      return { invoice: null, error: posted.error ?? 'Failed to post the revised revenue entry.' };
    }
    const { error: rpcErr } = await acct().rpc('apply_posted_invoice_edit', {
      p_invoice_id: id,
      p_new_entry_id: posted.entryId,
      p_header: header,
      p_lines: linePayload,
    });
    if (rpcErr) {
      // The replacement posted but the swap failed; void it so the books never drift.
      await journalService.voidEntry(
        posted.entryId,
        'Invoice edit failed after posting replacement'
      );
      return { invoice: null, error: rpcErr.message };
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

  /**
   * Void a sent invoice and clone it into a fresh DRAFT via
   * accounting.void_and_reissue_invoice (atomic). The RPC guards amount_paid=0 and
   * rejects draft/void/paid invoices; it returns the NEW draft invoice id so the UI
   * can navigate to it (the reissued draft still needs SENDING to post its JE).
   */
  async voidAndReissue(id: string): Promise<{ invoiceId: string | null; error?: string }> {
    const { data, error } = await acct().rpc('void_and_reissue_invoice', { p_invoice_id: id });
    if (error) return { invoiceId: null, error: error.message };
    const invoiceId = typeof data === 'string' ? data : data == null ? null : String(data);
    if (!invoiceId) return { invoiceId: null, error: 'Reissue did not return a draft invoice.' };
    return { invoiceId };
  },

  /**
   * Permanently delete a DRAFT invoice (and its lines). A draft has posted nothing to the
   * ledger, so a hard delete leaves no dangling journal entry. Sent/posted invoices carry a
   * posted JE + number/audit and must be VOIDED instead — rejected here.
   */
  async deleteDraft(id: string): Promise<{ ok: boolean; error?: string }> {
    const existing = await this.getById(id);
    if (!existing) return { ok: false, error: 'Invoice not found.' };
    if (existing.status !== 'draft') {
      return {
        ok: false,
        error: `Only draft invoices can be deleted (this one is ${existing.status}). Void it instead.`,
      };
    }
    await acct().from('invoice_lines').delete().eq('invoice_id', id);
    const { error } = await acct().from('invoices').delete().eq('id', id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },
};

/** Adapt a persisted InvoiceLine back to the create/update input shape. */
function toLineInput(l: {
  itemId: string | null;
  partId: string | null;
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
    partId: l.partId,
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

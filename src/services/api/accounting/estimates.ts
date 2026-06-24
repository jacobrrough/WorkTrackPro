import type {
  Estimate,
  EstimateLine,
  EstimateStatus,
  NewEstimateInput,
  NewEstimateLineInput,
  UpdateEstimateInput,
} from '../../../features/accounting/types';
import type { PerDocLayout } from '../../../features/accounting/documents/salesDocumentTypes';
import { computeInvoiceTotals, type InvoiceTotals } from '../../../features/accounting/posting';
import { acct } from './accountingClient';
import type { Row } from './mappers';
import { accountingSettingsService } from './settings';
import { taxService } from './tax';

/**
 * Estimates (accounting.estimates / estimate_lines). An estimate is the pre-sale quote:
 * it mirrors an AR invoice's header + lines and computed money fields, but posts NOTHING
 * to the ledger. Money posts only when its converted invoice is later SENT (the existing
 * invoices.send flow posts the balanced revenue JE).
 *
 * Lifecycle: draft → sent → accepted/declined/expired, and (from any non-declined state)
 * → converted. `convert` calls accounting.convert_estimate_to_invoice, which clones a DRAFT
 * invoice atomically + idempotently and links the two; the UI then navigates to that invoice.
 *
 * Reads throw (React Query surfaces them); writes return a result object whose `error`
 * carries the DB message so the UI can show it. createDraft cleans up a half-created
 * header if its line insert fails (mirrors invoicesService.createDraft).
 */

const SELECT_DETAIL = '*, lines:estimate_lines(*), customer:customers(display_name)';

const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const str = (v: unknown): string => (v == null ? '' : String(v));
const nstr = (v: unknown): string | null => (v == null ? null : String(v));
const bool = (v: unknown, fallback = false): boolean =>
  typeof v === 'boolean' ? v : v == null ? fallback : v === 'true' || v === 1;

const VALID_ESTIMATE_STATUSES = new Set<EstimateStatus>([
  'draft',
  'sent',
  'accepted',
  'declined',
  'expired',
  'converted',
]);

function estimateStatus(v: unknown): EstimateStatus {
  const s = str(v) as EstimateStatus;
  return VALID_ESTIMATE_STATUSES.has(s) ? s : 'draft';
}

function mapEstimateLineRow(row: Row): EstimateLine {
  return {
    id: str(row.id),
    estimateId: str(row.estimate_id),
    itemId: nstr(row.item_id),
    partId: nstr(row.part_id),
    description: nstr(row.description),
    quantity: num(row.quantity, 1),
    unitPrice: num(row.unit_price),
    lineTotal: num(row.line_total),
    discount: num(row.discount),
    taxCodeId: nstr(row.tax_code_id),
    taxable: bool(row.taxable, true),
    incomeAccountId: nstr(row.income_account_id),
    jobId: nstr(row.job_id),
    classId: nstr(row.class_id),
    locationId: nstr(row.location_id),
    departmentId: nstr(row.department_id),
    sortOrder: num(row.sort_order),
  };
}

function mapEstimateRow(row: Row): Estimate {
  const rawLines = (row.lines ?? row.estimate_lines ?? null) as Row[] | null;
  const customer = (row.customer ?? null) as Row | null;
  return {
    id: str(row.id),
    estimateNumber: nstr(row.estimate_number),
    customerId: str(row.customer_id),
    jobId: nstr(row.job_id),
    sourceProposalId: nstr(row.source_proposal_id),
    estimateDate: str(row.estimate_date),
    expiryDate: nstr(row.expiry_date),
    terms: nstr(row.terms),
    status: estimateStatus(row.status),
    subtotal: num(row.subtotal),
    discountTotal: num(row.discount_total),
    taxTotal: num(row.tax_total),
    total: num(row.total),
    taxCodeId: nstr(row.tax_code_id),
    convertedInvoiceId: nstr(row.converted_invoice_id),
    acceptedAt: nstr(row.accepted_at),
    memo: nstr(row.memo),
    notes: nstr(row.notes),
    layout: (row.layout as PerDocLayout | null) ?? null,
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
    lines: rawLines
      ? rawLines.map(mapEstimateLineRow).sort((a, b) => a.sortOrder - b.sortOrder)
      : undefined,
    customerName: customer ? str(customer.display_name) : undefined,
  };
}

/** Build a tax-rate resolver (code id -> decimal rate) from the seeded tax codes. */
async function taxRateResolver(): Promise<(id: string | null | undefined) => number> {
  const codes = await taxService.getAll(true);
  const byId = new Map(codes.map((c) => [c.id, c.isTaxable ? c.rate : 0]));
  return (id) => (id ? (byId.get(id) ?? 0) : 0);
}

/** Compute money totals for a set of input lines (shared by create + update). */
async function computeTotalsFor(
  lines: NewEstimateLineInput[],
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

function lineRows(estimateId: string, lines: NewEstimateLineInput[]): Record<string, unknown>[] {
  return lines.map((l, i) => {
    const explicitTotal = l.lineTotal != null;
    const lineTotal = explicitTotal
      ? l.lineTotal!
      : Math.max(0, (l.quantity || 0) * (l.unitPrice || 0) - (l.discount ?? 0));
    return {
      estimate_id: estimateId,
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
      // B2 reporting dimensions, persisted on the line and copied to the invoice line on convert.
      class_id: l.classId ?? null,
      location_id: l.locationId ?? null,
      department_id: l.departmentId ?? null,
      sort_order: i,
    };
  });
}

export const estimatesService = {
  async list(limit = 200): Promise<Estimate[]> {
    const { data, error } = await acct()
      .from('estimates')
      .select('*, customer:customers(display_name)')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapEstimateRow);
  },

  async getById(id: string): Promise<Estimate | null> {
    const { data, error } = await acct()
      .from('estimates')
      .select(SELECT_DETAIL)
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    return mapEstimateRow(data as Row);
  },

  /** Resolve an estimate by its unique number → a light ref for job-card deep links. */
  async findByNumber(
    estimateNumber: string
  ): Promise<{ id: string; status: string; customerName: string | null } | null> {
    const num = estimateNumber.trim();
    if (!num) return null;
    const { data, error } = await acct()
      .from('estimates')
      .select('id, status, customer:customers(display_name)')
      .eq('estimate_number', num)
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
   * Estimates quoted against a given job (the job page's billing panel and the
   * job-costing drill-down). Header rows only — newest first. Mirrors
   * invoicesService.listForJob.
   */
  async listForJob(jobId: string, limit = 200): Promise<Estimate[]> {
    const { data, error } = await acct()
      .from('estimates')
      .select('*, customer:customers(display_name)')
      .eq('job_id', jobId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapEstimateRow);
  },

  /** Estimates for a given customer (the Customers hub). Header rows only, newest first. */
  async listByCustomer(customerId: string, limit = 200): Promise<Estimate[]> {
    const { data, error } = await acct()
      .from('estimates')
      .select('*, customer:customers(display_name)')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapEstimateRow);
  },

  /** Insert a draft estimate + its lines, with money fields computed from the lines. */
  async createDraft(
    input: NewEstimateInput,
    opts?: { customerTaxExempt?: boolean }
  ): Promise<{ estimate: Estimate | null; error?: string }> {
    if (!input.lines.length)
      return { estimate: null, error: 'An estimate needs at least one line.' };
    const totals = await computeTotalsFor(
      input.lines,
      input.taxCodeId,
      opts?.customerTaxExempt ?? false
    );
    const cents = (c: number) => Math.round(c) / 100;

    const { data: header, error: hErr } = await acct()
      .from('estimates')
      .insert({
        customer_id: input.customerId,
        job_id: input.jobId ?? null,
        source_proposal_id: input.sourceProposalId ?? null,
        estimate_date: input.estimateDate ?? new Date().toISOString().slice(0, 10),
        expiry_date: input.expiryDate ?? null,
        terms: input.terms ?? null,
        status: 'draft',
        subtotal: cents(totals.subtotalCents),
        discount_total: cents(totals.discountCents),
        tax_total: cents(totals.taxCents),
        total: cents(totals.totalCents),
        tax_code_id: input.taxCodeId ?? null,
        memo: input.memo ?? null,
        notes: input.notes ?? null,
      })
      .select('*')
      .single();
    if (hErr || !header)
      return { estimate: null, error: hErr?.message ?? 'Failed to create estimate.' };

    const estimateId = (header as Row).id as string;
    const { error: lErr } = await acct()
      .from('estimate_lines')
      .insert(lineRows(estimateId, input.lines));
    if (lErr) {
      await acct().from('estimates').delete().eq('id', estimateId);
      return { estimate: null, error: lErr.message };
    }
    const created = await this.getById(estimateId);
    return { estimate: created };
  },

  /**
   * Replace an estimate's header + lines and recompute money fields. An estimate posts NOTHING to
   * the ledger, so it can be edited in place at any live status (draft / sent / declined / expired)
   * — editing a sent estimate just changes the content; the sent-version badge then flags it as
   * "edited since last sent". Only `converted` (it spawned an invoice) and `accepted` (the customer
   * has agreed) are locked. A pre-edit snapshot is captured so the change is restorable.
   */
  async updateDraft(
    id: string,
    input: UpdateEstimateInput,
    opts?: { customerTaxExempt?: boolean }
  ): Promise<{ estimate: Estimate | null; error?: string }> {
    const existing = await this.getById(id);
    if (!existing) return { estimate: null, error: 'Estimate not found.' };
    if (existing.status === 'converted' || existing.status === 'accepted') {
      return {
        estimate: null,
        error: `A ${existing.status} estimate can't be edited.`,
      };
    }
    // Snapshot the pre-edit state so this change can be reverted (best-effort; never block the save).
    try {
      await acct().rpc('capture_document_snapshot', {
        p_type: 'estimate',
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
    };
    if (input.customerId !== undefined) patch.customer_id = input.customerId;
    if (input.jobId !== undefined) patch.job_id = input.jobId;
    if (input.estimateDate !== undefined) patch.estimate_date = input.estimateDate;
    if (input.expiryDate !== undefined) patch.expiry_date = input.expiryDate;
    if (input.terms !== undefined) patch.terms = input.terms;
    if (input.taxCodeId !== undefined) patch.tax_code_id = input.taxCodeId;
    if (input.memo !== undefined) patch.memo = input.memo;
    if (input.notes !== undefined) patch.notes = input.notes;
    if (input.layout !== undefined) patch.layout = input.layout;

    const { error: uErr } = await acct().from('estimates').update(patch).eq('id', id);
    if (uErr) return { estimate: null, error: uErr.message };

    if (input.lines) {
      await acct().from('estimate_lines').delete().eq('estimate_id', id);
      const { error: lErr } = await acct().from('estimate_lines').insert(lineRows(id, input.lines));
      if (lErr) return { estimate: null, error: lErr.message };
    }
    return { estimate: await this.getById(id) };
  },

  /**
   * Link (or unlink) this estimate to a job by setting ONLY estimates.job_id — a pure
   * organizational tag (estimates post no JE at all). Allowed at ANY status (unlike
   * updateDraft, which is draft-only and rewrites lines/totals), so an already-sent or
   * accepted estimate can be filed against the right job after the fact. Pass null to unlink.
   */
  async setJob(id: string, jobId: string | null): Promise<{ ok: boolean; error?: string }> {
    const { error } = await acct().from('estimates').update({ job_id: jobId }).eq('id', id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  /**
   * Manually set (or clear) an estimate's number. Numbers are normally auto-assigned and
   * sequential (a DB trigger stamps EST-NNNN on insert); this is the deliberate override for
   * reconciling against QuickBooks while both systems run side by side. estimate_number is UNIQUE,
   * so a clash is rejected with a clear message. Pass an empty string to clear it.
   */
  async setNumber(id: string, estimateNumber: string): Promise<{ ok: boolean; error?: string }> {
    const trimmed = estimateNumber.trim();
    const { error } = await acct()
      .from('estimates')
      .update({ estimate_number: trimmed || null })
      .eq('id', id);
    if (error) {
      const dup = /duplicate|unique/i.test(error.message);
      return {
        ok: false,
        error: dup ? `Estimate number "${trimmed}" is already in use.` : error.message,
      };
    }
    return { ok: true };
  },

  /** Mark a draft estimate `sent`. No money moves (an estimate never posts a JE). */
  async send(id: string): Promise<{ estimate: Estimate | null; error?: string }> {
    const estimate = await this.getById(id);
    if (!estimate) return { estimate: null, error: 'Estimate not found.' };
    if (estimate.status !== 'draft') {
      return {
        estimate: null,
        error: `Only draft estimates can be sent (this one is ${estimate.status}).`,
      };
    }
    if (!estimate.lines || estimate.lines.length === 0) {
      return { estimate: null, error: 'Cannot send an estimate with no lines.' };
    }
    const { error } = await acct().from('estimates').update({ status: 'sent' }).eq('id', id);
    if (error) return { estimate: null, error: error.message };
    // Pin a 'sent' snapshot + stamp the sent-version hash for the "current version sent?" badge.
    try {
      await acct().rpc('record_document_sent', { p_type: 'estimate', p_id: id });
    } catch {
      /* sent-version tracking is best-effort */
    }
    return { estimate: await this.getById(id) };
  },

  /** Mark a sent estimate `accepted` (stamps accepted_at). */
  async accept(id: string): Promise<{ estimate: Estimate | null; error?: string }> {
    const estimate = await this.getById(id);
    if (!estimate) return { estimate: null, error: 'Estimate not found.' };
    if (estimate.status === 'converted') {
      return { estimate: null, error: 'This estimate has already been converted to an invoice.' };
    }
    if (estimate.status === 'declined') {
      return { estimate: null, error: 'A declined estimate cannot be accepted.' };
    }
    const { error } = await acct()
      .from('estimates')
      .update({ status: 'accepted', accepted_at: new Date().toISOString() })
      .eq('id', id);
    if (error) return { estimate: null, error: error.message };
    return { estimate: await this.getById(id) };
  },

  /** Mark an estimate `declined`. A declined estimate can no longer be converted. */
  async decline(id: string): Promise<{ estimate: Estimate | null; error?: string }> {
    const estimate = await this.getById(id);
    if (!estimate) return { estimate: null, error: 'Estimate not found.' };
    if (estimate.status === 'converted') {
      return { estimate: null, error: 'This estimate has already been converted to an invoice.' };
    }
    const { error } = await acct().from('estimates').update({ status: 'declined' }).eq('id', id);
    if (error) return { estimate: null, error: error.message };
    return { estimate: await this.getById(id) };
  },

  /**
   * Convert an estimate into a DRAFT invoice via accounting.convert_estimate_to_invoice
   * (atomic + idempotent). Returns the new invoice id so the UI can navigate to it; the
   * invoice still needs SENDING to post its revenue JE (no money posts at convert time).
   */
  async convert(id: string): Promise<{ invoiceId: string | null; error?: string }> {
    const { data, error } = await acct().rpc('convert_estimate_to_invoice', {
      p_estimate_id: id,
    });
    if (error) return { invoiceId: null, error: error.message };
    const invoiceId = typeof data === 'string' ? data : nstr(data);
    if (!invoiceId) return { invoiceId: null, error: 'Conversion did not return an invoice.' };
    return { invoiceId };
  },

  /**
   * Reissue an estimate: clone its header + lines into a brand-new DRAFT (no JE — estimates
   * never post, so no RPC is needed; this is a plain client-orchestrated duplicate). The new
   * draft is dated today (estimateDate omitted so the DB default applies). If the original was
   * still live (sent/expired), it's best-effort superseded (declined) so it stops circulating;
   * that supersede never fails the reissue. Returns the new draft's id for navigation.
   */
  async reissue(id: string): Promise<{ estimateId: string | null; error?: string }> {
    const original = await this.getById(id);
    if (!original) return { estimateId: null, error: 'Estimate not found.' };

    const res = await this.createDraft({
      customerId: original.customerId,
      jobId: original.jobId,
      expiryDate: original.expiryDate,
      terms: original.terms,
      taxCodeId: original.taxCodeId,
      memo: original.memo,
      notes: original.notes,
      lines: (original.lines ?? []).map(toLineInput),
    });
    if (!res.estimate) {
      return { estimateId: null, error: res.error ?? 'Could not create the reissued draft.' };
    }

    // Supersede the original only when it's still live (best-effort, never fails the reissue).
    if (original.status === 'sent' || original.status === 'expired') {
      try {
        await this.decline(id);
      } catch {
        /* best-effort */
      }
    }

    return { estimateId: res.estimate.id };
  },

  /**
   * Permanently delete a DRAFT estimate (and its lines). Estimates post no JE, so this is a
   * plain hard delete; only drafts are removable (sent/accepted/converted are locked — reissue
   * supersedes those instead).
   */
  async deleteDraft(id: string): Promise<{ ok: boolean; error?: string }> {
    const existing = await this.getById(id);
    if (!existing) return { ok: false, error: 'Estimate not found.' };
    if (existing.status !== 'draft') {
      return {
        ok: false,
        error: `Only draft estimates can be deleted (this one is ${existing.status}).`,
      };
    }
    await acct().from('estimate_lines').delete().eq('estimate_id', id);
    const { error } = await acct().from('estimates').delete().eq('id', id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },
};

/** Adapt a persisted EstimateLine back to the create/update input shape. */
function toLineInput(l: EstimateLine): NewEstimateLineInput {
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

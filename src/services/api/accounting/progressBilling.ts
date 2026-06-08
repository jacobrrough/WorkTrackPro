import type {
  ChangeOrder,
  NewChangeOrderInput,
  NewProgressInvoiceInput,
  NewProjectInput,
  NewSovLineInput,
  ProgressInvoice,
  ProgressInvoiceLine,
  Project,
  ProjectStatus,
  SovLine,
  UpdateProjectInput,
  UpdateSovLineInput,
} from '../../../features/accounting/types';
import {
  buildProgressInvoiceJournalLines,
  buildRetainageReleaseJournalLines,
  type ComputedProgressLine,
  type ProgressInvoiceTotals,
} from '../../../features/accounting/posting';
import { toCents } from '../../../features/accounting/accountingViewModel';
import { acct } from './accountingClient';
import type { Row } from './mappers';
import { journalService } from './journal';
import { accountingSettingsService } from './settings';
import { taxService } from './tax';

/**
 * Progress billing (#10): projects, schedule-of-values (SOV) lines, change orders, and the
 * period progress invoices (AIA-style applications) that bill against them.
 *
 * A progress invoice records the percent-complete per SOV line, derives the work-completed-
 * to-date (W) and retainage-to-date (R), and bills the current period. createProgressInvoice
 * is the ONE money path here: it computes the period's W/R in integer cents, builds the
 * balanced revenue JE with buildProgressInvoiceJournalLines, creates a real accounting.invoices
 * header (status 'sent') + posts that JE through journalService.createAndPost (source_type
 * 'invoice', linked to the invoice), then links the progress_invoice row to the invoice. It
 * mirrors invoicesService.send: if posting fails the draft invoice/JE are cleaned up and the
 * DB message is returned. releaseRetainage posts the retainage-release JE (Dr AR / Cr 1210).
 *
 * Reads throw (React Query surfaces them); writes return a result object whose `error` carries
 * the DB message (e.g. the over-billing reject) so the UI can show it inline.
 */

const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const str = (v: unknown): string => (v == null ? '' : String(v));
const nstr = (v: unknown): string | null => (v == null ? null : String(v));
const cents = (c: number) => Math.round(c) / 100;

const VALID_PROJECT_STATUSES = new Set<ProjectStatus>(['active', 'closed']);
function projectStatus(v: unknown): ProjectStatus {
  const s = str(v) as ProjectStatus;
  return VALID_PROJECT_STATUSES.has(s) ? s : 'active';
}

function mapProjectRow(row: Row): Project {
  const customer = (row.customer ?? null) as Row | null;
  return {
    id: str(row.id),
    customerId: str(row.customer_id),
    jobId: nstr(row.job_id),
    name: str(row.name),
    contractSum: num(row.contract_sum),
    retainagePercent: num(row.retainage_percent, 0.1),
    status: projectStatus(row.status),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
    customerName: customer ? str(customer.display_name) : undefined,
  };
}

function mapSovLineRow(row: Row): SovLine {
  return {
    id: str(row.id),
    projectId: str(row.project_id),
    description: nstr(row.description),
    scheduledValue: num(row.scheduled_value),
    incomeAccountId: nstr(row.income_account_id),
    changeOrderId: nstr(row.change_order_id),
    sortOrder: num(row.sort_order),
  };
}

function mapChangeOrderRow(row: Row): ChangeOrder {
  return {
    id: str(row.id),
    projectId: str(row.project_id),
    coNumber: nstr(row.co_number),
    description: nstr(row.description),
    amount: num(row.amount),
    status: (str(row.status) as ChangeOrder['status']) || 'draft',
    approvedAt: nstr(row.approved_at),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  };
}

function mapProgressInvoiceLineRow(row: Row): ProgressInvoiceLine {
  return {
    id: str(row.id),
    progressInvoiceId: str(row.progress_invoice_id),
    sovLineId: str(row.sov_line_id),
    percentComplete: num(row.percent_complete),
    completedToDate: num(row.completed_to_date),
    retainageThisPeriod: num(row.retainage_this_period),
    currentPeriod: num(row.current_period),
    sortOrder: num(row.sort_order),
  };
}

function mapProgressInvoiceRow(row: Row): ProgressInvoice {
  const rawLines = (row.lines ?? row.progress_invoice_lines ?? null) as Row[] | null;
  return {
    id: str(row.id),
    projectId: str(row.project_id),
    invoiceId: nstr(row.invoice_id),
    periodEnd: str(row.period_end),
    sequence: num(row.sequence, 1),
    workCompletedToDate: num(row.work_completed_to_date),
    retainageToDate: num(row.retainage_to_date),
    previouslyBilled: num(row.previously_billed),
    currentDue: num(row.current_due),
    status: (str(row.status) as ProgressInvoice['status']) || 'draft',
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
    lines: rawLines
      ? rawLines.map(mapProgressInvoiceLineRow).sort((a, b) => a.sortOrder - b.sortOrder)
      : undefined,
  };
}

/** Build a tax-rate resolver (code id -> decimal rate) from the seeded tax codes. */
async function taxRateResolver(): Promise<(id: string | null | undefined) => number> {
  const codes = await taxService.getAll(true);
  const byId = new Map(codes.map((c) => [c.id, c.isTaxable ? c.rate : 0]));
  return (id) => (id ? (byId.get(id) ?? 0) : 0);
}

export const projectsService = {
  async list(limit = 200): Promise<Project[]> {
    const { data, error } = await acct()
      .from('projects')
      .select('*, customer:customers(display_name)')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapProjectRow);
  },

  async getById(id: string): Promise<Project | null> {
    const { data, error } = await acct()
      .from('projects')
      .select('*, customer:customers(display_name)')
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    return mapProjectRow(data as Row);
  },

  async create(input: NewProjectInput): Promise<{ project: Project | null; error?: string }> {
    if (!input.customerId) return { project: null, error: 'Select a customer for this project.' };
    if (!input.name?.trim()) return { project: null, error: 'A project needs a name.' };
    const { data, error } = await acct()
      .from('projects')
      .insert({
        customer_id: input.customerId,
        job_id: input.jobId ?? null,
        name: input.name.trim(),
        contract_sum: input.contractSum ?? 0,
        retainage_percent: input.retainagePercent ?? 0.1,
        status: 'active',
      })
      .select('*, customer:customers(display_name)')
      .single();
    if (error || !data)
      return { project: null, error: error?.message ?? 'Failed to create project.' };
    return { project: mapProjectRow(data as Row) };
  },

  async update(
    id: string,
    input: UpdateProjectInput
  ): Promise<{ project: Project | null; error?: string }> {
    const patch: Record<string, unknown> = {};
    if (input.customerId !== undefined) patch.customer_id = input.customerId;
    if (input.jobId !== undefined) patch.job_id = input.jobId;
    if (input.name !== undefined) patch.name = input.name;
    if (input.contractSum !== undefined) patch.contract_sum = input.contractSum;
    if (input.retainagePercent !== undefined) patch.retainage_percent = input.retainagePercent;
    if (input.status !== undefined) patch.status = input.status;
    const { data, error } = await acct()
      .from('projects')
      .update(patch)
      .eq('id', id)
      .select('*, customer:customers(display_name)')
      .single();
    if (error || !data)
      return { project: null, error: error?.message ?? 'Failed to update project.' };
    return { project: mapProjectRow(data as Row) };
  },
};

export const progressBillingService = {
  // ── Schedule of values ──────────────────────────────────────────────────────
  async listSovLines(projectId: string): Promise<SovLine[]> {
    const { data, error } = await acct()
      .from('sov_lines')
      .select('*')
      .eq('project_id', projectId)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapSovLineRow);
  },

  /** Insert or update one SOV line (upsert by id when present). */
  async upsertSovLine(
    projectId: string,
    input: NewSovLineInput | UpdateSovLineInput
  ): Promise<{ sovLine: SovLine | null; error?: string }> {
    const row: Record<string, unknown> = {
      project_id: projectId,
      description: input.description ?? null,
      scheduled_value: input.scheduledValue ?? 0,
      income_account_id: input.incomeAccountId ?? null,
      change_order_id: input.changeOrderId ?? null,
      sort_order: input.sortOrder ?? 0,
    };
    if ('id' in input && input.id) row.id = input.id;
    const { data, error } = await acct()
      .from('sov_lines')
      .upsert(row, { onConflict: 'id' })
      .select('*')
      .single();
    if (error || !data)
      return { sovLine: null, error: error?.message ?? 'Failed to save SOV line.' };
    return { sovLine: mapSovLineRow(data as Row) };
  },

  async deleteSovLine(id: string): Promise<{ ok: boolean; error?: string }> {
    const { error } = await acct().from('sov_lines').delete().eq('id', id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  // ── Change orders ─────────────────────────────────────────────────────────────
  async listChangeOrders(projectId: string): Promise<ChangeOrder[]> {
    const { data, error } = await acct()
      .from('change_orders')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapChangeOrderRow);
  },

  async createChangeOrder(
    projectId: string,
    input: NewChangeOrderInput
  ): Promise<{ changeOrder: ChangeOrder | null; error?: string }> {
    const { data, error } = await acct()
      .from('change_orders')
      .insert({
        project_id: projectId,
        co_number: input.coNumber ?? null,
        description: input.description ?? null,
        amount: input.amount ?? 0,
        status: 'draft',
      })
      .select('*')
      .single();
    if (error || !data)
      return { changeOrder: null, error: error?.message ?? 'Failed to create change order.' };
    return { changeOrder: mapChangeOrderRow(data as Row) };
  },

  /** Approve or reject a change order. Approving stamps approved_at. */
  async setChangeOrderStatus(
    id: string,
    status: 'approved' | 'rejected'
  ): Promise<{ changeOrder: ChangeOrder | null; error?: string }> {
    const patch: Record<string, unknown> = {
      status,
      approved_at: status === 'approved' ? new Date().toISOString() : null,
    };
    const { data, error } = await acct()
      .from('change_orders')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data)
      return { changeOrder: null, error: error?.message ?? 'Failed to update change order.' };
    return { changeOrder: mapChangeOrderRow(data as Row) };
  },

  // ── Progress invoices (applications) ───────────────────────────────────────────
  async listProgressInvoices(projectId: string): Promise<ProgressInvoice[]> {
    const { data, error } = await acct()
      .from('progress_invoices')
      .select('*, lines:progress_invoice_lines(*)')
      .eq('project_id', projectId)
      .order('sequence', { ascending: true });
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapProgressInvoiceRow);
  },

  async getProgressInvoiceById(id: string): Promise<ProgressInvoice | null> {
    const { data, error } = await acct()
      .from('progress_invoices')
      .select('*, lines:progress_invoice_lines(*)')
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    return mapProgressInvoiceRow(data as Row);
  },

  /**
   * Sum, per SOV line, the work already billed (completed_to_date) across this project's
   * earlier POSTED progress invoices. Used to derive a period's current-period increment
   * (this application's completed-to-date minus the prior cumulative). Keyed by sov_line_id.
   */
  async billedToDateBySovLine(projectId: string): Promise<Map<string, number>> {
    const { data, error } = await acct()
      .from('progress_invoices')
      .select('id, status, lines:progress_invoice_lines(sov_line_id, current_period)')
      .eq('project_id', projectId);
    if (error) throw error;
    const byLine = new Map<string, number>();
    for (const inv of (data ?? []) as Row[]) {
      if (str(inv.status) === 'void') continue;
      const lines = (inv.lines ?? inv.progress_invoice_lines ?? []) as Row[];
      for (const l of lines) {
        const key = str(l.sov_line_id);
        byLine.set(key, (byLine.get(key) ?? 0) + num(l.current_period));
      }
    }
    return byLine;
  },

  /**
   * Create and POST one progress-billing period.
   *
   * Computes per SOV line — in integer cents — the completed-to-date (scheduled_value ×
   * percent_complete), the current-period increment (completed-to-date − already-billed), the
   * retainage withheld this period (current period × the project's retainage percent), and the
   * sales tax on the current period (tax-on-WORK) when the input names a tax code and the line
   * is taxable. It then:
   *   1) builds the balanced revenue JE with buildProgressInvoiceJournalLines,
   *   2) inserts a real accounting.invoices header (status 'sent') for the current due amount,
   *   3) posts the JE via journalService.createAndPost (source_type 'invoice', linked),
   *   4) stamps journal_entry_id on the invoice, and
   *   5) inserts the progress_invoices row + its lines, linked to the invoice.
   * If any step fails the partial invoice/JE are cleaned up and the DB message is returned
   * (mirrors invoicesService.send). The over-billing DB trigger is the final gate on the lines.
   */
  async createProgressInvoice(
    input: NewProgressInvoiceInput
  ): Promise<{ progressInvoice: ProgressInvoice | null; error?: string }> {
    const project = await projectsService.getById(input.projectId);
    if (!project) return { progressInvoice: null, error: 'Project not found.' };
    if (!input.lines.length)
      return { progressInvoice: null, error: 'A progress billing needs at least one line.' };

    const [sovLines, billed, defaults, rateOf, prior] = await Promise.all([
      this.listSovLines(input.projectId),
      this.billedToDateBySovLine(input.projectId),
      accountingSettingsService.getDefaultAccounts(),
      taxRateResolver(),
      this.listProgressInvoices(input.projectId),
    ]);
    const sovById = new Map(sovLines.map((s) => [s.id, s]));

    // Resolve the customer's tax-exempt flag so we never tax an exempt sale.
    let taxExempt = false;
    const { data: cust } = await acct()
      .from('customers')
      .select('tax_exempt')
      .eq('id', project.customerId)
      .maybeSingle();
    if (cust) taxExempt = (cust as Row).tax_exempt === true;

    const retainageRate = project.retainagePercent ?? 0;
    const headerTaxRate = taxExempt ? 0 : rateOf(input.taxCodeId);

    // Build the per-line computed figures (integer cents) for both the JE and the DB rows.
    const computed: ComputedProgressLine[] = [];
    const lineRows: Record<string, unknown>[] = [];
    for (let i = 0; i < input.lines.length; i++) {
      const ln = input.lines[i];
      const sov = sovById.get(ln.sovLineId);
      if (!sov) return { progressInvoice: null, error: 'A line references an unknown SOV line.' };

      const scheduledCents = toCents(sov.scheduledValue);
      const pct = Math.max(0, Math.min(1, num(ln.percentComplete)));
      const completedCents = Math.round(scheduledCents * pct);
      const priorCents = toCents(billed.get(ln.sovLineId) ?? 0);
      const currentCents = Math.max(0, completedCents - priorCents);
      const retainageCents = Math.round(currentCents * retainageRate);
      const taxable = ln.taxable === true; // progress billing defaults to non-taxable
      const taxCents = taxable && headerTaxRate > 0 ? Math.round(currentCents * headerTaxRate) : 0;

      computed.push({
        incomeAccountId: sov.incomeAccountId,
        currentPeriodCents: currentCents,
        retainageCents,
        taxable: taxable && !taxExempt,
        taxCents,
        classId: null,
        locationId: null,
        departmentId: null,
      });
      lineRows.push({
        sov_line_id: ln.sovLineId,
        percent_complete: pct,
        completed_to_date: cents(completedCents),
        retainage_this_period: cents(retainageCents),
        current_period: cents(currentCents),
        sort_order: i,
      });
    }

    const totals: ProgressInvoiceTotals = {
      workCents: computed.reduce((s, l) => s + l.currentPeriodCents, 0),
      retainageCents: computed.reduce((s, l) => s + l.retainageCents, 0),
      taxCents: computed.reduce((s, l) => s + l.taxCents, 0),
      lines: computed,
    };

    let je;
    try {
      je = buildProgressInvoiceJournalLines(totals, defaults, { customerId: project.customerId });
    } catch (e) {
      return {
        progressInvoice: null,
        error: e instanceof Error ? e.message : 'Unable to build the progress billing entry.',
      };
    }

    const periodEnd = input.periodEnd ?? new Date().toISOString().slice(0, 10);
    const sequence = prior.filter((p) => p.status !== 'void').length + 1;

    // Cumulative figures for the header (this application's running totals across all lines).
    const workToDateCents = computed.reduce(
      (s, _l, i) => s + toCents(num(lineRows[i].completed_to_date)),
      0
    );
    const retainageToDateCents =
      workToDateCents > 0 ? Math.round(workToDateCents * retainageRate) : 0;
    const previouslyBilledCents = [...billed.values()].reduce((s, v) => s + toCents(v), 0);

    // 1) Create the AR invoice header (status 'sent'; balance = current due).
    const { data: header, error: hErr } = await acct()
      .from('invoices')
      .insert({
        customer_id: project.customerId,
        job_id: project.jobId ?? null,
        invoice_date: periodEnd,
        status: 'sent',
        // subtotal is the net-of-retainage current work so subtotal + tax == total (review #6).
        // The withheld retainage lives on the progress_invoices row, not the AR header.
        subtotal: cents(toCents(je.work) - toCents(je.retainage)),
        tax_total: je.taxTotal,
        total: je.currentDue,
        balance_due: je.currentDue,
        tax_code_id: input.taxCodeId ?? null,
        memo: `Progress billing #${sequence} — ${project.name}`,
      })
      .select('*')
      .single();
    if (hErr || !header)
      return { progressInvoice: null, error: hErr?.message ?? 'Failed to create the AR invoice.' };
    const invoiceId = (header as Row).id as string;

    // 2) Post the progress revenue JE, linked to the invoice (source_type 'invoice').
    const posted = await journalService.createAndPost({
      entryDate: periodEnd,
      memo: `Progress billing #${sequence} — ${project.name}`,
      sourceType: 'invoice',
      sourceId: invoiceId,
      lines: je.lines,
    });
    if (!posted.entryId) {
      await acct().from('invoices').delete().eq('id', invoiceId);
      return {
        progressInvoice: null,
        error: posted.error ?? 'Failed to post the progress billing.',
      };
    }

    // 3) Link the posted JE onto the invoice.
    const { error: linkErr } = await acct()
      .from('invoices')
      .update({ journal_entry_id: posted.entryId })
      .eq('id', invoiceId);
    if (linkErr) {
      await journalService.voidEntry(posted.entryId, 'Progress billing link failed after posting');
      await acct().from('invoices').delete().eq('id', invoiceId);
      return { progressInvoice: null, error: linkErr.message };
    }

    // 4) Insert the progress_invoices header, linked to the invoice.
    const { data: piHeader, error: piErr } = await acct()
      .from('progress_invoices')
      .insert({
        project_id: input.projectId,
        invoice_id: invoiceId,
        period_end: periodEnd,
        sequence,
        work_completed_to_date: cents(workToDateCents),
        retainage_to_date: cents(retainageToDateCents),
        previously_billed: cents(previouslyBilledCents),
        current_due: je.currentDue,
        status: 'posted',
      })
      .select('*')
      .single();
    if (piErr || !piHeader) {
      // The AR invoice + JE are posted; void + delete so we don't leave a dangling post.
      await journalService.voidEntry(
        posted.entryId,
        'Progress billing record failed after posting'
      );
      await acct().from('invoices').delete().eq('id', invoiceId);
      return {
        progressInvoice: null,
        error: piErr?.message ?? 'Failed to record the progress billing.',
      };
    }
    const progressInvoiceId = (piHeader as Row).id as string;

    // 5) Insert the application lines (the over-billing trigger is the final gate).
    const { error: plErr } = await acct()
      .from('progress_invoice_lines')
      .insert(lineRows.map((r) => ({ ...r, progress_invoice_id: progressInvoiceId })));
    if (plErr) {
      await acct().from('progress_invoices').delete().eq('id', progressInvoiceId);
      await journalService.voidEntry(posted.entryId, 'Progress billing lines rejected');
      await acct().from('invoices').delete().eq('id', invoiceId);
      return { progressInvoice: null, error: plErr.message };
    }

    return { progressInvoice: await this.getProgressInvoiceById(progressInvoiceId) };
  },

  /**
   * Release withheld retainage for a project into a current receivable: posts the balanced
   * release JE (Dr 1200 AR / Cr 1210 Retainage Receivable) for `amount` dollars and creates an
   * AR invoice header (status 'sent') so the released amount is billed to the customer. No new
   * revenue is recognized (it was recognized when the work was billed). On a posting failure the
   * partial invoice/JE are cleaned up and the DB message is returned.
   */
  async releaseRetainage(params: {
    projectId: string;
    amount: number;
    periodEnd?: string;
  }): Promise<{ ok: boolean; invoiceId?: string; error?: string }> {
    const project = await projectsService.getById(params.projectId);
    if (!project) return { ok: false, error: 'Project not found.' };
    const amountCents = toCents(params.amount);
    if (amountCents <= 0)
      return { ok: false, error: 'Enter a retainage amount greater than zero.' };

    const defaults = await accountingSettingsService.getDefaultAccounts();

    // Cap the release at the customer's OUTSTANDING retainage — posted (debit − credit) on the
    // 1210 Retainage Receivable account for this customer — so a release can NEVER drive 1210
    // negative / release more than was ever withheld (accounting review #5). The GL is the
    // source of truth (every retainage line is stamped with the customer id).
    if (defaults.retainageReceivable) {
      const { data: retRows, error: retErr } = await acct()
        .from('journal_lines')
        .select('debit, credit, journal_entries!inner(status)')
        .eq('account_id', defaults.retainageReceivable)
        .eq('customer_id', project.customerId)
        .eq('journal_entries.status', 'posted');
      if (retErr) return { ok: false, error: retErr.message };
      const outstandingCents = ((retRows ?? []) as Row[]).reduce(
        (s, r) => s + toCents(num(r.debit)) - toCents(num(r.credit)),
        0
      );
      if (amountCents > outstandingCents) {
        return {
          ok: false,
          error: `Cannot release more than the outstanding retainage for this customer ($${cents(
            outstandingCents
          ).toFixed(2)}).`,
        };
      }
    }

    let je;
    try {
      je = buildRetainageReleaseJournalLines(amountCents, defaults, {
        customerId: project.customerId,
      });
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : 'Unable to build the release entry.',
      };
    }

    const periodEnd = params.periodEnd ?? new Date().toISOString().slice(0, 10);
    const { data: header, error: hErr } = await acct()
      .from('invoices')
      .insert({
        customer_id: project.customerId,
        job_id: project.jobId ?? null,
        invoice_date: periodEnd,
        status: 'sent',
        subtotal: 0,
        tax_total: 0,
        total: je.amount,
        balance_due: je.amount,
        memo: `Retainage release — ${project.name}`,
      })
      .select('*')
      .single();
    if (hErr || !header)
      return { ok: false, error: hErr?.message ?? 'Failed to create the AR invoice.' };
    const invoiceId = (header as Row).id as string;

    const posted = await journalService.createAndPost({
      entryDate: periodEnd,
      memo: `Retainage release — ${project.name}`,
      sourceType: 'invoice',
      sourceId: invoiceId,
      lines: je.lines,
    });
    if (!posted.entryId) {
      await acct().from('invoices').delete().eq('id', invoiceId);
      return { ok: false, error: posted.error ?? 'Failed to post the retainage release.' };
    }

    const { error: linkErr } = await acct()
      .from('invoices')
      .update({ journal_entry_id: posted.entryId })
      .eq('id', invoiceId);
    if (linkErr) {
      await journalService.voidEntry(posted.entryId, 'Retainage release link failed after posting');
      await acct().from('invoices').delete().eq('id', invoiceId);
      return { ok: false, error: linkErr.message };
    }

    return { ok: true, invoiceId };
  },
};

import type {
  Bill,
  NewBillInput,
  NewBillLineInput,
  UpdateBillInput,
} from '../../../features/accounting/types';
import {
  buildBillExpenseJournalLines,
  computeBillTotals,
  type BillTotals,
} from '../../../features/accounting/posting';
import { acct } from './accountingClient';
import { mapBillRow, type Row } from './mappers';
import { journalService } from './journal';
import { accountingSettingsService } from './settings';

/**
 * AP bills (accounting.bills/bill_lines). Bills are created as `draft` with their
 * line items and computed money fields. Posting a bill posts a BALANCED expense
 * journal entry through accounting.post_journal_entry
 * (Dr 6000|5000|1300 Expense/Inventory-asset per line / Cr 2000 Accounts Payable),
 * links journal_entry_id back onto the bill, and flips status to `open`.
 *
 * Reads throw (React Query surfaces them); writes return a result object whose
 * `error` carries the DB message (e.g. an unbalanced-entry rejection) so the UI can
 * show it without an orphan draft JE leaking — journalService.createAndPost cleans
 * up a failed post for us.
 *
 * DEBIT-ACCOUNT RESOLUTION per line (item-based first, then vendor, then default):
 *   item.expense_account_id (or inventory_asset_account_id for inventory items)
 *     → vendor.default_expense_account_id → settings.operating_expenses.
 * Account-based lines debit their own account_id directly.
 */

const SELECT_DETAIL = '*, lines:bill_lines(*), vendor:vendors(display_name)';

/** A line as it influences debit-account resolution. */
interface ItemAccountInfo {
  itemType: string;
  expenseAccountId: string | null;
  inventoryAssetAccountId: string | null;
}

/**
 * Build a per-line debit-account resolver for a set of bill lines. Fetches the items
 * referenced by item-based lines and the vendor's default expense account in one pass
 * so computeBillTotals (pure) can resolve each line without any DB lookups of its own.
 */
async function debitAccountResolver(
  lines: NewBillLineInput[],
  vendorId: string,
  operatingExpensesId: string | null
): Promise<(line: NewBillLineInput) => string | null> {
  const itemIds = Array.from(
    new Set(lines.map((l) => l.itemId).filter((id): id is string => !!id))
  );

  const itemsById = new Map<string, ItemAccountInfo>();
  if (itemIds.length) {
    const { data } = await acct()
      .from('items')
      .select('id, item_type, expense_account_id, inventory_asset_account_id')
      .in('id', itemIds);
    for (const r of (data ?? []) as Row[]) {
      itemsById.set(String(r.id), {
        itemType: String(r.item_type ?? 'service'),
        expenseAccountId: r.expense_account_id == null ? null : String(r.expense_account_id),
        inventoryAssetAccountId:
          r.inventory_asset_account_id == null ? null : String(r.inventory_asset_account_id),
      });
    }
  }

  let vendorDefaultExpense: string | null = null;
  const { data: vendorRow } = await acct()
    .from('vendors')
    .select('default_expense_account_id')
    .eq('id', vendorId)
    .maybeSingle();
  if (vendorRow) {
    const v = (vendorRow as Row).default_expense_account_id;
    vendorDefaultExpense = v == null ? null : String(v);
  }

  return (line: NewBillLineInput): string | null => {
    // Account-based line: debit its explicit account.
    if (line.accountId) return line.accountId;
    // Item-based line: inventory items capitalize to the inventory-asset account;
    // everything else expenses. Fall back through vendor default → operating expenses.
    if (line.itemId) {
      const info = itemsById.get(line.itemId);
      if (info) {
        if (info.itemType === 'inventory' && info.inventoryAssetAccountId) {
          return info.inventoryAssetAccountId;
        }
        if (info.expenseAccountId) return info.expenseAccountId;
      }
    }
    return vendorDefaultExpense ?? operatingExpensesId;
  };
}

/** Compute money totals + per-line debit accounts for a set of input lines. */
async function computeTotalsFor(
  lines: NewBillLineInput[],
  vendorId: string,
  taxTotal: number | null | undefined
): Promise<BillTotals> {
  const defaults = await accountingSettingsService.getDefaultAccounts();
  const resolveDebitAccount = await debitAccountResolver(
    lines,
    vendorId,
    defaults.operatingExpenses
  );
  return computeBillTotals({ lines, resolveDebitAccount, taxTotal });
}

function lineRows(billId: string, lines: NewBillLineInput[]): Record<string, unknown>[] {
  return lines.map((l, i) => {
    const explicitTotal = l.lineTotal != null;
    const lineTotal = explicitTotal
      ? l.lineTotal!
      : Math.max(0, (l.quantity || 0) * (l.unitCost || 0));
    return {
      bill_id: billId,
      account_id: l.accountId ?? null,
      item_id: l.itemId ?? null,
      description: l.description ?? null,
      quantity: l.quantity ?? 1,
      unit_cost: l.unitCost ?? 0,
      line_total: Math.round(lineTotal * 100) / 100,
      job_id: l.jobId ?? null,
      // B2 reporting dimensions, persisted on the AP line and stamped onto the expense JE.
      class_id: l.classId ?? null,
      location_id: l.locationId ?? null,
      department_id: l.departmentId ?? null,
      source_inventory_id: l.sourceInventoryId ?? null,
      sort_order: i,
    };
  });
}

export const billsService = {
  async list(limit = 200): Promise<Bill[]> {
    const { data, error } = await acct()
      .from('bills')
      .select('*, vendor:vendors(display_name)')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapBillRow);
  },

  async getById(id: string): Promise<Bill | null> {
    const { data, error } = await acct()
      .from('bills')
      .select(SELECT_DETAIL)
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    return mapBillRow(data as Row);
  },

  /** Bills owed to a given vendor (for a vendor detail / payment screen). */
  async listForVendor(vendorId: string, limit = 200): Promise<Bill[]> {
    const { data, error } = await acct()
      .from('bills')
      .select('*, vendor:vendors(display_name)')
      .eq('vendor_id', vendorId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapBillRow);
  },

  /**
   * Bills charged against a given job (for the B1 job-costing detail screen).
   * Header rows only (no lines) — newest first. Mirrors listForVendor.
   */
  async listForJob(jobId: string, limit = 200): Promise<Bill[]> {
    const { data, error } = await acct()
      .from('bills')
      .select('*, vendor:vendors(display_name)')
      .eq('job_id', jobId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapBillRow);
  },

  /** Insert a draft bill + its lines, with money fields computed from the lines. */
  async createDraft(input: NewBillInput): Promise<{ bill: Bill | null; error?: string }> {
    if (!input.lines.length) return { bill: null, error: 'A bill needs at least one line.' };
    const totals = await computeTotalsFor(input.lines, input.vendorId, input.taxTotal);
    const cents = (c: number) => Math.round(c) / 100;

    const { data: header, error: hErr } = await acct()
      .from('bills')
      .insert({
        vendor_id: input.vendorId,
        bill_number: input.billNumber ?? null,
        bill_date: input.billDate ?? new Date().toISOString().slice(0, 10),
        due_date: input.dueDate ?? null,
        terms: input.terms ?? null,
        status: 'draft',
        subtotal: cents(totals.subtotalCents),
        tax_total: cents(totals.taxCents),
        total: cents(totals.totalCents),
        balance_due: cents(totals.totalCents),
        job_id: input.jobId ?? null,
        memo: input.memo ?? null,
      })
      .select('*')
      .single();
    if (hErr || !header) return { bill: null, error: hErr?.message ?? 'Failed to create bill.' };

    const billId = (header as Row).id as string;
    const { error: lErr } = await acct().from('bill_lines').insert(lineRows(billId, input.lines));
    if (lErr) {
      await acct().from('bills').delete().eq('id', billId);
      return { bill: null, error: lErr.message };
    }
    const created = await this.getById(billId);
    return { bill: created };
  },

  /**
   * Replace a draft bill's header + lines and recompute money fields. Only permitted
   * while the bill is still `draft` (a posted bill has a posted JE and is corrected by
   * void + reissue). Returns an error otherwise.
   */
  async updateDraft(
    id: string,
    input: UpdateBillInput
  ): Promise<{ bill: Bill | null; error?: string }> {
    const existing = await this.getById(id);
    if (!existing) return { bill: null, error: 'Bill not found.' };
    if (existing.status !== 'draft') {
      return {
        bill: null,
        error: `Only draft bills can be edited (this one is ${existing.status}).`,
      };
    }
    const lines = input.lines ?? existing.lines?.map(toLineInput) ?? [];
    const vendorId = input.vendorId ?? existing.vendorId;
    const taxTotal = input.taxTotal !== undefined ? input.taxTotal : existing.taxTotal;
    const totals = await computeTotalsFor(lines, vendorId, taxTotal);
    const cents = (c: number) => Math.round(c) / 100;

    const patch: Record<string, unknown> = {
      subtotal: cents(totals.subtotalCents),
      tax_total: cents(totals.taxCents),
      total: cents(totals.totalCents),
      balance_due: cents(totals.totalCents),
    };
    if (input.vendorId !== undefined) patch.vendor_id = input.vendorId;
    if (input.billNumber !== undefined) patch.bill_number = input.billNumber;
    if (input.billDate !== undefined) patch.bill_date = input.billDate;
    if (input.dueDate !== undefined) patch.due_date = input.dueDate;
    if (input.terms !== undefined) patch.terms = input.terms;
    if (input.jobId !== undefined) patch.job_id = input.jobId;
    if (input.memo !== undefined) patch.memo = input.memo;

    const { error: uErr } = await acct().from('bills').update(patch).eq('id', id);
    if (uErr) return { bill: null, error: uErr.message };

    if (input.lines) {
      await acct().from('bill_lines').delete().eq('bill_id', id);
      const { error: lErr } = await acct().from('bill_lines').insert(lineRows(id, input.lines));
      if (lErr) return { bill: null, error: lErr.message };
    }
    return { bill: await this.getById(id) };
  },

  /**
   * Post the expense JE for a draft bill and mark it `open`. The JE is built from the
   * (re-fetched) lines so it always reflects what is stored. If posting fails
   * (unbalanced, RLS, missing accounts) the bill stays `draft` and the DB message is
   * returned; createAndPost removes any half-created draft entry.
   */
  async post(id: string): Promise<{ bill: Bill | null; error?: string }> {
    const bill = await this.getById(id);
    if (!bill) return { bill: null, error: 'Bill not found.' };
    if (bill.status !== 'draft') {
      return { bill: null, error: `Only draft bills can be posted (this one is ${bill.status}).` };
    }
    if (!bill.lines || bill.lines.length === 0) {
      return { bill: null, error: 'Cannot post a bill with no lines.' };
    }

    const totals = await computeTotalsFor(
      bill.lines.map(toLineInput),
      bill.vendorId,
      bill.taxTotal
    );
    const defaults = await accountingSettingsService.getDefaultAccounts();

    let je;
    try {
      je = buildBillExpenseJournalLines(totals, defaults, {
        vendorId: bill.vendorId,
        jobId: bill.jobId,
      });
    } catch (e) {
      return {
        bill: null,
        error: e instanceof Error ? e.message : 'Unable to build the expense entry.',
      };
    }

    const posted = await journalService.createAndPost({
      entryDate: bill.billDate || new Date().toISOString().slice(0, 10),
      memo: `Bill ${bill.billNumber ?? id}`,
      sourceType: 'bill',
      sourceId: id,
      lines: je.lines,
    });
    if (!posted.entryId) {
      return { bill: null, error: posted.error ?? 'Failed to post the expense journal entry.' };
    }

    const { error: uErr } = await acct()
      .from('bills')
      .update({
        status: 'open',
        journal_entry_id: posted.entryId,
        subtotal: je.subtotal,
        tax_total: je.taxTotal,
        total: je.total,
        balance_due: je.total,
      })
      .eq('id', id);
    if (uErr) {
      // The JE is posted but the link failed; void the entry to avoid a dangling post.
      await journalService.voidEntry(posted.entryId, 'Bill post failed after posting');
      return { bill: null, error: uErr.message };
    }
    return { bill: await this.getById(id) };
  },

  /**
   * Void a bill: reverse its posted expense JE (if any) and mark it `void`. Draft
   * bills are simply marked void (no JE exists yet). Refuses if payments are applied.
   */
  async voidBill(id: string, reason: string): Promise<{ ok: boolean; error?: string }> {
    const bill = await this.getById(id);
    if (!bill) return { ok: false, error: 'Bill not found.' };
    if (bill.status === 'void') return { ok: true };
    if (bill.amountPaid > 0) {
      return { ok: false, error: 'Unapply vendor payments before voiding this bill.' };
    }
    if (bill.journalEntryId) {
      const v = await journalService.voidEntry(bill.journalEntryId, reason || 'Bill voided');
      if (!v.ok) return { ok: false, error: v.error };
    }
    const { error } = await acct().from('bills').update({ status: 'void' }).eq('id', id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },
};

/** Adapt a persisted BillLine back to the create/update input shape. */
function toLineInput(l: {
  accountId: string | null;
  itemId: string | null;
  description: string | null;
  quantity: number;
  unitCost: number;
  lineTotal: number;
  jobId: string | null;
  classId: string | null;
  locationId: string | null;
  departmentId: string | null;
  sourceInventoryId: string | null;
}): NewBillLineInput {
  return {
    accountId: l.accountId,
    itemId: l.itemId,
    description: l.description,
    quantity: l.quantity,
    unitCost: l.unitCost,
    lineTotal: l.lineTotal,
    jobId: l.jobId,
    classId: l.classId,
    locationId: l.locationId,
    departmentId: l.departmentId,
    sourceInventoryId: l.sourceInventoryId,
  };
}

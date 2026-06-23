import type {
  AccountType,
  Bill,
  NewBillInput,
  NewBillLineInput,
  UpdateBillInput,
} from '../../../features/accounting/types';
import {
  buildBillExpenseJournalLines,
  computeBillTotals,
  journalLinesEquivalent,
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

/** Resolves both the debit account id AND its GL account type for each bill line. */
interface DebitResolvers {
  resolveDebitAccount: (line: NewBillLineInput) => string | null;
  resolveDebitAccountType: (line: NewBillLineInput) => AccountType | null;
}

/**
 * Build per-line debit resolvers for a set of bill lines. Fetches the items referenced
 * by item-based lines, the vendor's default expense account, and the GL type of every
 * account those lines could debit — all in one pass — so computeBillTotals (pure) can
 * resolve each line, with its account *type*, without any DB lookups of its own.
 *
 * The type resolver is what lets buildBillExpenseJournalLines keep header sales/use tax
 * off an inventory-asset debit even when the item maps to a CUSTOM inventory-asset
 * account (id != the configured 1300 default): an `asset`-typed debit is never folded,
 * so the inventory-asset balance keeps tying to the FIFO-costed amount (GL ↔
 * v_inventory_valuation). Without the type, the builder can only fall back to matching
 * the default id and would wrongly capitalize tax into the custom account.
 */
async function debitAccountResolver(
  lines: NewBillLineInput[],
  vendorId: string,
  operatingExpensesId: string | null
): Promise<DebitResolvers> {
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

  const resolveDebitAccount = (line: NewBillLineInput): string | null => {
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

  // Fetch the GL type of every account these lines could actually debit, so the type
  // resolver always reports the type of the *resolved* account (no id/type divergence).
  const debitAccountIds = Array.from(
    new Set(lines.map((l) => resolveDebitAccount(l)).filter((id): id is string => !!id))
  );
  const typeByAccount = new Map<string, AccountType>();
  if (debitAccountIds.length) {
    const { data } = await acct()
      .from('accounts')
      .select('id, account_type')
      .in('id', debitAccountIds);
    for (const r of (data ?? []) as Row[]) {
      if (r.account_type != null) {
        typeByAccount.set(String(r.id), String(r.account_type) as AccountType);
      }
    }
  }

  const resolveDebitAccountType = (line: NewBillLineInput): AccountType | null => {
    const accountId = resolveDebitAccount(line);
    return accountId ? (typeByAccount.get(accountId) ?? null) : null;
  };

  return { resolveDebitAccount, resolveDebitAccountType };
}

/** Compute money totals + per-line debit accounts (and their types) for input lines. */
async function computeTotalsFor(
  lines: NewBillLineInput[],
  vendorId: string,
  taxTotal: number | null | undefined
): Promise<BillTotals> {
  const defaults = await accountingSettingsService.getDefaultAccounts();
  const { resolveDebitAccount, resolveDebitAccountType } = await debitAccountResolver(
    lines,
    vendorId,
    defaults.operatingExpenses
  );
  return computeBillTotals({ lines, resolveDebitAccount, resolveDebitAccountType, taxTotal });
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
   * Edit a POSTED bill in place. Draft bills route to updateDraft; a void bill is rejected. Bills
   * that capitalized received inventory (any line with source_inventory_id) are rejected here —
   * those must be corrected via void & reissue so FIFO cost layers (GL 1300 ↔ v_inventory_valuation)
   * stay intact. When the rebuilt expense JE equals the posted one and the bill date is unchanged,
   * the edit is ledger-neutral and only the header/lines are rewritten; otherwise we REVERSE +
   * RE-POST (post a fresh expense JE, then accounting.apply_posted_bill_edit swaps header/lines +
   * relinks + voids the old entry). A failed swap voids the just-posted replacement so the books
   * never drift. Financial edits require an unpaid bill (and an open period — the RPCs enforce it).
   */
  async editPosted(
    id: string,
    input: UpdateBillInput
  ): Promise<{ bill: Bill | null; error?: string }> {
    const existing = await this.getById(id);
    if (!existing) return { bill: null, error: 'Bill not found.' };
    if (existing.status === 'void') {
      return { bill: null, error: 'A void bill cannot be edited — reissue a new one instead.' };
    }
    if (existing.status === 'draft') {
      return this.updateDraft(id, input);
    }

    const lines = input.lines ?? existing.lines?.map(toLineInput) ?? [];
    if (!lines.length) return { bill: null, error: 'A bill needs at least one line.' };

    // Inventory safety: never reverse+repost a bill tied to received stock (FIFO layers would desync).
    const touchesInventory =
      (existing.lines ?? []).some((l) => l.sourceInventoryId != null) ||
      lines.some((l) => l.sourceInventoryId != null);
    if (touchesInventory) {
      return {
        bill: null,
        error: 'This bill is linked to received inventory — correct it with void & reissue.',
      };
    }

    const vendorId = input.vendorId !== undefined ? input.vendorId : existing.vendorId;
    const billDate = input.billDate !== undefined ? input.billDate : existing.billDate;
    const taxTotal = input.taxTotal !== undefined ? input.taxTotal : existing.taxTotal;
    const jobId = input.jobId !== undefined ? input.jobId : existing.jobId;

    const totals = await computeTotalsFor(lines, vendorId, taxTotal);
    const defaults = await accountingSettingsService.getDefaultAccounts();
    let je;
    try {
      je = buildBillExpenseJournalLines(totals, defaults, { vendorId, jobId });
    } catch (e) {
      return {
        bill: null,
        error: e instanceof Error ? e.message : 'Unable to build the expense entry.',
      };
    }

    const header: Record<string, unknown> = {
      vendor_id: vendorId,
      bill_number: input.billNumber !== undefined ? input.billNumber : existing.billNumber,
      bill_date: billDate,
      due_date: input.dueDate !== undefined ? input.dueDate : existing.dueDate,
      terms: input.terms !== undefined ? input.terms : existing.terms,
      job_id: jobId,
      memo: input.memo !== undefined ? input.memo : existing.memo,
      subtotal: je.subtotal,
      tax_total: je.taxTotal,
      total: je.total,
    };
    const linePayload = lineRows(id, lines);

    const existingJe = existing.journalEntryId
      ? await journalService.getById(existing.journalEntryId)
      : null;
    const ledgerUnchanged =
      existingJe != null &&
      existingJe.status === 'posted' &&
      billDate === existing.billDate &&
      journalLinesEquivalent(existingJe.lines ?? [], je.lines);

    if (ledgerUnchanged) {
      const patch = {
        ...header,
        balance_due: Math.round((je.total - existing.amountPaid) * 100) / 100,
      };
      const { error: uErr } = await acct().from('bills').update(patch).eq('id', id);
      if (uErr) return { bill: null, error: uErr.message };
      await acct().from('bill_lines').delete().eq('bill_id', id);
      const { error: lErr } = await acct().from('bill_lines').insert(linePayload);
      if (lErr) return { bill: null, error: lErr.message };
      return { bill: await this.getById(id) };
    }

    if (existing.amountPaid > 0) {
      return {
        bill: null,
        error: 'Unapply vendor payments before changing the amounts on this bill.',
      };
    }
    const posted = await journalService.createAndPost({
      entryDate: billDate || new Date().toISOString().slice(0, 10),
      memo: `Bill ${existing.billNumber ?? id}`,
      sourceType: 'bill',
      sourceId: id,
      lines: je.lines,
    });
    if (!posted.entryId) {
      return { bill: null, error: posted.error ?? 'Failed to post the revised expense entry.' };
    }
    const { error: rpcErr } = await acct().rpc('apply_posted_bill_edit', {
      p_bill_id: id,
      p_new_entry_id: posted.entryId,
      p_header: header,
      p_lines: linePayload,
    });
    if (rpcErr) {
      await journalService.voidEntry(posted.entryId, 'Bill edit failed after posting replacement');
      return { bill: null, error: rpcErr.message };
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

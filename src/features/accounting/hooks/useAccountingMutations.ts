import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  accountingSettingsService,
  accountsService,
  bankAccountsService,
  bankRulesService,
  bankTransactionsService,
  billsService,
  budgetsService,
  customFieldsService,
  customersService,
  dimensionsService,
  fixedAssetsService,
  inventoryCogsService,
  invoicesService,
  journalService,
  paymentsService,
  reconciliationsService,
  recurringTemplatesService,
  taxTableSyncService,
  vendorPaymentsService,
  vendorsService,
} from '@/services/api/accounting';
import type {
  Account,
  BudgetCellInput,
  BudgetStatus,
  CustomFieldEntityType,
  CustomFieldValueInput,
  CustomFieldValueJson,
  NewAccountInput,
  NewBankAccountInput,
  NewBankRuleInput,
  NewBillInput,
  NewBudgetInput,
  NewCustomFieldDefInput,
  NewCustomerInput,
  NewDimensionInput,
  NewFixedAssetInput,
  NewInvoiceInput,
  NewJournalEntryInput,
  NewPaymentInput,
  NewReconciliationInput,
  NewRecurringTemplateInput,
  NewVendorInput,
  NewVendorPaymentInput,
  ParsedBankTransaction,
  UpdateBankAccountInput,
  UpdateBankRuleInput,
  FixedAssetStatus,
  UpdateBillInput,
  UpdateBudgetInput,
  UpdateCustomFieldDefInput,
  UpdateDimensionInput,
  UpdateFixedAssetInput,
  UpdateInvoiceInput,
  UpdateRecurringTemplateInput,
  TaxTableDrift,
} from '../types';
import { ACCOUNTING_QUERY_KEYS } from '../constants';

export function useCreateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewAccountInput) => accountsService.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.accounts }),
  });
}

export function useUpdateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<Account> }) =>
      accountsService.update(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.accounts }),
  });
}

/** Create a draft journal entry and post it (DB enforces balance + >=2 lines). */
export function usePostJournalEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewJournalEntryInput) => journalService.createAndPost(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.journal });
      // A posted JE moves every financial report (TB/P&L/BS).
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.reports });
    },
  });
}

export function useVoidJournalEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      journalService.voidEntry(id, reason),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.all }),
  });
}

// ── Customers ────────────────────────────────────────────────────────────────
export function useCreateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewCustomerInput) => customersService.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.customers }),
  });
}

export function useUpdateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: Partial<NewCustomerInput> & { isActive?: boolean };
    }) => customersService.update(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.customers }),
  });
}

// ── Invoices ─────────────────────────────────────────────────────────────────
// NOTE: accounting.v_job_costing.revenue sums lines of every NON-VOID invoice
// (drafts included), so draft create/update/void on a job-linked invoice all move
// that job's revenue — hence each invalidates the jobCosting subtree (scoped to
// accounting), not just `send`.
export function useCreateInvoiceDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      input,
      customerTaxExempt,
    }: {
      input: NewInvoiceInput;
      customerTaxExempt?: boolean;
    }) => invoicesService.createDraft(input, { customerTaxExempt }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.invoices });
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.jobCosting });
    },
  });
}

export function useUpdateInvoiceDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
      customerTaxExempt,
    }: {
      id: string;
      input: UpdateInvoiceInput;
      customerTaxExempt?: boolean;
    }) => invoicesService.updateDraft(id, input, { customerTaxExempt }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.invoices });
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.jobCosting });
    },
  });
}

/**
 * Send an invoice: posts the balanced revenue JE (Dr AR / Cr Income / Cr Sales Tax)
 * and flips it to `sent`. Invalidates invoices + the journal subtree (a JE posted).
 */
export function useSendInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => invoicesService.send(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.invoices });
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.journal });
      // Revenue JE + a new open receivable → refresh statements and AR aging.
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.reports });
      // Sending a job-linked invoice raises that job's revenue/margin.
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.jobCosting });
    },
  });
}

export function useVoidInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      invoicesService.voidInvoice(id, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.invoices });
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.journal });
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.reports });
      // Voiding a job-linked invoice drops that job's revenue/margin.
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.jobCosting });
    },
  });
}

// ── Customer payments ────────────────────────────────────────────────────────
/**
 * Record a customer payment: posts the balanced receipt JE (Dr Cash/Undeposited /
 * Cr AR) and writes payment + applications (invoice rollups update via DB trigger).
 * Invalidates payments, invoices (balances changed) and the journal subtree.
 */
export function useRecordPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewPaymentInput) => paymentsService.record(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.payments });
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.invoices });
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.journal });
      // Cash up / AR down → refresh statements and AR aging.
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.reports });
      // Job-costing detail lists invoice status/balance; refresh its drill-down.
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.jobCosting });
    },
  });
}

// ── Vendors (A2) ─────────────────────────────────────────────────────────────
export function useCreateVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewVendorInput) => vendorsService.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.vendors }),
  });
}

export function useUpdateVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: Partial<NewVendorInput> & { isActive?: boolean };
    }) => vendorsService.update(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.vendors }),
  });
}

// ── Bills (A2) ───────────────────────────────────────────────────────────────
// Bills do not feed accounting.v_job_costing's numbers (its material_cost comes
// from public.job_inventory, not bills), but the B1 per-job DETAIL screen lists a
// job's bills, so creating/editing/(re)assigning a job-linked bill must refresh the
// jobCosting subtree's drill-down. Scoped to accounting.
export function useCreateBillDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewBillInput) => billsService.createDraft(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.bills });
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.jobCosting });
    },
  });
}

export function useUpdateBillDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateBillInput }) =>
      billsService.updateDraft(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.bills });
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.jobCosting });
    },
  });
}

/**
 * Post a bill: posts the balanced expense JE (Dr Expense/Inventory-asset / Cr AP) and
 * flips it to `open`. Invalidates bills + the journal subtree (a JE posted).
 */
export function usePostBill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => billsService.post(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.bills });
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.journal });
      // Expense JE + a new open payable → refresh statements and AP aging.
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.reports });
      // The job-costing detail lists this job's bills; refresh its drill-down.
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.jobCosting });
    },
  });
}

export function useVoidBill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      billsService.voidBill(id, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.bills });
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.journal });
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.reports });
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.jobCosting });
    },
  });
}

// ── Vendor payments (A2) ─────────────────────────────────────────────────────
/**
 * Record a vendor payment: posts the balanced disbursement JE (Dr AP / Cr Cash) and
 * writes payment + applications (bill rollups update via DB trigger). Invalidates
 * vendor payments, bills (balances changed) and the journal subtree.
 */
export function useRecordVendorPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewVendorPaymentInput) => vendorPaymentsService.record(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.vendorPayments });
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.bills });
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.journal });
      // AP down / cash down → refresh statements and AP aging.
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.reports });
      // Job-costing detail lists bill status/balance; refresh its drill-down.
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.jobCosting });
    },
  });
}

// ── Banking (A4) ─────────────────────────────────────────────────────────────
// Non-money actions invalidate only the `bank` subtree. Money actions (accept,
// unmatch) post/void a JE, so they additionally invalidate the journal + reports
// subtrees — exactly like the AR/AP money mutations above.

export function useCreateBankAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewBankAccountInput) => bankAccountsService.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.bankAccounts }),
  });
}

export function useUpdateBankAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateBankAccountInput }) =>
      bankAccountsService.update(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.bankAccounts }),
  });
}

/**
 * Import parsed CSV/OFX/QFX rows into a bank account (deduped on external_id, then
 * auto-categorized by the active rules). No JE posts at import time — accepting a
 * transaction is what posts. Invalidates the whole bank subtree (new rows + counts).
 */
export function useImportBankTransactions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      bankAccountId,
      transactions,
    }: {
      bankAccountId: string;
      transactions: ParsedBankTransaction[];
    }) => bankTransactionsService.import(bankAccountId, transactions),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.bank }),
  });
}

/** Set/clear a transaction's category without posting (review step). */
export function useCategorizeBankTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, categoryAccountId }: { id: string; categoryAccountId: string | null }) =>
      bankTransactionsService.categorize(id, categoryAccountId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.bank }),
  });
}

/**
 * Accept a transaction: posts the balanced JE (Dr/Cr category vs. bank GL) and marks
 * it matched. Invalidates the bank subtree plus journal + reports (a JE posted).
 */
export function useAcceptBankTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, categoryAccountId }: { id: string; categoryAccountId?: string }) =>
      bankTransactionsService.accept(id, categoryAccountId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.bank });
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.journal });
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.reports });
    },
  });
}

/** Undo an accept: voids the posted JE and returns the row to categorized. */
export function useUnmatchBankTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      bankTransactionsService.unmatch(id, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.bank });
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.journal });
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.reports });
    },
  });
}

/** Exclude / un-exclude a transaction from the books (no JE). */
export function useSetBankTransactionExcluded() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, excluded }: { id: string; excluded: boolean }) =>
      bankTransactionsService.setExcluded(id, excluded),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.bank }),
  });
}

// ── Bank rules ───────────────────────────────────────────────────────────────
export function useCreateBankRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewBankRuleInput) => bankRulesService.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.bank }),
  });
}

export function useUpdateBankRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateBankRuleInput }) =>
      bankRulesService.update(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.bank }),
  });
}

export function useDeleteBankRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => bankRulesService.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.bank }),
  });
}

// ── Reconciliations ──────────────────────────────────────────────────────────
export function useCreateReconciliation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewReconciliationInput) => reconciliationsService.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.bank }),
  });
}

export function useUpdateReconciliation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: {
        statementDate?: string;
        statementEndingBalance?: number | null;
        beginningBalance?: number | null;
      };
    }) => reconciliationsService.update(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.bank }),
  });
}

/** Clear/unclear a transaction against a reconciliation (updates the live summary). */
export function useSetTransactionCleared() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      reconciliationId,
      bankTransactionId,
      cleared,
    }: {
      reconciliationId: string;
      bankTransactionId: string;
      cleared: boolean;
    }) => reconciliationsService.setCleared(reconciliationId, bankTransactionId, cleared),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.bank }),
  });
}

/** Finalize a reconciliation (refused unless the difference is 0.00). */
export function useCompleteReconciliation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => reconciliationsService.complete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.bank }),
  });
}

// ── Reporting dimensions (B2) ─────────────────────────────────────────────────
// Pure master-data CRUD. Dimensions move no money, so these only invalidate the
// `dimensions` subtree (existing postings keep whatever dimension they were stamped
// with; editing a tag's name does not re-post anything).

export function useCreateDimension() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewDimensionInput) => dimensionsService.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.dimensions }),
  });
}

export function useUpdateDimension() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateDimensionInput }) =>
      dimensionsService.update(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.dimensions }),
  });
}

export function useDeactivateDimension() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => dimensionsService.deactivate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.dimensions }),
  });
}

// ── Recurring templates (B2) ──────────────────────────────────────────────────
// CRUD on the template itself only touches the `recurring` subtree. The GENERATE
// mutations are a money path: each builds the next invoice/bill/JE and posts a
// balanced entry via post_journal_entry, so they invalidate recurring + invoices +
// bills + journal + reports + jobCosting — the same fan-out the AR/AP money mutations
// use — all scoped under ['accounting', ...].

export function useCreateRecurringTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewRecurringTemplateInput) => recurringTemplatesService.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.recurring }),
  });
}

export function useUpdateRecurringTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateRecurringTemplateInput }) =>
      recurringTemplatesService.update(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.recurring }),
  });
}

/** Pause/resume a recurring template (active flag). */
export function useSetRecurringTemplateActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      recurringTemplatesService.setActive(id, active),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.recurring }),
  });
}

/** Shared invalidation for a generate run (a balanced JE + a new document posted). */
function invalidateAfterGenerate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.recurring });
  qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.invoices });
  qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.bills });
  qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.journal });
  qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.reports });
  qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.jobCosting });
}

/**
 * Generate the next document/JE for ONE template (posts a balanced JE, then advances
 * the schedule). Invalidates recurring + every downstream subtree the new document
 * moves (invoices/bills/journal/reports/jobCosting).
 */
export function useGenerateRecurringTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, onDate }: { id: string; onDate?: string }) =>
      recurringTemplatesService.generateDue(id, onDate),
    onSuccess: () => invalidateAfterGenerate(qc),
  });
}

/**
 * Generate every template due as of a date (default today), one document each. Same
 * fan-out invalidation as the single generate.
 */
export function useGenerateAllDueRecurring() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (asOf?: string) => recurringTemplatesService.generateAllDue(asOf),
    onSuccess: () => invalidateAfterGenerate(qc),
  });
}

// ── Inventory valuation → COGS (B3) ───────────────────────────────────────────
// Receiving a layer posts NO journal entry (the 1300 debit was booked at bill time),
// so it only refreshes the inventory subtree (valuation/on-hand changed). Consuming a
// job's COGS posts a BALANCED Dr 5000 / Cr 1300 entry via accounting.consume_job_cogs,
// so it fans out to journal + reports + jobCosting (the job's costs moved) — the same
// pattern the AR/AP money mutations use — all scoped under ['accounting', ...].

/**
 * Seed (or fetch) a FIFO cost layer from a posted inventory bill line. Idempotent; posts
 * no JE. Invalidates the inventory subtree so the valuation reflects the new on-hand cost.
 */
export function useReceiveInventoryLayer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (billLineId: string) => inventoryCogsService.receiveLayerFromBillLine(billLineId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.inventory }),
  });
}

/**
 * Post FIFO COGS for a consumed job: the RPC FIFO-depletes layers and posts ONE balanced
 * Dr 5000 COGS / Cr 1300 Inventory Asset entry, recording the consumption events. A null
 * journalEntryId means nothing was costable (uncosted) — no JE posted, but the inventory
 * work list still refreshes. Invalidates inventory + journal + reports + jobCosting.
 */
export function useConsumeJobCogs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => inventoryCogsService.consumeJobCogs(jobId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.inventory });
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.journal });
      // COGS relief hits the P&L (5000) and Balance Sheet (1300) → refresh statements.
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.reports });
      // The job now carries booked COGS → its job-costing detail changed.
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.jobCosting });
    },
  });
}

// ── Books-closed (period lock) date (D1) ──────────────────────────────────────
// Admin-only. Moving the lock posts NO journal entry itself, but it changes which
// entry dates the DB will accept for posting/voiding — so it invalidates the closed-
// date value plus the journal + reports subtrees (the set of postable/period-bounded
// activity just changed). The RPC enforces accounting_admin-only; a non-admin caller
// gets a DB `insufficient_privilege` error surfaced as { ok:false, error }.

/**
 * Set or clear the books-closed-through date (null re-opens the books). Calls the
 * admin-only accounting.set_closed_through_date RPC. Returns { ok, error } so the
 * confirmation dialog can show a DB rejection (e.g. insufficient privileges) inline.
 */
export function useSetClosedThroughDate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (date: string | null) => accountingSettingsService.setClosedThroughDate(date),
    onSuccess: (result) => {
      // Only refetch when the change actually landed; a rejected attempt changed nothing.
      if (!result.ok) return;
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.closedThroughDate });
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.journal });
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.reports });
    },
  });
}

// ── Budgeting & forecasting (D2) ──────────────────────────────────────────────
// Budgets are planning artifacts: NONE of these mutations move money, so NONE posts a
// journal entry and NONE invalidates the journal/reports subtrees. They touch only the
// `budgets` subtree (the list, the edited budget's header/grid, and its Budget-vs-Actual
// — whose budgeted column changed; its actual column is unaffected by editing the plan).

export function useCreateBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewBudgetInput) => budgetsService.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.budgets }),
  });
}

export function useUpdateBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateBudgetInput }) =>
      budgetsService.update(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.budgets }),
  });
}

/** Set a budget's lifecycle status (draft → active → archived). */
export function useSetBudgetStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: BudgetStatus }) =>
      budgetsService.setStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.budgets }),
  });
}

export function useDeleteBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => budgetsService.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.budgets }),
  });
}

/**
 * Save the editor grid: replace a budget's lines with the non-zero cells. Moves no money
 * (no JE). Invalidates the `budgets` subtree so the grid + Budget-vs-Actual (its budgeted
 * column) refetch for the edited budget.
 */
export function useSaveBudgetLines() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ budgetId, cells }: { budgetId: string; cells: BudgetCellInput[] }) =>
      budgetsService.replaceLines(budgetId, cells),
    onSuccess: (_result, { budgetId }) => {
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.budgetGrid(budgetId) });
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.budgetVsActual(budgetId) });
    },
  });
}

// ── Fixed assets & depreciation (D3) ──────────────────────────────────────────
// Creating/editing an asset writes its header and (re)generates its UNPOSTED straight-line
// schedule — NO money moves, so those mutations invalidate ONLY the `fixedAssets` subtree
// (the list/register/detail/schedule). RUNNING DEPRECIATION is the money path: it posts a
// BALANCED Dr depreciation-expense / Cr 1510 entry per due asset via post_journal_entry, so
// it additionally invalidates journal + reports (depreciation hits the P&L and Balance
// Sheet) — the same fan-out the AR/AP money mutations use, all scoped under ['accounting',…].

export function useCreateFixedAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewFixedAssetInput) => fixedAssetsService.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.fixedAssets }),
  });
}

export function useUpdateFixedAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateFixedAssetInput }) =>
      fixedAssetsService.update(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.fixedAssets }),
  });
}

/** Set a fixed asset's lifecycle status (active → fully_depreciated → disposed). */
export function useSetFixedAssetStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: FixedAssetStatus }) =>
      fixedAssetsService.setStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.fixedAssets }),
  });
}

export function useDeleteFixedAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fixedAssetsService.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.fixedAssets }),
  });
}

/**
 * (Re)generate an asset's straight-line schedule (DB integer-cents split). Touches only
 * UNPOSTED rows and posts no JE, so it invalidates only the `fixedAssets` subtree.
 */
export function useGenerateDepreciationSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fixedAssetId: string) => fixedAssetsService.generateSchedule(fixedAssetId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.fixedAssets }),
  });
}

/** Shared invalidation for a depreciation posting (a balanced JE posted). */
function invalidateAfterDepreciation(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.fixedAssets });
  qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.journal });
  // Depreciation hits the P&L (expense) and Balance Sheet (1510 contra-asset) → refresh statements.
  qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.reports });
}

/**
 * Post a SINGLE due depreciation schedule row (balanced Dr expense / Cr 1510 via the RPC,
 * honoring the books-closed lock). Idempotent. Invalidates fixedAssets + journal + reports.
 */
export function usePostDepreciationRow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (scheduleId: string) => fixedAssetsService.postScheduleRow(scheduleId),
    onSuccess: () => invalidateAfterDepreciation(qc),
  });
}

/**
 * Run depreciation for a period: post every DUE row (unposted, period_date <= date) across
 * all non-disposed assets, each as a balanced Dr expense / Cr 1510 entry via the RPC
 * (post_journal_entry; books-closed lock honored). `date` defaults to today. Idempotent
 * (already-posted rows are skipped). Invalidates fixedAssets + journal + reports.
 */
export function useRunDepreciationForPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (date?: string) => fixedAssetsService.runDepreciationForPeriod(date),
    onSuccess: () => invalidateAfterDepreciation(qc),
  });
}

// ── Custom fields on accounting entities (D4) ─────────────────────────────────
// Pure metadata CRUD. NONE of these mutations move money, so NONE posts a journal entry
// and NONE invalidates the journal/reports subtrees. They touch ONLY the `customFields`
// subtree (the admin definitions list and the per-entity value lists). Defining/editing a
// field changes which fields render on host screens; saving values changes one entity's
// values — both refetch via the `customFields` root invalidation, all scoped under
// ['accounting', ...].

export function useCreateCustomFieldDef() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewCustomFieldDefInput) => customFieldsService.createDef(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.customFields }),
  });
}

export function useUpdateCustomFieldDef() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateCustomFieldDefInput }) =>
      customFieldsService.updateDef(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.customFields }),
  });
}

/** Show/hide a definition without deleting it (active flag). */
export function useSetCustomFieldDefActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      customFieldsService.setDefActive(id, active),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.customFields }),
  });
}

/** Hard-delete a definition AND its values (cascade). Prefer deactivate to keep history. */
export function useDeleteCustomFieldDef() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => customFieldsService.removeDef(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.customFields }),
  });
}

/**
 * Set ONE custom field value on an entity (validated+coerced against its def; an unset
 * value deletes the row). Invalidates that entity's value list so the host screen
 * refetches. No money moves → no journal/reports invalidation.
 */
export function useSetCustomFieldValue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      entityType,
      entityId,
      defId,
      value,
    }: {
      entityType: CustomFieldEntityType;
      entityId: string;
      defId: string;
      value: CustomFieldValueJson;
    }) => customFieldsService.setValue(entityType, entityId, defId, value),
    onSuccess: (_result, { entityType, entityId }) =>
      qc.invalidateQueries({
        queryKey: ACCOUNTING_QUERY_KEYS.customFieldValues(entityType, entityId),
      }),
  });
}

/**
 * Save MANY custom field values on one entity in a single batch (the host form's
 * custom-field section: set values are upserted, unset ones deleted; all-or-nothing on a
 * validation error). Invalidates that entity's value list. No money moves.
 */
export function useSaveCustomFieldValues() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      entityType,
      entityId,
      values,
    }: {
      entityType: CustomFieldEntityType;
      entityId: string;
      values: CustomFieldValueInput[];
    }) => customFieldsService.setValues(entityType, entityId, values),
    onSuccess: (_result, { entityType, entityId }) =>
      qc.invalidateQueries({
        queryKey: ACCOUNTING_QUERY_KEYS.customFieldValues(entityType, entityId),
      }),
  });
}

// ── TAX-SYNC: quarterly tax-table refresh + drift alert (ADVISORY-ONLY) ────────────────
// Three admin actions. NONE posts a journal entry / moves money (G3 vacuous):
//   • applyDrift  — the ONLY path that mutates accounting.tax_rates, via the
//     accounting_admin-only RPC. Because it changes stored RATES (reference data the
//     invoice tax math derives from), it invalidates the taxTableSync subtree AND the
//     `taxCodes` + `salesTax` subtrees (their combined rates are recomputed from
//     tax_rates) — but NOT journal/reports (no JE was posted).
//   • dismissDrift — marks a drift dismissed; no rate change → only the taxTableSync subtree.
//   • checkNow     — asks the server-gated function to run; new snapshots/drift may appear →
//     only the taxTableSync subtree.
// All invalidations stay under ['accounting', ...].

/** Invalidate the whole TAX-SYNC subtree (sources, snapshots, drift list, open-count, detail). */
function invalidateTaxTableSync(qc: ReturnType<typeof useQueryClient>): void {
  qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.taxTableSync });
}

/**
 * APPLY a drift (admin-confirmed): runs accounting.apply_tax_table_drift, which writes the
 * proposed rates to accounting.tax_rates and marks the drift 'applied'. Returns
 * `{ ok, applied, error }` (never throws on a DB rejection — a non-admin or a terminal-state
 * drift comes back as `{ ok:false, error }`). On success invalidates the TAX-SYNC subtree
 * plus the tax-code/sales-tax caches whose rates derive from tax_rates.
 */
export function useApplyTaxTableDrift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ driftId, diff }: { driftId: string; diff?: TaxTableDrift['diff'] }) =>
      taxTableSyncService.applyDrift(driftId, diff),
    onSuccess: (result) => {
      if (!result.ok) return; // a rejected apply changed nothing — leave caches as-is
      invalidateTaxTableSync(qc);
      // Stored rates changed → refresh anything that reads them (combined tax-code rates,
      // the sales-tax liability report). No JE was posted, so journal/reports are untouched.
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.taxCodes });
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.salesTax });
    },
  });
}

/**
 * DISMISS a drift (no rate change): runs accounting.dismiss_tax_table_drift and marks it
 * 'dismissed'. Returns `{ ok, error }`. On success invalidates only the TAX-SYNC subtree.
 */
export function useDismissTaxTableDrift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (driftId: string) => taxTableSyncService.dismissDrift(driftId),
    onSuccess: (result) => {
      if (result.ok) invalidateTaxTableSync(qc);
    },
  });
}

/**
 * Manual "check now": POSTs to the server-gated refresh function (it fetches the official
 * files, snapshots + diffs them, and inserts any open drift — only when the server env
 * ACCOUNTING_TAX_SYNC_ENABLED is set; otherwise it is inert). Returns `{ ok, message, error }`
 * (fails safe if the function is unavailable). On success invalidates the TAX-SYNC subtree
 * so any new snapshots/drift surface.
 */
export function useCheckTaxTablesNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => taxTableSyncService.checkNow(),
    onSuccess: (result) => {
      if (result.ok) invalidateTaxTableSync(qc);
    },
  });
}

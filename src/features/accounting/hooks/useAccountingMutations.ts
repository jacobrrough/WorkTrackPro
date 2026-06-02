import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  accountingSettingsService,
  accountsService,
  attachmentsService,
  bankAccountsService,
  bankRulesService,
  bankTransactionsService,
  billsService,
  budgetsService,
  customFieldsService,
  customersService,
  dimensionsService,
  fixedAssetsService,
  importService,
  inventoryCogsService,
  invoicesService,
  journalService,
  notificationDispatchService,
  notificationRulesService,
  paymentsService,
  reconciliationsService,
  recurringTemplatesService,
  stageParseResult,
  taxTableSyncService,
  vendorPaymentsService,
  vendorsService,
  employeesService,
  payScheduleService,
  payRunService,
  payrollTaxTablesService,
  securityService,
  rbacService,
  type PayRunEmployeeInput,
} from '@/services/api/accounting';
import type {
  Account,
  AttachmentEntityType,
  BudgetCellInput,
  BudgetStatus,
  CustomFieldEntityType,
  CustomFieldValueInput,
  CustomFieldValueJson,
  ImportAccountMapInput,
  ImportParseResult,
  Invoice,
  MappedJournalEntry,
  MappedOpeningBalance,
  NewImportBatchInput,
  NotificationRuleInput,
  ParsedImportRecord,
  ParsedSourceAccount,
  NewAccountInput,
  NewAttachmentInput,
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
  NewEmployeeInput,
  UpdateEmployeeInput,
  NewPayScheduleInput,
  UpdatePayScheduleInput,
  NewPayRunInput,
  NewPayrollTaxTableInput,
  UpdatePayrollTaxTableInput,
  AccountingRoleKey,
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
    mutationFn: ({ id, input }: { id: string; input: Partial<NewCustomerInput> & { isActive?: boolean } }) =>
      customersService.update(id, input),
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
    mutationFn: ({ input, customerTaxExempt }: { input: NewInvoiceInput; customerTaxExempt?: boolean }) =>
      invoicesService.createDraft(input, { customerTaxExempt }),
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
    mutationFn: ({ id, input }: { id: string; input: Partial<NewVendorInput> & { isActive?: boolean } }) =>
      vendorsService.update(id, input),
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
    mutationFn: ({ id, reason }: { id: string; reason: string }) => billsService.voidBill(id, reason),
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
      patch: { statementDate?: string; statementEndingBalance?: number | null; beginningBalance?: number | null };
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

// ── IMPORT / MIGRATION (HELD / UNVERIFIED — NOT FOR FILING) ────────────────────────────
// All but ONE mutation here are STAGING-ONLY and move NO money — they create a batch, stage
// parsed rows (deduped on content_hash), seed/edit the chart-of-accounts mapping wizard, and
// mark the batch ready. They invalidate ONLY the `import` subtree (and the per-batch
// reconciliation/blockers keys). The single money path is COMMIT, which calls the admin-only
// accounting.commit_import_batch RPC → accounting.post_journal_entry; like the AR/AP money
// mutations it additionally invalidates the journal + reports subtrees. Everything stays under
// ['accounting', ...]; with the flag OFF none of this is reachable.

/** Invalidate the whole import subtree (batch list, headers, staging, account-map, recon). */
function invalidateImport(qc: ReturnType<typeof useQueryClient>): void {
  qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.import });
}

/** Create a draft import batch header. */
export function useCreateImportBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewImportBatchInput) => importService.createBatch(input),
    onSuccess: (result) => {
      if (result.batch) qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.importBatches });
    },
  });
}

/**
 * Stage a full parse result into a batch: dedup-insert the parsed records AND seed the
 * chart-of-accounts mapping wizard (one row per distinct source account, pre-suggested from
 * the chart). No money moves. Invalidates the import subtree (new staging + map rows).
 */
export function useStageImportParse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ batchId, parsed }: { batchId: string; parsed: ImportParseResult }) =>
      stageParseResult(batchId, parsed),
    onSuccess: () => invalidateImport(qc),
  });
}

/** Dedup-insert parsed records into a batch's staging (no map seed). No money moves. */
export function useStageImportRecords() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ batchId, records }: { batchId: string; records: ParsedImportRecord[] }) =>
      importService.stageRecords(batchId, records),
    onSuccess: () => invalidateImport(qc),
  });
}

/** Seed/refresh the account-map wizard from the parsed distinct source accounts. */
export function useSeedImportAccountMap() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ batchId, sourceAccounts }: { batchId: string; sourceAccounts: ParsedSourceAccount[] }) =>
      importService.seedAccountMap(batchId, sourceAccounts),
    onSuccess: () => invalidateImport(qc),
  });
}

/** Patch one account-map wizard row (target / create-as-new / ignore). No money moves. */
export function useUpdateImportAccountMap() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ImportAccountMapInput }) =>
      importService.updateAccountMap(id, patch),
    onSuccess: () => invalidateImport(qc),
  });
}

/** Set one staging row's mapped posting payload (opening-balance / journal-entry). */
export function useUpdateImportStagingMapped() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      mapped,
    }: {
      id: string;
      mapped: MappedOpeningBalance | MappedJournalEntry | Record<string, unknown> | null;
    }) => importService.updateStagingMapped(id, mapped),
    onSuccess: () => invalidateImport(qc),
  });
}

/** Skip / un-skip a staging row (a skipped row never posts at commit). */
export function useSetImportStagingSkipped() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, skipped }: { id: string; skipped: boolean }) =>
      importService.setStagingSkipped(id, skipped),
    onSuccess: () => invalidateImport(qc),
  });
}

/** Set a batch's opening-balance "as of" date. */
export function useSetImportOpeningBalanceDate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, date }: { id: string; date: string | null }) =>
      importService.setOpeningBalanceDate(id, date),
    onSuccess: () => invalidateImport(qc),
  });
}

/**
 * Bind every postable row's mapped payload to real account ids (from the account map) and
 * write them back. No money moves. Invalidates the import subtree so the staging + recon +
 * blockers refresh. Returns `{ resolved, unresolved }` so the wizard can list what is left.
 */
export function useResolveImportBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (batchId: string) => importService.resolveAndPrepare(batchId),
    onSuccess: () => invalidateImport(qc),
  });
}

/**
 * Mark a batch 'ready' to commit (resolves payloads first, then enforces a complete map +
 * all postable rows bound). Returns `{ ok, blockers?, error? }` — a refusal lists the
 * blockers without throwing. No money moves. Invalidates the import subtree.
 */
export function useMarkImportReady() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (batchId: string) => importService.markReady(batchId),
    onSuccess: (result) => {
      if (result.ok) invalidateImport(qc);
    },
  });
}

/** Re-open a 'ready' batch's wizard (back to 'mapping'). No money moves. */
export function useReopenImportMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (batchId: string) => importService.reopenMapping(batchId),
    onSuccess: (result) => {
      if (result.ok) invalidateImport(qc);
    },
  });
}

/** Discard a batch (terminal). Keeps staged rows for the audit. No money moves. */
export function useDiscardImportBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (batchId: string) => importService.discardBatch(batchId),
    onSuccess: (result) => {
      if (result.ok) invalidateImport(qc);
    },
  });
}

/**
 * COMMIT the batch — the ONLY money path in the whole import module. Calls the admin-only
 * accounting.commit_import_batch RPC, which posts the staged opening balances as ONE balanced
 * entry (offsets 3050/2050) and each historical journal-entry row as its own balanced entry,
 * all through accounting.post_journal_entry (DB enforces debits = credits + >= 2 lines).
 * Idempotent. Returns `{ ok, summary?, error? }`; a DB rejection (unbalanced / non-admin /
 * wrong status) comes back as `{ ok:false, error }` with the whole commit rolled back — no
 * half-posted import. On success invalidates the import subtree PLUS journal + reports (a
 * balanced JE posted) — the same fan-out the AR/AP money mutations use.
 */
export function useCommitImportBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (batchId: string) => importService.commit(batchId),
    onSuccess: (result) => {
      if (!result.ok) return; // a rejected commit changed nothing — leave caches as-is.
      invalidateImport(qc);
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.journal });
      // Opening balances / historical entries hit every financial report (TB/P&L/BS) and AR/AP aging.
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.reports });
    },
  });
}

// ── NOTIFICATION DELIVERY (HELD / UNVERIFIED — NOT FOR FILING) ─────────────────────────
// Mutations over accounting.notification_rules CONFIG + the dispatch seam (migration
// 20260601000025). Editing a rule invalidates ONLY the notifications subtree — the module
// posts NO journal entry and moves NO money. DISPATCH delivers into the EXISTING
// public.system_notifications feed (owned by the core app's notification queries, which this
// module does not manage), so a successful dispatch invalidates no ['accounting', ...] key.
// With VITE_ACCOUNTING_ENABLED unset none of this is reachable and it is stripped from the
// production build.

/** Invalidate only the notifications config subtree (rules list + single rule). */
function invalidateNotifications(qc: ReturnType<typeof useQueryClient>): void {
  qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.notifications });
}

/**
 * Create-or-update a notification rule (enable/disable, set threshold, scope). Ships DISABLED;
 * the DB re-checks enabled inside the dispatch RPC (defense in depth). No money moves.
 */
export function useUpsertNotificationRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NotificationRuleInput) => notificationRulesService.upsert(input),
    onSuccess: () => invalidateNotifications(qc),
  });
}

/** Toggle one rule's enabled flag by id. No money moves. */
export function useSetNotificationRuleEnabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      notificationRulesService.setEnabled(id, enabled),
    onSuccess: () => invalidateNotifications(qc),
  });
}

/** Set one rule's threshold by id (dollars for low_bank_balance; days otherwise). No money moves. */
export function useSetNotificationRuleThreshold() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, threshold }: { id: string; threshold: number | null }) =>
      notificationRulesService.setThreshold(id, threshold),
    onSuccess: () => invalidateNotifications(qc),
  });
}

/** Delete a notification rule by id (typically a per-account low_bank_balance override). */
export function useDeleteNotificationRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => notificationRulesService.remove(id),
    onSuccess: () => invalidateNotifications(qc),
  });
}

/**
 * EVENT-DRIVEN (app-side): deliver the invoice_sent notification for an invoice that was just
 * sent. The dispatch RPC's enabled-gate makes this a NO-OP until an admin enables invoice_sent,
 * so it is safe to wire after invoicesService.send() while the module stays flag-dark. Returns
 * the per-candidate dispatch summary (recipients / delivered / suppressed). Delivery lands in
 * the core app's public.system_notifications feed, so nothing in the accounting cache changes.
 */
export function useDispatchInvoiceSent() {
  return useMutation({
    mutationFn: (invoice: Invoice) => notificationDispatchService.dispatchInvoiceSent(invoice),
  });
}

// ── DOCUMENT MANAGEMENT / ATTACHMENTS (HELD / UNVERIFIED — NOT FOR FILING) ─────────────
// Mutations over accounting.attachments (migration 20260601000026) + the existing
// `attachments` storage bucket. Attaching/removing a file invalidates ONLY the attachments
// subtree for the affected entity — the module posts NO journal entry and moves NO money, so
// the journal/reports subtrees are never touched. Encryption-at-rest is DEFERRED to Phase E
// (files sit unencrypted); MIME/size validation is client-side only. With the flag OFF none
// of this is reachable and it is stripped from the production build.

/** Invalidate only one entity's attachment list (the per-entity subtree). */
function invalidateEntityAttachments(
  qc: ReturnType<typeof useQueryClient>,
  entityType: AttachmentEntityType,
  entityId: string
): void {
  qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.attachmentsForEntity(entityType, entityId) });
}

/**
 * Upload a file and attach it to an entity (uploads the object to the existing bucket, then
 * inserts the metadata row). On success, refetches that entity's attachment list. The result
 * object carries any storage/DB error (e.g. RLS denial) so the control can show it inline.
 */
export function useUploadAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewAttachmentInput) => attachmentsService.upload(input),
    onSuccess: (_res, input) => invalidateEntityAttachments(qc, input.entityType, input.entityId),
  });
}

/**
 * Remove one attachment (deletes the storage object + the metadata row). The caller passes the
 * attachment id plus its (entityType, entityId) so the correct entity list is refetched after
 * the delete. Idempotent at the service layer (removing an unknown id is a no-op success).
 */
export function useDeleteAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; entityType: AttachmentEntityType; entityId: string }) =>
      attachmentsService.remove(id),
    onSuccess: (_res, { entityType, entityId }) =>
      invalidateEntityAttachments(qc, entityType, entityId),
  });
}

/**
 * Cascade-remove EVERY attachment for an entity (the app-layer orphan cleanup to call when a
 * parent invoice/bill/etc. is voided/deleted — the polymorphic table has no DB FK to cascade).
 * Removes all storage objects + all metadata rows, then refetches that entity's (now empty)
 * list.
 */
export function useRemoveEntityAttachments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ entityType, entityId }: { entityType: AttachmentEntityType; entityId: string }) =>
      attachmentsService.removeForEntity(entityType, entityId),
    onSuccess: (_res, { entityType, entityId }) =>
      invalidateEntityAttachments(qc, entityType, entityId),
  });
}

// ── C2 PAYROLL (HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING) ─────────────────────────
// Mutations over accounting.employees / pay_schedules / pay_runs / paychecks / payroll_tax_tables
// (migrations 028–029). Employee/schedule/tax-table CRUD and CALCULATE move NO money → they
// invalidate ONLY the `payroll` subtree (editing a tax table changes how a FUTURE run computes
// withholding; CALCULATE writes paychecks/liabilities but posts no JE). The ONLY money paths are
// COMMIT (accounting.commit_pay_run → ONE balanced JE via the GL's single balance guard) and VOID
// (voids that posted JE) — like the AR/AP money mutations they additionally invalidate journal +
// reports. A DB rejection (RLS denial, the cents-identity assert, a closed-period lock) comes back
// in the result object with the WHOLE operation rolled back — never a half-posted run. Everything
// stays under ['accounting', ...]; with the flag OFF none of this is reachable.

/** Invalidate the whole payroll subtree (employees, schedules, runs, paychecks, tax tables, reports). */
function invalidatePayroll(qc: ReturnType<typeof useQueryClient>): void {
  qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.payroll });
}

// ── Employees ──────────────────────────────────────────────────────────────
export function useCreateEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewEmployeeInput) => employeesService.create(input),
    onSuccess: () => invalidatePayroll(qc),
  });
}

export function useUpdateEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateEmployeeInput }) =>
      employeesService.update(id, input),
    onSuccess: () => invalidatePayroll(qc),
  });
}

/** Activate/deactivate an employee (never hard-delete — paychecks reference them ON DELETE RESTRICT). */
export function useSetEmployeeActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      employeesService.setActive(id, isActive),
    onSuccess: () => invalidatePayroll(qc),
  });
}

// ── Pay schedules ─────────────────────────────────────────────────────────────
export function useCreatePaySchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewPayScheduleInput) => payScheduleService.create(input),
    onSuccess: () => invalidatePayroll(qc),
  });
}

export function useUpdatePaySchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdatePayScheduleInput }) =>
      payScheduleService.update(id, input),
    onSuccess: () => invalidatePayroll(qc),
  });
}

// ── Pay runs ──────────────────────────────────────────────────────────────────

/** Create a draft pay run (period + pay date). No money moves. */
export function useCreatePayRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewPayRunInput) => payRunService.createDraft(input),
    onSuccess: () => invalidatePayroll(qc),
  });
}

/**
 * CALCULATE (or recalculate) a pay run: runs the pure withholding engine for every active employee
 * (hours sourced READ-ONLY from public.shifts), writes the paychecks + per-agency liabilities, and
 * flips the run to 'calculated'. Moves NO money (no JE posts), so it invalidates ONLY the payroll
 * subtree. Returns `{ ok, paychecksWritten, …, skipped, error }` so the workspace can show the
 * computed totals + any skipped employees (no hours / negative net) inline.
 */
export function useCalculatePayRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, overrides }: { runId: string; overrides?: PayRunEmployeeInput[] }) =>
      payRunService.calculate(runId, overrides ?? []),
    onSuccess: (result) => {
      if (result.ok) invalidatePayroll(qc);
    },
  });
}

/**
 * COMMIT a pay run — the ONLY money path in the whole payroll module. Calls
 * accounting.commit_pay_run (the can_payroll()-gated RPC), which asserts the cents identity then
 * posts ONE balanced JE (Dr 6500 gross + Dr 6510 employer tax / Cr 2300 liabilities + Cr 1010 net)
 * through the GL's single balance guard, stamping the run committed + summary. Idempotent. A DB
 * rejection (unbalanced, wrong status, non-payroll user, closed period) comes back `{ ok:false,
 * error }` with the WHOLE commit rolled back — no half-posted run. On success invalidates the
 * payroll subtree PLUS journal + reports (a balanced JE posted) — the same fan-out the AR/AP money
 * mutations use.
 */
export function useCommitPayRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => payRunService.commit(runId),
    onSuccess: (result) => {
      if (!result.ok) return; // a rejected commit changed nothing — leave caches as-is.
      invalidatePayroll(qc);
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.journal });
      // The payroll JE hits the P&L (6500/6510) and Balance Sheet (2300/1010) → refresh statements.
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.reports });
    },
  });
}

/**
 * VOID a committed pay run: calls accounting.void_pay_run, which voids the run's posted JE (posted
 * entries are immutable — only posted→void) and marks the run 'void'. The JE void is the ledger
 * correction. On success invalidates the payroll subtree + journal + reports.
 */
export function useVoidPayRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, reason }: { runId: string; reason: string }) =>
      payRunService.voidRun(runId, reason),
    onSuccess: (result) => {
      if (!result.ok) return;
      invalidatePayroll(qc);
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.journal });
      qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.reports });
    },
  });
}

/** Delete a DRAFT/calculated pay run (clears its paychecks; refuses once committed). No money moves. */
export function useDeletePayRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => payRunService.deleteDraft(runId),
    onSuccess: (result) => {
      if (result.ok) invalidatePayroll(qc);
    },
  });
}

// ── Admin tax tables ────────────────────────────────────────────────────────
// Editing a statutory rate/bracket changes how a FUTURE pay run computes withholding — it posts NO
// journal entry and moves NO money, so these invalidate ONLY the payroll subtree. The standard
// audit trigger on the table is the rate-edit tamper trail (DB-side). VERIFY every value.

export function useCreatePayrollTaxTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewPayrollTaxTableInput) => payrollTaxTablesService.create(input),
    onSuccess: (result) => {
      if (result.row) invalidatePayroll(qc);
    },
  });
}

export function useUpdatePayrollTaxTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdatePayrollTaxTableInput }) =>
      payrollTaxTablesService.update(id, input),
    onSuccess: (result) => {
      if (result.row) invalidatePayroll(qc);
    },
  });
}

/** Retire/reactivate a tax-table row (keeps the audit trail). No money moves. */
export function useSetPayrollTaxTableActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      payrollTaxTablesService.setActive(id, isActive),
    onSuccess: (result) => {
      if (result.ok) invalidatePayroll(qc);
    },
  });
}

// ── PHASE E SECURITY HARDENING (HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING) ─────────────────
// Mutations over the Phase E DB layer. NOTHING here moves money or posts a journal entry, so every
// mutation invalidates ONLY its own subtree — the journal/reports subtrees are NEVER touched. The
// DB role gate is the real authorization guard (encrypted accessors re-check can_write/can_payroll
// in-body; RBAC grant/revoke is RLS-gated to accounting_admin; the audit backfill is admin-only).
// Each call returns a result object whose `error` carries the DB message (RLS/role denial, a missing
// Vault key, a unique violation) for inline display. With the flag OFF none of this is reachable.

/** Invalidate the encryption-coverage probe (a backfill changed the plaintext-vs-cipher counts). */
function invalidateEncryptionCoverage(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.securityCoverage });
}

/** Invalidate the audit-chain status + verification keys (a backfill extended the chain). */
function invalidateAuditChain(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['accounting', 'security', 'audit-chain'] });
}

/**
 * Encrypt + store a vendor tax id (E1 cutover backfill; can_write()-gated in the DB). On success,
 * refresh the encryption-coverage probe. Does NOT touch journal/reports (no money moves).
 */
export function useSetVendorTaxId() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ vendorId, plaintext }: { vendorId: string; plaintext: string | null }) =>
      securityService.setVendorTaxId(vendorId, plaintext),
    onSuccess: (result) => {
      if (result.ok) invalidateEncryptionCoverage(qc);
    },
  });
}

/** Encrypt + store a bank-account mask (E1 cutover backfill; can_write()-gated). */
export function useSetBankAccountMask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ accountId, plaintext }: { accountId: string; plaintext: string | null }) =>
      securityService.setBankAccountMask(accountId, plaintext),
    onSuccess: (result) => {
      if (result.ok) invalidateEncryptionCoverage(qc);
    },
  });
}

/** Encrypt + store an employee SSN (E1 cutover backfill; can_payroll()-gated). */
export function useSetEmployeeSsn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ employeeId, plaintext }: { employeeId: string; plaintext: string | null }) =>
      securityService.setEmployeeSsn(employeeId, plaintext),
    onSuccess: (result) => {
      if (result.ok) invalidateEncryptionCoverage(qc);
    },
  });
}

/** Encrypt + store an employee's bank routing + account (E1 cutover backfill; can_payroll()-gated). */
export function useSetEmployeeBank() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      employeeId,
      routingPlaintext,
      accountPlaintext,
    }: {
      employeeId: string;
      routingPlaintext: string | null;
      accountPlaintext: string | null;
    }) => securityService.setEmployeeBank(employeeId, routingPlaintext, accountPlaintext),
    onSuccess: (result) => {
      if (result.ok) invalidateEncryptionCoverage(qc);
    },
  });
}

/**
 * Encrypt + store an employee pay rate in CENTS (E1 cutover backfill; can_payroll()-gated).
 * SHADOW-ONLY — the payroll engine still reads plaintext pay_rate_cents (HUMAN-VERIFY before
 * retiring the plaintext wage column).
 */
export function useSetEmployeePayRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ employeeId, payRateCents }: { employeeId: string; payRateCents: number | null }) =>
      securityService.setEmployeePayRate(employeeId, payRateCents),
    onSuccess: (result) => {
      if (result.ok) invalidateEncryptionCoverage(qc);
    },
  });
}

/**
 * Run the ONE-TIME audit-chain backfill of legacy (pre-E2) rows (E2; accounting_admin-only in the
 * DB). SUPERVISED — re-running after a tamper would "bless" it, so this is a deliberate human step
 * (HUMAN-VERIFY list). On success, refresh the chain status + verification.
 */
export function useBackfillAuditChain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => securityService.backfillAuditChain(),
    onSuccess: (result) => {
      if (result.ok) invalidateAuditChain(qc);
    },
  });
}

/**
 * GRANT an accounting role to a user (RBAC; RLS-gated to accounting_admin in the DB). A non-admin's
 * write comes back { ok:false, error }. On success, refresh the RBAC subtree. No money moves.
 */
export function useGrantRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: AccountingRoleKey }) =>
      rbacService.grant(userId, role),
    onSuccess: (result) => {
      if (result.ok) qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.rbac });
    },
  });
}

/** REVOKE an accounting role from a user (RBAC; RLS-gated to accounting_admin). No money moves. */
export function useRevokeRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: AccountingRoleKey }) =>
      rbacService.revoke(userId, role),
    onSuccess: (result) => {
      if (result.ok) qc.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.rbac });
    },
  });
}

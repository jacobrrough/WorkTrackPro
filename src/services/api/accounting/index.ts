/**
 * Accounting API services barrel. The accounting feature imports from here
 * (`@/services/api/accounting`). Intentionally NOT re-exported from the global
 * src/services/api/index.ts barrel — keeping it separate preserves the
 * develop-in-isolation boundary (the main app never pulls in accounting code).
 */
export { acct } from './accountingClient';
export { accountsService } from './accounts';
export { journalService } from './journal';
export { customersService } from './customers';
export { vendorsService } from './vendors';
export { taxService } from './tax';
export { invoicesService } from './invoices';
export { paymentsService } from './payments';
export { billsService } from './bills';
export { vendorPaymentsService } from './vendorPayments';
export { reportsService } from './reports';
export { jobCostingService } from './jobCosting';
export { accountingSettingsService } from './settings';
// ── Sales-tax reporting & tax calendar (C1) ───────────────────────────────────
export { salesTaxService } from './salesTax';
// ── Tax-table auto-refresh + drift alert (TAX-SYNC, advisory-only) ────────────
export { taxTableSyncService } from './taxTableSync';
export type {
  ApplyDriftResult,
  CheckNowResult,
} from './taxTableSync';
// ── Reporting dimensions + recurring templates (B2) ──────────────────────────
export { dimensionsService } from './dimensions';
export { recurringTemplatesService } from './recurringTemplates';
// ── Inventory valuation (FIFO) → COGS (B3) ────────────────────────────────────
export { inventoryCogsService } from './inventoryCogs';
// ── Budgeting & forecasting (D2) ──────────────────────────────────────────────
export { budgetsService } from './budgets';
// ── Fixed assets & depreciation (D3) ──────────────────────────────────────────
export { fixedAssetsService } from './fixedAssets';
// ── Custom fields on accounting entities (D4) ─────────────────────────────────
export { customFieldsService } from './customFields';
export {
  buildRecurringInvoiceInput,
  buildRecurringBillInput,
  buildRecurringJournalLines,
} from './recurringPayload';
export { buildInvoiceLinesFromJob, setsForPart } from './invoiceLinesFromJob';
export type {
  InvoiceLinesFromJobParams,
  QuoteRateSettings,
} from './invoiceLinesFromJob';
// ── Banking (A4) ─────────────────────────────────────────────────────────────
export { bankAccountsService } from './bankAccounts';
export { bankTransactionsService } from './bankTransactions';
export type { ImportResult, BankTransactionFilter } from './bankTransactions';
export { bankRulesService } from './bankRules';
export { reconciliationsService } from './reconciliations';
export {
  parseBankFile,
  parseCsv,
  parseOfx,
  detectFormat,
  parseAmount,
  normalizeDate,
  syntheticExternalId,
  BankImportError,
} from './bankImportParsers';
export type { BankImportFormat, ParseResult } from './bankImportParsers';
export {
  applyRules,
  applyRulesToBatch,
  ruleMatches,
  validateRule,
} from './bankRulesEngine';
export type { RuleEvaluable } from './bankRulesEngine';
export * from './mappers';

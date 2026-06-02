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
// ── IMPORT / MIGRATION (Phase D, HELD / UNVERIFIED — NOT FOR FILING) ──────────
// The whole module is FLAG-DARK and requires CPA and/or security sign-off before it is
// enabled. importService.commit is the ONLY money path (calls accounting.commit_import_batch
// → accounting.post_journal_entry; offsets 3050/2050). The parsers + mapping helpers are
// pure and dependency-free. HUMAN MUST VERIFY: account-mapping fidelity, no double-posting,
// opening balances reconcile to the source trial balance.
export { importService, stageParseResult } from './import';
export type { ImportStageResult, ImportResolveResult, ImportStagingFilter } from './import';
// ── NOTIFICATION DELIVERY (HELD / UNVERIFIED — NOT FOR FILING) ─────────────────
// The whole module is FLAG-DARK and requires CPA and/or security sign-off before it is
// enabled. notificationRulesService is CRUD around the additive accounting.notification_rules
// CONFIG (ships DISABLED). notificationDispatchService is the SOLE app-side delivery seam: it
// resolves the recipient audience (read-only public.*) and calls accounting.dispatch_notification
// (the single sanctioned cross-schema RPC) once per recipient. NO money moves; NO journal entry
// is posted. The pure candidate/dedupe math lives in features/accounting/reports/notificationRulesMath.
export { notificationRulesService } from './notificationRules';
export { notificationDispatchService } from './notificationDispatch';
export type { CandidateDispatchSummary } from './notificationDispatch';
// ── DOCUMENT MANAGEMENT / ATTACHMENTS (HELD / UNVERIFIED — NOT FOR FILING) ──────
// The whole module is FLAG-DARK and requires CPA and/or security sign-off before it is
// enabled. attachmentsService attaches receipts/contracts/files to accounting entities,
// REUSING the existing `attachments` storage bucket + the additive accounting.attachments
// metadata table. NO money moves and NO journal entry is posted. Encryption-at-rest is
// DEFERRED to Phase E (files sit unencrypted); MIME/size validation is client-side only.
// The pure helpers (buildStoragePath/validateAttachmentFile/extensionFor) back the upload
// control's client guard.
export {
  attachmentsService,
  buildStoragePath,
  validateAttachmentFile,
  extensionFor,
  ATTACHMENTS_BUCKET,
  ACCOUNTING_PATH_PREFIX,
  SIGNED_URL_TTL_SECONDS,
} from './attachments';
export type {
  AttachmentValidation,
  UploadAttachmentResult,
  RemoveAttachmentResult,
  RemoveForEntityResult,
} from './attachments';
export {
  parseImport,
  parseIif,
  parseQboJson,
  parseDelimited,
  detectImportShape,
  sourceForDetail,
  parseCents,
  normalizeImportDate,
  classifyAccountType,
  openingBalanceFromSigned,
  contentHashFor,
  ImportResultBuilder,
  ImportParseError,
} from './importParsers';
export type { NormalBalanceSide } from './importParsers';
export {
  suggestAccountMatch,
  buildAccountResolution,
  resolveOpeningBalance,
  resolveJournalEntry,
  reconcileOpeningBalances,
  accountMapBlockers,
  normalBalanceForType,
  toDbOpeningBalance,
  toDbJournalEntry,
} from './importMapping';
export type {
  AccountMatchSuggestion,
  MatchConfidence,
  ResolveResult,
  OffsetPlug,
  OpeningBalanceReconciliation,
  DbMappedOpeningBalance,
  DbMappedJournalEntry,
  DbMappedJournalLine,
} from './importMapping';
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
// ── C2 PAYROLL (HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING) ─────────────────
// The whole payroll module is FLAG-DARK and requires CPA/EA payroll AND/OR security sign-off
// before it is enabled. The ONLY money path is payRunService.commit → accounting.commit_pay_run
// (the can_payroll()-gated RPC that posts ONE balanced JE via the GL's single balance guard).
// The withholding MATH lives in the pure, heavily-tested payrollTax engine; hours come READ-ONLY
// from public.shifts via payrollHours. W-2/1099-NEC/DE-9C + NACHA are STUBS (NOT filing-grade).
// HUMAN MUST VERIFY: every rate/bracket/cap (migration 028) vs current IRS Pub 15-T & CA EDD,
// the withholding formulas, the CA daily-OT model, SSN/bank encryption posture (Phase E), and the
// NACHA format. The UI renders the "UNVERIFIED — NOT FOR FILING" banner on every screen + export.
export { employeesService, payScheduleService, payRunService } from './payroll';
export type { PayRunEmployeeInput } from './payroll';
export { payrollTaxTablesService } from './payrollTaxTables';
export { payrollReportsService } from './payrollReports';
export {
  buildPaystub,
  buildReportRow,
  buildPayrollReportStub,
  buildNachaStub,
  maskSsn,
  PAYROLL_UNVERIFIED_DISCLAIMER,
} from './payrollReportStubs';
// Pure withholding engine (cite official sources; verify every rate before filing).
export {
  applyRateCents,
  taxableUnderBaseCents,
  taxableOverThresholdCents,
  annualTaxFromBracketsCents,
  buildTaxTableSet,
  resolvePercentageRow,
  computeFederalIncomeWithholding,
  computeCaliforniaWithholding,
  computePaycheckTaxes,
  assemblePaycheck,
} from './payrollTax';
export type {
  PayrollTaxTableSet,
  PaycheckTaxInput,
  ComputedTaxLine,
  ComputedPaycheckTaxes,
  ComputedPaycheck,
  DeductionInput,
} from './payrollTax';
// Pure hours derivation (READ-ONLY from public.shifts; CA daily-OT model is on the verify list).
export {
  minutesToHourCents,
  shiftWorkedMinutes,
  deriveHoursFromShifts,
  hourlyGrossCents,
  salaryGrossCents,
  hourCentsToHours,
  DEFAULT_WEEKLY_OT_THRESHOLD_HOURS,
} from './payrollHours';
export type { ShiftRecord, DerivedHours, DeriveHoursOptions } from './payrollHours';
// ── PHASE E SECURITY HARDENING (HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING) ──────────────────
// The whole module is FLAG-DARK and requires a SECURITY review before it is enabled. securityService
// is the seam for the Phase E DB layer (migrations 031/032/033): the encryption-coverage probe, the
// SECURITY DEFINER ciphertext accessors (the ONLY authorized path to the *_enc columns; for the
// documented post-sign-off cutover backfill — the live forms still write plaintext), the tamper-
// evident audit hash-chain (status + verification + the one-time admin backfill), and the read-only
// security settings (rate limits + backup policy). rbacService is CRUD over accounting.user_roles
// (grant/revoke; RLS-gated to accounting_admin). NOTHING here moves money or posts a journal entry.
// HUMAN MUST VERIFY: key management/rotation, encryption coverage/cutover, hash-chain integrity,
// the backup/restore runbook, and the RBAC grant/revoke posture. The UI banners every security screen.
export { securityService } from './security';
export type { EmployeeBank } from './security';
export { rbacService } from './rbac';
export type { RbacWriteResult } from './rbac';
export * from './mappers';

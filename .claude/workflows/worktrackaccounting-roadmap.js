export const meta = {
  name: 'worktrackaccounting-roadmap',
  description:
    'Autonomously work the WorkTrackAccounting roadmap one GATED module at a time via the proven per-module pipeline. Sequential by design (modules share AccountingRouter/types/constants/hooks — parallel edits would corrupt the tree). Pass args="<moduleId>" to start from a given module (default A2). Fail-stops on a failed review; stops before payroll/import/notifications/docs/security for human sign-off; never auto-commits.',
  phases: [
    { title: 'A2 Bills/AP' },
    { title: 'A3 Reports' },
    { title: 'A4 Banking' },
    { title: 'B1 Job costing' },
    { title: 'B2 Recurring + dimensions' },
    { title: 'B3 Inventory FIFO' },
    { title: 'D1 Books-closed lock' },
    { title: 'D2 Budgeting' },
    { title: 'D3 Fixed assets' },
    { title: 'D4 Custom fields' },
    { title: 'C1 Sales-tax reporting' },
    { title: 'COA standard expansion' },
    { title: 'Tax-sync refresh+alert' },
    { title: 'Summary' },
  ],
};

// Reuse the proven, adversarially-gated per-module pipeline.
const MODULE_PIPELINE =
  'C:/Users/jrrou/WorkTrackPro/.claude/worktrees/romantic-curran-565e37/.claude/workflows/worktrackaccounting-module.js';

const PER_MODULE_RESERVE = 250_000; // only enforced if a token budget was set

const MODULES = [
  {
    id: 'A2',
    phase: 'A2 Bills/AP',
    args:
      'A2 — Bills/expenses → Accounts Payable + vendor payments. Tables accounting.bills/bill_lines/vendor_payments/vendor_payment_applications already exist (migration 009); add a new additive migration ONLY if a real gap is found. On posting a bill, post a BALANCED journal entry via accounting.post_journal_entry: Dr the expense or inventory-asset account on each bill_line / Cr 2000 Accounts Payable; on a vendor payment, Dr 2000 AP / Cr 1000 Cash and write vendor_payment_applications (the sync_bill_payment trigger rolls bill status/balance). Build bills list/create/detail screens and a record-vendor-payment dialog, mirroring the A1 invoices/payments services + screens and reusing the pure cents-based posting.ts builders. Wire routes bills, bills/new, bills/:billId into AccountingRouter (relative paths). Obey docs/WORKTRACKACCOUNTING_AGENT_BUILD_PROMPT.md and all invariants.',
  },
  {
    id: 'A3',
    phase: 'A3 Reports',
    args:
      'A3 — Financial reports v1: Trial Balance, Profit & Loss, Balance Sheet, AR aging, AP aging. No new migration: read accounting.v_trial_balance/v_ar_aging/v_ap_aging and aggregate POSTED journal lines by account_type for P&L (income − expense) and Balance Sheet (assets = liabilities + equity). Add a reportsService + hooks; build a Reports index plus one screen per report with a date-range filter using LedgerTable, plus PDF export (reuse html2pdf.js) and CSV export. Show the G9 "Not certified tax software. Always verify with a CPA/EA." disclaimer on every report and on export. Wire reports routes into AccountingRouter. Obey the build doc + invariants.',
  },
  {
    id: 'A4',
    phase: 'A4 Banking',
    args:
      'A4 — Banking: manual statement import + categorization rules + reconciliation (Plaid is OUT OF SCOPE — deferred behind user keys). Tables accounting.bank_accounts/bank_transactions/bank_rules/reconciliations exist (migration 010). Build: (1) bank-accounts list/create linking to a GL bank/credit-card account; (2) CSV/OFX/QFX import parsed client-side, inserting bank_transactions deduped on (bank_account_id, external_id); (3) a rules engine applying accounting.bank_rules to auto-categorize (set category_account_id/vendor); (4) accepting/categorizing a transaction posts a BALANCED journal entry via post_journal_entry (Dr/Cr the category account vs the bank GL account) and marks it matched; (5) a reconciliation screen matching transactions to a statement balance. Reuse posting.ts + the A1 service/screen patterns. Wire banking routes. Obey the build doc + invariants.',
  },
  {
    id: 'B1',
    phase: 'B1 Job costing',
    args:
      'B1 — Job-costing dashboard. No new migration: read accounting.v_job_costing (per-job revenue, material_cost, labor_minutes, labor_cost, margin). Build a job-costing list/dashboard with profitability per job (sortable, margin %), and a per-job detail linking to the job + its invoices + bills. Add a jobCostingService + hooks; reuse LedgerTable and the dark theme. Wire a job-costing route. Obey the build doc + invariants (read public.* read-only).',
  },
  {
    id: 'B2',
    phase: 'B2 Recurring + dimensions',
    args:
      'B2 — Recurring transactions + reporting dimensions (classes/locations/departments). Additive migration: accounting.recurring_templates (kind invoice|bill|journal, schedule fields, payload jsonb, next_run_date, active) and accounting.dimensions (type class|location|department, name), plus NULLABLE dimension columns on accounting.journal_lines/invoice_lines/bill_lines (these are accounting-schema tables we own — additive ALTER within schema accounting is allowed; NEVER touch public.*). Wire RLS + audit + touch on new tables via accounting._apply_standard_table. Build: a dimensions admin screen; a recurring-templates screen; a "generate due" action that creates the next document/JE from a template, BALANCED via post_journal_entry. Add services/hooks/screens + routes. Obey the build doc + invariants.',
  },
  {
    id: 'B3',
    phase: 'B3 Inventory FIFO',
    args:
      'B3 — Inventory valuation (FIFO) → COGS. Additive migration creating accounting.inventory_layers (item_id, source_inventory_id → public.inventory, qty_received, qty_remaining, unit_cost, received_at, bill_line_id) and accounting.inventory_cogs_events (item_id, journal_entry_id, qty, cost, consumed_at, job_id), with RLS + audit via accounting._apply_standard_table. On receiving an inventory item via a bill, create a FIFO layer. On job consumption — reading the existing public job-consumption moment READ-ONLY (never modify public.*) — post a BALANCED COGS journal entry Dr 5000 COGS / Cr 1300 Inventory Asset for the FIFO-consumed cost and record an inventory_cogs_event. Build a small inventory-valuation report. Reuse posting.ts. Obey the build doc + invariants.',
  },
  {
    id: 'D1',
    phase: 'D1 Books-closed lock',
    args:
      'D1 — Books-closed (period lock) date. Additive: store closed_through_date in accounting.settings; via an additive migration, CREATE OR REPLACE the posting guard so accounting.post_journal_entry / guard_journal_entry REJECTS posting or voiding any entry dated on or before the closed date (read the date from accounting.settings). Build an accounting_admin-only screen to view/change the lock date with a confirmation dialog. Tests: a pre-lock post is rejected, a post-lock post succeeds, and the admin can move the date. Do NOT alter public.* — the guard change is a CREATE OR REPLACE FUNCTION in the accounting schema only. Obey the build doc + invariants.',
  },
  {
    id: 'D2',
    phase: 'D2 Budgeting',
    args:
      'D2 — Budgeting & forecasting. Additive migration creating accounting.budgets (name, fiscal_year, status) and accounting.budget_lines (budget_id, account_id, period_month 1-12, amount) with RLS + audit via accounting._apply_standard_table. Build a budget editor (accounts × 12 months grid using CurrencyInput) and a Budget-vs-Actual report (actual = posted journal lines aggregated by account/month, same basis as the trial balance) plus a simple cash-flow forecast from AR/AP due dates. Services/hooks/screens + routes + PDF/CSV export. G9 disclaimer on the report. Obey the build doc + invariants.',
  },
  {
    id: 'D3',
    phase: 'D3 Fixed assets',
    args:
      'D3 — Fixed assets & depreciation. Additive migration creating accounting.fixed_assets (name, asset_account_id, accum_depr_account_id default 1510, depr_expense_account_id, cost, salvage_value, useful_life_months, method straight_line|declining_balance, in_service_date, status) and accounting.depreciation_schedule (fixed_asset_id, period_date, amount, journal_entry_id, posted) with RLS + audit. Build an asset register + a "run depreciation for period" action that, for each due asset, posts a BALANCED journal entry Dr depreciation expense / Cr 1510 Accumulated Depreciation via post_journal_entry and marks the schedule row posted. Straight-line first; show net book value. Services/hooks/screens + routes. Tests for the schedule math (in cents) and that each posting is balanced. Obey the build doc + invariants.',
  },
  {
    id: 'D4',
    phase: 'D4 Custom fields',
    args:
      'D4 — Custom fields on accounting entities. Additive migration creating accounting.custom_field_defs (entity_type invoice|bill|customer|vendor|account|journal_entry, key, label, data_type text|number|date|boolean|select, options jsonb, sort_order, active) and accounting.custom_field_values (def_id, entity_type, entity_id, value jsonb) with RLS + audit. Build an admin screen to define fields per entity type, and additively render/edit the active custom fields on the existing invoice/bill/customer/vendor create + detail screens WITHOUT breaking existing forms. Services/hooks. All data stays in accounting.*. Obey the build doc + invariants.',
  },
  {
    id: 'C1',
    phase: 'C1 Sales-tax reporting',
    args:
      'C1 — Sales-tax REPORTING & tax calendar (reporting only — NO e-filing, NO money movement, NO payroll). Build a sales-tax liability report: for a date range, sum sales tax COLLECTED (credits to 2200 Sales Tax Payable from posted invoices) grouped by tax agency/jurisdiction using the existing accounting.tax_* tables, with a CDTFA-style summary (taxable vs non-taxable sales, tax due). Build a read-only tax-calendar dashboard listing upcoming filing deadlines from accounting.settings (no notification delivery). PDF/CSV export. PROMINENT G9 disclaimer on every screen and export: "Not certified tax software. Always verify with a CPA/EA. Representative rates only." Reads accounting.* only; no public.* writes. If any figure cannot be tied back to the posted ledger, surface it rather than guessing (stop-condition). Obey the build doc + invariants.',
  },
  {
    id: 'COA-EXPAND',
    phase: 'COA standard expansion',
    args:
      'COA-EXPAND — Add the standard chart-of-accounts entries we currently lack, per docs/BIGCAPITAL_MINED_REFERENCE.md §1. Additive migration that INSERTs (ON CONFLICT (account_number) DO NOTHING) into accounting.accounts: 3050 Opening Balance Equity (equity) and 2050 Opening Balance Liabilities (liability/other_current_liability) — REQUIRED for the future import/migration module; 1250 Uncategorized Asset, 4900 Uncategorized Income, 6900 Uncategorized Expense — bank-feed landing zones; 1260 Payment Processor Clearing (other_current_asset); 1400 Prepaid Expenses; 2400 Deferred/Unearned Revenue; 1030 Petty Cash; 2500 Loans Payable; 3200 Owner Drawings; 7000 Exchange Gain/Loss (other_expense); and common expense detail 6100 Rent / 6200 Office / 6300 Bank Fees / 6400 Depreciation Expense. Set correct account_type/account_subtype/normal_balance; mark structural ones is_system=true. Update accounting.settings default_accounts with opening_balance_equity, uncategorized_income, uncategorized_expense, payment_processor_clearing. PURE additive INSERTs into the accounting schema — do NOT alter public.*. Tests: the new accounts exist with correct type + normal_balance and default_accounts resolves. Obey the build doc + invariants.',
  },
  {
    id: 'TAX-SYNC',
    phase: 'Tax-sync refresh+alert',
    args:
      'TAX-SYNC — Quarterly tax-table auto-refresh + drift alert, ADVISORY-ONLY (NEVER auto-applies rate changes). Build exactly per docs/BIGCAPITAL_MINED_REFERENCE.md §4: (DB, additive, schema accounting, RLS+audit via _apply_standard_table) accounting.tax_table_sources (kind sales|payroll, jurisdiction, url, official_file_url, check_frequency_days default 90, active, last_checked_at; seed CDTFA sales-tax + CA EDD payroll sources), accounting.tax_table_snapshots (source_id, fetched_at, content_hash, parsed jsonb, raw text), accounting.tax_table_drift (source_id, snapshot_id, detected_at, diff jsonb, severity, status open|reviewed|applied|dismissed, reviewed_by). (Backend) a Netlify SCHEDULED function netlify/functions/tax-table-refresh.mjs on cron "0 6 1 1,4,7,10 *" (quarterly) using the service role: for each active source fetch the OFFICIAL downloadable data file (prefer official files over fragile HTML scraping), parse to a normalized {jurisdiction, rate, effective_date} set, snapshot + content-hash it, DIFF against active accounting.tax_rates, and on mismatch insert a tax_table_drift row (status open) — that row IS the admin alert and stays ENTIRELY within accounting.* (the admin UI surfaces open drift prominently via a badge + list); do NOT write public.* / system_notifications (email/push delivery is a DEFERRED enhancement needing a separate cross-schema sign-off); NEVER mutate accounting.tax_rates automatically. The scheduled function MUST be gated on a server env var ACCOUNTING_TAX_SYNC_ENABLED (default OFF): when unset it exits immediately with NO external fetch and NO DB write, preserving the flag-off isolation guarantee until graduation (a frontend flag cannot gate a scheduled function). Also expose a manual "check now" callable; fail safe on fetch/parse error. (Frontend) an accounting_admin-only "Tax table updates" screen under Settings: list sources + last-checked + open drift; a drift detail with old-vs-new rates side-by-side; explicit Apply (admin-confirmed → updates accounting.tax_rates, marks drift applied) and Dismiss; PROMINENT G9 disclaimer. The source-specific PARSERS depend on current CDTFA/EDD file formats — implement best-effort and clearly mark each "VERIFY PARSER against the live file" for a human; defensively parse untrusted external input; rate-limit fetches. This module is advisory-only AND stays fully within accounting.* (in-app drift alert, no public.* writes, server-env-gated scheduled function), which is what makes it safe to build autonomously. Obey docs/WORKTRACKACCOUNTING_AGENT_BUILD_PROMPT.md + all invariants.',
  },
];

// Start point (default A2). Pass args="D1" etc. to continue after an earlier batch.
const startId = typeof args === 'string' && args.trim() ? args.trim() : 'A2';
const startIdx = MODULES.findIndex((m) => m.id === startId);
const queue = startIdx >= 0 ? MODULES.slice(startIdx) : MODULES;
log(`Roadmap queue (${queue.length}): ${queue.map((m) => m.id).join(' → ')}`);

const results = [];
let stoppedReason = `completed the queued batch from ${queue.length ? queue[0].id : '(none)'} through ${queue.length ? queue[queue.length - 1].id : '(none)'}`;

for (const m of queue) {
  if (budget.total && budget.remaining() < PER_MODULE_RESERVE) {
    stoppedReason = `token budget reserve reached before ${m.id} (${Math.round(budget.remaining() / 1000)}k left)`;
    log(stoppedReason);
    break;
  }

  phase(m.phase);
  log(`▶ ${m.id}: starting gated build (DB → API → UI → adversarial Reviewer, remediate-until-green).`);

  let res = null;
  try {
    res = await workflow({ scriptPath: MODULE_PIPELINE }, m.args);
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    stoppedReason = `${m.id} pipeline threw: ${msg}`;
    log(`✖ ${stoppedReason}`);
    results.push({ id: m.id, passed: false, error: msg });
    break;
  }

  const passed = !!(res && res.passed);
  results.push({
    id: m.id,
    passed,
    attempts: res && res.attempts,
    verdict: res && res.verdict ? { pass: res.verdict.pass, blocking: res.verdict.blocking } : null,
  });

  if (!passed) {
    stoppedReason = `${m.id} did NOT pass adversarial review after its retries — stopping the roadmap for human review (later modules build on this one).`;
    log(`✖ ${stoppedReason}`);
    break;
  }

  log(`✅ ${m.id} passed all gates. Left UNCOMMITTED in the worktree (repo policy: commit on request). Continuing.`);
}

// Final whole-tree sanity sweep + human-readable summary.
phase('Summary');
const summary = await agent(
  `You are closing out an autonomous WorkTrackAccounting roadmap run. Produce a concise report for the user:
1) Per-module table: id · pass/fail · attempts · any blocking notes.
2) Run a FINAL whole-worktree sanity sweep and report results verbatim:
   - npm run typecheck
   - npm run test  (report "N passed")
   - build with VITE_ACCOUNTING_ENABLED UNSET, then prove dist has ZERO accounting code (no accounting chunk; grep finds no "/app/accounting", no "post_journal_entry")
   - git status --short  (scope of the accumulated, uncommitted change)
   Do NOT commit anything.
3) State clearly what remains and WHY it requires explicit human sign-off (mechanical gates cannot verify it): C2 payroll (tax-rate/withholding/NACHA/W-2 correctness needs a CPA), import/migration (silent financial-data corruption), notifications & document management (writes outside accounting.* / storage-encryption), and Phase E security hardening (secrets, key management, encryption).
4) Recommend the next step.

Machine results: ${JSON.stringify(results)}
Stop reason: ${stoppedReason}`,
  { label: 'roadmap-summary', phase: 'Summary' }
);

return { startedFrom: startId, results, stoppedReason, summary };

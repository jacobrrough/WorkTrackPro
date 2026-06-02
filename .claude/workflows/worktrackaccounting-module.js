export const meta = {
  name: 'worktrackaccounting-module',
  description:
    'Build ONE WorkTrackAccounting module end-to-end (DB → API → UI → adversarial Reviewer) with hard verification gates and a remediate-until-green loop.',
  whenToUse:
    'Run once per roadmap module (pass the module as args). Builds inside the existing React+Supabase app per docs/WORKTRACKACCOUNTING_AGENT_BUILD_PROMPT.md. Do NOT use it to build the whole roadmap unattended — one module per run.',
  phases: [
    { title: 'Plan', detail: 'Scope the module against the build doc + invariants (no code)' },
    { title: 'DB', detail: 'Additive migration: tables, RLS, audit triggers, RPCs; apply on a dev branch' },
    { title: 'API', detail: 'Services + hooks; every money action posts a balanced JE' },
    { title: 'UI', detail: 'Screens reusing AccountingShell + ui kit; loading/empty/error + disclaimer' },
    { title: 'Review', detail: 'Adversarial verification: gates + DB checks + invariants' },
    { title: 'Remediate', detail: 'Fix blocking findings and re-review until green' },
  ],
};

// ── Inputs ───────────────────────────────────────────────────────────────────
const DOC = 'docs/WORKTRACKACCOUNTING_AGENT_BUILD_PROMPT.md';
const module =
  typeof args === 'string' && args.trim()
    ? args.trim()
    : 'A1 — Invoices from jobs/quotes → AR + payments. Posts a balanced revenue journal entry (Dr Accounts Receivable / Cr Income / Cr Sales Tax Payable). See roadmap Phase A in the build doc.';

// More retries when the user has set a token budget for the turn.
const maxAttempts = budget.total ? 4 : 3;

// ── Shared guardrail preamble injected into every agent ──────────────────────
const COMMON = `You are building the WorkTrackAccounting module: "${module}".

FIRST: read ${DOC} in full and obey it. It overrides any general knowledge.
NON-NEGOTIABLE GUARDRAILS:
- Stack is React 19 + Vite + Supabase + Netlify ONLY. BANNED without explicit approval: Next.js, Prisma, Docker, NextAuth/Lucia, FastAPI, a second database/ORM, any new framework or state library. If you think you need one → STOP and report a stop-condition instead of proceeding.
- Database is ADDITIVE-ONLY in schema "accounting". NEVER ALTER/DROP a public.* table. RLS on every new table (read=accounting.can_read(), write=accounting.can_write(); payroll=can_payroll()). Reuse accounting._apply_standard_table(...). Migrations: idempotent, timestamped, with a "-- ROLLBACK:" header.
- ALL money movement posts a BALANCED journal entry via accounting.post_journal_entry. Posted entries are immutable (void/reverse only). Money is numeric(14,2)/(14,4) in DB and integer cents in JS (accountingViewModel.toCents).
- ISOLATION: with VITE_ACCOUNTING_ENABLED unset, the production build must contain ZERO accounting code. The only core-app seam is the gated route in src/AppRouter.tsx. Read public.* read-only; write only accounting.*.
- Reuse conventions: services = xxxService object + snake/camel mapper (reads throw / writes return null); screens compose AccountingShell and reuse components/ui/* + LedgerTable/CurrencyInput/AccountPicker.
- WORKTREE: write files to the active worktree and confirm "git status" shows them before building (file tools can target the wrong checkout).
- Tax/payroll/report/export surfaces must show: "Not certified tax software. Always verify with a CPA/EA."

Work ONLY in your assigned lane. End with the report template from the build doc.`;

// ── Reviewer structured verdict ──────────────────────────────────────────────
const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'pass',
    'typecheck',
    'lint',
    'test',
    'buildFlagOn',
    'buildFlagOffClean',
    'invariantsAtRisk',
    'blocking',
    'evidence',
  ],
  properties: {
    pass: {
      type: 'boolean',
      description: 'true ONLY if every gate passes AND no invariant is at risk',
    },
    typecheck: { type: 'boolean' },
    lint: { type: 'boolean' },
    test: { type: 'boolean' },
    buildFlagOn: { type: 'boolean', description: 'build succeeds with VITE_ACCOUNTING_ENABLED=true' },
    buildFlagOffClean: {
      type: 'boolean',
      description: 'flag-off build emits ZERO accounting code (no accounting chunk, no /app/accounting, no post_journal_entry in dist)',
    },
    unbalancedJeRejected: {
      type: 'boolean',
      description: 'DB rejected an intentionally-unbalanced journal entry (omit if not applicable this module)',
    },
    rlsDeniesNonRole: {
      type: 'boolean',
      description: 'a user without an accounting role is denied by RLS (omit if not applicable)',
    },
    publicTablesUntouched: { type: 'boolean', description: 'no public.* table/column was altered' },
    invariantsAtRisk: {
      type: 'array',
      items: { type: 'string' },
      description: 'G1–G10 ids/notes for anything at risk (empty if clean)',
    },
    blocking: {
      type: 'array',
      items: { type: 'string' },
      description: 'specific, actionable findings that must be fixed before this module can pass',
    },
    evidence: { type: 'string', description: 'pasted command/MCP outputs proving the above' },
  },
};

// ── Pipeline: Plan → (DB → API → UI → Review) looped until green ──────────────
phase('Plan');
const plan = await agent(
  `${COMMON}

LANE: PLANNING (no code yet). Produce a short build plan:
1) Additive tables/columns needed in schema "accounting" (or "none").
2) The exact double-entry posting: which accounts are debited/credited and when.
3) Services/hooks to add, and the screen(s) to build.
4) The files you expect to create/modify.
Flag any stop-condition now if the module can't be done within the guardrails.`,
  { label: `plan:${module}`, phase: 'Plan' }
);

let attempt = 0;
let verdict = null;
let lastReport = plan;

while (attempt < maxAttempts) {
  attempt++;
  log(`Attempt ${attempt}/${maxAttempts}: build → adversarial review`);
  const priorBlocking = verdict ? JSON.stringify(verdict.blocking, null, 2) : 'none (first attempt)';

  phase('DB');
  const db = await agent(
    `${COMMON}

LANE: DATABASE. Implement the additive migration(s) for this module per the plan. Idempotent + timestamped + "-- ROLLBACK:" header + RLS + audit triggers (reuse accounting._apply_standard_table). If no schema change is needed, say so explicitly and do nothing.
Then APPLY it on a Supabase DEV BRANCH via the Supabase MCP (create_branch → apply_migration → list_migrations) and run get_advisors (security+performance). Never touch the main/live DB.

PLAN:
${plan}

PRIOR REVIEW — fix these if present:
${priorBlocking}`,
    { label: `db:${module} #${attempt}`, phase: 'DB' }
  );

  phase('API');
  const api = await agent(
    `${COMMON}

LANE: API + HOOKS. Add/extend src/services/api/accounting/* (service object + snake/camel mapper) and src/features/accounting/hooks/* (TanStack Query, ['accounting', ...] keys, invalidation scoped to accounting). Every money action must call accounting.post_journal_entry with a balanced entry. Add unit tests for mappers and posting logic.

DB STAGE RESULT:
${db}`,
    { label: `api:${module} #${attempt}`, phase: 'API' }
  );

  phase('UI');
  const ui = await agent(
    `${COMMON}

LANE: UI. Build the screen(s) under src/features/accounting/**, composing AccountingShell and reusing components/ui/* (Button/Card/FormField) + LedgerTable/CurrencyInput/AccountPicker. Include loading/empty/error states and the disclaimer where relevant. Register any new sub-route in AccountingRouter.tsx using a RELATIVE path.

API STAGE RESULT:
${api}`,
    { label: `ui:${module} #${attempt}`, phase: 'UI' }
  );

  lastReport = `DB:\n${db}\n\nAPI:\n${api}\n\nUI:\n${ui}`;

  phase('Review');
  verdict = await agent(
    `${COMMON}

LANE: ADVERSARIAL REVIEWER — do NOT trust the builders. Independently run ALL gates (build doc §9) and actively try to break the work:
- npm run typecheck ; npm run lint ; npm run test
- build with VITE_ACCOUNTING_ENABLED=true (must compile & code-split)
- build with the flag OFF and PROVE dist has zero accounting code: no accounting chunk, no "/app/accounting", no "post_journal_entry"
- Supabase MCP dev branch: attempt an UNBALANCED journal entry → confirm REJECTED; confirm a balanced entry posts then is immutable; confirm RLS denies a user with no accounting role; get_advisors shows no new security findings
- confirm NO public.* table/column was altered and NO banned dependency was added
Return the verdict STRICTLY per schema. pass=true ONLY if every gate passes and invariantsAtRisk is empty. Put concrete, actionable items in "blocking" and paste real outputs in "evidence".

WORK UNDER REVIEW:
${lastReport}`,
    { label: `review:${module} #${attempt}`, phase: 'Review', schema: VERDICT_SCHEMA }
  );

  if (verdict && verdict.pass) {
    log(`✅ "${module}" passed adversarial review on attempt ${attempt}.`);
    break;
  }
  log(`❌ Review failed: ${verdict ? verdict.blocking.join(' | ') : 'no verdict returned'}`);

  if (attempt < maxAttempts) {
    phase('Remediate');
    await agent(
      `${COMMON}

LANE: REMEDIATION. The adversarial reviewer found BLOCKING issues. Fix ONLY these, then stop (the reviewer will re-check). Do not expand scope or start new features.

BLOCKING:
${JSON.stringify(verdict.blocking, null, 2)}

EVIDENCE:
${verdict.evidence}`,
      { label: `fix:${module} #${attempt}`, phase: 'Remediate' }
    );
  }
}

if (!verdict || !verdict.pass) {
  log(
    `STOP: "${module}" did not reach green after ${maxAttempts} attempts. Leaving changes for human review — do NOT advance to the next module.`
  );
}

return {
  module,
  passed: !!(verdict && verdict.pass),
  attempts: attempt,
  verdict,
  report: lastReport,
};

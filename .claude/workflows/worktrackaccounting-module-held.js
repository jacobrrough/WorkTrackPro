export const meta = {
  name: 'worktrackaccounting-module-held',
  description:
    'Build ONE HELD / high-risk WorkTrackAccounting module (payroll, import, notifications, docs, security) FLAG-DARK and clearly UNVERIFIED. The user has explicitly accepted that mechanical gates cannot certify domain correctness (tax math, import fidelity, security posture). Same isolation/double-entry/RLS invariants, plus a mandatory in-app UNVERIFIED banner and a "what a human must verify" report.',
  phases: [
    { title: 'Plan' },
    { title: 'DB' },
    { title: 'API' },
    { title: 'UI' },
    { title: 'Review' },
    { title: 'Remediate' },
  ],
};

const DOC = 'docs/WORKTRACKACCOUNTING_AGENT_BUILD_PROMPT.md';
const module =
  typeof args === 'string' && args.trim() ? args.trim() : 'C2 — Payroll (see roadmap)';
const maxAttempts = budget.total ? 4 : 3;

const COMMON = `You are building a HELD / HIGH-RISK WorkTrackAccounting module: "${module}".
The user has EXPLICITLY authorized building this FLAG-DARK and UNVERIFIED. Read ${DOC} and obey it WITH these overrides for this held module:

- DO NOT halt on the §8 tax/payroll/correctness/import stop-conditions. Instead, implement against OFFICIAL published values/formats (cite the source in code comments), and render a PROMINENT, unmissable banner on EVERY screen, report, and export for this module: "UNVERIFIED — NOT FOR FILING. Requires CPA and/or security sign-off before this module is enabled." Build/reuse a single UnverifiedBanner component and use it everywhere this module renders.

ALL OTHER INVARIANTS STILL HOLD:
- Stack lock: React/Vite/Supabase/Netlify only; no banned tech.
- DB additive-only: NEVER ALTER/DROP the SCHEMA of an existing public.* table. New tables live in schema accounting with RLS (can_read/can_write or a finer role) + audit via accounting._apply_standard_table. Encryption work (Phase E) adds columns/functions additively.
- Double-entry: ANY money movement posts a BALANCED journal entry via accounting.post_journal_entry; posted entries immutable. Money math in integer cents.
- Frontend isolation: everything stays behind VITE_ACCOUNTING_ENABLED so the flag-OFF production build emits ZERO accounting code.
- Worktree discipline: write to the active worktree; confirm git status before building.
- Any server-side component (Netlify function / scheduled job) MUST be gated on a server env var (default OFF) so it is inert until explicitly enabled.

IN-SCOPE cross-boundary work for THIS module only (do via EXISTING app services, keep UI behind the flag, document it): notification DELIVERY through the existing public.system_notifications service; document STORAGE through the existing storage bucket. Do not invent new cross-cutting infrastructure.

End with the build-doc report template PLUS an explicit "WHAT A HUMAN MUST VERIFY" list (tax rates/formulas, import fidelity, encryption/key posture, etc.). Work only in your assigned lane.`;

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
    'publicSchemaUntouched',
    'unverifiedBannerPresent',
    'humanMustVerify',
    'blocking',
    'evidence',
  ],
  properties: {
    pass: {
      type: 'boolean',
      description:
        'true if MECHANICAL gates pass + isolation holds + the UNVERIFIED banner is present. This verdict does NOT and CANNOT certify domain correctness.',
    },
    typecheck: { type: 'boolean' },
    lint: { type: 'boolean' },
    test: { type: 'boolean' },
    buildFlagOn: { type: 'boolean' },
    buildFlagOffClean: { type: 'boolean', description: 'flag-off build emits zero accounting code' },
    publicSchemaUntouched: { type: 'boolean', description: 'no existing public.* table SCHEMA altered/dropped' },
    balancedWhereMoneyMoves: { type: 'boolean', description: 'every money movement posts a balanced JE (omit if module moves no money)' },
    unverifiedBannerPresent: { type: 'boolean', description: 'the UNVERIFIED — NOT FOR FILING banner renders on this module\'s screens/exports' },
    serverComponentEnvGated: { type: 'boolean', description: 'any Netlify fn/scheduled job is gated on a default-off server env var (omit if none)' },
    humanMustVerify: {
      type: 'array',
      items: { type: 'string' },
      description: 'the domain-correctness items a human/CPA/security reviewer MUST validate before enabling',
    },
    blocking: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'string' },
  },
};

phase('Plan');
const plan = await agent(
  `${COMMON}

LANE: PLANNING (no code yet). Produce a short build plan: additive accounting tables/columns; the exact double-entry postings (if money moves); the services/hooks; the screen(s) + where the UnverifiedBanner goes; any server component + its default-off env gate; and the precise list of domain-correctness items a human must verify. Flag genuine blockers (but remember: tax/correctness is NOT a blocker here — it is built-then-disclaimed).`,
  { label: `plan:${module}`, phase: 'Plan' }
);

let attempt = 0;
let verdict = null;
let lastReport = plan;

while (attempt < maxAttempts) {
  attempt++;
  log(`Attempt ${attempt}/${maxAttempts}: build → adversarial review (mechanics + isolation + UNVERIFIED banner)`);
  const prior = verdict ? JSON.stringify(verdict.blocking, null, 2) : 'none (first attempt)';

  phase('DB');
  const db = await agent(
    `${COMMON}

LANE: DATABASE. Implement the additive migration(s) (idempotent, timestamped, -- ROLLBACK: header, RLS + audit via _apply_standard_table). Apply on a Supabase DEV BRANCH (create_branch → apply_migration → list_migrations → get_advisors); never touch the live DB. If the module needs no schema change, say so.

PLAN:
${plan}

PRIOR REVIEW (fix these):
${prior}`,
    { label: `db:${module} #${attempt}`, phase: 'DB' }
  );

  phase('API');
  const api = await agent(
    `${COMMON}

LANE: API + HOOKS. Services (xxxService + snake/camel mappers) + TanStack hooks (['accounting', ...] keys) + unit tests. Any money movement goes through post_journal_entry with a balanced entry. Cite official sources for any tax/rate logic in comments.

DB RESULT:
${db}`,
    { label: `api:${module} #${attempt}`, phase: 'API' }
  );

  phase('UI');
  const ui = await agent(
    `${COMMON}

LANE: UI. Screens under src/features/accounting/**, composing AccountingShell + reusing components/ui/*. Put the UnverifiedBanner on EVERY screen/report/export for this module. Register routes in AccountingRouter (relative paths). loading/empty/error states.

API RESULT:
${api}`,
    { label: `ui:${module} #${attempt}`, phase: 'UI' }
  );

  lastReport = `DB:\n${db}\n\nAPI:\n${api}\n\nUI:\n${ui}`;

  phase('Review');
  verdict = await agent(
    `${COMMON}

LANE: ADVERSARIAL REVIEWER. Independently run all gates (build-doc §9) and verify ISOLATION + MECHANICS — you are NOT certifying domain correctness (say so):
- npm run typecheck / lint / test
- build flag ON; build flag OFF and PROVE dist has zero accounting code
- Supabase dev branch: confirm migrations apply, get_advisors clean, NO public.* SCHEMA altered, balanced-JE enforced where money moves
- CONFIRM the "UNVERIFIED — NOT FOR FILING" banner renders on this module's screens/exports
- CONFIRM any server component is gated on a default-off env var
Return the verdict per schema. pass=true if mechanics+isolation+banner are satisfied. Put every domain-correctness risk in humanMustVerify[] (do NOT fail the module for un-certifiable correctness — that is the human's job, by user instruction). Put genuine MECHANICAL defects in blocking[].

WORK UNDER REVIEW:
${lastReport}`,
    { label: `review:${module} #${attempt}`, phase: 'Review', schema: VERDICT_SCHEMA }
  );

  if (verdict && verdict.pass) {
    log(`✅ "${module}" passed mechanical+isolation review on attempt ${attempt}. (Domain correctness still UNVERIFIED — see humanMustVerify.)`);
    break;
  }
  log(`❌ Review failed (mechanical): ${verdict ? verdict.blocking.join(' | ') : 'no verdict'}`);

  if (attempt < maxAttempts) {
    phase('Remediate');
    await agent(
      `${COMMON}

LANE: REMEDIATION. Fix ONLY these MECHANICAL blocking items, then stop (the reviewer re-checks). Do not expand scope.

BLOCKING:
${JSON.stringify(verdict.blocking, null, 2)}

EVIDENCE:
${verdict.evidence}`,
      { label: `fix:${module} #${attempt}`, phase: 'Remediate' }
    );
  }
}

return {
  module,
  passed: !!(verdict && verdict.pass),
  attempts: attempt,
  verdict,
  humanMustVerify: verdict ? verdict.humanMustVerify : [],
  report: lastReport,
};

# WorkTrackAccounting — Multi-Agent Build Orchestration Prompt

> Single source of truth for a fleet of agents building **WorkTrackAccounting** to completion.
> Every agent reads this file FIRST, at the start of every task, and re-grounds against it before declaring done.
> It exists to keep agents **on rails** — the original product brief describes a different stack than the one we are actually building on, and drifting back to it would wreck the whole effort.

---

## 0. TL;DR for every agent
1. Read this whole file. Read the module's acceptance criteria. Confirm your worktree/branch.
2. Do exactly ONE assigned module/task, inside the allowed lane, honoring invariants **G1–G10**.
3. Run the **gates** (§9). Paste outputs into your report (§10).
4. If anything pushes you toward a banned tech, a non-additive DB change, or unverifiable tax/money math → **STOP and ask** (§8). Do not guess.

---

## 1. Project reality — THIS OVERRIDES THE ORIGINAL BRIEF
The original "build a self-hosted QuickBooks replacement" brief mandated **Next.js 15 + Docker + self-hosted PostgreSQL + Prisma + NextAuth**. **That stack is SUPERSEDED and must NOT be used.**

WorkTrackAccounting is being built **natively inside the existing WorkTrackPro app**, because the owner's overriding goal is *full integration* with that app. A separate Next.js/Docker/Postgres app cannot integrate — it would mean two logins, two databases, and constant sync.

**Actual stack (the only stack):**
- Frontend: **React 19 + TypeScript + Vite 6 + Tailwind 3 (dark theme) + React Router v7 + TanStack Query v5**
- Backend: **Supabase** (Postgres 16 + Auth + Storage + Realtime) + **Netlify** serverless functions; deploys on Netlify/Railway.

The brief's *goals* are still honored, but within this stack:
- Bank-grade security → Supabase RLS + pgcrypto + Supabase Auth MFA (TOTP/passkeys).
- Multi-tenant-ready → schema-per-company (we use a dedicated `accounting` schema).
- Zero subscription → no Intuit; Supabase free/self-hostable.

**Banned without explicit user approval:** Next.js, Prisma, Docker/compose, NextAuth/Lucia, FastAPI, a second database/ORM, any new UI framework, any new state library. If you think you need one, that's a **stop condition** (§8).

---

## 2. What already exists — the foundation. DO NOT rebuild it.
**Database — 11 additive migrations** `supabase/migrations/20260601000001…011`:
- `…01` schema + roles (`accounting.user_roles`: accounting_admin/accountant/payroll/viewer) + `SECURITY DEFINER` helpers `has_role/can_read/can_write/can_payroll` + `accounting.settings`.
- `…02` append-only `accounting.audit_log` + generic `accounting.audit()` trigger (hash-chain columns stubbed).
- `…03` `accounting.accounts` (seeded chart of accounts) + default-account mappings.
- `…04` `accounting.journal_entries` + `journal_lines` + **DEFERRABLE balance trigger** + immutability guard + `post_journal_entry` / `void_journal_entry` RPCs.
- `…05–10` customers/vendors/vendor_aliases, items (crosswalked to `public.inventory`/`public.parts`), tax (CDTFA-aware), invoices/invoice_lines/payments/payment_applications, bills/bill_lines/vendor_payments, banking + reconciliation.
- `…11` read-model views: `v_job_costing`, `v_trial_balance`, `v_ar_aging`, `v_ap_aging`.

**Frontend — feature module** `src/features/accounting/` behind build flag `VITE_ACCOUNTING_ENABLED`:
- Single flag-gated lazy entry `AccountingRouter.tsx`, wired into `src/AppRouter.tsx` (the ONLY core-app seam).
- API layer `src/services/api/accounting/` (`accountingClient.ts` wraps `supabase.schema('accounting')`; `accounts.ts`, `journal.ts`, `mappers.ts`).
- Working screens: **Chart of Accounts**, **Journal** (posts via the balance-enforcing RPC). Stubs: Invoices/Bills/Reports/Settings.
- Pure helpers + tests: `accountingViewModel.ts` (+ `.test.ts`) — money/cents math and double-entry validation.

**Verified baseline:** `typecheck`/`lint`/`test`/`build` green; with the flag OFF the production build contains **zero** accounting code.

Reuse these. Match their conventions. Extend, don't replace.

---

## 3. Invariants — every change MUST preserve ALL of these (G1–G10)
- **G1 — Additive DB only.** Never `ALTER`/`DROP` an existing `public.*` table or column. New objects live in schema `accounting`. Cross-schema FKs are created only on the accounting (child) side.
- **G2 — RLS on every new table.** read = `accounting.can_read()`, write = `accounting.can_write()` (payroll tables = `can_payroll()`). No table ships without RLS. `audit_log` has no authenticated write policy (definer-trigger only).
- **G3 — Double-entry integrity.** Every money movement posts a **balanced** journal entry through the GL (`post_journal_entry`). Never write ledger rows that bypass the balance trigger. Posted entries are immutable — correct via void + reversing entry.
- **G4 — Isolation.** With `VITE_ACCOUNTING_ENABLED` unset, the production build must contain **zero** accounting code/routes/chunks. The only core-app seam is the gated route in `src/AppRouter.tsx`. Accounting reads `public.*` **read-only** and writes only to `accounting.*`.
- **G5 — Stack lock.** React/Vite/Supabase/Netlify only (see §1 banned list). Prefer existing deps and `src/components/ui/*`, `lazyWithRetry`, TanStack Query, and existing domain utils (`src/lib/calculatePartQuote.ts`, `src/features/jobs/hooks/materialCostUtils.ts`).
- **G6 — Money math.** DB columns `numeric(14,2)`/`(14,4)`; all balance/sum logic in JS uses integer cents (`accountingViewModel.toCents`). No floats for balances.
- **G7 — Conventions.** Migrations: idempotent, timestamped, `-- ROLLBACK:` header, RLS + audit triggers, reuse `accounting._apply_standard_table(...)`. Services: `xxxService = {}` object + snake↔camel mapper, reads throw / writes return null. Screens: compose `AccountingShell`, reuse `Button/Card/FormField/LedgerTable/CurrencyInput/AccountPicker`.
- **G8 — Security is phased, not half-done.** Reuse Supabase Auth + RLS now. pgcrypto field encryption and hash-chained audit are *designed* (columns/placeholders exist) and only implemented in the dedicated security phase (Phase E) — never partially.
- **G9 — Legal.** Show "Not certified tax software. Always verify with a CPA/EA…" on every tax, payroll, and financial-report surface, and on data export.
- **G10 — Worktree discipline.** Write files to the **active worktree path**; file tools can silently target the main checkout. After editing, confirm `git status` shows your changes in the worktree before building. (This already caused one full round of rework.)

---

## 4. Definition of Done — a module is DONE only when EVERY box is checked
- [ ] **DB**: additive migration(s), idempotent, `-- ROLLBACK:` header, RLS + audit triggers; applied to a Supabase **dev branch** and smoke-tested (§9 DB checks).
- [ ] **Service**: `src/services/api/accounting/<x>.ts` + mappers + unit tests for mapping/edge cases.
- [ ] **Hooks**: query/mutation hooks with `['accounting', …]` keys; invalidation scoped to the accounting subtree only.
- [ ] **UI**: screen(s) compose `AccountingShell`, reuse `ui/*`, dark-theme + mobile-first, with **loading / empty / error** states and the §G9 disclaimer where relevant.
- [ ] **Double-entry proof**: the financial action posts a balanced JE via RPC; a test confirms an **unbalanced** attempt is rejected.
- [ ] **Tests**: unit (viewModel/services) + ≥1 flow test; `npm run test` green.
- [ ] **Gates**: `typecheck` + `lint` + `test` + `build` (flag ON) green; **flag-OFF build still emits zero accounting code**.
- [ ] **Docs**: update the module status table + a short README section.
- [ ] **Reviewer sign-off**: an independent verify agent confirms acceptance criteria + invariants **G1–G10** with evidence.

A builder may NOT start the next module until the current one passes DoD and the reviewer signs off.

---

## 5. The agent stack — roles & hand-off
- **Orchestrator** — owns this doc + the roadmap (§6). Assigns ONE module at a time. Enforces DoD gating. Never parallelizes two modules that touch the same files.
- **DB Builder** — migrations, RLS, triggers, RPCs, views. Lane: `supabase/migrations/`.
- **API/Hooks Builder** — `src/services/api/accounting/` + `src/features/accounting/hooks/`.
- **UI Builder** — `src/features/accounting/**` screens/components.
- **Reviewer / Verifier (adversarial)** — does NOT trust the builders. Re-runs all gates, checks every invariant, actively tries to break it: posts an unbalanced JE, runs a flag-OFF build, attempts an RLS bypass as a non-role user, looks for a touched `public.*` table. Emits **pass/fail with evidence**.
- **Integrator** — only runs the "graduation" seams (nav entry, runtime toggle, exposing the schema) **after the user approves going live**.

**Hand-off protocol:** every agent ends with the report template (§10). The next agent re-reads this doc + the prior report before acting. No silent context — everything material goes in the report.

**Driving it with an agent runner (e.g. the Workflow tool):** model each module as a pipeline `DB → API/Hooks → UI → Reviewer`, with the Reviewer stage as a hard gate (fail ⇒ loop back, do not advance). Keep one module in flight at a time unless modules are file-disjoint.

---

## 6. Module roadmap — build in this order, each gated by its own DoD cycle
**Phase A — Make core accounting usable (highest value first)**
- A1. **Invoices** from jobs/quotes → AR + **payments** → posts revenue JE (Dr AR / Cr Income / Cr Sales Tax). Reuse `calculatePartQuote` so the invoice equals the on-screen quote.
- A2. **Bills/expenses** → AP + **vendor payments** → posts expense JE.
- A3. **Reports v1**: Trial Balance, P&L, Balance Sheet, AR/AP aging (built on the `v_*` views) + PDF/CSV export (reuse `html2pdf.js`).
- A4. **Banking**: CSV/OFX/QFX import + rules engine + reconciliation UI. (Plaid is optional and lives behind user-supplied keys in a Netlify function — deferred.)

**Phase B — Operations**
- B1. Job-costing dashboard (`v_job_costing`) + per-job profitability.
- B2. Recurring transactions; classes/locations/departments dimensions on journal lines.
- B3. Inventory valuation (FIFO) → COGS postings tied to existing job-consumption events.

**Phase C — Compliance & payroll (HIGH RISK — extra reviewer scrutiny, mandatory disclaimers, "verify with CPA/EA" language, no shipping without a reviewer pass)**
- C1. Sales-tax reporting (CDTFA) + tax calendar/reminders.
- C2. Payroll: CA (UI/ETT/SDI/PIT) + federal (FICA/FUTA/Medicare) with **admin-updatable tax tables**; W-2 / 1099-NEC / DE-9C export stubs; payroll JE auto-posted. Hours sourced from `public.shifts`.

**Phase D — Platform**
- Import/migration (QBO CSV/JSON, QB Desktop IIF, Excel/CSV) + COA mapping wizard + dedup; document management (encrypted attachments); email/SMS notifications; budgeting & forecasting; fixed assets & depreciation; "Books Closed" lock date.

**Phase E — Security hardening (the brief's "nuclear secrets" bar)**
- pgcrypto field encryption (vendor tax IDs, bank masks, payroll SSNs/wages); hash-chained tamper-evident audit (fill the stub columns); encrypted automated backups + point-in-time restore UI; RBAC management UI; rate limiting / brute-force protection; security headers/CSP; dependency + DB advisor scans in CI.

Each bullet = its own DoD cycle. Do not batch.

---

## 7. Anti-wander checklist — run at the START and END of EVERY task
**START**
- [ ] I re-read this doc + the module's acceptance criteria.
- [ ] `git status` / branch confirms I'm in the correct worktree with the expected tree.
- [ ] My task touches ONLY the assigned module + allowed seams; I listed the files I expect to change.

**END (before declaring done)**
- [ ] I did NOT alter a `public.*` table or add a banned dependency/framework/stack.
- [ ] G2 (RLS) + G3 (balanced JE) + G4 (flag-off clean) verified with commands, not assumptions.
- [ ] All gates green; command outputs pasted into my report.
- [ ] Where I was unsure, I STOPPED and asked instead of guessing.

---

## 8. Stop conditions — HALT and ask the user/orchestrator when:
- The task seems to need a **banned tech** (Next.js/Docker/Prisma/NextAuth/second DB) or to **modify a `public.*` table**.
- A migration can't be made additive or can't roll back cleanly.
- A financial flow can't be expressed as **balanced double-entry**.
- Tax/payroll math whose correctness you can't verify against an authoritative source (IRS Pub 15-T, CA EDD/CDTFA rates).
- Anything that moves **real money**, handles **secrets/keys**, exposes the `accounting` schema, or writes to the user's **live** database — without explicit approval.
- Scope is ambiguous, or "finishing" would require inventing requirements.

When you stop: state the conflict, the options, and your recommendation. Don't proceed on assumption.

---

## 9. Gates — copy/paste; all must be green (paste outputs into your report)
**Code (run in the worktree):**
```
npm run typecheck
npm run lint
npm run test
# flag ON — module compiles & code-splits:
#   (.env.local) VITE_ACCOUNTING_ENABLED=true
npm run build
# flag OFF cleanliness — MUST find nothing:
#   unset the flag, npm run build, then assert dist has no accounting chunk,
#   no "/app/accounting", no "post_journal_entry"
```
**Database (use the Supabase MCP on a DEV BRANCH — never main):**
- `create_branch` → work on an isolated branch DB.
- `apply_migration` (or `execute_sql`) to apply the new migration; `list_migrations` to confirm.
- `get_advisors` (security + performance) → **zero new RLS/security findings** on accounting tables.
- `execute_sql` to prove invariants: (a) seed a tiny dataset; (b) attempt an **unbalanced** journal entry and confirm it is **rejected** by the trigger; (c) confirm a balanced entry posts and is then **immutable**; (d) confirm a non-role user is denied by RLS.
- When green, `merge_branch` only with approval; otherwise `delete_branch`.

A module without green code gates **and** green DB checks is **not done**, regardless of how finished the UI looks.

---

## 10. Reporting template — every agent ends its turn with this
```
MODULE / TASK:
FILES CHANGED (paths):
GATES:
  typecheck: pass/fail
  lint:      pass/fail
  test:      pass/fail (N passed)
  build (flag ON):  pass/fail
  build (flag OFF clean): pass/fail (evidence: chunk/grep result)
DB CHECKS (if any):
  migration applied + list_migrations: …
  get_advisors (security/perf): …
  unbalanced-JE rejected: yes/no
  RLS denies non-role user: yes/no
INVARIANTS G1–G10 CHECKED: (note any at risk)
DISCLAIMER shown where required (G9): yes/n-a
RESIDUAL RISKS / FOLLOW-UPS:
NEXT RECOMMENDED TASK:
```

---

## 11. Reference — files & patterns to mirror (don't reinvent)
- Migration style + RLS helpers: `supabase/migrations/20260224000003_user_approval.sql`, `…000006_fix_profiles_rls_recursion.sql`; the accounting batch `20260601000001…011`.
- Defensive trigger pattern (locks, idempotency, audit-in-txn): `supabase/migrations/20260509000003_jobs_consumed_at.sql`.
- Service pattern: `src/services/api/inventory.ts`; accounting client: `src/services/api/accounting/accountingClient.ts`.
- Routing/guard/lazy: `src/AppRouter.tsx`, `src/components/AdminGuard.tsx`, `src/lib/lazyWithRetry.ts`, `src/lib/featureFlags.ts`.
- UI kit: `src/components/ui/{Button,Card,FormField}.tsx`; module shell/controls: `src/features/accounting/components/*`.
- Costing/quote reuse: `src/lib/calculatePartQuote.ts`, `src/features/jobs/hooks/materialCostUtils.ts`.
- Double-entry/cents helpers + tests: `src/features/accounting/accountingViewModel.ts` (+ `.test.ts`).

> Golden rule: when in doubt, **extend the existing pattern, preserve the invariants, run the gates, and report honestly.** A smaller correct increment beats a large unverified one.

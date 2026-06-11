# QuickBooks Replica + Unified Jobs↔Billing — Rehearsal & Cutover Runbook

Everything below was built on branch `claude/amazing-lehmann-42803b` and the Supabase
development branch **unified-billing-dev** (`lvcufbmyhbqhvowjxmst`). Production has
received **zero** schema or data changes. This runbook is the ordered path from here
to a verified cutover.

## What was built

| Piece                                                                                            | Where                                                           |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| QBO read-only API proxy (count/query/report, admin-gated, tokens server-side)                    | `netlify/functions/qbo-sync.mjs`                                |
| Client-stepped sync engine (resumable; masters → documents → completeness → gated reconcile)     | `src/features/accounting/integrations/sync/`                    |
| Sync runner UI + verification report (`/app/accounting/integrations/sync`)                       | `QuickBooksSyncView.tsx`                                        |
| `external_qbo_id` on 9 entity tables + run/log tracking                                          | migration `20260610170000_qbo_sync_foundation.sql`              |
| `'qbo'` journal source type + one-transaction legacy-GL void                                     | migration `20260610190000_qbo_reconcile_support.sql`            |
| `jobs.customer_id` FK + lead→customer bridge RPC                                                 | migrations `20260610200000` + `20260610200100`                  |
| Job billing panel, customer picker, `?jobId=` prefilled create views, job column/filter on lists | `src/features/accounting/jobs/`, JobDetail/AdminCreateJob edits |

Already verified: typecheck, lint, 1139 tests (incl. 56 sync-specific), prettier,
flag-ON build, **flag-OFF build contains zero accounting code**, all four migrations
applied + tested on the Supabase branch (FK rejects bogus ids / links real ones /
ON DELETE SET NULL; both SECURITY DEFINER RPCs reject unauthorized callers), and the
security advisors show no new findings.

## Phase 0 — one-time prerequisites (user)

1. Create an app at **developer.intuit.com** (sandbox first). Single-company internal
   use does not need Intuit's app review.
2. Enable the hosted test rig: Netlify → Site configuration → Build & deploy →
   Branches and deploy contexts → add branch `claude/amazing-lehmann-42803b`.
   The **branch deploy** gets its own URL and — via the
   `[context.branch-deploy.environment]` section of `netlify.toml` — builds
   against the **unified-billing-dev** Supabase branch, never production.
3. Netlify env vars **scoped to the "Branch deploys" context** (Site settings →
   Environment variables → per-context values):
   - `SUPABASE_SERVICE_ROLE_KEY` = the **branch project's** service key
     (Dashboard → switch to branch unified-billing-dev → Settings → API)
   - `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_ENVIRONMENT` (`sandbox` →
     `production` later), `QBO_REDIRECT_URI` =
     `https://<branch-deploy-url>/api/qbo-oauth/callback`
4. Register that same callback URL under the Intuit app's Redirect URIs, then
   re-trigger the branch deploy so the functions pick the env up.

## Phase 1 — rehearsal (no production change)

On the **branch-deploy URL** (do not use deploy previews — those build against the
prod DB, which does not have the new columns yet):

1. Sign up a fresh user (the branch DB has schema but no users), then have the
   account approved + made admin + granted the accounting role on the branch DB
   (SQL or via Claude's Supabase access).
2. **Connect QuickBooks** at `/app/accounting/integrations` (sandbox realm first;
   "Test connection" must show the company name).
3. **Full sync** at `/app/accounting/integrations/sync`. Watch the phase table:
   masters → invoices/bills/estimates/payments → the 8 completeness types.
4. At the amber **"Retire legacy GL import"** gate: on the branch there are 0 legacy
   entries — approve to exercise the path.
5. **Run verification** (same page): every section must tie to the penny against the
   sandbox company.
6. Repeat steps 2–5 against the **live realm** (`QBO_ENVIRONMENT=production`,
   reconnect): full pull of the real company into the BRANCH DB, then verification.
   This is the dress rehearsal — chase any non-zero delta to its account before
   proceeding (the run log lists per-record errors).
7. Re-run **Full sync** a second time: expect 0 created / N updated / skips — proves
   idempotency.
8. Jobs side (same local app): open a job → Billing panel → set a customer → "New
   estimate" (customer + lines prefilled) → save → send → accept → convert → send
   invoice → record payment → both documents show on the job with live status.
   Confirm a non-admin user sees no Billing panel.

## Phase 2 — production cutover (explicit authorization; one batch)

1. Confirm `accounting` is in **Project Settings → API → Exposed schemas**, the
   right users hold rows in `accounting.user_roles`, and the books-closed lock is
   clear (the sync pre-flight also checks).
2. Apply the four migrations to **prod** in order (`qbo_sync_foundation`,
   `qbo_reconcile_support`, `jobs_customer_id`, `bridge_proposal_to_customer`) —
   all additive/idempotent, each with a ROLLBACK header. Run `get_advisors` after.
3. Merge the feature branch to `main` (CI green) — the UI ships; surfaces stay
   admin-gated.
4. Production **Full sync** from the live realm. The reconcile gate will show
   **14,339** legacy entries to void — approve only after the phases above it
   finished with no failures.
5. **Run verification** on prod — sign-off requires every section tied.
6. **Parallel run**: QuickBooks stays the system of record; press "Sync changes"
   (incremental) to top up; verification re-runs after each top-up.
7. Hard cutover (separate decision): final top-up + verification, stop entering in
   QuickBooks, WorkTrack is the books.

## Rollback

- **Code**: revert the merge; nothing in the core app depends on the new columns.
- **Migrations**: each file's `-- ROLLBACK:` header (drop columns/tables/functions).
- **Synced documents**: identifiable by `external_qbo_id is not null` /
  `journal_entries.source_type in ('qbo')` and removable; the legacy GL void is
  reversible in principle (rows retained, status='void') and Supabase PITR covers
  the cutover window as the backstop.
- **Branch cleanup**: delete the Supabase branch (`unified-billing-dev`,
  ~$0.013/hr) once the rehearsal is signed off.

## Known limitations (surface in verification, by design)

- Credit-memo applications to invoices: the CM's ledger effect posts exactly, but
  the per-invoice `amount_paid` allocation for the credit portion is shaved and
  logged (`credit-memo portion … not allocated`) — AR aging deltas will flag any
  that matter.
- Historical document EDITS in QuickBooks after a sync are skipped, not updated
  (idempotent-skip); they appear as verification deltas.
- QBO tokens are stored service-role-only but plaintext (encryption-at-rest is the
  existing deferred follow-up).

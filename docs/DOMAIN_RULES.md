# DOMAIN_RULES.md — durable rules, rates & safeguards

Salvaged from now-deleted `docs/archive/*` and **verified against live code** (2026-06).
Each item cites its source — if code and this doc ever disagree, **code wins**; fix this doc.

## Rates (defaults — admin-overridable in Settings)
- **Labor rate: $175/hr.** CNC rate: **$150/hr.** Plus a 3D-print rate. These are *defaults*;
  the admin Settings UI overrides them per org.
  Source: `src/contexts/SettingsContext.tsx` (`DEFAULT_SETTINGS`), `src/components/QuoteCalculator.tsx`.
  (History: labor was $50 before the V7 migration, then raised to $175.)

## Security safeguards (hard rules)
- **Supabase service-role key lives only in `netlify/functions/` — never in `src/` / frontend.**
  Verified: zero `SERVICE_ROLE` references under `src/`. The anon key is the only key the client uses.
- **Any serverless function that reads/writes user data must verify the Supabase JWT.**
- **Never change the Supabase schema without writing a migration file first**
  (`supabase/migrations/`). Migrations auto-apply on merge.

## Data integrity
- **Never silently drop a write — queue it.** WorkTrackPro is offline-tolerant: writes attempted
  while offline (detected via `isOffline()` + an 8s `OFFLINE_WRITE_TIMEOUT_MS`, `src/lib/networkStatus.ts`)
  are persisted to localStorage and replayed on reconnect.
  - **Clock punches:** `src/lib/offlineQueue.ts` (`enqueueClockPunch`, key `wtp_offline_clock_queue`),
    replayed by `src/lib/syncOfflineClockQueue.ts`. Capped at 25 attempts/punch
    (`MAX_SYNC_ATTEMPTS_PER_PUNCH`); surfaces `OfflinePunchWarning` + the `OfflinePunchBanner`.
  - **General actions** (job create/update/delete/status, comment add, inventory create/update):
    `src/lib/offlineActionQueue.ts` (key `wtp_offline_action_queue`) → `syncOfflineActionQueue.ts`.
  - Offline state is shown via `OfflineIndicator` / `OfflinePunchBanner`. Clock punch handlers:
    `handleClockIn`/`handleClockOut` (`JobDetail.tsx`), `useClockMutations`.

## Inventory invariants
- **Stock leaves incrementally, per unit, during In Progress — NOT in one shot at Finished.**
  As units are checked off, `log_unit_progress` decrements `in_stock` and bumps
  `job_inventory.consumed_quantity` for that unit's share of the BOM. The two milestones:
  CNC-checkoff deducts only the CNC-able (foam) share of the unit; unit-done deducts the rest.
  **Finished is only a true-up backstop** — its trigger
  (`jobs_reconcile_inventory_on_status`) deducts just the leftover `quantity − consumed_quantity`
  for units nobody logged. So by the time a card reaches QC→Finished, most stock has already
  left. (History: pre-`20260622000001` deduction happened entirely at Finished; that migration
  is the source of the stale "deducts at Finished" mental model — it's wrong now.)
  Source: `supabase/migrations/20260622000001_cnc_unit_progress.sql`,
  `src/lib/cncDeduction.ts`, `docs/cnc-unit-progress-deduction.md`.
- **The deduction basis is the intentionally over-padded BOM.** The owner over-estimates the
  BOM on purpose; the distributed per-unit shares sum to that padded total, so the system reads
  **lower** than what's physically on the shelf — a deliberate safety buffer. Consequence for any
  "verify inventory" feature: the happy path is already biased pessimistic, so a yes/no shelf-
  confirm at checkoff just trains rubber-stamping. The real un-modeled drift is **scrap/remakes**
  (ruined units consume material but complete no unit, so their BOM never deducts) — there is no
  scrap tracking today.
- **Over-allocation guard:** a job cannot allocate more than `in_stock`. Enforced two ways —
  client via `isAllocationActiveStatus` (`src/lib/inventoryCalculations.ts`) and server via the
  Supabase trigger `job_inventory_allocate_guard` (race-safe). "Allocated" nets out
  `consumed_quantity` (already-consumed stock left `in_stock`, so it isn't double-counted as an
  outstanding reservation).
- **Reorder signal:** an item "needs reordering" when `available < minStock`
  (a.k.a. `quantity <= reorderPoint`). Drives the low-stock banner / summary cards.
- **Quantity validation:** guard against negative / zero / non-finite `quantity_per_unit`
  in part-quote and material calculations (`validateQuantity`) — bad values must not reach the DB.

## Job rules
- **Overdue badge:** a job is overdue when its `ecd` (or `due_date`) is in the past **and** status
  is not complete. Pure frontend calc — `isJobOverdue` in `src/KanbanBoard.tsx`.
- **ECD is contract-reference only — automation never writes to ECD.**
- **Terminal statuses** (`finished`, `delivered`, `projectCompleted`, `paid`) auto-complete
  progress to 100%. QC = 80%; production (labor + CNC + 3D) fills the first 80%.
- **Machine hours:** `machineBreakdownByVariant` is the source of truth; all consumers read via
  `getMachineTotalsFromJob()`.

## UI & role-based rendering (salvaged from old Cursor skills, verified)
- **Shop-floor (non-admin) users must NEVER see financial data** — no price, unit cost, labor/CNC
  rate, total, margin, markup, budget, quote, or invoice figures. Gate every financial field behind
  `currentUser.isAdmin` and/or the `priceVisibility` helper. This is a privacy boundary, not just UX.
- **Toast-first UX:** every mutation gives immediate toast feedback (`showToast`). **Never use
  `alert()` or `confirm()`** — there are zero in the codebase; keep it that way (use a toast or an
  in-app confirm component).
- **Persistent UI state goes through `NavigationContext`** (search, filters, scroll positions,
  expanded groups, last job, active tab, minimal view) — never component-local state for anything
  that should survive a refresh or browser back.
- **Mobile-first:** shop-floor runs on tablets/phones — large tap targets, icon buttons over text.

## Service-layer convention
- Every function in `src/services/api/` returns a typed result and handles its own errors;
  **don't change existing function names/signatures** when refactoring — only internals.

## Reference (niche, kept for the importer)
- Trello export → job field mapping (incl. the `ECD` custom field) was documented in the old
  `TRELLO_EXPORT_STRUCTURE.md`; the live logic is in `src/TrelloImport.tsx` (grep there if needed).

# Per-Unit CNC / Production Progress + Incremental Inventory Deduction

Status: **implemented (online path) — offline queue pending in a separate session**
Owner ask captured: 2026-06-22

## Implementation status (2026-06-22)

- [x] DB migration `20260622000001_cnc_unit_progress.sql` — columns, `log_unit_progress` RPC,
      Finished-trigger true-up, allocate-guard nets `consumed_quantity`, `cnc_able_categories` on
      organization_settings.
- [x] Types + API mappers (`jobs.ts`, `subscriptions.ts`) + `unitProgress` RPC wrapper service.
- [x] Distribution math `src/lib/cncDeduction.ts` (+ 11 passing tests).
- [x] `cncAbleCategories` org setting wired end-to-end + admin toggle in AdminSettings.
- [x] `jobProgress.ts` fractional CNC % + units-done %.
- [x] Job Details: CNC + Units Done accordions (`UnitProgressAccordion`), "Is CNC also done?"
      confirm; removed the CNC auto-mark-on-bin-location and the old toggle.
- [x] Two-phase clock-out popup (`ClockOutCompletionModal` + `ClockOutCompletionGate`), hosted in
      AppShell, fired from wrapped `clockIn`/`clockOut` in AppContext (production jobs only).
- [x] No-variant PART card bug fix.
- [ ] Offline-queue support for the progress log — deferred (hand-off below). Online-only for now:
      the prompt is skipped when `navigator.onLine === false`.
- [ ] (Optional follow-up) Mirror per-unit tracking for 3D printing.

## Context / Why

Today inventory only physically leaves stock (`inventory.in_stock` decremented) when a job
enters a **consumed** status (`finished`, etc.) via the `jobs_reconcile_inventory_on_status`
trigger (`supabase/migrations/20260615000000_finished_stock_nonblocking.sql`). While a job is
in production its materials are only "allocated" (reduce computed `available`, not `in_stock`).

CNC completion is also currently a single all-or-nothing job flag (`cnc_completed_at`) that, in
practice, behaves as a near-terminal "production done" signal — workers delay marking it because
it inflates progress / interferes with the job. The owner wants production tracked and stock
deducted **incrementally, per unit, as work actually happens**, with CNC no longer terminal.

## Core model

A job has **units**, grouped by **variant** (dash suffix). Variant counts come from
`job.dashQuantities` (e.g. `{-01:4, -02:4, -03:4, -04:4}` → 16 units). A part with **no variants**
is treated as a **single pseudo-variant with no suffix**, quantity = job total qty (see Bug #1).

Each unit has **two independent milestones**, tracked per variant as completed counts:

1. **CNC done** — only meaningful for variants that **have CNC hours**
   (`job.machineBreakdownByVariant[suffix].cncHoursTotal > 0`). Deducts **only the CNC-able**
   portion of that unit's distributed BOM (the foam under that variant). Does **not** mark the unit
   fully done. A CNC-hour variant with no foam still appears in the checklist — it just deducts
   nothing on this step.
2. **Unit done (TOTAL)** — deducts the **full** distributed BOM for that unit (all materials).
   Because a fully-done unit's CNC is necessarily done, marking total-done also completes CNC for
   that unit (deducting the CNC-able share too if not already pulled — never double-deducts).

Invariant: `cncDoneCount[variant] >= unitDoneCount[variant]`. A unit can be CNC-done but not
total-done; never the reverse (except the explicit "CNC not done?" override below).

### Deduction basis — distribute the (padded) BOM

The owner intentionally **over-estimates the BOM**; over-deducting is desirable (system shows
less than the shop physically has, so workers always have a buffer). So we **distribute** each
material's job-BOM total across the units, rather than using canonical per-unit spec amounts:

- For a CNC-able material M: find the variants that **use** M (from `PartVariant.materials`).
  Distribute the job's total allocated qty of M across only those variants, proportional to each
  variant's usage (`quantityPerUnit × unitCount`), giving a **per-unit share** per variant. So a
  material used by some variants but not others only deducts from the variants that use it.
- Reuse `distributeSetMaterialToVariants` / `distributeQuantityProportionally` in
  `src/lib/partDistribution.ts`.
- By the time every unit is logged, the **full padded BOM total** has been deducted.
- Fallback when a part has no per-variant material spec: even split of the BOM line across all
  units by `dashQuantities` weight.

Two conditions decide whether a material deducts on the CNC milestone (for a given variant):

1. **The material is in a CNC category** — by category (foam), below.
2. **That foam actually needs CNC'ing** — the per-material `requiresCnc` slider (see below). When the
   linked part carries no explicit flag for that material (older parts, or a job with no linked part)
   this falls back to **"the variant runs CNC"** — `machineBreakdownByVariant[variant].cncHoursTotal
   > 0`.

A material deducts on the CNC milestone iff **both** hold. Foam that isn't flagged (and isn't on a
CNC-hour variant via the fallback) deducts on the total-done milestone instead — it still leaves
stock, just later. The logic lives in `buildDistributedBom` / `specMaterialRequiresCnc` in
`src/lib/cncDeduction.ts`.

## Per-material `requiresCnc` slider (the source of truth)

`part_materials.requires_cnc` (boolean, migration `20260623170000_part_material_requires_cnc.sql`) is
the "does this foam need CNC'd out" flag, surfaced as a **Needs CNC** toggle on each foam material in
the part/variant editor (`VariantCard` + `PartMaterialLink`). It only renders for materials whose
category is CNC-able (foam).

`specMaterialRequiresCnc(part, variantKey, inventoryId)` reads it with three outcomes: an explicit
`true`/`false` is authoritative (the slider overrides the hours gate — e.g. a CNC-hour variant whose
foam is flagged off deducts that foam on unit-done); an **absent** flag returns `undefined` and the
caller falls back to the CNC-hours gate (preserving pre-slider behavior). The read mapper in
`parts.ts` preserves `undefined` when the column is missing so the fallback holds during the
deploy/migration window.

**Backfill (seed-from-CNC-hours):** the migration seeded `requires_cnc = true` for foam on
parts/variants that already had CNC hours (`requires_cnc`/`cnc_time_hours`, with a part-level
fallback), and left all other foam `false` (opt-in for new foam). This is why the old "all foam ⇒
CNC" over-marking is gone without stranding existing CNC work.

## CNC checklist = per variant (CNC hours OR flagged foam)

A variant is **CNC-able** (shown in the CNC checklist) iff it has CNC hours **or** at least one
material flagged to deduct on CNC — `cncableVariantKeys` in `src/lib/cncDeduction.ts` unions
`hasCncHours` with `cncable` presence, not foam presence. (Earlier this was "any variant that uses
foam"; then "has CNC hours"; now it's the union, so flagged foam on a no-hours variant still shows
and a CNC-hour variant with no flagged foam still shows.) For a no-variant job, any CNC hours in the
breakdown belong to the single unit group.

**Kanban badge:** `KanbanBoard.tsx` shows the "CNC Pending/Done" chip iff the job has CNC hours or
CNC has actually been tracked (`cncCompletedAt` / a `cncDoneByVariant` count) — it no longer keys off
foam in the BOM. (It can't cheaply rebuild the distributed BOM per card to see flagged-foam-only
variants; once such a job logs any CNC the badge appears. Acceptable, given the seed aligns flagged
foam with CNC hours for existing parts.)

**Known limitation (accepted):** the foam → CNC-vs-unit-done bucket is computed client-side at log
time. If an admin removes a variant's CNC hours / un-flags its foam **after** some of its units were
CNC-marked, that already-consumed foam stays in `job_inventory.consumed_quantity` and can't be
un-marked via the CNC accordion (the variant may drop out of the checklist). Totals still reconcile —
the foam was physically consumed, and the Finished true-up (`quantity − consumed`) deducts the
remainder. This mirrors editing `dashQuantities` / BOM lines mid-job.

## CNC-able material category (gates which categories the slider applies to)

Categories are a fixed enum in `src/core/types.ts` (`material, foam, trimCord, printing3d,
chemicals, hardware, miscSupplies`). The admin setting:

- `AdminSettings.cncAbleCategories: InventoryCategory[]` (default `['foam']`).
- A material can deduct on CNC (and shows the `requiresCnc` slider) only if
  `cncAbleCategories.includes(item.category)`.
- Admin UI: toggle which categories are CNC-able (Settings).

The per-material flag is `part_materials.requires_cnc` (there is still no per-_inventory-item_
`is_cnc_able` column — CNC-ability is category + per-material-on-a-part).

## UI surfaces

### 1. Job Details — replace the single CNC card with two accordions

Location: `src/JobDetail.tsx` ~3196 (currently `MachineCompletionSection type="cnc"`).

- **CNC accordion** — lists only variants/units that **have CNC hours**. Per-variant `+/-`
  stepper showing `cncDone / totalUnits`. Increment deducts that variant's foam; decrement restores
  it (deducts nothing if the variant has CNC hours but no foam).
- **Units Done accordion** — lists all variants. Per-variant `+/-` stepper showing
  `unitDone / totalUnits`. Increment deducts the rest of the BOM (and completes CNC for those
  units, with the override prompt below); decrement restores.
- Both use a shared `<UnitProgressStepper>` component (also used by the popup).
- `+/-` steppers only — **no text boxes** (quantities are small).

### 2. Clock-out popup — two sequential prompts

Fires when a worker **clocks out of** OR **clocks into another job from** a job that is in a
**production status (`inProgress` / `rush`)** and has units to log. Both exit points are in
`src/hooks/useClockMutations.ts` (`clockOut` ~253; the switch-job clock-out inside `clockIn` ~67
and the retry path ~209). Intercept at the `AppContext` / `ClockInContext` level so the modal
shows before the punch completes, then proceed.

Sequence:

1. **"Any CNC done?"** — per-variant `+/-` steppers (CNC-hour variants only). Submit → deduct foam.
2. **"Any units done?"** — per-variant `+/-` steppers (all variants). Submit → deduct the rest.
   - If a unit-done is logged whose CNC isn't done yet, show a confirm:
     **"Is CNC also done for <part/variant>? Yes / No"**
     - **Yes** → also complete CNC for those units (pull foam) + non-CNC-able.
     - **No** → pull only non-CNC-able; leave CNC pending for those units.

- Worker can submit **0 / "nothing finished"** for either prompt.
- Always shows for production jobs **with variants/units**, CNC hours or not (jobs with no CNC-hour
  variants still pop for progress; the CNC step is skipped and only unit-done deducts).

### 3. Progress bar

`src/lib/jobProgress.ts`:

- `cncPercent` becomes fractional: `sum(cncDoneCount) / sum(cncableUnitTotals)` (was binary on
  `cnc_completed_at`).
- Production progress incorporates `unitDoneCount / totalUnits`.
- `cnc_completed_at` is set automatically when all CNC-able units are CNC-done (and cleared on
  reversal) — kept for back-compat / badges, but no longer terminal and no longer auto-advances
  status.

## Data model changes

Migrations (auto-apply on merge — never a manual release step):

- `jobs.cnc_done_by_variant jsonb default '{}'` — `{ "-04": 2, ... }` CNC-done counts per variant.
- `jobs.units_done_by_variant jsonb default '{}'` — total-done counts per variant.
- `job_inventory.consumed_quantity numeric default 0` — running total already physically deducted
  for that line (drives the Finished true-up and reversal, and nets out of `allocated`).
- New RPC `log_unit_progress(p_job_id uuid, p_cnc_delta jsonb, p_unit_delta jsonb)`
  `SECURITY DEFINER`, trigger-style locking, that, atomically:
  - Validates new counts stay within `[0, totalUnits]` and `cncDone >= unitDone`.
  - Computes per-material distributed deltas (CNC-able for cnc deltas; non-CNC-able for unit
    deltas; CNC-able too for unit deltas that complete a not-yet-CNC-done unit when confirmed).
  - Updates `inventory.in_stock` + `inventory.available` (may go negative — matches
    `20260615000000` policy; no non-negative CHECK), `job_inventory.consumed_quantity`, and writes
    `inventory_history` rows (new actions `cnc_consume` / `unit_consume` and their reversals).
  - Updates `jobs.cnc_done_by_variant` / `units_done_by_variant`; sets/clears `cnc_completed_at`.
  - Supports negative deltas (un-mark → restore stock).
- Modify `jobs_reconcile_inventory_on_status` (Finished trigger): on consume, deduct
  `quantity - consumed_quantity` per line (true-up backstop for un-logged units) instead of full
  `quantity`; on restore, reverse symmetrically and reset `consumed_quantity` to 0.
- Update `job_inventory_allocate_guard` and `src/lib/inventoryCalculations.ts`
  (`buildAllocatedByInventoryId`) so `allocated` nets out `consumed_quantity` (consumed already
  left `in_stock`, so it must not also count as a reservation).

## Files (representative, not exhaustive)

- DB: new `supabase/migrations/20260622*` (columns + RPC + trigger edits + guard edit).
- Types: `src/core/types.ts` (Job fields, JobInventoryItem.consumedQuantity, AdminSettings).
- Settings: `src/contexts/SettingsContext.tsx` (+ admin settings UI for cncAbleCategories).
- API mappers: `src/services/api/jobs.ts`, `src/services/api/subscriptions.ts`,
  `src/services/api/inventory.ts` (consumed_quantity), a new `progressService` RPC wrapper.
- Distribution: `src/lib/partDistribution.ts` (reuse), new
  `src/lib/cncDeduction.ts` (compute per-variant CNC-able vs non-CNC-able per-unit shares) + tests.
- Progress: `src/lib/jobProgress.ts`.
- UI: new `src/features/jobs/components/UnitProgressStepper.tsx`,
  `UnitProgressAccordion.tsx`, `ClockOutCompletionModal.tsx`; edits to `src/JobDetail.tsx`,
  `src/AppContext.tsx` / `src/contexts/ClockInContext.tsx`.

## Bugs folded in

1. **DONE — No-variant jobs showed no PART card.** The part block (`viewParts`) only rendered when
   `job.parts` or `job.partId` existed, so a job linked by **part number only (no part id)** lost
   its entire Part Number / Name / Rev card. Fixed in `src/JobDetail.tsx` (~3251): render the card
   from `job.partNumber` even without an id, fall back the React key, and show `job.qty` as a
   "Quantity" readout when there are no dash variants. (Per owner: "doesn't have to have an id, but
   a quantity is good to have.")
2. **No-variant unit modeling (feature work).** For the accordions/popup, a part with no variants is
   a single pseudo-unit (no suffix) with quantity = job total qty — see Core model.

## Offline hand-off (separate session — owner is adding offline-queue support)

The clock-out popup must not silently drop logged progress when the punch happens offline. The
owner is building general offline-queue support for clock punches in another session. This feature
needs, in that work:

- A new queued op type, e.g. `unit_progress`, carrying `{ jobId, cncDelta, unitDelta, timestamp }`.
- `enqueue` on offline clock-out **after** the popup is filled (so the deltas ride along with the
  queued `clock_out`).
- `syncOfflineClockQueue` handler that calls the `log_unit_progress` RPC on replay, **idempotently**
  (guard against double-apply on retry — e.g. an op id, mirroring how `clockIn` no-ops on an
  existing open shift). Deductions are not naturally idempotent, so replay must be keyed.
- Ordering: progress op should apply relative to the shift it was captured in; safe to apply
  independent of punch order since it targets job state, not shift state.

Until that lands, online-only: when offline, skip the popup/deduction; the worker logs via the
Job Details accordions later. Relevant files: `src/lib/offlineQueue.ts`,
`src/lib/syncOfflineClockQueue.ts` (or equivalent), `src/hooks/useClockMutations.ts`.

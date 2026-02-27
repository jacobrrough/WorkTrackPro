# Inventory Refresh Compatibility Addendum

This iteration did **not** rework the Parts/Inventory refresh UI. The focus was Job Detail + Edit overhaul, with compatibility safeguards so existing inventory behavior remains stable.

## What was safeguarded

- Kept all inventory allocation and available-stock logic on shared helpers:
  - `src/lib/inventoryCalculations.ts`
  - `src/lib/inventoryState.ts`
  - `src/lib/inventoryReconciliation.ts`
- Kept existing allocation and history write pathways in place:
  - `AppContext.updateJobStatus(...)` still writes inventory history actions (`reconcile_job`, `reconcile_job_reversal`).
  - `syncJobInventoryFromPart(...)` still routes through `jobService` inventory methods.
- Preserved existing inventory navigation links from Job Detail and edit material rows to `inventory-detail`.
- Did not change Inventory list/detail routing, filters, tabs, or scanner flows implemented in the previous refresh.

## Job Detail changes with inventory impact

- Replaced duplicated inline part/variant math in `JobDetail` with shared helper usage:
  - Added `buildPartVariantDefaults(...)` in `src/lib/variantAllocation.ts`.
  - `JobDetail` now reuses this helper for both auto-pull and apply-from-part flows.
- Reconciliation is now reversible across delivered status toggles:
  - `buildReconciliationMutations(...)` now allows reversible stock delta math.
  - `AppContext` uses `entry.newAvailable` from reconciliation output directly (single truth path).

## Compatibility verification performed

- `npm run test -- --run` passed (including new reconciliation + variant allocation tests).
- `npm run build` passed.
- `npm run lint` passed with only pre-existing warnings in `src/TimeReports.tsx`.

## Why this is safe

- Inventory UI contracts were not changed.
- Inventory service contracts were not changed.
- Job Detail still uses existing `onAddInventory`, `onRemoveInventory`, and `onNavigate` interfaces.
- Role-based visibility remains guarded by existing admin checks and `priceVisibility` helpers.
# Inventory Refresh Summary

This document captures the implemented Parts/Inventory refresh work, focused on functional correctness, cross-module consistency, and mobile-first UX.

## What changed

### 1) Allocation and availability logic was unified
- `src/lib/inventoryCalculations.ts`
  - Added shared allocation status guard (`isAllocationActiveStatus`)
  - Added single-pass allocation map builder (`buildAllocatedByInventoryId`)
- `src/lib/inventoryState.ts` (new)
  - Added `withComputedInventory()` to compute `allocated` and `available` in one canonical pass
- `src/features/inventory/AllocateToJobModal.tsx`
  - Switched job eligibility to the shared `isAllocationActiveStatus()` helper

Why this grouping:
- Keeps every screen using one allocation truth path.
- Eliminates drift between AppContext, modals, and detail/list views.

### 2) Job delivery reconciliation is now reversible
- `src/lib/inventoryReconciliation.ts` (new)
  - Added reconciliation mutation builder for delivery consume/restore transitions
- `src/AppContext.tsx`
  - `updateJobStatus` now reconciles both:
    - to `delivered` => consume stock (`reconcile_job`)
    - from `delivered` => restore stock (`reconcile_job_reversal`)

Why this grouping:
- Keeps status-transition business rules in one module, not inline in context.
- Prevents stock drift when jobs are moved out of delivered.

### 3) Stock write semantics are consistent
- `src/services/api/inventory.ts`
  - `updateStock()` now updates `in_stock` only (no forced `available = in_stock`)

Why this grouping:
- `available` is a computed operational value tied to active allocations.
- Prevents DB-level overwrite from fighting computed UI logic.

### 4) Inventory list UX was refined for scannability
- `src/features/inventory/InventoryMainView.tsx`
  - Added top summary cards (total, needs reorder, low/critical)
  - Added min-stock badge in table rows
  - Improved desktop action cluster with quick +/- stock controls
  - Kept existing grouped tabs, global search, filters, FAB add action, and CSV export

Why this grouping:
- Keeps list glanceable on mobile and desktop.
- Groups operational urgency (needs reorder/low stock) above row-level actions.

### 5) Inventory detail sections were strengthened
- `src/InventoryDetail.tsx`
  - Added top header card with SKU, in-stock count, and category/vendor pills
  - Linked jobs now explicitly show active allocation jobs only
  - Added readable labels for new history actions:
    - `allocated_to_job`
    - `reconcile_job_reversal`

Why this grouping:
- Keeps detail view structured by operator intent: identify part, assess stock health, act.
- Aligns history readability with operational actions.

### 6) System documentation was refreshed
- `SYSTEM_MASTERY.md`
  - Fully updated with verified schema, relationships, and runtime flows
  - Added explicit interconnectivity and pain-point documentation

## Files created
- `src/lib/inventoryState.ts`
- `src/lib/inventoryReconciliation.ts`
- `INVENTORY_REFRESH_SUMMARY.md`

## Files modified
- `SYSTEM_MASTERY.md`
- `src/AppContext.tsx`
- `src/lib/inventoryCalculations.ts`
- `src/services/api/inventory.ts`
- `src/features/inventory/AllocateToJobModal.tsx`
- `src/features/inventory/InventoryMainView.tsx`
- `src/InventoryDetail.tsx`

## Manual PocketBase/Supabase schema changes required
- None required for this refresh.

## Ready-to-test checklist

1. Allocate inventory from `/inventory` list:
   - allocate `5` units to an active job
   - verify `allocated` increases and `available` decreases immediately
   - verify inventory history shows `Allocated To Job`
2. Delivery reconciliation:
   - move a job with allocations to `delivered`
   - verify `in_stock` decreases and history shows `Job Reconciliation`
3. Reversal reconciliation:
   - move same job from `delivered` back to `inProgress`
   - verify stock is restored and history shows `Delivery Reversal`
4. Over-allocation guard:
   - attempt allocation greater than available quantity
   - verify allocation is blocked
5. Inventory list UX:
   - verify summary cards, tab filtering, search/filter behavior, and quick +/- stock actions
6. Inventory detail UX:
   - verify header card values (SKU/category/vendor/stock) and linked jobs list
7. Role visibility:
   - non-admin user: confirm financial fields remain hidden where expected
   - admin user: confirm pricing views still render
# Inventory Refresh Summary

This summarizes the Parts/Inventory refresh implemented in this pass and why each grouping/layout decision was made.

## What Changed

### 1) System understanding baseline
- Added `SYSTEM_MASTERY.md` with:
  - full Supabase table/relationship map (PocketBase-shaped service facade preserved)
  - inventory-job allocation/reconciliation/history flow documentation
  - realtime, shift/job interaction, and navigation persistence mapping
  - explicit inventory/parts pain points and helper-library preservation list

### 2) Inventory main page redesign
- Replaced old kanban-first inventory main UX with a new modular list experience:
  - New file: `src/features/inventory/InventoryMainView.tsx`
  - New file: `src/features/inventory/inventoryViewModel.ts`
  - New file: `src/features/inventory/AllocateToJobModal.tsx`
  - Wiring update: `src/Inventory.tsx`
- New capabilities:
  - tabs: **All Parts**, **Needs Reordering**, **Low Stock**, **By Bin Location**
  - global search and category/supplier filters
  - mobile card layout + desktop table layout
  - quick actions: **Edit**, **View History**, **Allocate To Job**
  - quick stock adjust buttons (+/-) for admins
  - CSV export of current filtered inventory
  - mobile FAB (**Add Part**) for admins

### 3) Inventory detail grouping improvements
- Updated `src/InventoryDetail.tsx` to improve scannability and structure:
  - **Stock Overview** section (In Stock, Allocated, Available, On Order) plus min-stock progress bar
  - **Location & Barcode** section (includes scan barcode action)
  - **Supplier & Pricing** section with reorder cost estimate (admin-visible pricing only)
  - **Linked Jobs** section showing job allocations for this inventory item
  - Existing attachments and stock history sections preserved

### 4) Allocation flow (job_inventory + inventory_history)
- Added allocation action in context and UI wiring:
  - `AppContext` now exposes `allocateInventoryToJob(...)`
  - writes `job_inventory` row
  - writes `inventory_history` row with action `allocated_to_job`
  - refreshes jobs/inventory and provides toast-driven UX through caller
- Inventory modal (`AllocateToJobModal`) allows one-click allocation to active jobs.

### 5) Parts ↔ Job-card interaction sync
- Added update signaling from admin part editor:
  - `src/features/admin/PartDetail.tsx` dispatches `parts:updated` events after key part/variant updates
- Added listener in job detail:
  - `src/JobDetail.tsx` listens for `parts:updated` and reloads linked part data when the edited part matches current job
- Effect:
  - job detail pricing/scheduling views are refreshed against latest part edits without requiring full app reload.

### 6) Job Detail refresh (modular + mobile-first)
- Added a non-breaking baseline contract doc:
  - `JOB_DETAIL_REFRESH_BASELINE.md`
- Refactored `src/JobDetail.tsx` internals into focused modules while keeping parent props/actions unchanged:
  - `src/features/jobs/hooks/useMaterialSync.ts`
  - `src/features/jobs/hooks/useVariantBreakdown.ts`
  - `src/features/jobs/hooks/useMaterialCosts.ts`
  - `src/features/jobs/components/JobComments.tsx`
  - `src/features/jobs/components/JobInventory.tsx`
- UX refinements applied in extracted sections:
  - inventory actions and modal kept in a dedicated component
  - improved tap target sizing on material actions/buttons
  - comments flow preserved with cleaner component boundaries
- Financial guardrails hardened for Job Detail:
  - extended `src/lib/priceVisibility.ts` with job-specific helpers
  - financial computations and displays now route through centralized visibility checks
- Navigation/scroll reliability preserved:
  - existing `NavigationContext` scroll persistence and last-job state behavior retained
  - edit/save/material-sync flows keep the same back/refresh behavior contract

### 7) Part Detail refresh (modular + guardrailed)
- Added a non-breaking baseline contract doc:
  - `PART_DETAIL_REFRESH_BASELINE.md`
- Reduced `PartDetail` complexity by extracting part-job labor analytics logic:
  - `src/features/admin/hooks/usePartLaborFeedback.ts`
- Hardened role-based financial visibility in Part Detail:
  - new centralized helper `canViewPartFinancials(...)` in `src/lib/priceVisibility.ts`
  - financial widgets/displays in Part Detail now run through this guard.
- Mobile-first interaction improvements:
  - larger back button touch target
  - larger Add/Edit tap targets in set/variant material actions.
- Maintained parts-to-job synchronization behavior:
  - part updates still propagate via `parts:updated` event for linked job detail refresh.

## Why These Grouping Decisions Were Made

### Inventory main tabs
- **All Parts**: default operational view for day-to-day lookup.
- **Needs Reordering**: strict reorder threshold signal (`available < minStock`).
- **Low Stock**: broader warning bucket including near-zero/critical availability.
- **By Bin Location**: physical picking/restock workflow maps to storage layout.

### Detail section breakdown
- **Stock Overview** first: most critical at-a-glance signal for production continuity.
- **Location & Barcode** second: shop-floor retrieval/scanning flow.
- **Supplier & Pricing** isolated: keeps admin financial data grouped and role-gated.
- **Linked Jobs** explicit: makes allocation pressure traceable without leaving part detail.

### Modalized allocation
- Kept allocation workflow minimal (job + quantity + note) to reduce friction and mistakes.
- Keeping it in a focused modal avoids overloading list rows while preserving quick action speed.

## Files Created/Modified In This Pass

### Created
- `SYSTEM_MASTERY.md`
- `INVENTORY_REFRESH_SUMMARY.md`
- `JOB_DETAIL_REFRESH_BASELINE.md`
- `PART_DETAIL_REFRESH_BASELINE.md`
- `src/features/inventory/inventoryViewModel.ts`
- `src/features/inventory/InventoryMainView.tsx`
- `src/features/inventory/AllocateToJobModal.tsx`
- `src/features/jobs/hooks/useMaterialCosts.ts`
- `src/features/jobs/hooks/useMaterialSync.ts`
- `src/features/jobs/hooks/useVariantBreakdown.ts`
- `src/features/jobs/hooks/materialCostUtils.ts`
- `src/features/jobs/hooks/variantBreakdownUtils.ts`
- `src/features/jobs/components/JobComments.tsx`
- `src/features/jobs/components/JobInventory.tsx`
- `src/features/jobs/hooks/useMaterialCosts.test.ts`
- `src/features/jobs/hooks/useVariantBreakdown.test.ts`
- `src/features/admin/hooks/usePartLaborFeedback.ts`

### Modified
- `src/Inventory.tsx`
- `src/InventoryDetail.tsx`
- `src/AppContext.tsx`
- `src/App.tsx`
- `src/JobDetail.tsx`
- `src/features/admin/PartDetail.tsx`
- `src/features/inventory/index.ts`
- `src/lib/priceVisibility.ts`
- `src/lib/priceVisibility.test.ts`

## Manual Database Changes Required

- None required for this implementation.
- Uses existing tables and fields (`inventory`, `job_inventory`, `inventory_history`, `jobs`, `parts`, `part_variants`).

## Ready-To-Test Checklist

- [ ] Open `/inventory` and verify tabs switch correctly across All Parts / Needs Reordering / Low Stock / By Bin Location.
- [ ] Search by name, barcode/SKU, bin, and category text; verify filter results update live.
- [ ] Filter by category and supplier; confirm both mobile cards and desktop table match.
- [ ] Click **Edit** and **View History** on an item; confirm detail view opens correctly.
- [ ] Use quick stock `+`/`-`; verify stock updates, toasts, and history entries are created.
- [ ] Click **Allocate To Job**, allocate quantity to active job; verify:
  - `job_inventory` updates
  - inventory history entry is written
  - available/allocated numbers refresh
- [ ] In detail view, verify sections render as grouped:
  - Stock Overview (with min-stock progress)
  - Location & Barcode
  - Supplier & Pricing
  - Linked Jobs
  - Stock History / Attachments
- [ ] Update a part/variant in admin part detail, then open related job detail; verify linked part data reloads and pricing/scheduling views reflect latest part configuration.
- [ ] Open a job detail on mobile width and verify section scannability and 44px+ touch targets on material/comment actions.
- [ ] As non-admin, verify no labor/material/total dollar values are shown in Job Detail.
- [ ] Edit dash quantities and confirm debounced material auto-sync still updates job inventory reliably.
- [ ] In Part Detail, verify mobile touch targets for back/add/edit actions are comfortable (44px+).
- [ ] As non-admin, verify Part Detail financial widgets are hidden (set price/customer-cost displays).
- [ ] Update part/variant pricing/labor/CNC values and confirm linked job detail reflects the update path.

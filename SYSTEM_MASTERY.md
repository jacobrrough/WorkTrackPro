# System Mastery Document

This document captures the current, verified system state of WorkTrack Pro as implemented today.

## 1) Backend and Collection/Table Model

The frontend still uses a PocketBase-style service facade (`src/pocketbase.ts`), but runtime persistence is Supabase (`src/services/api/*`, `supabase/migrations/*`).

### Core identity and access

#### `profiles`
- Source: `supabase/migrations/20250216000001_initial_schema.sql`, `20260224000003_user_approval.sql`
- Fields:
  - `id` (uuid, PK, FK to `auth.users.id`)
  - `email` (text)
  - `name` (text)
  - `initials` (text)
  - `is_admin` (boolean)
  - `is_approved` (boolean)
  - `approved_at` (timestamptz)
  - `approved_by` (uuid, FK to `profiles.id`)
  - `created_at`, `updated_at` (timestamptz)
- Primary relations:
  - `profiles` 1:N `jobs.created_by`
  - `profiles` 1:N `shifts.user_id`
  - `profiles` 1:N `comments.user_id`
  - `profiles` 1:N `shift_edits.edited_by`
  - `profiles` 1:N `checklist_history.user_id`
  - `profiles` 1:N `inventory_history.user_id`
  - `profiles` 1:N `quotes.created_by`
  - `profiles` 1:N `organization_settings.updated_by`

### Jobs, inventory, and production

#### `jobs`
- Source: `20250216000001_initial_schema.sql` + follow-up migrations
- Fields (in use by app/services/types):
  - `id`, `job_code`, `po`, `name`, `qty`, `description`
  - `ecd`, `due_date`, `labor_hours`
  - `active`, `status`, `board_type`
  - `created_by`, `assigned_users`, `is_rush`, `workers`, `bin_location`
  - `part_number`, `part_id`, `variant_suffix`
  - `est_number`, `inv_number`, `rfq_number`, `owr_number`
  - `dash_quantities`, `revision`
  - `labor_breakdown_by_variant`, `machine_breakdown_by_variant`
  - `allocation_source`, `allocation_source_updated_at`
  - `created_at`, `updated_at`
- Primary relations:
  - `jobs` 1:N `job_inventory.job_id`
  - `jobs` 1:N `shifts.job_id`
  - `jobs` 1:N `comments.job_id`
  - `jobs` 1:N `attachments.job_id`
  - `jobs` 1:N `checklists.job_id`
  - `jobs` 1:N `inventory_history.related_job_id`
  - `jobs` N:1 `parts` via `part_id` (and legacy `part_number` FK)

#### `inventory`
- Source: `20250216000001_initial_schema.sql`
- Fields:
  - `id`, `name`, `description`, `category`
  - `in_stock`, `available`, `disposed`, `on_order`
  - `reorder_point`, `price`, `unit`
  - `has_image`, `image_path`
  - `barcode`, `bin_location`, `vendor`
  - `attachment_count`, `created_at`, `updated_at`
- Primary relations:
  - `inventory` 1:N `job_inventory.inventory_id`
  - `inventory` 1:N `part_materials.inventory_id`
  - `inventory` 1:N `attachments.inventory_id`
  - `inventory` 1:N `inventory_history.inventory_id`

#### `job_inventory` (junction)
- Source: `20250216000001_initial_schema.sql`
- Fields: `id`, `job_id`, `inventory_id`, `quantity`, `unit`, `created_at`
- Primary relation:
  - `jobs` N:M `inventory` through `job_inventory`

### Time tracking and audit

#### `shifts`
- Source: `20250216000001_initial_schema.sql`, `20260221000200_shift_lunch_tracking.sql`
- Fields:
  - `id`, `user_id`, `job_id`
  - `clock_in_time`, `clock_out_time`
  - `lunch_start_time`, `lunch_end_time`, `lunch_minutes_used`
  - `notes`, `created_at`
- Primary relations:
  - N:1 `profiles`
  - N:1 `jobs`
  - 1:N `shift_edits`

#### `shift_edits`
- Fields:
  - `id`, `shift_id`, `edited_by`
  - `previous_clock_in`, `new_clock_in`
  - `previous_clock_out`, `new_clock_out`
  - `reason`, `edit_timestamp`

### Collaboration and files

#### `comments`
- Fields: `id`, `job_id`, `user_id`, `text`, `created_at`

#### `attachments`
- Source: base schema + inventory/part migrations + constraint fix
- Fields:
  - `id`
  - `job_id` (nullable)
  - `inventory_id` (nullable)
  - `part_id` (nullable)
  - `filename`, `storage_path`, `is_admin_only`, `created_at`
- Relation model:
  - Polymorphic link: exactly one parent entity per attachment (job OR inventory OR part)

### Checklists

#### `checklists`
- Fields: `id`, `job_id` (nullable for templates), `status`, `items` (jsonb), `created_at`, `updated_at`

#### `checklist_history`
- Fields: `id`, `checklist_id`, `user_id`, `item_index`, `item_text`, `checked`, `created_at`

### Pricing and quotes

#### `quotes`
- Fields:
  - `id`, `product_name`, `description`
  - `material_cost`, `labor_hours`, `labor_rate`, `labor_cost`
  - `markup_percent`, `subtotal`, `markup_amount`, `total`
  - `line_items` (jsonb), `reference_job_ids` (uuid[])
  - `notes`, `created_by`, `created_at`, `updated_at`

### Inventory change audit

#### `inventory_history`
- Fields:
  - `id`, `inventory_id`, `user_id`
  - `action`, `reason`
  - `previous_in_stock`, `new_in_stock`
  - `previous_available`, `new_available`
  - `change_amount`
  - `related_job_id`, `related_po`
  - `created_at`

### Parts and variant manufacturing model

#### `parts`
- Fields:
  - `id`, `part_number`, `name`, `description`
  - `price_per_set`, `labor_hours`
  - `requires_cnc`, `cnc_time_hours`
  - `requires_3d_print`, `printer_3d_time_hours`
  - `set_composition`, `created_at`, `updated_at`

#### `part_variants`
- Fields:
  - `id`, `part_id`, `variant_suffix`, `name`
  - `price_per_variant`, `labor_hours`
  - `requires_cnc`, `cnc_time_hours`
  - `requires_3d_print`, `printer_3d_time_hours`
  - `created_at`, `updated_at`

#### `part_materials`
- Fields (supports old/new schema names):
  - `id`
  - `part_id` (nullable for variant-only rows)
  - `part_variant_id` or legacy `variant_id` (nullable for part-level per-set rows)
  - `inventory_id`
  - `quantity_per_unit` or legacy `quantity`
  - `unit`, `usage_type`, `created_at`, `updated_at`
- Relation model:
  - `parts` N:M `inventory` via `part_materials`
  - `part_variants` N:M `inventory` via `part_materials`

### Organization settings

#### `organization_settings`
- Fields:
  - `id`, `org_key`
  - `labor_rate`, `material_upcharge`, `cnc_rate`, `printer_3d_rate`
  - `employee_count`, `overtime_multiplier`, `work_week_schedule`
  - `require_on_site`, `site_lat`, `site_lng`, `site_radius_meters`, `enforce_on_site_at_login`
  - `updated_by`, `created_at`, `updated_at`

### Additional tables present (not central to current inventory/parts flow)
- `customer_proposals`
- `customer_proposal_files`

## 2) How the Pieces Interact

### Inventory ↔ Jobs via `job_inventory`

- Job material assignment writes rows in `job_inventory` through `jobService.addJobInventory(...)`.
- Allocation is conceptually derived, not permanently deducted at assignment time.
- Official math helper is `src/lib/inventoryCalculations.ts`:
  - Allocated = sum of `job_inventory` on active workflow statuses only.
  - Available = `max(0, inStock - allocated)`.
- `AppContext` also computes `inventoryWithComputed` in one pass for UI display.

### Available vs allocated and stock reconciliation

- Operational model:
  - Pre-delivery: inventory is allocated (planning commitment).
  - On delivery: reconciliation reduces `in_stock` based on `job_inventory`.
- In `AppContext.updateJobStatus(...)`:
  - when status becomes `delivered`, each allocated line decrements stock and writes `inventory_history` action `reconcile_job`.

### Inventory history logging

- `inventoryHistoryService.createHistory(...)` writes audit rows for:
  - `manual_adjust`
  - `reconcile_job`
  - `order_placed`
  - `order_received`
- History is queried in detail pages (`inventory_history` + profile/job joins for display metadata).

### Time clock / shifts impact on jobs

- `clockIn(jobId)` creates a shift.
- If clocking into a `pending` or `rush` job, job status auto-advances to `inProgress`.
- Lunch state is tracked on shift fields and influences shift totals/reporting; no direct inventory quantity mutation occurs from shifts.

### Realtime subscriptions

- `src/services/api/subscriptions.ts` subscribes to `jobs`, `shifts`, and `inventory`.
- `AppContext` attaches listeners and updates local state.
- On job create/update/delete events, inventory refresh is triggered to keep allocation-driven display values current.

### Navigation / AppContext / state flow

- Router wrapper exists (`BrowserRouter` in `src/index.tsx`) but app navigation is still custom state in `App.tsx` (`view`, `id`, `returnViews`).
- Global domain state/actions are centralized in `AppContext`.
- UI navigation persistence uses `NavigationContext` + localStorage for:
  - search terms (`searchTerm`, `inventorySearchTerm`, `partsSearchTerm`)
  - expanded categories
  - scroll positions
  - last viewed job
  - minimal view

### Validation, error handling, toasts, modals

- Validation helpers in `src/core/validation.ts`.
- Mutations generally use `useToast().showToast(...)` for success/error feedback.
- Modal patterns are mixed:
  - reusable modal components exist (`ConfirmDialog`, `QRScanner`, `FileViewer`)
  - some screens still use inline overlay modals and occasional `confirm(...)`.
- Error handling is mostly catch/log/toast; some operations return booleans and degrade gracefully.

## 3) Current Navigation & View System

- Current primary view routing is a custom switch tree in `App.tsx`:
  - `dashboard`, `job-detail`, `inventory`, `inventory-detail`, `parts`, `part-detail`, `quotes`, etc.
- Return navigation is manually tracked with `returnViews`.
- URL path is only used at top level to split public site (`/`) and employee app (`/app`).
- Some components read router location for scroll state, but not all views are true route-driven pages.

## 4) Inventory/Parts UI Pain Points (Observed in Code)

1. `src/features/admin/PartDetail.tsx` is extremely large and mixes many concerns (load/update/material logic/analytics/UI).
2. Inventory list UX is split across old kanban-style and ordering views with inconsistent information density between mobile/desktop.
3. Inventory detail includes heavy scanner and editing logic in a single large component.
4. Allocation/availability display uses multiple computation paths (`inventoryCalculations` + `AppContext` memo pass), increasing drift risk.
5. `inventoryService.updateStock(...)` writes `available = in_stock` at DB level, while UI treats available as computed.
6. Ordering flow still shows pricing information in places where role-specific visibility must be explicitly guarded.
7. Modal and confirm patterns are inconsistent (`ConfirmDialog` used in some places, native `confirm` still used in others).
8. Touch target sizing is not uniformly applied across all icon actions in inventory surfaces.
9. Parts list is simple and clean, but coupling from part edits into job card pricing/scheduling visibility needs explicit verification and tests.

## 5) Libraries/Helpers That Must Be Preserved or Extended

- `src/lib/inventoryCalculations.ts`
  - canonical allocated/available math; keep as single source of truth.
- `src/lib/timeUtils.ts`
  - shared shift duration formatting and totals.
- `src/core/validation.ts`
  - form validation primitives; extend rather than duplicate.
- `src/lib/materialFromPart.ts`
  - computes required materials from part variants + dash quantities and syncs job inventory.
- `src/lib/partDistribution.ts`
  - set/variant distribution logic for pricing, labor, and materials.
- `src/lib/priceVisibility.ts`
  - role-based hiding of financial fields.

## 6) PocketBase Compatibility Notes

- Runtime backend is Supabase, but service naming and app architecture retain PocketBase compatibility conventions:
  - central facade import from `src/pocketbase.ts`
  - `expand`-style shapes on jobs (`job_inventory`, comments, attachments) mirrored in mapped types
- This compatibility should be preserved while refactoring to avoid broad app breakage.

## 7) Job Detail Refresh Notes (Current State)

- Scope locked to `src/JobDetail.tsx` and directly coupled modules, with parent prop contract unchanged from `src/App.tsx`.
- Non-breaking baseline contract documented in `JOB_DETAIL_REFRESH_BASELINE.md`.
- Job Detail internals now use extracted modules:
  - Hooks:
    - `src/features/jobs/hooks/useMaterialSync.ts`
    - `src/features/jobs/hooks/useVariantBreakdown.ts`
    - `src/features/jobs/hooks/useMaterialCosts.ts`
  - Components:
    - `src/features/jobs/components/JobComments.tsx`
    - `src/features/jobs/components/JobInventory.tsx`
- Financial visibility guardrails are centralized through `src/lib/priceVisibility.ts` job helpers:
  - `canViewJobFinancials(...)`
  - `shouldComputeJobFinancials(...)`
- Navigation reliability remains on existing foundations:
  - custom app view stack in `App.tsx`
  - persisted scroll + last viewed job in `NavigationContext`
  - debounced material sync behavior retained for dash-quantity changes.

## 8) Part Detail Refresh Notes (Current State)

- Scope remains centered on `src/features/admin/PartDetail.tsx`.
- Non-breaking baseline contract documented in `PART_DETAIL_REFRESH_BASELINE.md`.
- Part detail analytics extraction added:
  - `src/features/admin/hooks/usePartLaborFeedback.ts`
  - isolates part-linked job matching and labor feedback derivation.
- Financial guardrail hardening:
  - centralized part visibility helper added in `src/lib/priceVisibility.ts`:
    - `canViewPartFinancials(...)`
  - Part Detail now uses this guard for financial widgets/displays.
- Mobile/touch ergonomics improved on key actions:
  - larger back/action tap targets
  - improved Add/Edit action hit areas in materials/variant sections.
- Parts-to-jobs coupling remains preserved:
  - `parts:updated` dispatch continues from part updates and is consumed by job detail refresh paths.

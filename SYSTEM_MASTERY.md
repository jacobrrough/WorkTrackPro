# System Mastery Document

Verified against current implementation in `src/core/types.ts`, `src/services/api/*`, `src/App.tsx`, `src/AppContext.tsx`, and Supabase migrations in `supabase/migrations`.

## Backend model and exact relations

Runtime backend is Supabase. The `src/pocketbase.ts` module is a compatibility import facade that re-exports Supabase-backed services.

### Identity and access

#### `profiles`
- Fields: `id`, `email`, `name`, `initials`, `is_admin`, `is_approved`, `approved_at`, `approved_by`, `created_at`, `updated_at`
- Relations:
  - 1:N to `jobs.created_by`
  - 1:N to `shifts.user_id`
  - 1:N to `comments.user_id`
  - 1:N to `shift_edits.edited_by`
  - 1:N to `checklist_history.user_id`
  - 1:N to `inventory_history.user_id`
  - 1:N to `quotes.created_by`
  - 1:N to `organization_settings.updated_by`
  - self-reference via `approved_by`

### Jobs, inventory, allocations

#### `jobs`
- Fields: `id`, `job_code`, `po`, `name`, `qty`, `description`, `ecd`, `due_date`, `labor_hours`, `active`, `status`, `board_type`, `created_by`, `assigned_users`, `is_rush`, `workers`, `bin_location`, `part_number`, `part_id`, `variant_suffix`, `est_number`, `inv_number`, `rfq_number`, `owr_number`, `dash_quantities`, `revision`, `labor_breakdown_by_variant`, `machine_breakdown_by_variant`, `allocation_source`, `allocation_source_updated_at`, `created_at`, `updated_at`
- Relations:
  - 1:N `job_inventory.job_id`
  - 1:N `shifts.job_id`
  - 1:N `comments.job_id`
  - 1:N `attachments.job_id`
  - 1:N `checklists.job_id`
  - 1:N `inventory_history.related_job_id`
  - N:1 `parts` (`part_id`, plus legacy `part_number`)

#### `inventory`
- Fields: `id`, `name`, `description`, `category`, `in_stock`, `available`, `disposed`, `on_order`, `reorder_point`, `price`, `unit`, `has_image`, `image_path`, `barcode`, `bin_location`, `vendor`, `attachment_count`, `created_at`, `updated_at`
- Relations:
  - 1:N `job_inventory.inventory_id`
  - 1:N `part_materials.inventory_id`
  - 1:N `attachments.inventory_id`
  - 1:N `inventory_history.inventory_id`

#### `job_inventory`
- Fields: `id`, `job_id`, `inventory_id`, `quantity`, `unit`, `created_at`
- Relation role: N:M bridge for `jobs` and `inventory`

### Time and labor audit

#### `shifts`
- Fields: `id`, `user_id`, `job_id`, `clock_in_time`, `clock_out_time`, `lunch_start_time`, `lunch_end_time`, `lunch_minutes_used`, `notes`, `created_at`
- Relations: N:1 to `profiles`, N:1 to `jobs`, 1:N to `shift_edits`

#### `shift_edits`
- Fields: `id`, `shift_id`, `edited_by`, `previous_clock_in`, `new_clock_in`, `previous_clock_out`, `new_clock_out`, `reason`, `edit_timestamp`

### Collaboration and media

#### `comments`
- Fields: `id`, `job_id`, `user_id`, `text`, `created_at`

#### `attachments`
- Fields: `id`, `job_id`, `inventory_id`, `part_id`, `filename`, `storage_path`, `is_admin_only`, `created_at`
- Constraint: exactly one parent key (`job_id` xor `inventory_id` xor `part_id`)

### Checklists and history

#### `checklists`
- Fields: `id`, `job_id`, `status`, `items`, `created_at`, `updated_at`

#### `checklist_history`
- Fields: `id`, `checklist_id`, `user_id`, `item_index`, `item_text`, `checked`, `created_at`

### Quotes and financial modeling

#### `quotes`
- Fields: `id`, `product_name`, `description`, `material_cost`, `labor_hours`, `labor_rate`, `labor_cost`, `markup_percent`, `subtotal`, `markup_amount`, `total`, `line_items`, `reference_job_ids`, `notes`, `created_by`, `created_at`, `updated_at`

### Inventory audit

#### `inventory_history`
- Fields: `id`, `inventory_id`, `user_id`, `action`, `reason`, `previous_in_stock`, `new_in_stock`, `previous_available`, `new_available`, `change_amount`, `related_job_id`, `related_po`, `created_at`

### Parts and variant materials

#### `parts`
- Fields: `id`, `part_number`, `name`, `description`, `price_per_set`, `labor_hours`, `requires_cnc`, `cnc_time_hours`, `requires_3d_print`, `printer_3d_time_hours`, `set_composition`, `created_at`, `updated_at`

#### `part_variants`
- Fields: `id`, `part_id`, `variant_suffix`, `name`, `price_per_variant`, `labor_hours`, `requires_cnc`, `cnc_time_hours`, `requires_3d_print`, `printer_3d_time_hours`, `created_at`, `updated_at`

#### `part_materials`
- Fields: `id`, `part_id`, `part_variant_id` (legacy `variant_id` compatibility), `inventory_id`, `quantity_per_unit` (legacy `quantity` compatibility), `unit`, `usage_type`, `created_at`, `updated_at`
- Relation role: links parts/variants to inventory material requirements

### Admin/org settings and intake

#### `organization_settings`
- Fields: `id`, `org_key`, `labor_rate`, `material_upcharge`, `cnc_rate`, `printer_3d_rate`, `employee_count`, `overtime_multiplier`, `work_week_schedule`, `require_on_site`, `site_lat`, `site_lng`, `site_radius_meters`, `enforce_on_site_at_login`, `updated_by`, `created_at`, `updated_at`

#### `customer_proposals`
- Fields: `id`, `submission_id`, `contact_name`, `email`, `phone`, `description`, `status`, `linked_job_id`, `created_at`, `updated_at`

#### `customer_proposal_files`
- Fields: `id`, `proposal_id`, `filename`, `storage_path`, `content_type`, `size_bytes`, `public_url`, `created_at`

## Interaction flows and interconnectivity

### Inventory ↔ Jobs via `job_inventory`
- Allocation rows are created through `jobService.addJobInventory`.
- Display allocation is computed, not trusted from `inventory.available`.
- Canonical logic now comes from:
  - `src/lib/inventoryCalculations.ts`
  - `src/lib/inventoryState.ts`
- Active allocation statuses used for availability: `pod`, `rush`, `pending`, `inProgress`, `qualityControl`, `finished`.

### Available vs allocated and reconciliation on status changes
- Available is always computed as `max(0, inStock - allocated)`.
- `AppContext.updateJobStatus` now supports both directions:
  - transition to `delivered` -> stock consumed + `inventory_history.action = reconcile_job`
  - transition from `delivered` to non-delivered -> stock restored + `inventory_history.action = reconcile_job_reversal`
- Reconciliation planning logic is extracted to `src/lib/inventoryReconciliation.ts`.

### Inventory history logging
- Paths writing `inventory_history`:
  - manual stock change (`manual_adjust`)
  - allocation operation (`allocated_to_job`)
  - order placement (`order_placed`)
  - order receipt (`order_received`)
  - delivery reconciliation (`reconcile_job`)
  - delivery rollback (`reconcile_job_reversal`)
- Read path is `inventoryHistoryService.getHistory`.

### Time clock and shifts impact on jobs
- `clockIn(jobId)` creates a shift and auto-advances job status from `pending`/`rush` to `inProgress`.
- Lunch tracking updates shift records (`startLunch`, `endLunch`) and reporting values.
- No direct quantity mutation from shifts to inventory.

### Realtime subscriptions
- `src/services/api/subscriptions.ts` subscribes to `jobs`, `shifts`, `inventory` postgres changes.
- `AppContext` applies in-memory updates and triggers inventory refresh on job changes for allocation consistency.

### TanStack Query and server state
- Jobs, shifts, users, and inventory are fetched via `useQuery` in `AppContext` (query keys: `['jobs']`, `['shifts']`, `['users']`, `['inventory']`), enabled when the user is approved.
- Mutations use `queryClient.invalidateQueries` or `setQueryData`; realtime handlers update the cache. No duplicate fetch-on-mount for these lists.

### Offline time clock queue
- `src/lib/offlineQueue.ts`: failed clock-in/clock-out enqueues to localStorage; sync on `online` and mount. `OfflineIndicator` shows pending count in the dashboard header.

### Netlify functions
- `netlify/functions/` (e.g. `submit-proposal.js`) for serverless endpoints; proposal intake is public. Set env vars in Netlify for secrets.

### Navigation and application state flow
- Top-level route split: `/` public marketing vs `/app` employee app.
- Internal app navigation is custom view-state in `App.tsx` using `view`, `id`, and `returnViews`.
- `NavigationContext` persists to localStorage:
  - `searchTerm`
  - `inventorySearchTerm`
  - `partsSearchTerm`
  - `expandedCategories`
  - `scrollPositions`
  - `lastViewedJobId`
  - `minimalView`

### Validation, error handling, toasts, modals
- Validation helpers live in `src/core/validation.ts`.
- Mutation feedback pattern is toast-first via `useToast`.
- Modals mix reusable and inline implementations (`ConfirmDialog`, `QRScanner`, `FileViewer`, `AllocateToJobModal`, inline overlays).
- Error handling is primarily try/catch + console logging + toast fallback.

## Compatibility notes

- **`src/pocketbase.ts`** is a facade that re-exports Supabase-backed services from `src/services/api`. Keep this import path stable for any legacy imports.
- **Expand-style relationship shapes:** Services return job/inventory shapes that include `expand.job_inventory` (or `expand.job_inventory_via_job` for schema compat). UI and `inventoryCalculations.buildAllocatedByInventoryId` accept both; see `src/lib/inventoryCalculations.ts` and `src/services/api/schemaCompat.ts`.
- Keep schema fallback behavior in `src/services/api/schemaCompat.ts` for forward/backward compatibility with incremental migrations.

## Current navigation and view system

- Router shell exists, but feature navigation remains custom state-machine in `App.tsx`.
- Main views include:
  - `dashboard`
  - `job-detail`
  - `clock-in`
  - `inventory`
  - `inventory-detail`
  - `board-shop` / `board-admin`
  - `parts`
  - `part-detail`
  - `create-job`
  - `quotes`
  - `calendar`
  - `time-reports`
  - `admin-settings`
  - `trello-import`

## Inventory and parts pain points observed in code

1. `src/AppContext.tsx` is still large and combines auth, jobs, shifts, inventory orchestration.
2. `src/InventoryDetail.tsx` remains monolithic (scanner, edit form, history, attachments, linked-jobs in one file).
3. `src/features/admin/PartDetail.tsx` is large and high-coupling.
4. Mixed modal patterns and one-off overlays increase maintenance cost.
5. `inventory.available` still exists in schema but display uses computed values, requiring discipline across services/UI.
6. Some action clusters in list/detail views still duplicate controls (for example edit/history both entering same detail surface).
7. Limited test coverage around status transitions and stock reconciliation edge cases.

## Helpers and utilities to preserve/extend

- `src/lib/inventoryCalculations.ts`
- `src/lib/inventoryState.ts`
- `src/lib/inventoryReconciliation.ts`
- `src/lib/timeUtils.ts`
- `src/core/validation.ts`
- `src/lib/materialFromPart.ts`
- `src/lib/partDistribution.ts`
- `src/lib/priceVisibility.ts`
- `src/lib/jobWorkflow.ts`

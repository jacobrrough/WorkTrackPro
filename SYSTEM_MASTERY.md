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
  - 1:N to `boards.created_by`
  - 1:N to `board_members.user_id`
  - 1:N to `board_cards.assignee_id`
  - 1:1 to `user_encryption_keys.user_id`
  - 1:N to `conversations.created_by`
  - 1:N to `conversation_members.user_id`
  - 1:N to `messages.sender_id`
  - 1:N to `deliveries.created_by`
  - self-reference via `approved_by`
- Triggers:
  - `on_auth_user_created` → `handle_new_user()` (creates profile row)
  - `trg_create_notification_preferences` → `create_default_notification_preferences()` (creates default prefs row after profile insert)

### Jobs, inventory, allocations

#### `jobs`
- Fields: `id`, `job_code`, `po`, `name`, `qty`, `description`, `ecd`, `due_date`, `planned_completion_date`, `labor_hours`, `active`, `status`, `board_type`, `created_by`, `assigned_users`, `is_rush`, `workers`, `bin_location`, `part_number`, `part_id`, `variant_suffix`, `est_number`, `inv_number`, `rfq_number`, `owr_number`, `dash_quantities`, `revision`, `labor_breakdown_by_variant`, `machine_breakdown_by_variant`, `allocation_source`, `allocation_source_updated_at`, `progress_estimate_percent`, `cnc_completed_at`, `cnc_completed_by`, `printer3d_completed_at`, `printer3d_completed_by`, `created_at`, `updated_at`
- Relations:
  - 1:N `job_inventory.job_id`
  - 1:N `job_parts.job_id` (multi-part support)
  - 1:N `shifts.job_id`
  - 1:N `comments.job_id`
  - 1:N `attachments.job_id`
  - 1:N `checklists.job_id`
  - 1:N `deliveries.job_id`
  - 1:N `inventory_history.related_job_id`
  - N:1 `parts` (`part_id`, plus legacy `part_number`)
  - N:1 `profiles` (`cnc_completed_by`, `printer3d_completed_by`)

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
- Fields: `id`, `job_id`, `inventory_id`, `part_id`, `board_card_id`, `filename`, `storage_path`, `is_admin_only`, `created_at`
- Constraint: exactly one parent key (`job_id` xor `inventory_id` xor `part_id` xor `board_card_id`)

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

### Multi-part jobs

#### `job_parts`
- Fields: `id`, `job_id`, `part_id`, `dash_quantities` (jsonb), `sort_order`, `created_at`, `updated_at`
- Unique: (`job_id`, `part_id`)
- Relation role: N:M bridge for `jobs` and `parts`; allows a single job to link multiple parts, each with its own dash quantities

### Deliveries

#### `deliveries`
- Fields: `id`, `job_id`, `delivery_number`, `delivered_at` (date), `carrier`, `tracking_number`, `recipient_name`, `notes`, `line_items` (jsonb), `created_by`, `created_at`, `updated_at`
- Unique: (`job_id`, `delivery_number`)
- Relations: N:1 to `jobs`, N:1 to `profiles` (`created_by`)

### Custom boards

#### `boards`
- Fields: `id`, `name`, `description`, `created_by`, `visibility` (default 'private'), `created_at`, `updated_at`
- Relations: 1:N `board_columns`, 1:N `board_cards`, 1:N `board_members`, N:1 `profiles` (`created_by`)

#### `board_columns`
- Fields: `id`, `board_id`, `name`, `color`, `sort_order`, `created_at`, `updated_at`
- Relations: N:1 `boards`, 1:N `board_cards`

#### `board_cards`
- Fields: `id`, `board_id`, `column_id`, `title`, `description`, `assignee_id`, `due_date`, `color`, `sort_order`, `created_at`, `updated_at`
- Relations: N:1 `boards`, N:1 `board_columns`, N:1 `profiles` (`assignee_id`), 1:N `attachments` (`board_card_id`)

#### `board_members`
- Fields: `id`, `board_id`, `user_id`, `role` (default 'editor'), `created_at`
- Unique: (`board_id`, `user_id`)
- Relations: N:1 `boards`, N:1 `profiles`

### Encrypted chat

#### `user_encryption_keys`
- Fields: `id`, `user_id`, `public_key`, `encrypted_private_key`, `key_salt`, `key_iv`, `algorithm` (default 'ECDH-P256-AES-GCM'), `created_at`, `updated_at`
- Unique: (`user_id`)
- Relations: 1:1 `profiles`

#### `conversations`
- Fields: `id`, `type` (default 'direct'), `name`, `created_by`, `created_at`, `updated_at`
- Relations: N:1 `profiles` (`created_by`), 1:N `conversation_members`, 1:N `messages`

#### `conversation_members`
- Fields: `id`, `conversation_id`, `user_id`, `encrypted_conversation_key`, `key_iv`, `role` (default 'member'), `joined_at`, `left_at`
- Unique: (`conversation_id`, `user_id`)
- Relations: N:1 `conversations`, N:1 `profiles`

#### `messages`
- Fields: `id`, `conversation_id`, `sender_id`, `encrypted_content`, `content_iv`, `message_type` (default 'text'), `created_at`, `updated_at`, `deleted_at`
- Relations: N:1 `conversations`, N:1 `profiles` (`sender_id`), 1:N `message_receipts`, 1:N `message_attachments`

#### `message_receipts`
- Fields: `id`, `message_id`, `user_id`, `delivered_at`, `read_at`
- Unique: (`message_id`, `user_id`)
- Relations: N:1 `messages`, N:1 `profiles`

#### `message_attachments`
- Fields: `id`, `message_id`, `storage_path`, `encrypted_file_key`, `file_key_iv`, `file_iv`, `file_name`, `file_size`, `mime_type`
- Relations: N:1 `messages`

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
- `src/services/api/subscriptions.ts` provides granular subscription functions:
  - `subscribeToJobs()` — jobs table changes
  - `subscribeToShifts()` — shifts table changes
  - `subscribeToInventory()` — inventory table changes
  - `subscribeToJobRelated()` — consolidated: comments, attachments, job_parts, job_inventory, checklists, deliveries
  - `subscribeToBoardRelated()` — boards, board_columns, board_cards
  - `subscribeToParts()` — parts table changes
  - `subscribeToChatMessages()` — new/updated messages
  - `subscribeToChatReceipts()` — delivery/read receipts
  - `subscribeToChatMembers()` — conversation membership changes
  - `subscribeToConversationUpdates()` — conversation metadata
  - `subscribeToSystemNotifications()` — system notification events
- `AppContext` applies in-memory updates and triggers inventory refresh on job changes for allocation consistency.
- `useSystemNotificationSubscription` prepends new notifications to the infinite query cache and increments the unread count.

### Notification preferences flow
- `notificationPreferencesService` (`src/services/api/notificationPreferences.ts`) handles get/update with defaults merging.
- `useNotificationPreferences` hook uses TanStack Query with 5-min stale time (prefs change rarely).
- `useUpdateNotificationPreferences` uses optimistic mutation with rollback on error.
- `createNotificationIfEnabled` in `systemNotificationService` provides client-side preference gating (in addition to server-side `should_notify()` in triggers).
- Settings page accessible to all users via gear icon in NotificationBell dropdown → `notification-settings` view.

### TanStack Query and server state
- Jobs, shifts, users, and inventory are fetched via `useQuery` in `AppContext` (query keys: `['jobs']`, `['shifts']`, `['users']`, `['inventory']`), enabled when the user is approved.
- Mutations use `queryClient.invalidateQueries` or `setQueryData`; realtime handlers update the cache. No duplicate fetch-on-mount for these lists.

### Offline time clock queue
- `src/lib/offlineQueue.ts`: failed clock-in/clock-out enqueues to localStorage; sync on `online` and mount. `OfflineIndicator` shows pending count in the dashboard header.

### Netlify functions
- `netlify/functions/submit-proposal.js` — public proposal intake; validates Turnstile CAPTCHA, writes to `customer_proposals`, sends emails via Resend.
- `netlify/functions/boards-for-addon.js` — returns boards list for Gmail add-on; authenticates via `GMAIL_ADDON_API_KEY`.
- `netlify/functions/create-card-from-email.js` — creates a board card from email data; handles attachment upload to Supabase storage.

### Multi-part jobs via `job_parts`
- Jobs can link to multiple parts through the `job_parts` junction table. Each link stores its own `dash_quantities` (jsonb).
- The primary `part_id` on `jobs` is retained for backward compatibility; `job_parts` is the canonical multi-part source.
- `useMaterialSync` iterates all linked parts and calls `syncJobInventoryFromPart` for each, merging material requirements.
- UI: JobDetail shows a parts list; each part expands to show its dash quantities and material allocation.

### Deliveries workflow
- Deliveries are created per job via `deliveryService.createDelivery`.
- Each delivery has a sequential `delivery_number` (unique per job), `line_items` (jsonb array of items/quantities shipped), and optional carrier/tracking info.
- Packing slip generation renders delivery details for printing.
- When a job reaches `delivered` status, inventory reconciliation runs as before; deliveries provide the shipment audit trail.

### Custom boards
- Boards are created by any user; `board_members` controls who can view/edit.
- Board columns are ordered by `sort_order`; cards within columns also use `sort_order`.
- Card CRUD: create, update (title, description, assignee, due date, color), move between columns (drag-drop updates `column_id` + `sort_order`), delete.
- Card attachments use the existing `attachments` table with `board_card_id` as the parent key.
- Realtime: `subscribeToBoardRelated()` listens to `boards`, `board_columns`, `board_cards` postgres changes.

### Chat encryption flow
- **Key generation:** On first login (or when no keys exist), the client generates an ECDH P-256 key pair. The private key is encrypted with a key derived from the user's password (PBKDF2 → AES-GCM) and stored in `user_encryption_keys` alongside the public key.
- **Conversation creation:** Creator generates a random AES-GCM conversation key, encrypts it with each member's public key, and stores per-member in `conversation_members.encrypted_conversation_key`.
- **Send message:** Sender decrypts the conversation key with their private key, encrypts the message content with AES-GCM, writes to `messages.encrypted_content` + `content_iv`.
- **Receive message:** Recipient decrypts conversation key → decrypts message. Delivery/read receipts tracked in `message_receipts`.
- **Key recovery:** On password reset, the user's private key is re-encrypted with the new password-derived key. `useCryptoKeys` hook manages key cache and auto-unlock.
- **Attachments:** Files are encrypted with a per-file key; the file key is encrypted with the conversation key and stored in `message_attachments`.

### Gmail Add-on flow
- Google Apps Script add-on (`gmail-addon/`) provides a sidebar in Gmail.
- User selects a board → add-on calls `boards-for-addon` Netlify function to fetch available boards.
- On "Create Card", add-on calls `create-card-from-email` with email subject, body snippet, and attachments.
- Netlify function authenticates via `GMAIL_ADDON_API_KEY`, creates a `board_cards` row, and uploads attachments to Supabase storage.

### System notifications
- Notification types: `job_overdue`, `job_rush`, `low_stock`, `chat_message`, `mention`, `job_status_change`.
- Delivered via the chat system as system messages in a dedicated system conversation.
- `useSystemNotifications` hook subscribes to realtime notifications and updates the notification bell count.
- Triggers are evaluated client-side (e.g., job overdue check on dashboard load, low stock on inventory mutation).

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
  - `scanner`
  - `inventory`
  - `inventory-detail`
  - `board-shop` / `board-admin`
  - `boards` (custom boards list)
  - `board-detail` (individual custom board)
  - `board-card-detail`
  - `chat` (conversation list)
  - `chat-conversation` (individual conversation)
  - `parts` (admin)
  - `part-detail` (admin)
  - `create-job` (admin)
  - `quotes` (admin)
  - `calendar` (admin)
  - `time-reports`
  - `admin-settings` (admin)
  - `trello-import` (admin)

## Known pain points

1. `src/AppContext.tsx` is still large and combines auth, jobs, shifts, inventory orchestration.
2. `src/InventoryDetail.tsx` remains monolithic (scanner, edit form, history, attachments, linked-jobs in one file).
3. `src/features/admin/PartDetail.tsx` is large and high-coupling (see SYSTEM_MASTERY_PARTS_v2.md for detailed audit).
4. Mixed modal patterns and one-off overlays increase maintenance cost.
5. `inventory.available` still exists in schema but display uses computed values, requiring discipline across services/UI.
6. Some action clusters in list/detail views still duplicate controls (for example edit/history both entering same detail surface).
7. Limited test coverage around status transitions and stock reconciliation edge cases.
8. Parts calculation logic has been consolidated into `partsCalculations.ts` but some callers may still import from individual modules directly.

## Helpers and utilities to preserve/extend

- `src/lib/inventoryCalculations.ts` — allocated/available stock math
- `src/lib/inventoryState.ts` — inventory display state derivation
- `src/lib/inventoryReconciliation.ts` — delivery reconciliation planning
- `src/lib/timeUtils.ts` — shift duration, formatting, reporting helpers
- `src/core/validation.ts` — input validation helpers
- `src/lib/materialFromPart.ts` — `computeRequiredMaterials`, `syncJobInventoryFromPart`
- `src/lib/partsCalculations.ts` — single source of truth re-exporting all part calculation functions with safe quantity handling
- `src/lib/calculatePartQuote.ts` — material + labor + CNC + 3D cost per part/variant
- `src/lib/partDistribution.ts` — set/variant price, labor, CNC distribution
- `src/lib/variantPricingAuto.ts` — variant labor/CNC/3D targets from set composition
- `src/lib/variantMath.ts` — `quantityPerUnit` normalization, dash suffix helpers
- `src/lib/priceVisibility.ts` — shop-floor price hiding
- `src/lib/jobWorkflow.ts` — status transitions and workflow logic
- `src/lib/jobProgress.ts` — progress estimation and at-risk flagging
- `src/lib/formatJob.ts` — job display formatting, `calculateSetCompletion`
- `src/lib/offlineQueue.ts` — offline time clock punch queue
- `src/lib/exportCsv.ts` — CSV export for reports
- `src/lib/crypto/` — E2E encryption: ECDH key generation, AES-GCM encrypt/decrypt, key cache

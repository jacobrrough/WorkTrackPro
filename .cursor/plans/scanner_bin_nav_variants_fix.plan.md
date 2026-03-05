# Surgical fix plan: Scanner bin, navigation loop, variant quantities, bin removal, scanner access, calendar, CNC mark-done revert

## 1. Fix removing bin locations (bin location clear not working)

**Current state**
- Clearing a bin location (setting it to empty) sends `binLocation: undefined` or empty string from the UI. The update API previously only wrote `bin_location` when `data.binLocation !== undefined`, so the key was omitted from the PATCH and the database kept the old value.

**Fix (API – already implemented in codebase)**
- In [src/services/api/jobs.ts](src/services/api/jobs.ts) and [src/services/api/inventory.ts](src/services/api/inventory.ts), the update logic uses `if ('binLocation' in data)` so that when the payload includes the key (even with `undefined` or `''`), the API sets `row.bin_location = (data.binLocation ?? '').toString().trim() || null`, i.e. clears the column when the value is empty.

**Plan items**
- **Verify** the above API behavior is present and deployed so that clearing bin location from Dashboard (uncheck), JobDetail (clear field + save), InventoryDetail (clear field + save), and AdminSettings “Clear shelf” all persist. If any call path omits the `binLocation` key when clearing, ensure it explicitly includes the key (e.g. `binLocation: undefined` or `binLocation: null`) so the API clears the value.
- **UI consistency**: Ensure every “remove/clear bin” action (Dashboard bin results uncheck, job edit form clear + save, inventory edit form clear + save, BinLocationScanner clear, AdminSettings clear shelf) sends an update that includes `binLocation` (with empty/null/undefined value). No separate “remove” API is required if the update API correctly clears when the key is present and value empty.

---

## 2. All QR code scanners accessible to all users

**Goal**
- Every QR/barcode scanner in the app (bin, job, inventory, barcode) is usable by all authenticated users, not only admins.

**Current state**
- **Scanner tab** (ScannerScreen): No role check; all users can open it. Scanner tab does not yet show full bin results (see section 5).
- **Dashboard** scanner (floating button): No admin gate; all users can open it.
- **JobDetail**: When the job has no bin location, the “Add Bin Location” button is shown only to admins (`{!job.binLocation && currentUser.isAdmin && (` in [src/JobDetail.tsx](src/JobDetail.tsx) ~2500). When the job already has a bin, the button to open the bin scanner is shown to everyone.
- **KanbanBoard**: Bin scan button on job cards is not behind isAdmin; all users can use it.
- **InventoryKanban**: Bin scan button on inventory cards is not behind isAdmin; all users can use it.
- **InventoryDetail**: Barcode and bin location scanners live inside the **edit form**. Only admins see “Edit” and can enter edit mode, so only admins can open those scanners from InventoryDetail.

**Plan items**
- **JobDetail**: Remove the admin-only gate on the “Add Bin Location” button so that when a job has no bin location, all users see and can use the “Add Bin Location” control (which opens BinLocationScanner). File: [src/JobDetail.tsx](src/JobDetail.tsx) — change or remove the `currentUser.isAdmin &&` condition around the “Add Bin Location” button (~2500).
- **InventoryDetail**: Make bin (and optionally barcode) scanning available to all users. Options: (a) Add a “Set bin location” / “Scan bin” action on the view-only screen that opens the bin scanner and calls `onUpdateItem` with only `binLocation` (no full edit mode); or (b) Allow a limited “edit bin/barcode only” mode for all users. Same for barcode if desired. File: [src/InventoryDetail.tsx](src/InventoryDetail.tsx).
- **Job card scanners (easy binning)**: All users must be able to **see and use the bin scanner on job cards** for easy binning. (1) **Kanban board**: The bin scan button on each job card ([src/KanbanBoard.tsx](src/KanbanBoard.tsx) lines 814–826) is already outside the `isAdmin` block and is shown on both shop floor and admin boards; ensure it remains visible and that `onUpdateJob` is passed from App (it is) so scans persist. (2) **Job detail**: When a job has no bin, the “Add Bin Location” button is currently admin-only (see above); when it has a bin, the button is already for everyone. Removing the admin gate for “Add Bin Location” (already in plan) completes job-card scanner access so all users can set/change bin from job cards (Kanban) and from job detail.
- **Audit**: After changes, confirm no other scanner entry point (QRScanner, BinLocationScanner, or scan buttons) is gated by `isAdmin` or `currentUser.isAdmin` unless there is an explicit product reason.

---

## 3. Robust scanner + full bin functionality for all users

**Current state**
- **Scanner tab** ([src/ScannerScreen.tsx](src/ScannerScreen.tsx)): Scans job, inventory, or bin; for a bin it only shows a toast and does not open any bin management UI.
- **Dashboard scanner** ([src/Dashboard.tsx](src/Dashboard.tsx) ~499–677): When a bin is scanned, it opens a full-screen “Bin {location}” modal with: list of jobs at bin, list of inventory at bin, uncheck to remove from bin, and “Add job to this bin”. This is the desired “move, replace, remove” behavior but is only reachable from the Dashboard’s floating scanner button.

**Goal**
- All users can use the **Scanner tab** and get the same bin behavior: after scanning a bin, show the same “Bin results” experience (list jobs/inventory at bin, remove from bin, add job to bin).

**Approach**
- Extract a shared “Bin results” UI (e.g. `BinResultsView`) that receives: `binLocation`, `jobs`, `inventory`, `onUpdateJob`, `onUpdateInventoryItem`, `onRefreshJobs`, `onRefreshInventory`, `onNavigate`, `onClose`.
- **ScannerScreen**: When a scan matches the bin pattern, set local state `scannedBinLocation` and render the same bin-results UI. Pass in update/refresh handlers from App (add props to ScannerScreen).
- **Dashboard**: Optionally refactor to use the shared component.
- **Access**: Scanner tab is already available to all users; no extra role check needed beyond making the bin flow work from that tab.

**Files to touch**
- New shared component, e.g. [src/components/BinResultsView.tsx](src/components/BinResultsView.tsx).
- [src/ScannerScreen.tsx](src/ScannerScreen.tsx): Handle bin scan → show BinResultsView; add props for update/refresh.
- [src/App.tsx](src/App.tsx): Pass update/refresh callbacks into ScannerScreen.
- [src/Dashboard.tsx](src/Dashboard.tsx): Optionally use BinResultsView for the existing bin modal.

---

## 4. Fix navigation loop (job ↔ inventory when selecting material)

**Current state**
- [src/App.tsx](src/App.tsx) uses a single **return view per detail type**; each navigation to a detail **overwrites** that key. So after Job A → material → Inventory → “Used on jobs” → Job B, Back from Job B goes to Inventory, Back from Inventory goes to Job A, and repeating Back can oscillate (navigation loop).

**Goal**
- Back follows real navigation history (stack).

**Approach**
- Replace the single `returnViews` map with a **back stack** (array of `{ view, id? }`). When navigating **to** a detail view, **push** the current (view, id) onto the stack. When the user presses **Back** on a detail screen, **pop** and navigate to that entry; if stack is empty, use fallback (e.g. dashboard / inventory list).

**Files to touch**
- [src/App.tsx](src/App.tsx): Replace `returnViews` with `backStack`; in `handleNavigate` push when going to a detail view; in `navigateBackFrom` pop and navigate.

---

## 5. Variant & quantities UI/UX in edit job (better grouping and clarity)

**Current state**
- In [src/JobDetail.tsx](src/JobDetail.tsx) edit mode, the “Variants & quantities” block shows per-variant inputs labeled only with `variant.variantSuffix` (e.g. `-01`, `-05`), so it’s unclear which part–dash each field is.

**Goal**
- Clear grouping and labels so each quantity is obviously for a specific part–variant (e.g. SK-F35-0911-01).

**Approach**
- **Labels**: Show full identifier `{linkedPart.partNumber}{toDashSuffix(variant.variantSuffix)}` and optionally `variant.name` (e.g. `SK-F35-0911-01 (Short)`).
- **Layout**: Stacked layout per variant: label on top, then quantity input with “Qty”/“Units” hint; keep mobile-friendly tap targets.
- **Grouping**: Keep “Variants & quantities” and “Input by: Full sets | Variants”; add clear visual grouping for per-variant inputs (e.g. “Per-variant quantities” or bordered group).
- **Accessibility**: `aria-label` with full part–dash (e.g. “Quantity for SK-F35-0911-01”).

**Files to touch**
- [src/JobDetail.tsx](src/JobDetail.tsx): Per-variant block (~1902–1920): stacked label (partNumber + toDashSuffix + optional name), input, optional “Qty” hint; update aria-label.

---

## 6. Calendar not updating when new jobs are added

**Current state**
- The Calendar ([src/features/admin/Calendar.tsx](src/features/admin/Calendar.tsx)) receives `jobs` as a prop from App, which comes from React Query `['jobs']` in [src/AppContext.tsx](src/AppContext.tsx).
- When a new job is created via AdminCreateJob, `createJob` in AppContext does an optimistic update: `queryClient.setQueryData<Job[]>(['jobs'], (prev) => prev ? dedupeJobsById([job, ...prev]) : [job])`. So the cache is updated, but the Calendar may not re-render with the new list if the component tree or React Query behavior doesn’t propagate the update (e.g. when the user is on a different view and then navigates to the calendar, or when the new job is missing fields the Calendar depends on).
- The Calendar only shows jobs that have `dueDate`, are `active`, and are not paid/delivered/projectCompleted. It also requires `requiredHours > 0` (from labor or machine hours) for jobs to appear in the capacity-aware schedule ([src/features/admin/Calendar.tsx](src/features/admin/Calendar.tsx) laborForwardInputs, cncScheduleInputs, etc.). So newly created jobs without a due date or without labor/machine hours never appear on the calendar.
- There is no refetch when the user navigates to the calendar view, so if jobs were created in another tab or before the calendar mounted, the calendar might show stale data. React Query has a global `staleTime: 60_000` in [src/index.tsx](src/index.tsx), so the jobs query may not refetch when switching to the calendar.

**Goal**
- The calendar updates and adapts when the user adds new jobs: new jobs with due dates and hours appear on the calendar, and the calendar view reflects the latest job list when opened or when jobs are created/updated.

**Approach**
- **Refetch on calendar view**: When the Calendar view is shown, trigger a jobs (and optionally shifts) refetch so the calendar always displays up-to-date data. In [src/App.tsx](src/App.tsx), when `view === 'calendar'`, run `refreshJobs()` (and optionally `refreshShifts()`) in a `useEffect` that depends on `view`, or pass `refreshJobs`/`refreshShifts` to Calendar and call them in Calendar’s `useEffect` on mount.
- **Optimistic create**: Ensure the job returned from `jobService.createJob` includes all fields the Calendar needs (`dueDate`, `ecd`, `laborHours`, `active`, machine breakdowns if any). If the API returns a minimal job, the optimistic `setQueryData` might be missing `dueDate` or other fields, so the Calendar’s filters would exclude the new job. Verify the create payload and API response so the cached job has the right shape.
- **New jobs without due date**: Either document that jobs need a due date to appear on the calendar, or add a section/indicator for “Undated jobs” (optional, scope as needed).
- **Past-due jobs first**: The calendar currently sorts `jobTimelines` only by `endDate` ([src/features/admin/Calendar.tsx](src/features/admin/Calendar.tsx) line 262: `.sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime())`). Each timeline already has `scheduleRisk`: `'overdue'` (due date passed), `'behind'`, `'atRisk'`, or `null`. Change the sort so that **overdue jobs come first**, then “behind”, then “at risk”, then on-time; within each group sort by end date (or by due date for overdue so the most overdue appear first). That way past-due jobs are always shown first in the list and in day cells. File: [src/features/admin/Calendar.tsx](src/features/admin/Calendar.tsx) — replace the single endDate sort with a composite sort: first by scheduleRisk priority (overdue &gt; behind &gt; atRisk &gt; null), then by endDate or due date within the same risk.
- **Finished jobs not removed / refresh on status change**: The calendar filters out jobs with `status === 'paid' | 'projectCompleted' | 'delivered'` or `!active` ([src/features/admin/Calendar.tsx](src/features/admin/Calendar.tsx) lines 79–87), but the list it receives (`allJobs`) may not update when a job is marked finished, so finished jobs can still appear. Ensure that **marking a job as finished (paid, delivered, projectCompleted, or inactive) triggers a jobs refresh** so the calendar’s data updates and those jobs disappear. In [src/AppContext.tsx](src/AppContext.tsx), `updateJobStatus` already calls `refreshJobs()` after a status change (lines 437–438); verify that this runs for all “finished” statuses and that no other code path updates status without invalidating/refetching jobs. In addition, **refetch when opening the calendar** (already in plan) so that if the user marked a job finished elsewhere and then opens the calendar, the list is up to date and finished jobs are removed.

**Files to touch**
- [src/App.tsx](src/App.tsx): When `view === 'calendar'`, trigger `refreshJobs()` (and optionally `refreshShifts()`) on entering the view (e.g. `useEffect` depending on `view`), or pass `refreshJobs`/`refreshShifts` to Calendar and call them in Calendar’s `useEffect` on mount.
- [src/features/admin/Calendar.tsx](src/features/admin/Calendar.tsx): (1) Accept optional `refreshJobs`/`refreshShifts` and call in `useEffect` on mount so the calendar refetches when opened (and finished jobs are removed). (2) Change `jobTimelines` sort to put past-due jobs first: sort by scheduleRisk priority (overdue, then behind, then atRisk, then null), then by end date (or due date for overdue) within each group.
- [src/AppContext.tsx](src/AppContext.tsx): Confirm `createJob` optimistic update uses the full job returned from the API (including `dueDate`, `ecd`, etc.) so new jobs with due dates appear on the calendar after create. Verify that **updateJobStatus** (and any path that sets a job to paid/delivered/projectCompleted or active=false) always calls **refreshJobs()** so the calendar and other views drop finished jobs; fix any path that updates status without refreshing.

---

## 7. CNC / machine time “Mark as done” sometimes reverts to not done

**Current state**
- In [src/JobDetail.tsx](src/JobDetail.tsx), the CNC “Mark Done” / “Mark Pending” button calls `onUpdateJob(job.id, { cncCompletedAt, cncCompletedBy })` ([src/JobDetail.tsx](src/JobDetail.tsx) ~1512–1516). [src/AppContext.tsx](src/AppContext.tsx) `updateJob` merges the returned job with the requested CNC fields and updates the cache (lines 308–324), and the comment in JobDetail says not to refetch because “Refetch would overwrite cache with API response that may omit cnc_completed_at” (line 1520).
- Despite that, the UI sometimes reverts to “not done”. Likely cause: the **job-detail** view uses a separate query `['job', jobId]` that fetches via `jobService.getJobById`. When that query refetches (e.g. on window focus, or when the jobs list is invalidated), the effect in [src/App.tsx](src/App.tsx) (lines 121–126) merges `detailJob` into the `['jobs']` list by replacing the job with `detailJob`. If the API (Supabase/PostgREST) returns the row **without** `cnc_completed_at` / `cnc_completed_by` (e.g. schema cache not including those columns, similar to the `part_id` issue in AGENTS.md), the merged job overwrites the correct cached state and the button shows “not done” again.

**Goal**
- After marking CNC (or machine time) as done, the state must stay “done” and not revert when the job is refetched or when the user switches views and comes back.

**Approach**
- **Preserve CNC state when merging refetched job**: In [src/App.tsx](src/App.tsx), when merging `detailJob` into the `['jobs']` cache (the `useEffect` that runs on `detailJob`), **do not overwrite** `cncCompletedAt` / `cncCompletedBy` with values from `detailJob` if the refetched job has them null/undefined but the **existing** job in the cache has them set. That is, merge so that we keep the existing cache’s CNC done state when the refetched payload is missing it (client-side “heal” so a stale API response doesn’t wipe the state).
- **Optional – server**: If Supabase/PostgREST sometimes omits `cnc_completed_at` / `cnc_completed_by` from select responses, run `NOTIFY pgrst, 'reload schema';` in the Supabase SQL Editor (as in AGENTS.md for `part_id`) so the API consistently returns these columns.
- **Optional – schemaCompat**: If there is a schema-heal path for jobs (e.g. in [src/services/api/schemaCompat.ts](src/services/api/schemaCompat.ts)), ensure `cnc_completed_at` and `cnc_completed_by` are included in any job column healing so refetches never strip them.

**Files to touch**
- [src/App.tsx](src/App.tsx): In the `useEffect` that sets `['jobs']` from `detailJob`, when replacing the job with `detailJob`, preserve `cncCompletedAt` and `cncCompletedBy` from the previous cached job for that id if the incoming `detailJob` has them null/undefined and the previous job had them set (so refetch doesn’t revert “mark as done”).
- Optionally: document or add schema reload / schemaCompat for `cnc_completed_at` and `cnc_completed_by` so API responses always include them.

---

## Order of implementation

| # | Task | Notes |
|---|------|--------|
| 1 | Bin removal: verify API + all UI paths send `binLocation` when clearing | Quick verification / small fixes |
| 2 | Scanner access: remove JobDetail “Add Bin” admin gate; add InventoryDetail bin (and optionally barcode) for all users | Low–medium |
| 3 | Calendar: refetch when opening; past-due first sort; verify createJob cache; verify marking job finished triggers refresh so finished jobs are removed | Low–medium |
| 4 | Back stack in App.tsx (replace returnViews with push/pop) | Medium |
| 5 | BinResultsView + ScannerScreen bin flow + App props | Medium |
| 6 | Variant & quantities UI in JobDetail (labels, stacking, grouping) | Low |
| 7 | CNC/machine “Mark as done” revert: preserve cncCompletedAt/cncCompletedBy when merging refetched job in App | Low |

---

## Summary

- **Bin removal**: Rely on API that uses `'binLocation' in data` to clear; ensure every clear path (Dashboard, JobDetail, InventoryDetail, AdminSettings) includes the key in the payload.
- **Scanner access**: All users can use all QR scanners — remove JobDetail “Add Bin Location” admin gate; add bin (and optionally barcode) scan for non-admins on InventoryDetail. **All users must be able to see and use job card bin scanners** (Kanban job cards and Job detail) for easy binning; verify Kanban scan button stays visible to all and Job detail “Add Bin Location” is available to all.
- **Scanner + bin**: Reuse “Bin results” (view/remove/add job at bin) from Dashboard in the Scanner tab via a shared component.
- **Navigation loop**: Replace single return-view with a back stack; push on navigate to detail, pop on Back.
- **Variant quantities**: In JobDetail edit, show part number + dash (+ optional variant name) per row and use a stacked label-above-input layout with a “Qty” hint.
- **Calendar**: Refetch jobs (and shifts) when the calendar view is opened so new/updated jobs appear and **finished jobs are removed**; ensure createJob optimistic update includes dueDate/ecd so new jobs show when they have dates and hours. Ensure **marking a job as finished (paid, delivered, projectCompleted, or inactive) triggers a refresh** so the calendar stops showing that job. Sort job timelines so **past-due (overdue) jobs appear first**, then behind, then at risk, then on-time (within each group by end/due date).
- **CNC/machine “Mark as done” revert**: Preserve `cncCompletedAt` and `cncCompletedBy` when merging the refetched job into the jobs list in App so a stale API response does not overwrite the cached “done” state; optionally reload Supabase schema or heal columns so API always returns these fields.

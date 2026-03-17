# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

WorkTrack Pro is a job, inventory & time-tracking SaaS for manufacturing. Single-package Vite + React 19 + TypeScript + Tailwind CSS frontend backed by **hosted Supabase only** (auth, DB, storage). No PocketBase or local server in repo. Hosting: Netlify (auto-deploy from GitHub). See `README.md` for full feature list and available npm scripts.

### Environment variables

**Single template:** `.env.example` (copy to `.env.local` for local dev). The app requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local` (gitignored). Cursor Cloud injects these via the update script.

The update script writes from injected shell env vars into `.env.local`. A `sed` strip removes any accidental `VITE_SUPABASE_URL=` prefix (safe no-op if already correct).

**Vite env priority:** Shell environment variables override `.env.local`. The update script unsets `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from the shell after writing `.env.local` so Vite reads the file values.

### Running the dev server

```bash
npm run dev          # Vite dev server on http://localhost:3000
```

### Authentication

Test login credentials are available as `TEST_LOGIN_USERNAME` and `TEST_LOGIN_PASSWORD` secrets. The test account is already confirmed and approved as admin.

The Supabase instance has email confirmation enabled. If the test account ever needs to be re-created or a new test account is needed, use the `SUPABASE_SERVICE_ROLE_KEY` secret with the admin API to:
1. Confirm email: `PUT /auth/v1/admin/users/{id}` with `{"email_confirm": true}`
2. Approve + grant admin: `PATCH /rest/v1/profiles?id=eq.{id}` with `{"is_approved": true, "is_admin": true}`

### Key commands

| Task | Command |
|------|---------|
| Dev server | `npm run dev` |
| Lint | `npm run lint` |
| Format | `npm run format` |
| Test | `npm run test` |
| Build | `npm run build` |

### App routes

- **`/`** — Public landing page (Rough Cut Manufacturing)
- **`/app`** — Employee login → WorkTrack Pro dashboard (SPA)

Internal app navigation is view-state (not URL path). Main views:

| View | Description |
|------|-------------|
| `dashboard` | Home: active shift, quick links (Jobs, Inventory, Parts, Quotes, Boards), notifications |
| `job-detail` | Job detail (materials, comments, attachments, checklists, status) |
| `clock-in` | Time clock (pick job, clock in/out, lunch) |
| `scanner` | QR/barcode scanner (inventory, job, bin) |
| `inventory` | Inventory list; add item, search, categories |
| `inventory-detail` | Single item: stock, history, attachments, allocate to job |
| `board-shop` | Shop-floor Kanban |
| `board-admin` | Admin Kanban |
| `parts` | Parts list (admin) |
| `part-detail` | Part/variants, materials, quote calculator (admin) |
| `create-job` | Create job from part (admin) |
| `quotes` | Quotes list and editor (admin) |
| `time-reports` | Labor by job/employee, CSV export (admin) |
| `calendar` | Calendar view (admin) |
| `admin-settings` | Org settings, labor rates, on-site rules (admin) |
| `trello-import` | Trello import (admin) |

Sign-up is available from the login page. **Navigation:** Internal app uses view-state (e.g. `dashboard`, `job-detail`, `inventory`) and `handleNavigate` from App; no URL path per view. State (search, filters, scroll, last job, minimal view, active tab) is persisted via `NavigationContext`.

### Architecture (refactored)

- **Auth:** `AuthContext` (`useAuth()`) — currentUser, login, signUp, logout, auth refresh, idle timeout.
- **Server state:** `useAppQueries(enabled)` — jobs, shifts, users, inventory + refresh fns.
- **Derived:** `useActiveShift`, `useInventoryAllocation` — activeShift, activeJob, calculateAvailable/Allocated.
- **Mutations:** `useJobMutations`, `useClockMutations`, `useInventoryMutations`, `useAttachmentMutations` — composed in `AppContext`; public API remains `useApp()`.
- **Attachments:** Job and inventory file lists support delete (admin) via `AttachmentsList` `canDelete` / `onDeleteAttachment`; toast feedback.
- **Allocation guard:** Supabase trigger `job_inventory_allocate_guard` prevents allocating more than `in_stock` (race-safe). Migration: `supabase/migrations/20260313000001_job_inventory_allocate_guard.sql`.
- **Backups:** See `docs/BACKUP.md` for Supabase backup and PITR notes.

### Notes

- TypeScript type-checking (`tsc --noEmit`) is intentionally disabled in CI. Only ESLint + Vite build are used for validation.
- Vite may enable HTTPS/proxy when `key.pem`/`cert.pem` exist; in Cloud Agent these don't exist, so dev server runs on plain HTTP — fine.
- Supabase is cloud-hosted (no local Supabase CLI required). Migrations in `supabase/migrations/` are reference only; apply in Supabase SQL Editor or via CLI.
- Trello proxy (`npm run trello-proxy`) is optional and only needed for Trello import.

### When to use explore / agents

- **Broad exploration** (e.g. “how does X work?”, “find all usages of Y”): use the **explore** agent with a clear prompt.
- **Specific lookups** (known file or symbol): use grep, read_file, or codebase search directly.

### Troubleshooting: Jobs not linking to parts (BOM / labor gone)

**Root cause:** Supabase’s PostgREST schema cache can become stale. If it doesn’t know about the `jobs.part_id` column, the API rejects writes that include `part_id`. The app’s schema fallback then treats `part_id` as “missing” and strips it from future writes, so job–part links and BOM/labor stop working.

**Server-side fix (do this first):** In the [Supabase SQL Editor](https://supabase.com/dashboard), run:

```sql
NOTIFY pgrst, 'reload schema';
```

Then hard-refresh the app (Ctrl+F5). The app also heals the client-side “omit” cache and repairs jobs that have `part_number` but null `part_id` when loading the job list or opening a job.

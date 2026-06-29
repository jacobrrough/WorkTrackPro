# AGENTS.md

## Project setup & environment

### Project overview

WorkTrack Pro is a job, inventory & time-tracking SaaS for manufacturing. Single-package Vite + React 19 + TypeScript + Tailwind CSS frontend backed by **hosted Supabase only** (auth, DB, storage). No PocketBase or local server in repo. Hosting: Netlify (auto-deploy from GitHub). See `README.md` for full feature list and available npm scripts.

> **Where does code live? Read `docs/CODE_MAP.md` FIRST.** It maps features → file + symbol
> anchor for the data layer, contexts, and the big 2k–4k-line screens (JobDetail, PartDetail,
> KanbanBoard, accounting). **Grep the anchor and ranged-read; never read those files whole.**

> **Claude/AI users:** install the project context skill once with `node scripts/sync-wtp-skill.mjs`
> (no UI — installs to `~/.claude/skills/`), then invoke `/worktrackpro-context` for full domain context.

### Environment variables

**Single template:** `.env.example` (copy to `.env.local` for local dev). The app requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local` (gitignored). Cloud-agent setups may inject these via a setup script.

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
| `boards` / `board-detail` / `board-card-detail` | Custom kanban boards (standalone) |
| `chat` / `chat-conversation` | E2E encrypted chat + system notifications |

Sign-up is available from the login page. **Navigation:** Internal app uses view-state (e.g. `dashboard`, `job-detail`, `inventory`) and `handleNavigate` from App; no URL path per view. State (search, filters, scroll, last job, minimal view, active tab) is persisted via `NavigationContext`.

### Architecture (refactored — completed)

The AppContext refactor has been executed:

- **Auth:** `AuthContext` (`useAuth()`) — currentUser, login, signUp, logout, password reset, session expiry guards, idle timeout, + E2E key unlock/generation for chat.
- **Server state:** `useAppQueries(enabled)` — the 4 core TanStack queries (jobs, shifts, users, inventory) with smart refreshers (including part-data healing).
- **Derived:** `useActiveShift`, `useInventoryAllocation`.
- **Mutations:** Domain hooks (`useJobMutations`, `useClockMutations`, `useInventoryMutations`, `useAttachmentMutations`, `useBoardMutations`, `useChatMutations`, `useDeliveryMutations`, etc.) composed in the thin `AppContext` (public `useApp()` facade preserved for minimal churn).
- **Realtime:** Debounced Supabase subscriptions (jobs scalars + job-related tables, shifts, inventory, boards, parts) wired in AppContext.
- **Attachments:** Job and inventory file lists support delete (admin) via `AttachmentsList` `canDelete` / `onDeleteAttachment`; toast feedback.
- **Allocation guard:** Supabase trigger `job_inventory_allocate_guard` prevents allocating more than `in_stock` (race-safe).
- **Schema resilience:** `schemaCompat.ts` + runtime column stripping + client healing for PostgREST cache staleness after migrations.
- **Navigation state:** `NavigationContext` persists searches, filters, scroll positions, quick-action order, minimalView, etc. in localStorage.
- **Backups:** See `docs/BACKUP.md` for Supabase backup and PITR notes.

**Deep reference docs (highly recommended):**
- `docs/SYSTEM_MASTERY.md` — verified DB schema, relations, RLS, encryption, job workflow.
- `docs/JOB_AND_PART_DATA_FLOW.md`, `docs/PART_DETAIL_AUTO_CALCULATIONS.md`, etc.
- `docs/CODE_MAP.md` — feature → file + symbol-anchor routing map (read before exploring).
- `docs/DOMAIN_RULES.md` — durable rates ($175/hr labor, $150/hr CNC), security & inventory safeguards, job invariants.

### Notes

- TypeScript type-checking (`tsc --noEmit`) is intentionally disabled in CI. Only ESLint + Vite build are used for validation.
- Vite may enable HTTPS/proxy when `key.pem`/`cert.pem` exist; in Cloud Agent these don't exist, so dev server runs on plain HTTP — fine.
- Supabase is cloud-hosted (no local Supabase CLI required). Migrations in `supabase/migrations/` are reference only; apply in Supabase SQL Editor or via CLI.
- Trello proxy (`npm run trello-proxy`) is optional and only needed for Trello import.
- Realtime uses a custom debouncer (`lib/realtimeDebounce.ts`) to avoid UI stutter on high-frequency updates. Schema compatibility layer gracefully handles PostgREST cache staleness after migrations (see `services/api/schemaCompat.ts` and the troubleshooting note below).

**Mastery / deep docs** live in `docs/` (SYSTEM_MASTERY.md is the single best source for schema, RLS, encryption, and data flows).

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

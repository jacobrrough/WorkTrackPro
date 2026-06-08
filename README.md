# WorkTrackPro

A manufacturing / fabrication shop-management app for small-to-medium businesses: job tracking, parts & inventory, time clock, quoting, deliveries, encrypted chat, and a full double-entry accounting module — built for the shop floor (mobile/tablet) and the back office.

It powers [Rough Cut Manufacturing](https://roughcutmfg.com): a public storefront + proposal intake on the front, and an authenticated internal app at `/app`.

## Tech Stack

- **Frontend:** React 19, TypeScript, Vite 6, Tailwind CSS 3, React Router 7
- **Server state:** TanStack Query 5 + Supabase Realtime (debounced subscriptions)
- **Backend / Auth / DB / Storage:** Supabase (hosted Postgres 17, Row-Level Security, Auth, Storage, Realtime)
- **Serverless:** Netlify Functions (proposal intake, Gmail add-on, AI assistant, scheduled tax-table refresh)
- **Hosting:** Netlify (auto-deploy from GitHub); a Railway config is also included
- **Icons:** Material Symbols
- **Testing / Quality:** Vitest, ESLint (flat config), Prettier — all enforced in CI

## Features

### Job Tracker
- Kanban boards: a **Shop Floor** board (Pending → In Progress → Quality Control → Finished → Delivered, plus On Hold) and an **Admin** board (To Be Quoted → Quoted → RFQ → PO'd → Waiting For Payment → Project Completed → Paid)
- Drag-and-drop status changes, bulk status update, rush and overdue indicators
- Multi-variant jobs: per-variant `dashQuantities` (e.g. `-01`, `-05`) with material auto-assignment from Part → PartMaterial
- Multi-part jobs: link several parts to one job via `job_parts`
- Material allocation, comments, attachments, checklists, status history
- Bin location, ECD, due dates, planned completion date; progress %, CNC and 3D-print completion tracking
- Calendar view for scheduling and timeline visualization

### Parts Management (Admin)
- Part catalog with part number, revision tracking, descriptions
- Variant system with per-variant pricing, labor, CNC, and 3D-print-time overrides; "variants are copies" mode
- Materials / BOM: link inventory items per-set or per-variant
- Pricing: price-per-set with optional per-variant overrides
- Drawing attachments (technical) and product images (storefront)

### Inventory Management
- Stock levels, item details, suppliers, purchases
- **Allocated vs available** stock — `available = max(0, inStock − allocated)`, allocated = quantity committed to active (non-consumed) jobs
- DB-trigger-driven consumption: stock is decremented when a job reaches a consumed status and restored on rework
- Low-stock banner and reorder workflow, bin location + barcode scanning, full inventory history

### Time Clock & Reporting
- Clock-in/out by job code with a live active-shift timer
- **Offline queue:** punches are stored locally when offline and synced (with dedupe + lost-ACK recovery) when back online
- Optional geofenced/on-site clock-in (org setting)
- Time reports by date range / user / job, labor + hours with CSV export, on-time delivery report

### Quotes & Pricing
- Quote calculator: material cost, labor hours, CNC time, 3D-print time, configurable rates + material markup (org settings)
- Saved quotes with reference-job linkage; line-item breakdown
- Quoted price snapshot persists on the job so invoices bill what was quoted

### Accounting (WorkTrackAccounting)
A full **double-entry** accounting module (feature-flagged — see `VITE_ACCOUNTING_ENABLED`). Money is stored and computed in integer cents; every posted journal entry is balance-enforced at the database (debits == credits) with a deferred commit-time safety net.

- **General Ledger & Journal:** chart of accounts, manual journal entries, period (books-closed) lock
- **Sales:** invoices (with quote snapshot from a job), customer payments, AR aging
- **Purchases:** bills, vendor payments, AP aging, purchase orders
- **Banking:** accounts, transaction import, rules engine, reconciliation
- **Inventory accounting:** FIFO cost layers, COGS posting, inventory valuation
- **Job costing**, **budgets** + budget-vs-actual + cash-flow forecast
- **Fixed assets** with straight-line depreciation schedules
- **Sales tax** (internal jurisdiction tables + resolver) and a tax-filing calendar, with an optional scheduled tax-table refresh (`ACCOUNTING_TAX_SYNC_ENABLED`)
- **Reports:** Trial Balance, Profit & Loss, Balance Sheet, AR/AP aging, sales-tax liability; CSV/printable export
- **Recurring templates, dimensions, custom fields, 1099 / W-9 tracking, retainage, progress billing, estimates**
- **QuickBooks import:** a wizard that moves QuickBooks Online data over via CSV/Excel — Chart of Accounts → Customers → Vendors → full GL transaction history (posted as balanced journal entries). Invoice/estimate import is in progress.

### Encrypted Chat
- Direct and group conversations with ECDH (P-256) end-to-end encryption; AES-GCM message encryption
- Per-user key pair; private key encrypted with a password-derived key (PBKDF2)
- Encrypted attachments, @mention notifications

### Deliveries
- Per-job delivery tracking with line items, carrier/tracking/recipient
- Packing-slip generation and printing, delivery history + numbering

### Public Storefront & Proposals
- Customer-facing product browsing from the part catalog
- Proposal intake form protected by Cloudflare Turnstile, with Resend email confirmations (customer + admin)

### AI Assistant (Admin)
- An in-app assistant that answers questions about live shop data (jobs, inventory, shifts, quotes, …)
- Backed by the `ai-chat` Netlify function: admin-gated, per-admin rate-limited, with bounded/​sandboxed context injection

### Gmail Add-on
- Create board cards from Gmail with auto-uploaded attachments (Google Apps Script + `boards-for-addon` / `create-card-from-email` functions)

### Notifications, Boards & More
- Real-time in-app notification feed with per-type preferences (server-side `should_notify()` gating on Postgres triggers)
- Standalone custom Kanban boards with member roles and card attachments
- Global command palette (Cmd/Ctrl+K), role-based access (Admin vs Employee), admin user-approval workflow
- Trello import for job cards/boards; mobile-first layout with bottom nav

## Getting Started

### Prerequisites
- **Node.js 20** (pinned via `.nvmrc`) and npm
- A Supabase project ([supabase.com](https://supabase.com))

### Installation

```bash
git clone <repository-url>
cd WorkTrackPro
npm install
cp .env.example .env.local   # then fill in the values below
npm run dev                  # http://localhost:3000  (/ = landing, /app = the app)
```

At minimum set:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

(Supabase Dashboard → Project Settings → API.)

### Building & Deploying

```bash
npm run build      # outputs to dist/
```

- **Netlify:** connect the repo (build `npm run build`, publish `dist`); set `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` and any function env vars below. Functions live in `netlify/functions/`.
- **Railway:** uses `railway.toml` (`npm ci && npm run build`, then `npm start` serves `dist/` via `scripts/static-serve.mjs`, honoring `PORT`). `VITE_*` vars are baked at build time — redeploy after changing them.

## Environment Variables

**Required (client, build-time):**
- `VITE_SUPABASE_URL` — Supabase project URL
- `VITE_SUPABASE_ANON_KEY` — Supabase anon (public) key

**Accounting module (build-time gate):**
- `VITE_ACCOUNTING_ENABLED` — `true` to register the `/app/accounting/*` routes and include the module in the build (default `false`). Also requires the `accounting` schema to be added to Supabase → API → Exposed schemas.

**AI assistant (Netlify function, server-side):**
- `AI_MODEL_URL`, `AI_PROXY_SECRET` — upstream model endpoint + auth for `ai-chat`

**Customer proposals (Netlify function, server-side):**
- `SUPABASE_SERVICE_ROLE_KEY` — service-role key (server-side only; never exposed to the browser)
- `VITE_TURNSTILE_SITE_KEY` (public) + `TURNSTILE_SECRET_KEY` — Cloudflare Turnstile CAPTCHA
- `RESEND_API_KEY`, `PROPOSAL_ADMIN_EMAIL`, `PROPOSAL_FROM_EMAIL_ADMIN`, `PROPOSAL_FROM_EMAIL_CUSTOMER`, `APP_PUBLIC_URL` — email delivery + links

**Tax-table auto-refresh (Netlify scheduled function, server-side):**
- `ACCOUNTING_TAX_SYNC_ENABLED` — default off; hard-gates the quarterly tax-table refresh (a build flag cannot gate a scheduled function, so this server var is the isolation guarantee)

**Gmail add-on (optional, server-side):**
- `GMAIL_ADDON_API_KEY`, optional `GMAIL_ADDON_USER_ID`

**Trello import (optional, client):**
- `VITE_TRELLO_API_KEY`, `VITE_TRELLO_TOKEN`

## Development

### Scripts
- `npm run dev` — dev server
- `npm run build` — production build
- `npm run preview` — preview the build
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — ESLint
- `npm run format` / `npm run format:check` — Prettier (CI fails on `format:check`)
- `npm run test` / `npm run test:watch` — Vitest

CI runs typecheck, lint, `format:check`, build, and the test suite; all must pass to merge.

### Project Structure

```
src/
├── services/api/        # Supabase-backed API modules (jobs, shifts, inventory, auth, parts, quotes,
│   │                    #   boards, chat, deliveries, …) and services/api/accounting/* for the GL/AP/AR layer
├── lib/                 # Pure utilities + math (timeUtils, inventoryCalculations, partDistribution,
│   │                    #   calculatePartQuote, variant*, jobProgress, offlineQueue, …)
│   └── crypto/          #   ECDH/AES E2E chat helpers
├── components/          # Shared UI (AdminGuard, NotificationBell, CommandPalette, QRScanner, ui/*, …)
├── contexts/            # Auth, Navigation, Settings, ClockIn
├── core/                # types.ts, validation, date, clockPunch
├── features/
│   ├── accounting/      #   WorkTrackAccounting (GL, invoices, bills, banking, reports, import, …)
│   ├── admin/           #   Parts, calendar, admin settings
│   ├── boards/  chat/  deliveries/  inventory/  jobs/  notifications/
├── hooks/               # useAppQueries + domain mutation hooks, realtime wiring
├── AppContext.tsx       # Thin composer over auth + queries + mutation hooks + realtime
└── *.test.ts(x)         # Vitest tests (math, services, utilities, some components)

supabase/migrations/     # Timestamped SQL migrations (the authoritative schema); _archive/ holds
                         #   historical one-off scripts that must NOT be run (see its README)
netlify/functions/       # submit-proposal, boards-for-addon, create-card-from-email, ai-chat, tax-table-refresh
gmail-addon/             # Google Apps Script add-on
```

### Data Layer & Realtime Notes
- TanStack Query + Supabase Realtime (debounced subscriptions for jobs/shifts/inventory/parts/boards and related tables).
- A schema-compatibility layer (`schemaCompat.ts`) keeps reads resilient to PostgREST cache staleness right after migrations.
- DB triggers enforce business rules: over-allocation guard, status-driven inventory reconciliation, single open shift per user, and the accounting balance/period-lock guards.

## Security & Auth
- Supabase Auth (email/password). New accounts require **admin approval** before they can use the app.
- **Row-Level Security** on all tables; admin and approval checks are enforced server-side (the client `AdminGuard` is only a UX gate). The `profiles` self-update policy pins `is_admin`/`is_approved`, so a user cannot self-promote.
- Shop-floor users never see prices/costs; admins have full visibility.
- Chat is end-to-end encrypted (ECDH P-256 + AES-GCM; password-derived private-key protection).
- Session management with idle timeout and token-refresh fallback to sign-out.
- The accounting module adds role-based access (`accounting_admin` / read / payroll) on top of admin.

## Database & Migrations
- Schema lives in `supabase/migrations/` as timestamped SQL, applied with the Supabase CLI / dashboard. Keep the migration chain in sync with the live project before any `db reset`.
- `supabase/migrations/_archive/` contains historical, **non-timestamped one-off scripts** (including destructive ones) — kept for reference only; never run them.

## Backups
Data lives in Supabase (Postgres + storage). See [docs/BACKUP.md](docs/BACKUP.md) for PITR and manual export options.

## Browser Support
Latest Chrome/Edge, Firefox, Safari, and mobile browsers (iOS Safari, Chrome Mobile). Layout is mobile-first with a bottom nav on small screens.

## License
[Your License Here]

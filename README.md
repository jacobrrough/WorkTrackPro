# WorkTrackPro

A comprehensive business management application for small to medium manufacturing businesses: job tracking, inventory, time clock, and reporting.

## Tech Stack

- **Frontend:** React 19, TypeScript, Vite 6, Tailwind CSS
- **Backend / Auth / DB:** Supabase (hosted)
- **Hosting:** Netlify (auto-deploy from GitHub)
- **State:** TanStack Query for server state; React context for auth and UI
- **Icons:** Material Symbols
- **Testing:** Vitest
- **Linting:** ESLint + Prettier

## Features

### Inventory Management
- Track stock levels, item details, suppliers, and purchases
- Allocated vs available stock (committed to active jobs)
- Low-stock banner and reorder workflow
- Bin location and barcode scanning
- Inventory history (transaction log) on item detail
- Category-based organization (Material, Foam, Trim & Cord, 3D Printing, Chemicals, Hardware, Misc Supplies)

### Time Clock
- Employee clock-in/clock-out by job code
- Offline queue: punches stored locally when offline and synced when back online
- Active shift tracking with live timer
- Geolocation/on-site requirement (optional, via org settings)

### Time & Reporting
- Time reports with date range and filters (shifts, users, jobs)
- Labor by job and employee hours with CSV export
- On-time delivery report (completed jobs vs ECD)

### Job Tracker
- Kanban boards (Shop Floor and Admin)
- Status workflow, bulk status update, rush and overdue indicators
- Multi-variant jobs: `dashQuantities` per variant (e.g. `-01`, `-05`); material auto-assignment from Part → PartMaterial
- Multi-part jobs: link multiple parts to a single job via `job_parts`
- Material allocation, comments, attachments, checklists
- Bin location, ECD, due dates, planned completion date; clickable material names link to inventory detail
- Progress tracking: user-estimated completion percent, CNC and 3D printer completion tracking
- Calendar view for scheduling and job timeline visualization

### Parts Management (Admin)
- Part catalog with part number, revision tracking, and descriptions
- Variant system with per-variant pricing, labor, CNC, and 3D print time overrides
- Materials / BOM: link inventory items to parts (per-set) or variants (per-variant)
- Pricing: price per set with optional per-variant overrides; quote calculator with material + labor + CNC + 3D print costs and markup
- Drawing attachments (technical) and product images (storefront)
- Labor hour estimates and machine time requirements (CNC, 3D printer)

### Custom Boards
- Standalone kanban boards (independent of job boards)
- Columns with drag-and-drop card management
- Card detail with descriptions, assignees, due dates, color labels, and file attachments
- Board sharing with member roles (editor)

### Encrypted Chat
- Direct and group conversations with ECDH end-to-end encryption
- Per-user key pair generation; private keys encrypted with user password
- Message attachments (encrypted at rest)
- @mention notifications
- System notifications: job alerts (overdue, rush), low stock, status changes

### Deliveries
- Delivery tracking per job with line items
- Carrier, tracking number, and recipient info
- Packing slip generation and printing
- Delivery history and numbering

### Quotes & Pricing
- Quote calculator: material cost, labor hours, CNC time, 3D print time
- Configurable labor rate, material markup, CNC/3D print rates (org settings)
- Saved quotes with reference job linkage
- Line item breakdown and notes

### Public Storefront & Proposals
- Customer-facing product browsing from part catalog
- Proposal intake form with Cloudflare Turnstile CAPTCHA
- Email confirmations via Resend (customer + admin notifications)
- Proposal status tracking and job linkage

### Gmail Add-on
- Create board cards directly from Gmail emails
- Auto-upload email attachments to card
- Google Apps Script add-on with Netlify function backend (`boards-for-addon`, `create-card-from-email`)
- Board selection from within Gmail sidebar
- Full setup guide: `gmail-addon/README.md` + Netlify env vars (`GMAIL_ADDON_API_KEY`, optional `GMAIL_ADDON_USER_ID`)

### Other
- Role-based access (Admin vs Employee); admin-only views guarded
- User approval workflow: new accounts require admin approval
- Global search (Cmd/Ctrl+K) from dashboard: jobs, inventory, people
- In-app notifications (overdue, rush, low stock) delivered via chat system
- Mobile bottom nav and large clock-in button on small screens
- Trello import: bulk import of job cards and boards with attachment proxying

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- Supabase project (create at [supabase.com](https://supabase.com))

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd WorkTrackPro
```

2. Install dependencies:
```bash
npm install
```

3. Environment variables (Supabase only):

Copy `.env.example` to `.env.local` and set your Supabase credentials:

```bash
cp .env.example .env.local
```

Edit `.env.local` and set at least:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Get these from Supabase Dashboard → Settings → API.

4. Start the development server:
```bash
npm run dev
```

The app runs at `http://localhost:3000`. Use `/app` for the employee app; `/` is the public landing page.

### Building for Production

```bash
npm run build
```

Output is in `dist/`. Netlify builds this automatically when you connect the repo.

### Deploy to Netlify

1. Connect your GitHub repo to Netlify.
2. Build command: `npm run build`
3. Publish directory: `dist`
4. Set environment variables in Netlify: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
5. Optional: configure Netlify serverless functions (`netlify/functions/submit-proposal.js` for customer proposals, `boards-for-addon.js` and `create-card-from-email.js` for Gmail add-on).

### Deploy to Railway

The repo includes a root `railway.toml`. Use the **project root** as the Railway service root.

1. In Railway, create a new service from this repo (root directory).
2. Build and start use: `npm ci && npm run build` and `npm start` (see `railway.toml`). `npm start` serves the `dist/` folder via `scripts/static-serve.mjs` and respects the `PORT` variable.
3. **Required:** In Railway → your service → **Variables**, set:
   - `VITE_SUPABASE_URL` = your Supabase project URL
   - `VITE_SUPABASE_ANON_KEY` = your Supabase anon key  
   These are baked in at build time, so redeploy after changing them.
4. Optional: `.nvmrc` pins Node 20 for the build.

## Development

### Scripts

- `npm run dev` – Development server
- `npm run build` – Production build
- `npm run preview` – Preview production build
- `npm run lint` – ESLint
- `npm run format` – Prettier
- `npm run test` – Vitest (once)
- `npm run test:watch` – Vitest watch

### Project Structure

```
src/
├── services/api/     # Supabase-backed API modules (jobs, shifts, inventory, auth, parts, quotes, boards, chat, deliveries, subscriptions, etc.)
├── lib/              # Utilities (timeUtils, inventoryCalculations, inventoryState, offlineQueue, exportCsv, partDistribution, partsCalculations, calculatePartQuote, jobProgress, formatJob, etc.)
│   └── crypto/       # E2E encryption helpers (ECDH key generation, encrypt/decrypt, key cache)
├── components/       # Shared UI (Toast, ProtectedRoute, AdminRoute, NotificationBell, CommandPalette, QRScanner, etc.)
├── contexts/         # Navigation, Settings, ClockIn, Notifications
├── core/             # types.ts, validation, imageHelper
├── features/         # Feature modules:
│   ├── admin/        #   Parts management, calendar, admin settings
│   ├── auth/         #   Login, signup, approval
│   ├── boards/       #   Custom kanban boards
│   ├── chat/         #   Encrypted messaging
│   ├── dashboard/    #   Employee dashboard
│   ├── deliveries/   #   Delivery tracking, packing slips
│   ├── inventory/    #   Stock management
│   ├── jobs/         #   Job tracking, kanban
│   ├── quotes/       #   Quote generation
│   └── time/         #   Time reports
├── hooks/            # 19 custom hooks (useAppQueries, useJobMutations, useClockMutations, useInventoryMutations, useBoardMutations, useChatMutations, useDeliveryMutations, useCryptoKeys, useSystemNotifications, etc.)
├── public/           # PublicHome (landing), Storefront
├── App.tsx           # View-state routing and shell
├── AppContext.tsx    # Thin composer (useAuth + useAppQueries + domain mutation hooks + realtime wiring); legacy useApp() facade preserved
├── pocketbase.ts     # Facade re-exporting Supabase services (legacy import path)
└── *.test.ts        # Vitest tests

gmail-addon/          # Google Apps Script Gmail add-on (Code.gs, Api.gs, appsscript.json)
netlify/functions/    # Serverless endpoints (submit-proposal, boards-for-addon, create-card-from-email)
```

### Environment Variables

**Required:**

- `VITE_SUPABASE_URL` – Supabase project URL
- `VITE_SUPABASE_ANON_KEY` – Supabase anonymous (public) key

**Optional — Gmail Add-on:**

- `GMAIL_ADDON_API_KEY` – shared secret for add-on → Netlify function auth
- `GMAIL_ADDON_USER_ID` – scope which user's boards the add-on can access

**Optional — Trello Import:**

- `VITE_TRELLO_API_KEY` – Trello Power-Up API key
- `VITE_TRELLO_TOKEN` – Trello authorization token

**Optional — Customer Proposals (Netlify functions):**

- `VITE_TURNSTILE_SITE_KEY` – Cloudflare Turnstile site key (public, for CAPTCHA)
- `TURNSTILE_SECRET_KEY` – Turnstile server-side secret
- `RESEND_API_KEY` – Resend email delivery API key
- `SUPABASE_SERVICE_ROLE_KEY` – Supabase service role key (server-side only)
- `PROPOSAL_ADMIN_EMAIL` – admin notification recipient
- `PROPOSAL_FROM_EMAIL_ADMIN` – "from" address for admin notifications
- `PROPOSAL_FROM_EMAIL_CUSTOMER` – "from" address for customer confirmations

No PocketBase or Docker required.

### Data Layer & Realtime Notes
- TanStack Query + Supabase Realtime (debounced subscriptions for jobs/shifts/inventory/job-related tables/boards/parts).
- Schema compatibility layer (`schemaCompat.ts`) + job data healing for safe evolution after migrations (PostgREST cache staleness is handled gracefully).
- Supabase trigger `job_inventory_allocate_guard` prevents over-allocation (race-safe).
- See `docs/SYSTEM_MASTERY.md` and `docs/APPCONTEXT-REFACTOR-PLAN.md` for deep verified details on schema, RLS, encryption, and workflows.

## Testing

```bash
npm run test          # Run once
npm run test:watch    # Watch mode
```

Tests include: validation, time utils, inventory calculations, offline queue, price visibility, schema compat, and others.

## Backups and data safety

Data is stored in **Supabase** (Postgres + storage). See [docs/BACKUP.md](docs/BACKUP.md) for backup options, PITR, and manual exports so you’re not dependent on a single point of failure.

## Security and Auth

- Auth is handled by Supabase Auth (email/password; email confirmation can be enabled).
- User approval workflow: new accounts must be approved by an admin before accessing the app.
- Protected routes render only when the user is authenticated and approved.
- Admin-only views use `AdminRoute` and redirect non-admins to the dashboard.
- Shop-floor users never see prices/costs; admins have full visibility.
- Chat uses end-to-end encryption: ECDH P-256 key pairs per user, AES-GCM message encryption, password-derived private key protection. Key recovery is handled on password reset.
- Row-level security (RLS) policies enforce access control across all Supabase tables.
- Session management with idle timeout, hard logout on expiry, and token refresh with fallback to sign-out.

## Integrations

- **Supabase** – primary database (Postgres), authentication, file storage, realtime subscriptions
- **Netlify** – hosting, auto-deploy from GitHub, serverless functions
- **Resend** – email delivery for customer proposal confirmations and admin notifications
- **Cloudflare Turnstile** – CAPTCHA protection on public proposal intake form
- **Trello** – optional import of job cards and boards with attachment proxying
- **Gmail Add-on** – Google Apps Script add-on for creating board cards from emails (via Netlify functions)

## Browser Support

- Chrome/Edge, Firefox, Safari (latest)
- Mobile browsers (iOS Safari, Chrome Mobile); layout is mobile-first with bottom nav on small screens.

## License

[Your License Here]

## Support

See `SYSTEM_MASTERY.md` for data model, relations, and implementation notes.

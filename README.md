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
- Material allocation, comments, attachments, checklists
- Bin location, ECD, due dates; clickable material names link to inventory detail

### Other
- Role-based access (Admin vs Employee); admin-only views guarded
- Global search (Cmd/Ctrl+K) from dashboard: jobs, inventory, people
- In-app notifications (overdue, rush, low stock)
- Mobile bottom nav and large clock-in button on small screens
- Netlify serverless function for customer proposal intake

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

Copy `.env.template` to `.env.local` and set your Supabase credentials:

```bash
cp .env.template .env.local
```

Edit `.env.local` and set:

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
5. Optional: configure Netlify serverless functions (e.g. `netlify/functions/submit-proposal.js` for customer proposals).

### Deploy to Railway

The repo includes a root `railway.toml`. Use the **project root** as the Railway service root (not PocketBaseServer).

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
├── services/api/     # Supabase-backed API (jobs, shifts, inventory, auth, parts, quotes, etc.)
├── lib/              # Utilities (timeUtils, inventoryCalculations, inventoryState, offlineQueue, exportCsv, partDistribution, etc.)
├── components/       # Shared UI (Toast, ProtectedRoute, AdminRoute, NotificationBell, CommandPalette, QRScanner, etc.)
├── contexts/         # Navigation, Settings, ClockIn, Notifications
├── core/             # types.ts, validation, imageHelper
├── features/         # Feature modules (admin, dashboard, inventory, jobs, parts, quotes, time)
├── hooks/            # useClockInWithOnSiteCheck, etc.
├── public/           # PublicHome (landing)
├── App.tsx           # View-state routing and shell
├── AppContext.tsx    # Auth, mutations, TanStack Query wiring
├── pocketbase.ts     # Facade re-exporting Supabase services (legacy import path)
└── *.test.ts        # Vitest tests
```

### Environment Variables

- `VITE_SUPABASE_URL` – Supabase project URL
- `VITE_SUPABASE_ANON_KEY` – Supabase anonymous (public) key

No PocketBase or Docker required.

## Testing

```bash
npm run test          # Run once
npm run test:watch    # Watch mode
```

Tests include: validation, time utils, inventory calculations, offline queue, price visibility, schema compat, and others.

## Security and Auth

- Auth is handled by Supabase Auth (email/password; email confirmation can be enabled).
- Protected routes render only when the user is authenticated.
- Admin-only views use `AdminRoute` and redirect non-admins to the dashboard.
- Shop-floor users never see prices/costs; admins have full visibility.

## Browser Support

- Chrome/Edge, Firefox, Safari (latest)
- Mobile browsers (iOS Safari, Chrome Mobile); layout is mobile-first with bottom nav on small screens.

## License

[Your License Here]

## Support

See `SYSTEM_MASTERY.md` for data model, relations, and implementation notes.

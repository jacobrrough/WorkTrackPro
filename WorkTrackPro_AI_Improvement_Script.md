# WorkTrackPro — AI Agent Improvement Script
**Stack: React 19 + TypeScript + Vite 6 + Tailwind CSS + Supabase + Netlify**

> This document is a step-by-step instruction script for an AI coding agent (Cursor, Windsurf, Claude Code, etc.).
> Follow every step **in order**. Do NOT skip ahead. After each step, verify the app still builds and no TypeScript errors exist before moving to the next step.
> Run `npm run build && npm run lint` after every major step as a safety check.

---

## GROUND RULES FOR THE AI AGENT

Before starting any step:
1. **Read the file before editing it.** Never overwrite a file without first reading its full contents.
2. **Never delete functionality.** If removing dead code, confirm it is unreferenced first.
3. **Commit after every step** with a clear message so rollback is easy.
4. **If uncertain about a file's purpose, read the SYSTEM_MASTERY.md file first.**
5. **Never change the Supabase schema** unless a migration file is written first.
6. **Test imports.** After adding any new utility or component, verify the import resolves correctly before moving on.

---

## STEP 1 — Dead Code & Infrastructure Cleanup

**Goal:** Remove backend artifacts from PocketBase and Node.js eras that no longer apply. This reduces confusion and bundle noise.

### 1a. Remove PocketBase artifacts
- Open the repo root. Look for any of the following and **delete them entirely**:
  - `PocketBaseServer/` directory
  - `pocketbase-https-check.txt`
  - `POCKETBASE_TROUBLESHOOTING.md`
  - `START-WITH-PROXY.bat`
  - `STOP-ALL.bat`
  - `.cloudflared/` directory
  - `railway.toml` (only if you are not using Railway for anything)
  - `Dockerfile.frontend` and `docker-compose.yml` (only if Docker is not part of your deployment pipeline — confirm first)

- Search the entire `src/` directory for any import of `pocketbase` or `import PocketBase`. If found, note the file and do NOT delete yet — flag it for Step 2.

### 1b. Remove Node server artifacts
- Delete the `server/` directory entirely (confirmed unused).
- Check `netlify/functions/` — keep any functions that are actively called from `src/`. Delete any that reference PocketBase or the old Node server.
- Check `package.json` for any dependencies referencing `pocketbase`, `express`, `cors`, or `node-fetch` that are only needed for the old server. Remove them and run `npm install`.

### 1c. Clean up stale documentation
- These doc files are historical artifacts. **Archive** them (move to `docs/archive/`) rather than deleting, in case you need context later:
  - `OVERHAUL_PLAN.md`
  - `POCKETBASE_TROUBLESHOOTING.md`
  - `FINAL_IMPLEMENTATION_SUMMARY.md`
  - `IMPLEMENTATION_SUMMARY.md`
  - `INVENTORY_REFRESH_SUMMARY.md`
  - `JOB_DETAIL_REFRESH_BASELINE.md`
  - `PART_DETAIL_REFRESH_BASELINE.md`
  - `PUT-ON-WEBSITE.md`
  - `QUICK_FIX.md`
  - `TRELLO_EXPORT_STRUCTURE.md`
  - `GITHUB_SETUP.md`
  - `SETUP-SUPABASE.md`
  - `LOCAL-DEV.md`
  - `V7_MIGRATION_STATUS.md`

### 1d. Verify
```bash
npm run build
npm run lint
```
Fix any errors before proceeding.

---

## STEP 2 — Supabase API Layer Audit & Hardening

**Goal:** Ensure all data access goes through a clean, typed Supabase client. Eliminate any remaining PocketBase SDK calls.

### 2a. Audit the API service layer
- Open every file in `src/services/api/`.
- For each file, check:
  - [ ] Does it import from `pocketbase`? → Replace with Supabase equivalent and delete PocketBase import.
  - [ ] Does it use `any` as a return type for database responses? → Fix in 2b.
  - [ ] Does it have inconsistent error handling (some throw, some return null, some return `{error}`)? → Fix in 2c.

### 2b. Create typed Supabase response interfaces
- Open `src/types.ts`.
- For every Supabase table (jobs, shifts, inventory, users, job_inventory, comments, attachments, checklists, inventory_history), verify there is a corresponding TypeScript interface.
- If any interface is missing, add it. Example pattern:
```typescript
export interface Job {
  id: string;
  created: string;
  updated: string;
  title: string;
  status: JobStatus;
  // ... all columns from your Supabase table
}
```
- After defining interfaces, go back to `src/services/api/` and replace all `any` response types with the correct interface.

### 2c. Standardize error handling across all API functions
- Every API function in `src/services/api/` must follow this exact pattern:
```typescript
export async function getJobs(): Promise<{ data: Job[] | null; error: string | null }> {
  try {
    const { data, error } = await supabase.from('jobs').select('*');
    if (error) return { data: null, error: error.message };
    return { data, error: null };
  } catch (err) {
    return { data: null, error: 'Unexpected error fetching jobs' };
  }
}
```
- This ensures callers always know exactly what they're dealing with.
- **Do not change function names or signatures** — only the return type and internal error handling.

### 2d. Centralize the Supabase client
- Confirm there is a single file (e.g., `src/lib/supabase.ts` or `src/services/supabase.ts`) that creates and exports the Supabase client.
- If multiple files call `createClient(...)`, consolidate them to import from that single file.
- Verify `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are used (not hardcoded). Check `.env.example` and `.env.template` are updated to reflect Supabase keys only (remove any PocketBase URL references).

### 2e. Verify
```bash
npm run build
npm run lint
```

---

## STEP 3 — Authentication Hardening

**Goal:** Make auth robust, handle session expiry gracefully, and guard all routes properly.

### 3a. Audit the auth flow
- Find where `supabase.auth.signIn` (or equivalent) is called.
- Find where the session/token is stored and read.
- Check: when the session expires, what happens? Does the user get silently logged out, or are they redirected cleanly to the login page?

### 3b. Add auth state listener
- In your top-level app setup (likely `App.tsx` or `AppContext.tsx`), confirm this pattern exists:
```typescript
useEffect(() => {
  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || !session) {
      // redirect to login, clear local state
    }
    if (event === 'TOKEN_REFRESHED') {
      // update session in context
    }
  });
  return () => subscription.unsubscribe();
}, []);
```
- If this doesn't exist, add it. This is what catches expired tokens and network-recovered sessions.

### 3c. Audit route guards
- Open `App.tsx` and list every route.
- For each route, answer: Is this route accessible without being logged in?
  - If yes and it should not be → wrap it in a `<ProtectedRoute>` component.
  - If it's an admin-only route → wrap it in `<AdminRoute>`.
- Create these components if they don't exist:
```typescript
// ProtectedRoute.tsx
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user } = useAppContext();
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

// AdminRoute.tsx  
export function AdminRoute({ children }: { children: ReactNode }) {
  const { user } = useAppContext();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}
```

### 3d. Verify
```bash
npm run build
npm run lint
```
Also manually test: open the app logged out and try navigating directly to `/admin` — you should be redirected to login.

---

## STEP 4 — State Management Cleanup

**Goal:** Reduce AppContext bloat. Server data (jobs, shifts, inventory) should not live in global context — it should be fetched on demand.

### 4a. Audit AppContext.tsx
- Open `AppContext.tsx`.
- List everything stored in context. Separate them into two categories:
  - **Client state** (auth user, UI preferences, current role, active shift) — these STAY in context.
  - **Server state** (job lists, inventory lists, shift history) — these should be moved to local component state or React Query.

### 4b. Install TanStack Query
```bash
npm install @tanstack/react-query
```
- Wrap your app in `QueryClientProvider` in `main.tsx` or `App.tsx`:
```typescript
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 min
      retry: 2,
    },
  },
});
// wrap <App /> with <QueryClientProvider client={queryClient}>
```

### 4c. Migrate one module at a time — start with Jobs
- In the Jobs/Kanban page component, replace the manual `useEffect(() => { fetchJobs() }, [])` + loading state pattern with:
```typescript
const { data: jobs, isLoading, error, refetch } = useQuery({
  queryKey: ['jobs'],
  queryFn: () => getJobs(), // your existing API function
});
```
- Remove the jobs array from AppContext after confirming the page still works.
- Repeat this migration for: Inventory, Shifts/Time entries, Users (admin).

### 4d. Keep in AppContext only
- `currentUser` (auth state)
- `activeShift` (current clock-in state — needed globally for the clock-in button)
- `userRole` (admin/employee)
- Any app-wide UI settings

### 4e. Verify
```bash
npm run build
npm run lint
```
Manually test: jobs load, inventory loads, time tracker loads.

---

## STEP 5 — Netlify Functions Audit & Hardening

**Goal:** Ensure Netlify functions are clean, secure, and all use Supabase correctly.

### 5a. Audit each function in `netlify/functions/`
- Open every `.ts` or `.js` file.
- For each function check:
  - [ ] Does it validate the incoming request body before using it?
  - [ ] Does it check for auth (verify the user's JWT from the Authorization header) before doing any database operation?
  - [ ] Does it return proper HTTP status codes (200, 400, 401, 403, 500)?
  - [ ] Does it have a try/catch wrapping the entire handler?

### 5b. Add auth verification to all protected functions
Any function that reads or writes user data must verify the Supabase JWT:
```typescript
import { createClient } from '@supabase/supabase-js';

export const handler = async (event) => {
  const token = event.headers.authorization?.replace('Bearer ', '');
  if (!token) return { statusCode: 401, body: 'Unauthorized' };

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return { statusCode: 401, body: 'Invalid token' };

  // proceed with handler logic...
};
```

### 5c. Check environment variables
- Open `netlify.toml`. Confirm `[build]` section is correct and all required env vars are listed.
- In Netlify dashboard, confirm these vars are set: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- **Never use the service role key in frontend code.** It should only appear in `netlify/functions/`.

### 5d. Verify
```bash
npm run build
```
Test one Netlify function locally with `netlify dev` if available.

---

## STEP 6 — Offline Support for Time Clock

**Goal:** Clock punches must never be lost due to network issues. This is a data integrity requirement.

### 6a. Create an offline queue utility
Create `src/lib/offlineQueue.ts`:
```typescript
const QUEUE_KEY = 'wtp_offline_clock_queue';

export interface QueuedPunch {
  id: string;
  type: 'clock_in' | 'clock_out';
  userId: string;
  jobCode?: string;
  timestamp: string; // ISO string captured at time of punch
  location?: { lat: number; lng: number };
}

export function enqueueClockPunch(punch: Omit<QueuedPunch, 'id'>) {
  const queue = getQueue();
  queue.push({ ...punch, id: crypto.randomUUID() });
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function getQueue(): QueuedPunch[] {
  const raw = localStorage.getItem(QUEUE_KEY);
  return raw ? JSON.parse(raw) : [];
}

export function clearPunchFromQueue(id: string) {
  const queue = getQueue().filter(p => p.id !== id);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}
```

### 6b. Modify the clock-in/clock-out handlers
- In the Time Clock component, find the clock-in and clock-out submission functions.
- Wrap the API call in a try/catch. On failure, enqueue the punch instead of showing only an error:
```typescript
try {
  await clockIn({ userId, jobCode, timestamp: new Date().toISOString() });
} catch (err) {
  enqueueClockPunch({ type: 'clock_in', userId, jobCode, timestamp: new Date().toISOString() });
  showToast('Clocked in offline — will sync when connected', 'warning');
}
```

### 6c. Create a queue sync effect
- In `AppContext.tsx` (or a dedicated `useOfflineSync` hook), add:
```typescript
useEffect(() => {
  const syncQueue = async () => {
    if (!navigator.onLine) return;
    const queue = getQueue();
    for (const punch of queue) {
      try {
        if (punch.type === 'clock_in') await clockIn(punch);
        if (punch.type === 'clock_out') await clockOut(punch);
        clearPunchFromQueue(punch.id);
      } catch { /* leave in queue, try next cycle */ }
    }
  };

  window.addEventListener('online', syncQueue);
  syncQueue(); // also try on mount
  return () => window.removeEventListener('online', syncQueue);
}, []);
```

### 6d. Show offline indicator
- In the app header/navbar, add a small badge that shows when `navigator.onLine === false` and when there are pending punches in the queue.

### 6e. Verify
```bash
npm run build
```
Test: throttle network in Chrome DevTools to offline, clock in, confirm no crash and the punch appears in localStorage queue.

---

## STEP 7 — Job Tracker Kanban Improvements

**Goal:** Make the Kanban board faster and more usable in a shop floor environment.

### 7a. Add drag-and-drop to the Kanban
```bash
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```
- Wrap each Kanban column in a `<Droppable>` and each job card in a `<Draggable>`.
- On drag end, call the `updateJobStatus` API function with the new status.
- Apply optimistic update: update the local React Query cache immediately, then let the API call confirm or revert.
- **Do NOT remove the existing status dropdown** — keep it as a fallback for mobile/accessibility.

### 7b. Add rush job visual treatment
- Check if jobs have a `rush` boolean field in Supabase. If not, add a migration.
- Rush jobs on the Kanban should have a distinct red border or badge that's immediately visible.
- Add a "Mark as Rush" button to the job card context menu / job detail view.

### 7c. Add overdue indicator
- Any job where `due_date` or `ecd` is in the past and status is not complete should show a red overdue badge on the card.
- This is a pure frontend calculation: `new Date(job.ecd) < new Date() && job.status !== 'complete'`.

### 7d. Add bulk status update
- Add a "Select" mode button to the Kanban header.
- When in select mode, job cards show checkboxes. A bottom action bar appears with "Move to → [status]" dropdown and a confirm button.
- This calls `updateJobStatus` in a `Promise.all()` for all selected job IDs.

### 7e. Verify
```bash
npm run build
npm run lint
```
Test drag and drop on both Shop Floor and Admin board views.

---

## STEP 8 — Inventory Improvements

**Goal:** Make inventory more reliable and useful.

### 8a. Fix barcode scanning reliability
- Find the barcode scanning component. Check which library it uses.
- If it uses a basic `<input>` field for manual entry, ensure it also accepts keyboard-input mode barcode scanners (they send keystrokes ending in Enter — this should already work with a standard input but verify).
- If using a camera-based scanner, add `quagga2` as a fallback decoder:
```bash
npm install @ericblade/quagga2
```
- Always show a manual SKU text input alongside the camera scanner. Never let the camera be the only input method.

### 8b. Add low stock notification on load
- When the Inventory page loads, query for items where `quantity <= reorder_point`.
- If any exist, show a persistent yellow banner at the top of the page: "X items are below reorder threshold."
- Each item in the list should have a quick "Reorder" action button.

### 8c. Add inventory transaction log view
- The `inventory_history` table exists in Supabase. Make sure there's a UI to view it.
- On each inventory item's detail page, add a "History" tab showing all transactions (who changed what, when, and by how much).

### 8d. Verify
```bash
npm run build
```

---

## STEP 9 — Reporting Dashboard

**Goal:** Turn the reporting section into something actionable and useful.

### 9a. Identify the current reports page
- Open the reporting/dashboard route. Document what's currently shown.

### 9b. Add these core reports (each as a separate tab or card):

**Labor by Job**
- Query: `shifts` joined with `jobs` → group by `job_id`, sum `duration_minutes`.
- Display: horizontal bar chart using recharts.

**Inventory Burn Rate**
- Query: `inventory_history` for the last 30 days → group by `item_id`, sum negative deltas.
- Display: table with item name, total consumed, projected days until stockout.

**On-Time Delivery Rate**
- Query: completed `jobs` → compare `ecd` vs `completed_at`.
- Display: a single percentage + sparkline of on-time rate over the last 12 weeks.

**Employee Hours Summary**
- Query: `shifts` for selected date range → group by `user_id`, sum hours.
- Display: table with employee name, total hours, breakdown by job.

### 9c. Add a date range filter
- All reports should respect a shared date range picker at the top of the page.
- Use a simple `<input type="date">` pair (from/to) stored in local component state.
- Pass the range as query parameters to each report's data fetch function.

### 9d. Add CSV export
- Add an "Export CSV" button to each report.
- Create a utility `src/lib/exportCsv.ts`:
```typescript
export function exportToCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(','),
    ...rows.map(r => headers.map(h => JSON.stringify(r[h] ?? '')).join(','))
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
```

### 9e. Verify
```bash
npm run build
npm run lint
```

---

## STEP 10 — In-App Notification System

**Goal:** Surface critical events (low stock, overdue jobs, rush jobs) without the user having to go looking.

### 10a. Create a toast notification utility
- Check if a toast library is already installed. If not:
```bash
npm install react-hot-toast
```
- In `main.tsx` or `App.tsx`, add `<Toaster position="top-right" />`.

### 10b. Create a notification context
Create `src/components/NotificationBell.tsx` — a bell icon in the header that shows a red badge count and, when clicked, shows a dropdown of recent notifications.

Create `src/lib/notifications.ts` to manage notification state:
```typescript
export type AppNotification = {
  id: string;
  type: 'low_stock' | 'overdue_job' | 'rush_job' | 'info';
  message: string;
  link?: string;
  read: boolean;
  createdAt: string;
};
```

### 10c. Wire up notification triggers
- On app load (in `AppContext.tsx` or a `useNotifications` hook), run these checks:
  - Fetch jobs where `ecd < now AND status != 'complete'` → create overdue notifications.
  - Fetch inventory where `quantity <= reorder_point` → create low stock notifications.
  - Fetch jobs where `rush = true AND status != 'complete'` → create rush job notifications.
- Store results in notification context. Show toast for any **new** ones (not previously seen, tracked in localStorage by ID).

### 10d. Add Supabase Realtime for live updates
- Supabase supports realtime subscriptions. Subscribe to job status changes:
```typescript
supabase
  .channel('job-changes')
  .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'jobs' }, (payload) => {
    queryClient.invalidateQueries({ queryKey: ['jobs'] });
    if (payload.new.status === 'complete') {
      toast.success(`Job "${payload.new.title}" marked complete`);
    }
  })
  .subscribe();
```
- This means when any user completes a job, all other users see it instantly without refreshing.

### 10e. Verify
```bash
npm run build
```

---

## STEP 11 — Mobile UX Audit

**Goal:** The time clock and job status changes must be usable on a phone with one hand.

### 11a. Audit these pages on 375px viewport (iPhone SE size)
Open Chrome DevTools → device emulation → iPhone SE for each:
- [ ] **Time Clock** — is the clock-in button large enough to tap? Is the job code scanner easily reachable?
- [ ] **Job Kanban** — can you see job cards? Can you change status?
- [ ] **Inventory** — can you search and view item details?
- [ ] **Nav menu** — does it collapse properly? Are all sections reachable?

### 11b. Add a mobile bottom navigation bar
- On screens < 768px, hide the sidebar and show a bottom nav bar instead.
- Bottom nav should have 4-5 icons: Home/Dashboard, Jobs, Inventory, Time Clock, Profile.
- Use Tailwind's `hidden md:flex` / `flex md:hidden` pattern to toggle between sidebar and bottom nav.

### 11c. Make the clock-in button massive on mobile
- The clock-in/clock-out button is the most used element for shop floor workers.
- On mobile, it should be at least `h-24` (96px tall) with a clear icon and label.
- Consider adding a dedicated "Quick Clock" view that's just the big button + job code input, accessible from the bottom nav.

### 11d. Verify
Test on real mobile device or Chrome DevTools at 375px width.

---

## STEP 12 — Global Search

**Goal:** Let users find anything (jobs, inventory items, employees) from anywhere in the app.

### 12a. Create a search command palette
```bash
npm install cmdk
```
- Create `src/components/CommandPalette.tsx` that opens on `Cmd+K` / `Ctrl+K`.
- The palette searches across: job titles/IDs, inventory item names/SKUs, and employee names.
- Each result shows its type (Job/Inventory/Employee) and navigates to the detail page on selection.

### 12b. Wire up keyboard shortcut
In `App.tsx`:
```typescript
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      setCommandPaletteOpen(true);
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, []);
```

### 12c. Make search queries use Supabase full-text search
```typescript
const { data } = await supabase
  .from('jobs')
  .select('id, title, status')
  .textSearch('title', query, { type: 'websearch' });
```

### 12d. Verify
```bash
npm run build
```
Test: press Cmd+K, type a job name, confirm result appears and navigates correctly.

---

## STEP 13 — Test Coverage Expansion

**Goal:** Add tests for critical workflows so future changes don't silently break things.

### 13a. Add component tests for auth flow
Create `src/test/auth.test.tsx`:
- Test: unauthenticated user visiting a protected route is redirected to `/login`.
- Test: admin user can access `/admin` route.
- Test: employee user is redirected away from `/admin`.

### 13b. Add integration tests for Time Clock
Create `src/test/timeClock.test.tsx`:
- Test: clock-in creates a shift record with correct userId, timestamp, and optional jobCode.
- Test: clock-out on a non-existent active shift returns an error (does not crash).
- Test: offline queue stores punch when API call fails.

### 13c. Add inventory calculation tests
These likely already exist in `src/lib/inventoryCalculations.test.ts`. Verify and add:
- Test: allocated stock calculation correctly subtracts job-committed inventory from available.
- Test: low stock detection correctly identifies items at or below reorder point.

### 13d. Run full test suite
```bash
npm run test
```
All tests must pass. Fix any failures before moving to Step 14.

---

## STEP 14 — CI/CD Pipeline Hardening

**Goal:** Ensure the GitHub Actions pipeline catches problems before they reach production.

### 14a. Audit `.github/workflows/`
- Open each workflow file. Check what it currently runs.
- The main branch workflow should run, in order:
  1. `npm ci`
  2. `npm run lint`
  3. `npm run build` (TypeScript type check happens here)
  4. `npm run test`
- If any step is missing, add it.

### 14b. Add a PR check workflow
Create `.github/workflows/pr-check.yml` if it doesn't exist:
```yaml
name: PR Check
on:
  pull_request:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm run build
      - run: npm run test
```

### 14c. Add branch protection
- In GitHub repo settings → Branches → Add rule for `main`:
  - Require status checks to pass before merging.
  - Select the PR Check workflow.
  - Require at least 1 review (even if it's yourself — forces deliberate merges).

### 14d. Verify
Push a small change on a branch, open a PR, confirm the workflow runs and passes.

---

## STEP 15 — Final Cleanup & Documentation Update

**Goal:** Leave the codebase clean and documented for future development.

### 15a. Update README.md
Replace the current README with an accurate one that reflects the current stack:
- Remove all PocketBase setup instructions.
- Remove Docker and Node server references.
- Add Supabase setup instructions (create project, run migrations, set env vars).
- Add Netlify deployment instructions (connect repo, set env vars).
- Update the `.env.example` to only contain Supabase and Netlify variables.

### 15b. Update SYSTEM_MASTERY.md
- Add a section for the new state management architecture (TanStack Query).
- Add a section describing the Netlify functions and what each one does.
- Add a section on the offline clock queue.
- Remove all PocketBase references.

### 15c. Clean up `.env` templates
- `.env.example`, `.env.template`, `.env.production.example` should all only reference:
  ```
  VITE_SUPABASE_URL=
  VITE_SUPABASE_ANON_KEY=
  ```
- Remove `VITE_POCKETBASE_URL` from every env template.

### 15d. Final build and test
```bash
npm run lint
npm run test
npm run build
```
All must pass with zero errors.

### 15e. Final manual smoke test
Walk through every major flow manually:
- [ ] Login as admin → view dashboard → no errors
- [ ] Login as employee → clock in → verify shift created in Supabase
- [ ] Create a new job → move it through statuses on Kanban
- [ ] Add inventory item → allocate it to a job → verify available qty decreases
- [ ] View a report → export CSV → confirm file downloads correctly
- [ ] Test on mobile (375px) → clock in/out works → job status change works
- [ ] Disable network → attempt clock-in → confirm offline queue stores punch → re-enable network → confirm punch syncs

---

## APPENDIX: New Dependencies Added by This Script

| Package | Purpose | Step |
|---|---|---|
| `@tanstack/react-query` | Server state management | Step 4 |
| `@dnd-kit/core` + `@dnd-kit/sortable` | Kanban drag-and-drop | Step 7 |
| `@ericblade/quagga2` | Barcode scanning fallback | Step 8 |
| `react-hot-toast` | Toast notifications | Step 10 |
| `cmdk` | Command palette / global search | Step 12 |

## APPENDIX: Packages to Remove

| Package | Reason |
|---|---|
| `pocketbase` | Replaced by Supabase |
| `express` / `cors` / `node-fetch` | Node server removed |
| Any other server-only packages found in Step 1 |

---

*This script was generated based on the WorkTrackPro repository at https://github.com/jacobrrough/WorkTrackPro — React 19 + TypeScript + Vite + Tailwind + Supabase + Netlify stack.*

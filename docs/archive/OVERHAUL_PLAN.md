# WorkTrackPro — Complete Overhaul Plan

## Tech Stack (Actual)

- **Frontend:** React 19, TypeScript, Vite 6, Tailwind CSS  
- **Backend:** PocketBase (single executable, no Node/Express)  
- **Styling:** Tailwind with custom purple/dark theme; Material Symbols for icons  
- **No:** ESLint in project, tests, React Router (custom view state in App)

---

## 1. Overall Analysis

### Strengths

- **TypeScript** used consistently with clear domain types (`Job`, `Shift`, `InventoryItem`, etc.) in `src/types.ts`.
- **Feature set** is broad: jobs (Kanban), inventory (allocated/available, ordering), time clock, time reports, attachments, comments, checklists, bin locations.
- **PocketBase** gives auth, realtime potential, and file storage without a custom backend.
- **Validation** module (`validation.ts`) covers job codes, email, quantities, bin location, etc.
- **Error boundary** and **toast** system exist; **debounce/throttle** hooks present.
- **Inventory logic** is documented in `INVENTORY_LOGIC.md` and implemented (allocated/available, reconciliation on delivery).
- **Responsive** considerations (e.g. `max-w-2xl lg:max-w-4xl`, bottom nav, safe-area).

### Weaknesses

| Area | Issues |
|------|--------|
| **Modularity** | Single `pocketbase.ts` (~600 lines) with all API logic; `AppContext.tsx` is very large (~440 lines) with mixed state + business logic; `App.tsx` holds navigation, view routing, and many handlers. |
| **Navigation** | Custom view state + stack in App; no React Router — deep links, browser back, and code-splitting by route are harder. |
| **Realtime** | Realtime subscriptions disabled; manual refresh only — no live updates for jobs/shifts/inventory. |
| **Performance** | `getFullList()` for jobs loads everything (attachments/comments batched but still all jobs); no pagination; Kanban loads checklist state per job in a loop. |
| **Security** | Login uses PocketBase auth; no visible rate limiting, CSRF, or strict input validation on all forms; some `any` types and `data: any` in handlers. |
| **Testing** | No tests (no Jest/Vitest in project `package.json`). |
| **Linting** | No ESLint/Prettier in project. |
| **Design** | Purple/dark theme is consistent but single theme; no design tokens file; some duplicated column configs (e.g. KanbanBoard vs types). |
| **Accessibility** | Some `aria-label`s; no systematic focus management, skip links, or high-contrast support. |
| **Error handling** | Many `alert()` in forms (e.g. AddInventoryItem); inconsistent user-facing errors; console.log/emoji in production code. |
| **Duplication** | Two ErrorBoundary implementations (index.tsx and ErrorBoundary.tsx); column definitions repeated. |
| **DevOps** | Vite config hardcodes HTTPS cert paths and proxy target IP; no Docker or CI/CD in repo. |

### Major Issues Summary

- **Code smells:** Monolithic services and context, `any` in places, `console.log` in production paths, duplicated boundaries and config.
- **Security:** Relies on PocketBase; no project-level ESLint/security rules; forms could use validation more consistently.
- **Performance:** Full-list fetches, N+1-style checklist loading in Kanban, no virtualization for long lists.
- **Outdated patterns:** Custom navigation instead of router; no realtime; no tests or lint.

---

## 2. Functionality Improvements

### 2.1 Refactoring for Modularity

**Split API layer into feature modules:**

- `src/services/api/`  
  - `client.ts` — create PocketBase instance, `beforeSend`, base URL.  
  - `auth.ts` — `checkAuth`, `login`, `logout`.  
  - `users.ts` — `getAllUsers`.  
  - `jobs.ts` — job CRUD, comments, attachments, job_inventory.  
  - `shifts.ts` — list, clockIn, clockOut.  
  - `inventory.ts` — list, create, update, updateStock.  
  - `inventoryHistory.ts` — create, getHistory, getAllHistory.  
- Keep `src/types.ts` as shared types; services import from there.
- Optionally add `src/hooks/useJobs.ts`, `useShifts.ts`, `useInventory.ts` that call these services and cache (or use React Query later).

**Break down AppContext:**

- Keep `AppContext` for: `currentUser`, `authError`, `isLoading`, `login`, `logout`, and “refresh” triggers.
- Move “domain” state and actions into either:
  - Custom hooks that use the new services (e.g. `useJobs()`, `useShifts()`), or  
  - A small number of focused contexts (e.g. `JobsContext`, `InventoryContext`) if you prefer context over hooks.
- Move “computed” logic (e.g. `calculateAllocated`, `calculateAvailable`) into `src/lib/inventoryCalculations.ts` and use it from hooks/context.

**Break down App.tsx:**

- Introduce a router (e.g. React Router) with routes: `/`, `/login`, `/dashboard`, `/jobs`, `/jobs/:id`, `/inventory`, `/inventory/:id`, `/time`, `/clock-in`, `/admin/...`.
- Extract “view” components that only need route params + context/hooks (e.g. `DashboardView`, `JobDetailView`) and keep routing and layout in `App.tsx` or a `Shell` component.
- Move handlers (e.g. `handleCreateJob`, `handleClockIn`) into custom hooks or view components so App only composes and passes minimal props.

**Reusable UI:**

- Extract shared pieces: `PageHeader`, `Card`, `FormField`, `StatusBadge`, `ConfirmDialog` (you have `ConfirmDialog.tsx` — use it consistently), `EmptyState`.
- Use a single `ErrorBoundary` from `ErrorBoundary.tsx` and remove the duplicate from `index.tsx`.

### 2.2 Optimizations

**Inventory:**

- In `getAllJobs`, you already batch attachments/comments; ensure `expand` is minimal and only request needed fields where possible.
- For “needs ordering,” compute on the client from existing inventory list (you already have `calculateAvailable`); no extra query needed.
- For very large inventories, add server-side filter/sort and pagination (PocketBase `getList(1, pageSize, { filter, sort })`) and infinite scroll or pagination in the UI.

**Time tracking:**

- Keep duration calculation in one place (e.g. `src/lib/timeUtils.ts`: `durationMs(clockIn, clockOut?)`, `formatDuration(ms)`).
- Use the same helpers in Dashboard, JobDetail, and TimeReports to avoid drift and duplication.

**Job scheduling / Kanban:**

- Load checklist counts in one batch request (e.g. `filter: 'job = "id1" || job = "id2" ...'`) or a dedicated “checklist summary” API if you add one, instead of one request per job in `useEffect`.
- For “active” jobs, consider a filter like `active = true` and paginate or limit to “current” time window to avoid loading hundreds of jobs when not needed.

**General:**

- Add request deduplication for the same `getJobById(id)` when multiple components need it (e.g. in a hook with a simple in-memory cache keyed by id).
- Use `useDeferredValue` or virtualization (e.g. `react-window`) for long lists (job list, inventory list, time report table).

### 2.3 Missing Features / Enhancements

- **Realtime:** Re-enable PocketBase realtime for `jobs`, `shifts`, `inventory` (fix proxy/URL so `/api/realtime` works), and update context/hooks state on create/update/delete so UIs stay in sync without manual refresh.
- **Automated backups:** Use PocketBase admin API or cron to backup SQLite (or your DB) regularly; document in README.
- **Invoicing:** If needed, add an “Invoices” or “Billing” module: new PocketBase collection(s), UI to create invoices from jobs/shifts, and optional PDF export.
- **Reporting dashboard:** Add a dedicated “Reports” view: charts (e.g. Chart.js or Recharts) for hours by job/user, inventory turnover, low-stock alerts; reuse existing filters (date range, user).
- **API integrations:** Optional webhooks (PocketBase hooks) or a small serverless function for “job created” → calendar or email; keep core in PocketBase.

### 2.4 Scalability

- **Pagination:** Use PocketBase `getList(page, perPage)` for jobs, shifts, inventory; keep `perPage` (e.g. 50) and add “Load more” or pagination controls.
- **Concurrent users:** PocketBase can handle many connections; ensure auth refresh and token handling are robust (you already have refresh and idle timeout).
- **Large inventory:** Indexed filters and pagination; avoid loading full list for dropdowns — use search/autocomplete that queries the API.

### 2.5 Code Snippets (Critical Changes)

**Service client (single instance):**

```ts
// src/services/api/client.ts
import PocketBase from 'pocketbase';

const POCKETBASE_URL = import.meta.env.VITE_POCKETBASE_URL || 'http://192.168.1.100:8090';
export const pb = new PocketBase(POCKETBASE_URL);
pb.autoCancellation(false);

pb.beforeSend = (url, options) => {
  if (url.includes('/api/realtime')) {
    const urlObj = new URL(url);
    return { url: urlObj.pathname + urlObj.search, options };
  }
  return { url, options };
};
```

**Inventory calculations (extract from context):**

```ts
// src/lib/inventoryCalculations.ts
import type { Job, InventoryItem } from '../types';

const ACTIVE_STATUSES = ['pod', 'rush', 'pending', 'inProgress', 'qualityControl', 'finished'] as const;

export function calculateAllocated(
  inventoryId: string,
  jobs: Job[]
): number {
  let allocated = 0;
  for (const job of jobs) {
    if (!ACTIVE_STATUSES.includes(job.status)) continue;
    const jobInv = job.expand?.job_inventory_via_job ?? job.expand?.job_inventory ?? [];
    for (const ji of jobInv) {
      const invId = typeof ji.inventory === 'string' ? ji.inventory : ji.inventory?.id;
      if (invId === inventoryId) allocated += ji.quantity || 0;
    }
  }
  return allocated;
}

export function calculateAvailable(item: InventoryItem, allocated: number): number {
  return Math.max(0, item.inStock - allocated);
}
```

**Time utility (single place):**

```ts
// src/lib/timeUtils.ts
export function durationMs(clockIn: string, clockOut?: string | null): number {
  const start = new Date(clockIn).getTime();
  const end = clockOut ? new Date(clockOut).getTime() : Date.now();
  return end - start;
}

export function formatDuration(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return [h, m, s].map(n => n.toString().padStart(2, '0')).join(':');
}
```

---

## 3. Intuitiveness (UI/UX) Enhancements

### 3.1 User Flows

- **Dashboard:** One primary action per role (e.g. “Clock in” or “Continue job” for workers; “Create job” for admins); keep “Recent shifts” and “Quick scan” prominent; add a clear “Needs ordering” link if there are low-stock items.
- **Clock-in:** Default to “Scan or enter job code” with large input; show last-used jobs as shortcuts; clear feedback when already clocked in.
- **Inventory:** “All Items” vs “Ordering” tabs are good; add a search/filter bar at top; “Add item” as a FAB or fixed header button.
- **Job detail:** Keep sections (status, materials, comments, attachments) in a predictable order; “Edit” mode with explicit Save/Cancel; confirm before status change to “Delivered” (material reconciliation).

### 3.2 Accessibility

- Add `aria-label` to all icon-only buttons (e.g. logout, close, add).
- Ensure focus moves to modal content when a modal opens and returns to trigger on close (e.g. `useRef` + `useEffect`).
- Add a “Skip to main content” link at the top.
- Check color contrast (e.g. `text-slate-400` on dark) against WCAG AA; increase contrast or use an outline for critical actions.
- Support keyboard: Enter to submit forms, Escape to close modals, Tab order logical.

### 3.3 Error Handling and Onboarding

- Replace `alert()` with toast or inline form errors (reuse `useToast` and a small `FieldError` component).
- For failed API calls, show a toast and optional “Retry” where appropriate.
- Optional short onboarding: first-time tooltips or a one-time “Tour” (e.g. “Dashboard → Clock in → Job detail”) using a library like React Joyride.

### 3.4 Responsive Design

- Bottom nav is good for mobile; on desktop consider a side nav or top nav so content has more width.
- Tables (e.g. Time Reports) should scroll horizontally or collapse to cards on small screens.
- Ensure touch targets are at least 44px and spacing is consistent (Tailwind spacing scale).

---

## 4. Aesthetics and Professional Look

### 4.1 Design System

- **Theme:** Keep purple as primary but define a small design tokens file (e.g. `tailwind.config.js` or `src/theme.ts`) with:
  - Primary, secondary, success, warning, error.
  - Background (dark), surface (cards), border.
  - Typography: font family, sizes, weights.
- **Material Symbols:** Already in use; ensure one variant (e.g. outlined) and consistent size (e.g. `text-2xl` for nav, `text-xl` for buttons).

### 4.2 Color and Typography

- **Palette suggestion (enterprise):** Primary `#4F46E5` (indigo) or keep `#9333ea` (purple); neutrals `slate`; success `emerald`, error `red`, warning `amber`.
- **Typography:** Use a single font stack (e.g. `Inter` or `DM Sans`) in `index.css` and Tailwind; headings one step bolder and one size up.
- **Whitespace:** Use consistent padding (e.g. `p-4` for cards, `gap-4` for grids); avoid cramped blocks.

### 4.3 Consistency

- One `Card` component (rounded, border, padding) for dashboard cards, job cards, and list items.
- One `Button` variant set: primary, secondary, ghost, danger.
- Status badges: one component that takes `status` and maps to color (reuse `getStatusDisplayName` and a single color map).

### 4.4 CSS / Layout Examples

**Tailwind design tokens (extend):**

```js
// tailwind.config.js - extend theme
theme: {
  extend: {
    colors: {
      primary: {
        DEFAULT: '#9333ea',
        hover: '#7e22ce',
        muted: 'rgba(147, 51, 234, 0.2)',
      },
      surface: {
        dark: '#1a0c2e',
        card: '#1e0f2e',
      },
    },
    fontFamily: {
      sans: ['Inter', 'system-ui', 'sans-serif'],
    },
  },
},
```

**Dashboard card (wireframe):**

- Container: `bg-surface-card border border-white/10 rounded-xl p-4`.
- Title: `text-lg font-semibold text-white`.
- Subtext: `text-sm text-slate-400`.
- Primary action: `bg-primary text-white px-4 py-2 rounded-lg font-medium`.

---

## 5. Professional Best Practices

### 5.1 Code Standards

- Add **ESLint** (e.g. `eslint.config.js` with `typescript-eslint`, `react-hooks`, `react/jsx-no-leaked-render`).
- Add **Prettier** and format on save; ensure Tailwind class order (e.g. `prettier-plugin-tailwindcss`).
- Strict TypeScript: `"strict": true`; replace `any` with proper types (e.g. `Record<string, unknown>` or specific interfaces).
- Remove or guard `console.log` in production (e.g. strip in build or use a small logger that no-ops in prod).

### 5.2 Testing

- **Unit:** Vitest for pure functions: `validation.ts`, `inventoryCalculations.ts`, `timeUtils.ts`.
- **Integration:** Vitest + React Testing Library for key flows: login, clock-in, add job, add inventory item (mock PocketBase or use `pb.collection().getList` mock).
- **E2E (optional):** Playwright or Cypress for “login → open job → add comment” and “clock in → clock out.”

Example (Vitest) for validation:

```ts
// src/validation.test.ts
import { describe, it, expect } from 'vitest';
import { validateJobCode, validateBinLocation } from './validation';

describe('validateJobCode', () => {
  it('accepts valid code', () => {
    expect(validateJobCode(123)).toBeNull();
    expect(validateJobCode(999999)).toBeNull();
  });
  it('rejects invalid', () => {
    expect(validateJobCode(0)).not.toBeNull();
    expect(validateJobCode(1000000)).not.toBeNull();
  });
});
```

### 5.3 Security

- **Input:** Use `validation.ts` on all form submits (job code, email, quantities, bin location); sanitize comment text (you have `sanitizeInput`).
- **Auth:** Rely on PocketBase; ensure HTTPS in production; keep token refresh and idle timeout.
- **Sensitive data:** Don’t log passwords or tokens; if you add env-based config, document that secrets stay in env (e.g. `.env` not committed).

### 5.4 Documentation

- **README:** Project name, one-line description, tech stack (React, TypeScript, Vite, PocketBase, Tailwind), how to run (env vars, `npm run dev`, PocketBase URL), and link to PocketBase server folder.
- **API:** Document PocketBase collections and main fields (or point to PocketBase admin schema); optional OpenAPI for any future REST wrapper.
- **Inline:** JSDoc for public service functions and complex business logic (e.g. `calculateAllocated`).

### 5.5 Deployment

- **CI:** GitHub Actions (or similar): install, lint, typecheck, test, build on push/PR.
- **Docker:** Optional `Dockerfile` for the Vite app (multi-stage build, serve with nginx); optional `docker-compose` with PocketBase for local dev.
- **Env:** Use `VITE_POCKETBASE_URL` for API URL; avoid hardcoding IP in `vite.config.ts` (e.g. proxy target from env or keep for local only and document).

---

## 6. Implementation Plan (Prioritized Roadmap)

| Step | Task | Effort | Tools / Notes |
|------|------|--------|----------------|
| 1 | Add ESLint + Prettier; fix critical lint/type issues | Low | eslint, prettier, typescript-eslint |
| 2 | Extract `src/services/api/*` and `src/lib/inventoryCalculations.ts`, `timeUtils.ts` | Medium | — |
| 3 | Replace duplicate ErrorBoundary; use single component from `ErrorBoundary.tsx` in `index.tsx` | Low | — |
| 4 | Add React Router; routes for login, dashboard, jobs, job/:id, inventory, time, clock-in, admin | Medium | react-router-dom |
| 5 | Replace `alert()` with toast + inline errors in AddInventoryItem and similar forms | Low | useToast |
| 6 | Add Vitest + unit tests for validation and inventory/time utils | Medium | vitest |
| 7 | Introduce design tokens in Tailwind; standardize Card/Button/StatusBadge | Low–Medium | tailwind.config.js |
| 8 | Pagination for jobs list and inventory list (API + UI) | Medium | PocketBase getList |
| 9 | Re-enable PocketBase realtime and wire to state | Medium | pb.realtime |
| 10 | Batch Kanban checklist loading (single or few requests) | Low | pb.collection().getFullList with filter |
| 11 | Optional: React Query (or SWR) for server state and cache | Medium | @tanstack/react-query |
| 12 | Accessibility pass: aria-labels, focus, contrast | Medium | Manual + axe-core |
| 13 | Docker + CI (lint, typecheck, test, build) | Medium | Docker, GitHub Actions |
| 14 | README and env documentation | Low | — |

### Files to Modify

- `package.json` — add scripts: lint, format, test; add devDeps: eslint, prettier, vitest, react-router-dom (if used).
- `src/index.tsx` — use `ErrorBoundary` from `ErrorBoundary.tsx`; wrap app with `BrowserRouter` if using router.
- `src/App.tsx` — reduce to router + layout; move view logic to route components.
- `src/AppContext.tsx` — slim down; move calculations to `src/lib`, API calls to `src/services/api`.
- `src/pocketbase.ts` — split into `src/services/api/*` (see above).
- `src/Dashboard.tsx`, `JobDetail.tsx`, `TimeReports.tsx`, `Inventory.tsx`, etc. — use new hooks/services; replace alerts with toasts.
- `tailwind.config.js` — extend with design tokens.
- `vite.config.ts` — make proxy URL configurable (env); optional test config for Vitest.

### Files to Create

- `src/services/api/client.ts`, `auth.ts`, `users.ts`, `jobs.ts`, `shifts.ts`, `inventory.ts`, `inventoryHistory.ts`.
- `src/lib/inventoryCalculations.ts`, `src/lib/timeUtils.ts`.
- `src/components/ui/Card.tsx`, `Button.tsx`, `StatusBadge.tsx` (optional but recommended).
- `eslint.config.js`, `.prettierrc`, `src/validation.test.ts`, `src/lib/timeUtils.test.ts`.
- Optional: `src/routes.tsx` or route config; `Dockerfile`, `.github/workflows/ci.yml`.

### Files to Delete

- None required; after migration to `src/services/api/*`, the old `src/pocketbase.ts` can be removed once all imports are updated.

---

## 7. Refactored Versions of Key Sections

### 7.1 index.tsx — Single ErrorBoundary + Router (optional)

```tsx
// src/index.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AppProvider } from './AppContext';
import { ToastProvider } from './Toast';
import ErrorBoundary from './ErrorBoundary';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <BrowserRouter>
      <AppProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AppProvider>
    </BrowserRouter>
  </ErrorBoundary>
);
```

### 7.2 Design tokens (tailwind.config.js)

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#9333ea',
          hover: '#7e22ce',
          muted: 'rgba(147, 51, 234, 0.2)',
        },
        'background-dark': '#0f0218',
        'background-light': '#1a0c2e',
        'card-dark': '#1e0f2e',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Avenir', 'Helvetica', 'Arial', 'sans-serif'],
      },
      animation: {
        'slide-in-right': 'slideInRight 0.3s ease-out',
        'fade-in': 'fadeIn 0.2s ease-out',
        'scan-line': 'scanLine 2s ease-in-out infinite',
      },
      keyframes: {
        slideInRight: {
          '0%': { transform: 'translateX(100%)', opacity: 0 },
          '100%': { transform: 'translateX(0)', opacity: 1 },
        },
        fadeIn: { '0%': { opacity: 0 }, '100%': { opacity: 1 } },
        scanLine: {
          '0%, 100%': { transform: 'translateY(0)', opacity: 0.8 },
          '50%': { transform: 'translateY(256px)', opacity: 1 },
        },
      },
    },
  },
  plugins: [],
};
```

### 7.3 AddInventoryItem — Toast instead of alert

```tsx
// In AddInventoryItem.tsx - add at top:
import { useToast } from './Toast';

// Inside component:
const { showToast } = useToast();

// Replace validation and error handling in handleSubmit:
const handleSubmit = async () => {
  if (!name.trim()) {
    showToast('Name is required', 'error');
    return;
  }
  if (!unit.trim()) {
    showToast('Unit is required', 'error');
    return;
  }
  setIsSaving(true);
  try {
    const success = await onAdd({ ... });
    if (success) {
      showToast('Item added', 'success');
      onCancel();
    } else {
      showToast('Failed to add item', 'error');
    }
  } catch (error) {
    showToast('Error adding item', 'error');
  }
  setIsSaving(false);
};
```

---

If you want to proceed step-by-step, a good order is: (1) ESLint/Prettier + remove duplicate ErrorBoundary, (2) extract services and lib, (3) add router and slim App/Context, (4) toasts and tests, (5) design tokens and accessibility.

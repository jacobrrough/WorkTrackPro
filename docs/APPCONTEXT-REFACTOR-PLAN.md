# AppContext refactor plan

AppContext is a ~1,370-line single file that owns auth, TanStack Query wiring for jobs/shifts/users/inventory, all mutations (jobs, inventory, attachments, clock, etc.), and derived state (activeShift, activeJob, calculateAvailable/Allocated, pendingOfflinePunchCount). This plan outlines a way to split it into smaller, testable pieces without a big-bang rewrite.

## Goals

- **Smaller surface area** – Easier to reason about, fewer dependency-array headaches.
- **Clear boundaries** – Auth vs server state vs mutations.
- **Testability** – Hooks and modules that can be unit-tested without mounting the full tree.
- **Same public API** – Keep `useApp()` (or a thin facade) so existing components don’t need to change at first.

## Current shape (simplified)

```
AppProvider
├── Auth state: currentUser, isLoading, authError, login, signUp, logout, resetPasswordForEmail
├── Queries (TanStack Query): jobs, shifts, users, inventory
├── Derived: activeShift, activeJob, inventoryForRole (withComputedInventory), pendingOfflinePunchCount
├── Refresh: refreshJobs, refreshJob, refreshShifts, refreshUsers, refreshInventory
├── Job mutations: createJob, updateJob, deleteJob, updateJobStatus, advanceJobToNextStatus, addJobComment, getJobByCode
├── Clock: clockIn, clockOut, startLunch, endLunch (plus offline queue)
├── Inventory: createInventory, updateInventoryItem, updateInventoryStock, addJobInventory, allocateInventoryToJob, removeJobInventory, markInventoryOrdered, receiveInventoryOrder
├── Attachments: addAttachment, deleteAttachment, updateAttachmentAdminOnly, addInventoryAttachment, deleteInventoryAttachment
└── Helpers: calculateAvailable, calculateAllocated
```

## Phase 1: Extract auth (low risk)

**New:** `contexts/AuthContext.tsx` (or `hooks/useAuth.ts`)

- State: `currentUser`, `isLoading`, `authError`
- Actions: `login`, `signUp`, `logout`, `resetPasswordForEmail`
- No TanStack Query; just Supabase auth + profile fetch if needed.

**AppContext:** Imports `useAuth()`, re-exposes the same auth fields and actions (or components use `useAuth()` directly later). Auth logic moves out of AppContext.

**Benefit:** Auth can be tested and reused (e.g. in a future “login only” shell) without loading jobs/inventory.

---

## Phase 2: Extract server-state layer (medium risk)

**New:** `hooks/useAppQueries.ts` (or keep in context but in a separate file)

- Runs the four `useQuery` calls (jobs, shifts, users, inventory).
- Returns `{ jobs, shifts, users, inventory, refreshJobs, refreshJob, refreshShifts, refreshUsers, refreshInventory }`.
- Takes `enabled: boolean` (e.g. `!!currentUser && currentUser.isApproved !== false`).

**AppContext:** Uses this hook and passes through the returned values. No change to component API.

**Benefit:** Query keys and refetch logic live in one place; easier to add more queries or switch to a different pattern later.

---

## Phase 3: Extract mutation modules (medium risk)

**Option A – Hooks per domain**

- `hooks/useJobMutations.ts` – createJob, updateJob, deleteJob, updateJobStatus, advanceJobToNextStatus, addJobComment; uses `useQueryClient` and `jobService`; returns stable callbacks.
- `hooks/useInventoryMutations.ts` – createInventory, updateInventoryItem, updateInventoryStock, addJobInventory, allocateInventoryToJob, removeJobInventory, markInventoryOrdered, receiveInventoryOrder; uses `inventoryService`, `jobService`, `inventoryHistoryService`, and the “queries” hook for refresh + calculateAvailable/Allocated.
- `hooks/useAttachmentMutations.ts` – addAttachment, deleteAttachment, updateAttachmentAdminOnly, addInventoryAttachment, deleteInventoryAttachment.
- `hooks/useClockMutations.ts` – clockIn, clockOut, startLunch, endLunch; encapsulates offline queue and shift refresh.

**Option B – Same but as plain functions in `lib/` or `services/`**

- E.g. `createJobMutations(queryClient) => { createJob, updateJob, ... }`. AppContext (or a single “mutations” hook) calls these once and puts the result in context.

**AppContext:** Becomes a composition layer: `useAuth()` + `useAppQueries(enabled)` + `useJobMutations()` + … and builds the single `contextValue` object that `useApp()` returns. No business logic in AppContext, only wiring.

**Benefit:** Each mutation bundle can be tested with a mock query client and mock services; no need to render the full provider.

---

## Phase 4: Derive state in hooks (low risk)

- **activeShift / activeJob** – Move to `hooks/useActiveShift.ts`: takes `currentUser`, `shifts`, `jobs`; returns `{ activeShift, activeJob }`.
- **calculateAvailable / calculateAllocated** – Already delegate to `lib/inventoryCalculations`. Keep them in context as thin wrappers that take `jobs` from context, or move to a small `useInventoryAllocation(jobs)` hook.
- **inventoryForRole** – `withComputedInventory(inventory, …)` stays in AppContext or moves into `useAppQueries` / a dedicated `useInventoryForRole(inventory, jobs, isAdmin)`.

**Benefit:** Less logic inside the giant `useMemo` for `contextValue`; dependency arrays become obvious.

---

## Phase 5: Optional – Split context by domain

If you want to go further:

- **AuthContext** – `useAuth()` (already in Phase 1).
- **ServerStateContext** – Exposes `jobs`, `shifts`, `users`, `inventory`, refresh functions, and maybe `calculateAvailable` / `calculateAllocated` (they depend on `jobs`). Consumed by components that only need read + refresh.
- **MutationsContext** – Exposes all mutation callbacks; consumes ServerStateContext (or the same query client) for invalidation/updates.

Then a single **AppContext** (or **AppProvider**) only composes these and, if desired, still exposes one combined object for `useApp()` so existing code keeps working while you gradually migrate components to `useAuth()`, `useJobs()`, etc.

---

## Suggested order

1. **Phase 1** – Extract auth; keep AppContext re-exporting it. Low risk, immediate clarity.
2. **Phase 4** – Extract `useActiveShift` and, if helpful, `useInventoryAllocation`. Small files, easy to test.
3. **Phase 2** – Extract `useAppQueries`. Reduces AppContext size and centralizes query keys.
4. **Phase 3** – Extract mutation hooks (start with `useJobMutations` and `useClockMutations`; they’re self-contained). Then inventory and attachments.

Avoid doing Phase 3 and 5 at the same time; do Phase 3 first so the single context stays the integration point, then Phase 5 only if you want multiple contexts.

---

## What stays in AppContext during refactor

- Composing the new hooks and building the one `contextValue` object.
- Any logic that truly depends on multiple domains (e.g. “after clock-in, invalidate shifts and update active shift”) until that’s moved into a hook.
- The `useApp()` export and its type, so call sites don’t need to change until you choose to migrate them.

---

## Files to add (example)

| File | Purpose |
|------|--------|
| `contexts/AuthContext.tsx` | Auth state + login/signUp/logout/resetPassword |
| `hooks/useAppQueries.ts` | jobs, shifts, users, inventory + refresh |
| `hooks/useActiveShift.ts` | activeShift, activeJob from currentUser + shifts + jobs |
| `hooks/useJobMutations.ts` | createJob, updateJob, deleteJob, updateJobStatus, advanceJobToNextStatus, addJobComment, getJobByCode |
| `hooks/useClockMutations.ts` | clockIn, clockOut, startLunch, endLunch + offline queue |
| `hooks/useInventoryMutations.ts` | All inventory/job-inventory mutations |
| `hooks/useAttachmentMutations.ts` | Job + inventory attachment mutations |

After refactor, `AppContext.tsx` becomes a short composition file that uses these hooks and provides `AppContext.Provider value={...}`.

---

## Testing strategy

- **AuthContext** – Test with a mock Supabase auth client; assert login/signUp/logout set state and call the client.
- **useAppQueries** – Test with MockedProvider (TanStack Query); assert query keys and that refetch invalidates the right keys.
- **useJobMutations** – Test with mock `jobService` and `queryClient.invalidateQueries`; assert create/update/delete call the service and invalidate `['jobs']`.
- **useClockMutations** – Test offline queue (enqueue, sync) and that clockIn/clockOut call shiftService and invalidate shifts.

No need to test the full AppContext integration in one go; test each extracted hook in isolation.

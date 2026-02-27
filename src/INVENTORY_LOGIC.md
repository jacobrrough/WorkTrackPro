# Inventory Stock Reconciliation Logic

## Stock Fields:
- **inStock**: Total physical inventory in warehouse
- **available**: Stock available for allocation (inStock - allocated), computed in app
- **allocated**: Stock assigned to active jobs (calculated from jobs + job_inventory via `inventoryCalculations.buildAllocatedByInventoryId`)
- **onOrder**: Stock ordered from vendors (pending receipt)

## Stock Lifecycle:

### 1. Adding New Inventory
```
inStock = [user input]
available = inStock  // initially equals inStock
allocated = 0        // no jobs yet
onOrder = 0          // nothing ordered yet
```

### 2. Allocating to Job (when materials added to job)
```
allocated += quantity   // from job_inventory rows for active-status jobs
available -= quantity   // available = inStock - allocated (computed)
inStock stays the same  // physical stock unchanged
```

### 3. Job Delivered (materials consumed)
```
inStock -= allocated_for_this_job
allocated -= allocated_for_this_job
available stays the same  // already subtracted when allocated
```

### 4. Marking Order (requesting from vendor)
```
onOrder += quantity
// inStock and available unchanged (not received yet)
```

### 5. Receiving Order (full or partial)
```
receivedQty = [user input]
inStock += receivedQty
available += receivedQty
onOrder -= receivedQty
```

## Calculation Functions (current app)

Allocation and available are computed in the app; do not trust `inventory.available` from the DB for display.

### Calculate Allocated (from all active jobs)
- **Source:** `src/lib/inventoryCalculations.ts`
- **Function:** `buildAllocatedByInventoryId(jobs)` returns `Map<inventoryId, quantity>`
- **Function:** `calculateAllocated(inventoryId, jobs)` returns the allocated quantity for one item
- Active statuses (count toward allocated): `pod`, `rush`, `pending`, `inProgress`, `qualityControl`, `finished` (see `ACTIVE_ALLOCATION_STATUSES`)

Jobs are loaded with relation `job_inventory` (or `job_inventory_via_job` for schema compat). Each job’s `expand.job_inventory` / `expand.job_inventory_via_job` is an array of `{ inventory_id, quantity, ... }`.

### Calculate Available
```typescript
available = Math.max(0, inStock - allocated);
```
- **Source:** `calculateAvailable(item, allocated)` in `src/lib/inventoryCalculations.ts`

### Low Stock Check
```typescript
const needsReordering = available < reorderPoint;
```

## Supabase / App logic

### On Receive Order:
- **Service:** `inventoryService.receiveOrder` (or equivalent) updates the inventory row:
  - `in_stock` += receivedQty
  - `on_order` = max(0, on_order - receivedQty)
- Available is computed in the UI from `inStock - allocated` (allocated from current jobs list).

### On Job Delivered:
- **Context:** `AppContext.updateJobStatus` when transitioning to `delivered`
- **Logic:** `src/lib/inventoryReconciliation.ts` — for each job_inventory row, reduce `in_stock` and log `inventory_history` with action `reconcile_job`
- Reverse (job status away from delivered): action `reconcile_job_reversal` restores stock

### On Add Materials to Job:
- **Service:** `jobService.addJobInventory` adds/updates `job_inventory` rows
- Allocated is recomputed from all jobs via `buildAllocatedByInventoryId`; available = inStock - allocated. No direct write to `inventory.available` for allocation; display always uses computed available.

## Important Rules:
1. Never let available go negative (use `Math.max(0, inStock - allocated)`).
2. Never let onOrder go negative
3. inStock should never be less than allocated after reconciliation
4. Allocated is always derived from jobs + job_inventory in the app (`inventoryCalculations`); the DB `inventory.available` column may exist but is not the source of truth for allocation display

## PO / In-Production Jobs (Allocated):
- **Allocated** = sum of material quantities on jobs that have a PO / are in production (status: pod, rush, pending, inProgress, qualityControl, finished). Delivered jobs do not count.
- Once a job has a PO number (status PO'd or later), its materials count against **available** (available = inStock - allocated).
- **API:** Jobs are loaded with expand for `job_inventory` (Supabase relation). Each job gets `expand.job_inventory` (or `expand.job_inventory_via_job` for compat) = array of job_inventory records.

## Reorder Flag & "Needed to Complete All Jobs":
- **Flag for reorder** when: available < reorderPoint (and nothing on order) OR available < allocated (short for committed jobs).
- **Needed to complete all jobs** = allocated (total quantity committed to PO'd / in-production jobs).
- When short: show "Need X more [unit] to complete all jobs" where X = allocated - available.

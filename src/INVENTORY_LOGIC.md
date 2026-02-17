# Inventory Stock Reconciliation Logic

## Stock Fields:
- **inStock**: Total physical inventory in warehouse
- **available**: Stock available for allocation (inStock - allocated)
- **allocated**: Stock assigned to active jobs (calculated from job.inventoryItems)
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
allocated += quantity
available -= quantity
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

## Calculation Functions:

### Calculate Allocated (from all active jobs)
```typescript
const allocated = jobs
  .filter(job => job.status !== 'delivered')
  .reduce((sum, job) => {
    const jobItem = job.inventoryItems?.find(ji => ji.inventoryId === itemId);
    return sum + (jobItem?.quantity || 0);
  }, 0);
```

### Calculate Available
```typescript
available = inStock - allocated;
```

### Low Stock Check
```typescript
const needsReordering = available < reorderPoint;
```

## PocketBase Updates:

### On Receive Order:
```typescript
await pb.collection('inventory').update(itemId, {
  inStock: item.inStock + receivedQty,
  available: item.available + receivedQty,
  onOrder: Math.max(0, item.onOrder - receivedQty)
});
```

### On Job Delivered:
```typescript
// For each inventory item in job:
await pb.collection('inventory').update(inventoryId, {
  inStock: item.inStock - quantity,
  allocated: item.allocated - quantity
  // available stays same (was already subtracted when allocated)
});
```

### On Add Materials to Job:
```typescript
await pb.collection('inventory').update(inventoryId, {
  available: item.available - quantity
  // allocated will be recalculated from jobs
});
```

## Important Rules:
1. Never let available go negative
2. Never let onOrder go negative
3. inStock should never be less than allocated
4. Recalculate allocated from jobs periodically to prevent drift

## PO / In-Production Jobs (Allocated):
- **Allocated** = sum of material quantities on jobs that have a PO / are in production (status: pod, rush, pending, inProgress, qualityControl, finished). Delivered jobs do not count.
- Once a job has a PO number (status PO'd or later), its materials count against **available** (available = inStock - allocated).
- **API**: Jobs are loaded with back-relation expand `job_inventory_via_job` (PocketBase: collection_via_relationField) so each job gets `expand.job_inventory_via_job` = array of job_inventory records.

## Reorder Flag & "Needed to Complete All Jobs":
- **Flag for reorder** when: available < reorderPoint (and nothing on order) OR available < allocated (short for committed jobs).
- **Needed to complete all jobs** = allocated (total quantity committed to PO'd / in-production jobs).
- When short: show "Need X more [unit] to complete all jobs" where X = allocated - available.

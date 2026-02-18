---
name: dash-material-logic
description: Handles variant quantities and material explosion for WorkTrack Pro. Expert in dashQuantities Record<string, number>, auto-calculates JobInventory entries from PartMaterial × variant quantities, and updates on quantity change. Use when working with multi-variant jobs, dash quantities, material auto-assignment, or PartMaterial calculations.
---

# Dash & Material Logic Specialist

## Core Responsibility

Handles variant quantities (`dashQuantities`) and automatically calculates/assigns materials to jobs based on `PartMaterial` definitions multiplied by variant quantities.

---

## Dash Quantities Pattern

### Data Structure

```typescript
interface Job {
  dashQuantities?: Record<string, number>; // e.g. { "-01": 5, "-05": 10 }
  partNumber?: string;
  // ... other fields
}

// Variant suffix format: "-01", "-05", etc. (dash prefix + number)
```

### Form Input Pattern

```typescript
{part.variants.map((variant) => {
  const qty = dashQuantities[variant.variantSuffix] || 0;
  return (
    <div key={variant.id} className="flex items-center gap-2">
      <label className="w-32 text-sm text-slate-400">
        {part.partNumber}-{variant.variantSuffix}:
      </label>
      <input
        type="number"
        min="0"
        value={qty}
        onChange={(e) => {
          const newQuantities = { ...dashQuantities };
          const val = parseInt(e.target.value) || 0;
          if (val > 0) {
            newQuantities[variant.variantSuffix] = val;
          } else {
            delete newQuantities[variant.variantSuffix];
          }
          setDashQuantities(newQuantities);
          // Trigger auto-calculation if needed
        }}
      />
    </div>
  );
})}
```

---

## Material Explosion Logic

### PartMaterial Structure

```typescript
interface PartMaterial {
  id: string;
  partId?: string;        // Part-level material (usageType: 'per_set')
  variantId?: string;     // Variant-specific material (usageType: 'per_variant')
  inventoryId: string;    // Reference to inventory item
  quantity: number;        // Quantity per unit/variant
  unit: string;           // e.g., "units", "ft", "lbs"
  usageType: 'per_set' | 'per_variant';
}
```

### Calculation Algorithm

When `dashQuantities` change, calculate required materials:

1. **Load Part with variants and materials**:
   ```typescript
   const part = await partsService.getPartWithVariants(partId);
   // Returns Part with variants[], each variant has materials?: PartMaterial[]
   ```

2. **For each variant in dashQuantities**:
   ```typescript
   for (const [variantSuffix, qty] of Object.entries(dashQuantities)) {
     const variant = part.variants.find(v => v.variantSuffix === variantSuffix);
     if (!variant || !variant.materials) continue;
     
     // For each material in this variant
     for (const material of variant.materials) {
       // Calculate: material.quantity × variant quantity
       const requiredQty = material.quantity * qty;
       // Accumulate by inventoryId
     }
   }
   ```

3. **Handle per_set materials** (if any):
   ```typescript
   // Part-level materials apply to total quantity
   const totalQty = Object.values(dashQuantities).reduce((sum, q) => sum + q, 0);
   if (part.materials) {
     for (const material of part.materials) {
       if (material.usageType === 'per_set') {
         const requiredQty = material.quantity * totalQty;
         // Accumulate by inventoryId
       }
     }
   }
   ```

4. **Sum quantities by inventoryId**:
   ```typescript
   const materialMap = new Map<string, { quantity: number; unit: string }>();
   
   // After all calculations above:
   // materialMap.get(inventoryId) = { quantity: sum, unit: "units" }
   ```

5. **Create/update JobInventory entries**:
   ```typescript
   import { jobService } from '@/services/api/jobs';
   
   for (const [inventoryId, { quantity, unit }] of materialMap.entries()) {
     // Check if already exists
     const existing = job.inventoryItems?.find(
       ji => ji.inventoryId === inventoryId
     );
     
     if (existing) {
       // Update existing entry
       await jobService.updateJobInventory(existing.id, quantity, unit);
     } else {
       // Create new entry
       await jobService.addJobInventory(jobId, inventoryId, quantity, unit);
     }
   }
   ```

---

## Auto-Assignment Implementation

### Complete Function Pattern

```typescript
const handleAutoAssignMaterials = async (
  jobId: string,
  part: Part & { variants?: PartVariant[] },
  dashQuantities: Record<string, number>
) => {
  const { showToast } = useToast();
  
  try {
    // Step 1: Calculate required materials
    const materialMap = new Map<string, { quantity: number; unit: string }>();
    
    // Process variant-specific materials
    for (const [variantSuffix, qty] of Object.entries(dashQuantities)) {
      if (qty <= 0) continue;
      
      const variant = part.variants?.find(v => v.variantSuffix === variantSuffix);
      if (!variant?.materials) continue;
      
      for (const material of variant.materials) {
        const requiredQty = material.quantity * qty;
        const existing = materialMap.get(material.inventoryId);
        
        if (existing) {
          existing.quantity += requiredQty;
        } else {
          materialMap.set(material.inventoryId, {
            quantity: requiredQty,
            unit: material.unit || 'units'
          });
        }
      }
    }
    
    // Process part-level per_set materials
    const totalQty = Object.values(dashQuantities).reduce((sum, q) => sum + q, 0);
    if (part.materials && totalQty > 0) {
      for (const material of part.materials) {
        if (material.usageType === 'per_set') {
          const requiredQty = material.quantity * totalQty;
          const existing = materialMap.get(material.inventoryId);
          
          if (existing) {
            existing.quantity += requiredQty;
          } else {
            materialMap.set(material.inventoryId, {
              quantity: requiredQty,
              unit: material.unit || 'units'
            });
          }
        }
      }
    }
    
    // Step 2: Get current job inventory
    const job = await jobService.getJob(jobId);
    const existingMap = new Map(
      job.inventoryItems?.map(ji => [ji.inventoryId, ji]) || []
    );
    
    // Step 3: Create/update JobInventory entries
    for (const [inventoryId, { quantity, unit }] of materialMap.entries()) {
      const existing = existingMap.get(inventoryId);
      
      if (existing) {
        // Update if quantity changed
        if (existing.quantity !== quantity) {
          await jobService.updateJobInventory(existing.id, quantity, unit);
        }
      } else {
        // Create new
        await jobService.addJobInventory(jobId, inventoryId, quantity, unit);
      }
    }
    
    // Step 4: Remove materials no longer needed (optional - be careful!)
    // Only remove if they were auto-assigned and are now zero
    // This is context-dependent - may want to preserve manual additions
    
    showToast('Materials auto-assigned successfully', 'success');
    
    // Refresh job data
    await refreshJob(jobId);
    
  } catch (error) {
    console.error('Auto-assign error:', error);
    showToast(`Failed to auto-assign materials: ${error.message}`, 'error');
  }
};
```

---

## When to Trigger Auto-Assignment

### Automatic Triggers

1. **Dash quantity changes** (if auto-assign is enabled):
   ```typescript
   onChange={(e) => {
     const newQuantities = { ...dashQuantities };
     // ... update logic ...
     setDashQuantities(newQuantities);
     
     // Auto-assign if enabled
     if (autoAssignEnabled) {
       handleAutoAssignMaterials(jobId, part, newQuantities);
     }
   }}
   ```

2. **Part linked to job** (initial assignment):
   ```typescript
   useEffect(() => {
     if (part && dashQuantities && Object.values(dashQuantities).some(q => q > 0)) {
       handleAutoAssignMaterials(jobId, part, dashQuantities);
     }
   }, [part?.id]); // Only on part change, not every render
   ```

### Manual Trigger

```typescript
<button
  onClick={() => handleAutoAssignMaterials(jobId, part, dashQuantities)}
  className="w-full rounded-lg border border-primary/30 bg-primary/20 px-4 py-2.5 text-sm font-medium text-primary transition-colors hover:bg-primary/30"
>
  Auto-assign Materials from Part
</button>
```

---

## Edge Cases & Validation

### Validation Rules

1. **Zero quantities**: Skip variants with qty ≤ 0
2. **Missing variants**: If dashQuantities references non-existent variant, log warning but continue
3. **Missing materials**: If variant has no materials defined, skip silently
4. **Unit consistency**: Use PartMaterial.unit, default to 'units' if missing
5. **Existing inventory**: Check for existing JobInventory entries before creating duplicates

### Error Handling

```typescript
try {
  // ... calculation logic ...
} catch (error) {
  if (error instanceof Error) {
    showToast(`Material calculation failed: ${error.message}`, 'error');
  } else {
    showToast('Failed to calculate materials', 'error');
  }
  console.error('Material explosion error:', error);
}
```

### Preserving Manual Additions

**Important**: Auto-assignment should NOT remove manually-added materials. Only:
- Create new entries for calculated materials
- Update quantities for materials that were previously auto-assigned
- Leave manual additions untouched

Track auto-assigned vs manual:
```typescript
// Option 1: Add metadata field (if schema supports it)
interface JobInventoryItem {
  // ... existing fields ...
  autoAssigned?: boolean; // true if from PartMaterial calculation
}

// Option 2: Only update if exists, never delete
// Safer approach - preserve all manual additions
```

---

## Integration Points

### With JobDetail Component

```typescript
// In JobDetail.tsx
const [dashQuantities, setDashQuantities] = useState<Record<string, number>>(
  job.dashQuantities || {}
);

// When quantities change
const handleDashQuantityChange = useCallback(async (
  variantSuffix: string,
  qty: number
) => {
  const newQuantities = { ...dashQuantities };
  if (qty > 0) {
    newQuantities[variantSuffix] = qty;
  } else {
    delete newQuantities[variantSuffix];
  }
  setDashQuantities(newQuantities);
  
  // Save to job
  await jobService.updateJob(job.id, { dashQuantities: newQuantities });
  
  // Auto-assign if part linked
  if (linkedPart) {
    await handleAutoAssignMaterials(job.id, linkedPart, newQuantities);
  }
}, [dashQuantities, linkedPart, job.id]);
```

### With PartSelector Component

```typescript
// In PartSelector.tsx
const handleAutoAssign = async () => {
  if (!part || !onSelect) return;
  
  // Pass part and quantities to parent
  onSelect(part, dashQuantities);
  
  // Parent (JobDetail) handles auto-assignment
  showToast('Part and dash quantities selected', 'success');
};
```

---

## Quick Reference

### Calculation Formula

```
For each variant in dashQuantities:
  For each PartMaterial in variant.materials:
    requiredQty = PartMaterial.quantity × dashQuantities[variantSuffix]
    Accumulate by inventoryId

For part-level per_set materials:
  requiredQty = PartMaterial.quantity × totalDashQuantity
  Accumulate by inventoryId

Create/update JobInventory:
  job_inventory.quantity = sum(requiredQty for each inventoryId)
```

### Key Types

- `dashQuantities`: `Record<string, number>` - variant suffix → quantity
- `PartMaterial`: Material definition with `variantId`, `inventoryId`, `quantity`, `unit`
- `JobInventoryItem`: Link between job and inventory with `quantity`, `unit`

### Service Methods

- `partsService.getPartWithVariants(partId)` - Load part with variants and materials
- `jobService.addJobInventory(jobId, inventoryId, quantity, unit)` - Create entry
- `jobService.updateJobInventory(id, quantity, unit)` - Update entry (if exists)
- `jobService.updateJob(jobId, { dashQuantities })` - Save quantities to job

---

## Checklist

When implementing dash quantity material logic:

- [ ] Load part with variants and materials using `getPartWithVariants()`
- [ ] Iterate through `dashQuantities` entries
- [ ] Match variant by `variantSuffix`
- [ ] Multiply `PartMaterial.quantity × dashQuantity` for each material
- [ ] Handle `per_set` materials separately (multiply by total quantity)
- [ ] Sum quantities by `inventoryId`
- [ ] Check for existing `JobInventory` entries before creating
- [ ] Preserve manually-added materials (don't delete)
- [ ] Show toast feedback on success/error
- [ ] Refresh job data after assignment
- [ ] Handle edge cases (zero quantities, missing variants, etc.)

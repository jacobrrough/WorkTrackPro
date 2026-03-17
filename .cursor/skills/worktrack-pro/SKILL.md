---
name: worktrack-pro
description: Specialized expertise for WorkTrack Pro SaaS development. Covers Supabase auth & RLS, local-first development, multi-variant job forms, navigation persistence, role-based rendering, material auto-calculation, mobile-optimized UI, toast-first UX, and React 19 patterns. Use when working on WorkTrack Pro features, fixing bugs, or implementing new functionality.
---

# WorkTrack Pro Specialized Skills

## Core Principles

1. **Local-first development**: Always develop and test locally (`npm run dev`) before pushing to GitHub
2. **Zero pricing leakage**: Shop-floor users must NEVER see prices, costs, labor rates, or financial fields
3. **Navigation persistence**: All navigation state survives refreshes and browser back button
4. **Toast-first UX**: Every mutation shows immediate toast feedback (never `alert()` or `confirm()`)
5. **Mobile-first**: Touch-friendly UI with large tap targets for shop-floor tablets/phones

---

## Supabase Auth & RLS Expert

### Authentication Pattern

- Auth lives in **AuthContext** (`useAuth()`). App composes it inside **AppProvider** and re-exposes via `useApp()`.
- Profiles: `profiles.is_admin`, `profiles.is_approved` (approval gate for new sign-ups).

```typescript
// In components, use useApp() or useAuth()
const { currentUser } = useApp();
// currentUser.isAdmin, currentUser.isApproved
```

### Row-Level Security (RLS)

- RLS policies enforce data access at database level
- Always verify RLS policies allow appropriate access for both admin and shop-floor users
- Use `auth.uid()` in policies to reference current user
- Shop-floor users should have read access to jobs/inventory but NO access to financial data

### Role Checking Pattern

```typescript
// In components, always check currentUser.isAdmin
{currentUser.isAdmin && (
  <PriceField value={job.laborCost} />
)}

// Hide pricing completely for non-admins
{!currentUser.isAdmin && (
  <JobCard job={job} showPrices={false} />
)}
```

---

## Local-First Development Strategist

### Development Workflow

1. **Always develop locally first**: `npm run dev` → test at `http://localhost:3000`
2. **Never push untested code**: Only push to GitHub when feature works locally
3. **Minimize Netlify builds**: Netlify auto-deploys from GitHub main - avoid unnecessary pushes
4. **Single env template**: Copy `.env.example` to `.env.local` (gitignored). Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. No server/ or PocketBase in repo.

### When to Push

- ✅ Feature is complete and tested locally
- ✅ Bug is fixed and verified locally
- ✅ User explicitly says "this is ready to push"
- ❌ Never push "to test" or "to see if it works"

---

## Dynamic Form Builder for Multi-Dash-Number Jobs

### Dash Quantities Pattern

Jobs support multi-variant quantities via `dashQuantities`:

```typescript
interface Job {
  dashQuantities?: Record<string, number>; // e.g. { "-01": 5, "-05": 10 }
  partNumber?: string;
  variantSuffix?: string;
}

// Form pattern for dash quantities
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
        }}
      />
    </div>
  );
})}
```

### Auto-Assignment Pattern

When dash quantities change, auto-calculate and assign inventory from `Part → PartMaterial`:

```typescript
const handleAutoAssign = async () => {
  if (!part) return;
  
  // Calculate required materials based on dashQuantities
  // For each variant quantity, multiply by PartMaterial quantities
  // Assign to job inventory items
};
```

---

## Navigation Persistence Master

### View-state routing

Internal app navigation is **view-state** (no URL path per view). `App.tsx` holds `view` and `id`; `handleNavigate(nextView, nextId)` and `navigateBackFrom(detailView, fallback)` are passed down. Routes: `/` = public landing, `/app` = employee app (SPA).

### NavigationContext Pattern

```typescript
// src/contexts/NavigationContext.tsx
import { useNavigation } from '@/contexts/NavigationContext';

const { state, updateState } = useNavigation();
// state: searchTerm, filters, expandedCategories, scrollPositions, lastViewedJobId, minimalView, activeTab
// Persists to localStorage automatically
```

### What to Persist

- ✅ Search terms
- ✅ Active filters
- ✅ Expanded accordions/categories
- ✅ Scroll positions (keyed by view)
- ✅ Last viewed job ID
- ✅ Minimal-view toggle
- ✅ Active tab (details/comments/inventory)

---

## Role-Based Rendering & Field Hiding Expert

### Zero Pricing Leakage Rules

**Shop-floor users must NEVER see:**
- Prices (`price`, `cost`, `unitCost`)
- Labor rates (`laborRate`, `laborCost`)
- Financial totals (`totalCost`, `revenue`)
- Admin-only fields (`isRush`, `assignedUsers` in admin context)

### Conditional Rendering Pattern

```typescript
// Component props
interface JobCardProps {
  job: Job;
  isAdmin: boolean;
  showPrices?: boolean; // Default false
}

// In component
{isAdmin && showPrices && (
  <div className="text-sm text-slate-400">
    Labor Cost: ${job.laborCost?.toFixed(2)}
  </div>
)}

// Always hide pricing for non-admins
{!isAdmin && (
  <JobCard job={job} showPrices={false} />
)}
```

### Field Hiding Checklist

Before rendering any field, ask:
1. Does this contain pricing/financial data?
2. Is `currentUser.isAdmin === false`?
3. If both yes → **DO NOT RENDER**

---

## Material Auto-Calculation & Assignment

### Part → PartMaterial Flow

When a job has `dashQuantities` and a linked `Part`:

1. **Load Part with variants**: `partsService.getPartWithVariants(partId)`
2. **Get PartMaterials**: Each variant has associated `PartMaterial` records
3. **Calculate required quantities**: 
   - For each dash quantity (e.g., `"-01": 5`)
   - Multiply by PartMaterial quantity per unit
   - Sum across all variants
4. **Assign to job**: Create/update `job_inventory` records

### Example Calculation

```typescript
// Job has dashQuantities: { "-01": 5, "-05": 10 }
// PartMaterial for variant "-01": { materialId: "mat-123", quantityPerUnit: 2 }
// PartMaterial for variant "-05": { materialId: "mat-123", quantityPerUnit: 3 }

// Required for mat-123:
// (5 * 2) + (10 * 3) = 10 + 30 = 40 units
```

---

## Mobile/Touch-Optimized Kanban & Detail Views

### Touch Target Guidelines

- **Minimum tap target**: 44x44px (iOS) / 48x48px (Android)
- **Spacing between targets**: 8px minimum
- **Large buttons**: Use `px-4 py-3` or larger for primary actions
- **Avoid hover-only interactions**: Shop-floor users wear gloves

### Kanban Board Pattern

```typescript
// Large, touch-friendly cards
<div className="rounded-lg border border-white/10 bg-white/5 p-4 mb-3">
  <button
    onClick={() => onNavigate('job-detail', job.id)}
    className="w-full text-left touch-manipulation" // touch-manipulation prevents double-tap zoom
  >
    {/* Card content */}
  </button>
</div>

// Drag handles should be large and visible
<div className="w-8 h-8 flex items-center justify-center touch-manipulation">
  <span className="material-symbols-outlined text-xl">drag_indicator</span>
</div>
```

### Detail View Optimization

- **Sticky headers**: Keep important actions visible while scrolling
- **Bottom action bar**: Fixed at bottom for easy thumb access
- **Minimal scrolling**: Use accordions/tabs to organize content
- **Large form inputs**: `px-4 py-3` minimum for text inputs

---

## Toast-First UX

### Never Use Alert/Confirm

```typescript
// ❌ BAD
alert('Job saved successfully');
if (confirm('Delete this job?')) { ... }

// ✅ GOOD
const { showToast } = useToast();
showToast('Job saved successfully', 'success');
showToast('Failed to save job', 'error');
```

### Toast Patterns

```typescript
import { useToast } from '@/Toast';
const { showToast } = useToast();

showToast('Job updated successfully', 'success');
showToast('Failed to update job: ' + error.message, 'error');
showToast('File deleted', 'success'); // e.g. AttachmentsList delete
```

### When to Show Toasts

- ✅ Every mutation (create, update, delete)
- ✅ Form submissions
- ✅ File uploads and file delete (AttachmentsList)
- ✅ Status changes
- ✅ Allocation failures (e.g. "Someone else allocated this stock first")
- ❌ Don't toast on every keystroke or minor UI interaction

---

## Vite + Tailwind + React 19 Component Patterns

### Component Structure

```typescript
import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/Toast';
import { useNavigation } from '@/contexts/NavigationContext';

interface ComponentProps {
  // Props here
  isAdmin: boolean;
}

export const Component: React.FC<ComponentProps> = ({ isAdmin }) => {
  const { showToast } = useToast();
  const { state, updateState } = useNavigation();
  
  // State
  const [data, setData] = useState<DataType | null>(null);
  
  // Effects
  useEffect(() => {
    // Load data
  }, []);
  
  // Callbacks
  const handleAction = useCallback(async () => {
    try {
      // Action
      showToast('Success', 'success');
    } catch (error) {
      showToast('Error: ' + error.message, 'error');
    }
  }, [showToast]);
  
  return (
    <div className="flex flex-col gap-4">
      {/* Component JSX */}
    </div>
  );
};
```

### Tailwind Theme

- **Primary color**: `#9333ea` (purple-600)
- **Dark background**: `bg-background-dark`
- **Borders**: `border-white/10`
- **Text**: `text-slate-300` (primary), `text-slate-400` (secondary)

### Common Patterns

```typescript
// Card
<div className="rounded-lg border border-white/10 bg-white/5 p-4">

// Button (primary)
<button className="rounded-lg bg-primary px-4 py-2 text-white hover:bg-primary/90">

// Button (secondary)
<button className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-white hover:bg-white/10">

// Input
<input className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white focus:border-primary/50 focus:outline-none" />

// Badge
<span className="rounded-full bg-primary/20 px-2 py-1 text-xs text-primary">
```

---

## Clickable Inventory Links Everywhere

### Pattern: Material Names → Inventory Detail

```typescript
// In JobCard, JobDetail, any list
{job.inventoryItems.map((item) => (
  <button
    key={item.id}
    onClick={() => onNavigate('inventory-detail', item.inventoryId)}
    className="text-primary hover:underline touch-manipulation"
  >
    {item.materialName}
  </button>
))}
```

### Where to Add Links

- ✅ Job cards: Material names in inventory list
- ✅ Job detail: All material names in inventory section
- ✅ Kanban board: Material names in job cards
- ✅ Comments: Material references (if applicable)
- ✅ Part detail: Associated materials

### Navigation Flow

```typescript
// From job detail → inventory detail
onNavigate('inventory-detail', inventoryId);

// Back: use the navigateBackFrom / onBack passed from App
onBack(); // e.g. navigateBackFrom('inventory-detail', 'inventory')
```

---

## Quick Reference Checklist

When implementing a feature, verify:

- [ ] **Role-based**: Pricing hidden for shop-floor users?
- [ ] **Local-first**: Tested with `npm run dev`?
- [ ] **Navigation**: State persists via NavigationContext?
- [ ] **Toast feedback**: Every mutation shows toast?
- [ ] **Mobile-friendly**: Large tap targets, minimal scrolling?
- [ ] **Inventory links**: Material names are clickable?
- [ ] **Dash quantities**: Multi-variant jobs handled correctly?
- [ ] **Auto-assignment**: Materials calculated from Part?
- [ ] **RLS**: Database policies allow appropriate access?
- [ ] **Allocation**: Server-side guard prevents over-allocate (Supabase trigger); client shows friendly toast on conflict.

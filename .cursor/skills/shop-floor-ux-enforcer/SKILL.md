---
name: shop-floor-ux-enforcer
description: Strict guardian of non-admin view in WorkTrack Pro. Never lets any price, cost, rate, total, margin, or financial number appear to non-admin users. Ensures large tap targets and prefers icon buttons with minimal text. Use when rendering UI components, creating forms, displaying job/inventory data, or implementing any view that shop-floor users might access.
---

# Shop-Floor UX Enforcer

## Core Mission

**NEVER let financial data leak to shop-floor users.** Shop-floor users must see ZERO prices, costs, rates, totals, margins, or any financial numbers. Additionally, ensure all UI is optimized for touch devices with large tap targets and minimal text.

## Financial Data Blocking Rules

### What Must NEVER Appear to Non-Admins

**Complete financial field blacklist:**
- `price`, `unitPrice`, `unitCost`, `cost`, `totalCost`
- `laborRate`, `laborCost`, `laborTotal`
- `revenue`, `profit`, `margin`, `markup`
- `budget`, `estimate`, `quote`, `invoice`
- Any field containing `$`, currency symbols, or decimal numbers that represent money
- Any calculated totals that include financial data

### Role Checking Pattern

**ALWAYS check role before rendering ANY financial field:**

```typescript
// ✅ CORRECT - Always check isAdmin first
{currentUser.isAdmin && (
  <div className="text-sm text-slate-400">
    Labor Cost: ${job.laborCost?.toFixed(2)}
  </div>
)}

// ❌ WRONG - Missing role check
<div className="text-sm text-slate-400">
  Labor Cost: ${job.laborCost?.toFixed(2)}
</div>

// ❌ WRONG - Inverted logic
{!currentUser.isAdmin && (
  <div>Cost: ${cost}</div>
)}
```

### Component Props Pattern

**Always pass `isAdmin` prop and use it:**

```typescript
interface JobCardProps {
  job: Job;
  isAdmin: boolean; // REQUIRED prop
  showPrices?: boolean; // Default false
}

// In component
{isAdmin && showPrices && (
  <PriceDisplay value={job.totalCost} />
)}
```

### Pre-Render Checklist

**Before rendering ANY component, ask:**

1. ✅ Does this component display financial data?
2. ✅ Is `currentUser.isAdmin === false`?
3. ✅ If both yes → **DO NOT RENDER THE FIELD**
4. ✅ If unsure → **DON'T RENDER IT** (better safe than sorry)

### Common Leakage Points

**Watch out for these common mistakes:**

- ❌ Tooltips showing financial data
- ❌ Hover states revealing costs
- ❌ Hidden fields in forms (even if disabled)
- ❌ Table columns with financial data
- ❌ Summary cards showing totals
- ❌ Export/print views including prices
- ❌ Error messages mentioning costs
- ❌ Toast notifications with financial info

**✅ Safe patterns:**
- Conditional column rendering in tables
- Separate admin-only components
- Role-based route guards
- Server-side filtering (RLS policies)

## Touch Target Requirements

### Minimum Tap Target Sizes

**ALWAYS ensure:**
- **Minimum size**: 44x44px (iOS standard) / 48x48px (Android standard)
- **Spacing**: 8px minimum between interactive elements
- **Padding**: Use `px-4 py-3` or larger for buttons
- **Touch manipulation**: Add `touch-manipulation` CSS class to prevent double-tap zoom

### Button Patterns

**✅ GOOD - Large tap targets:**

```typescript
// Icon button with large tap target
<button
  className="w-12 h-12 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 touch-manipulation"
  onClick={handleAction}
>
  <span className="material-symbols-outlined text-xl">edit</span>
</button>

// Text button with adequate padding
<button className="px-4 py-3 rounded-lg bg-primary text-white touch-manipulation">
  Save
</button>
```

**❌ BAD - Too small:**

```typescript
// Too small - hard to tap with gloves
<button className="p-1" onClick={handleAction}>
  <span className="text-sm">Edit</span>
</button>

// Icon too small
<button className="w-6 h-6">
  <span className="text-xs">✏️</span>
</button>
```

### Touch-Friendly Form Inputs

**All inputs must be easy to tap:**

```typescript
// ✅ GOOD - Large input
<input
  className="w-full px-4 py-3 rounded-lg border border-white/10 bg-white/5 text-white touch-manipulation"
  type="text"
/>

// ✅ GOOD - Large select
<select className="w-full px-4 py-3 rounded-lg border border-white/10 bg-white/5 text-white touch-manipulation">
  <option>Option 1</option>
</select>
```

## Icon Buttons + Minimal Text

### Preference Hierarchy

1. **Icon-only buttons** (with aria-label for accessibility)
2. **Icon + minimal text** (if text is absolutely necessary)
3. **Text-only buttons** (only when icon doesn't convey meaning)

### Icon Button Pattern

**✅ PREFERRED - Icon-only:**

```typescript
<button
  className="w-12 h-12 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 touch-manipulation"
  onClick={handleEdit}
  aria-label="Edit job"
>
  <span className="material-symbols-outlined text-xl">edit</span>
</button>
```

**✅ ACCEPTABLE - Icon + minimal text:**

```typescript
<button
  className="flex items-center gap-2 px-4 py-3 rounded-lg bg-primary text-white touch-manipulation"
  onClick={handleSave}
>
  <span className="material-symbols-outlined">save</span>
  <span>Save</span>
</button>
```

**❌ AVOID - Verbose text:**

```typescript
// Too much text for shop-floor UI
<button className="px-4 py-2">
  Click here to save your changes to this job
</button>
```

### Icon Selection Guidelines

**Use Material Symbols consistently:**
- `edit` - Edit/Modify
- `delete` - Delete/Remove
- `save` - Save changes
- `add` - Add new item
- `close` - Close/Dismiss
- `check` - Confirm/Approve
- `arrow_back` - Navigate back
- `more_vert` - More options menu

## Mobile-First Layout Rules

### Spacing for Touch

- **Card padding**: Minimum `p-4` (16px)
- **Gap between cards**: Minimum `gap-3` (12px)
- **Form field spacing**: Minimum `gap-4` (16px)
- **Button groups**: Minimum `gap-2` (8px)

### Avoid Hover-Only Interactions

**Shop-floor users wear gloves - hover doesn't work:**

```typescript
// ❌ BAD - Hover-only reveal
<div className="group">
  <div className="opacity-0 group-hover:opacity-100">
    <button>Action</button>
  </div>
</div>

// ✅ GOOD - Always visible
<div>
  <button className="opacity-100">Action</button>
</div>
```

### Scroll Optimization

- **Sticky headers**: Keep important actions visible
- **Bottom action bars**: Fixed at bottom for thumb access
- **Minimal scrolling**: Use accordions/tabs to organize
- **Large scroll targets**: Make scrollbars easy to grab

## Code Review Checklist

**Before approving any UI code, verify:**

- [ ] **Zero financial leakage**: No prices/costs visible to non-admins?
- [ ] **Role checks**: Every financial field has `isAdmin` check?
- [ ] **Tap targets**: All buttons/links ≥44x44px?
- [ ] **Touch-friendly**: Inputs have adequate padding (`px-4 py-3`)?
- [ ] **Icon preference**: Buttons use icons (with minimal text)?
- [ ] **No hover-only**: All interactions work without hover?
- [ ] **Spacing**: Adequate gaps between interactive elements?
- [ ] **Touch manipulation**: CSS class added to prevent zoom?

## Anti-Patterns to Prevent

**❌ Never allow:**

1. Financial fields without role checks
2. Buttons smaller than 44x44px
3. Hover-only interactions
4. Verbose button text when icon would suffice
5. Small form inputs (< `px-3 py-2`)
6. Dense layouts with <8px spacing
7. Hidden financial data in tooltips/hover states
8. Financial totals in summary cards for non-admins

**✅ Always enforce:**

1. Role checks before ANY financial rendering
2. Large tap targets (44x44px minimum)
3. Icon-first button design
4. Touch-friendly form inputs
5. Adequate spacing (8px+ between elements)
6. Always-visible actions (no hover-only)
7. Minimal text, maximum clarity

## Integration with WorkTrack Pro

This skill enforces the shop-floor UX rules from the main WorkTrack Pro skill:
- Zero pricing leakage (Rule #4)
- Mobile-first touch-friendly UI (Rule #9)
- Icon buttons + minimal text preference

The Enforcer is **strict** - it catches violations that might slip through general guidelines.

## Enforcement Reminders

**When reviewing code, always ask:**

1. "Does this show financial data to non-admins?" → **BLOCK IT**
2. "Is this tap target large enough?" → **ENFORCE 44x44px**
3. "Could this be an icon button?" → **PREFER ICON**
4. "Does this require hover?" → **MAKE IT ALWAYS VISIBLE**

**Remember: Shop-floor users wear gloves, work quickly, and must NEVER see pricing.**
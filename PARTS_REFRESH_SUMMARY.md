# Parts Refresh Summary

Surgical, calculation-first refresh of the Parts section only. Inventory, stock, bin, and physical inventory code were not modified.

---

## What was broken / pain points

1. **Scattered calculation logic** — Part quote, set/variant price, labor, and CNC lived in multiple files (calculatePartQuote, partDistribution, variantPricingAuto, materialFromPart) with no single source of truth.
2. **No validation on quantities** — materialFromPart and calculatePartQuote did not explicitly guard negative/zero/non-finite quantity_per_unit; DB could store 0 or negative and produce negative requirements or costs.
3. **Parts list** — Single list with search only; no tabs (All / In Jobs / Needs Attention), no “in use” indication.
4. **Part detail** — Very large file with inline MaterialsListWithCost (~200 lines); no reusable PartMaterialLink sub-component for BOM rows with live totals.

---

## What was fixed

1. **Single source of truth: `src/lib/partsCalculations.ts`**
   - Re-exports all Part-related calculations and wraps computeRequiredMaterials, syncJobInventoryFromPart, calculatePartQuote, calculateVariantQuote with sanitized part/variant (material quantityPerUnit clamped to >= 0).
   - New safe `quantityPerUnit()` and `getPartMaterialCostForOneSet()` for UI roll-ups.
   - Callers (useMaterialSync, JobDetail, AdminCreateJob, PartDetail, QuoteCalculator, temp_parts_calc_audit.test.ts) now import from partsCalculations so all paths use safe quantities.

2. **Calculation audit** — `src/temp_parts_calc_audit.test.ts` added with 15 scenarios: part with 5 materials + price change, required quantities vs set composition, set completion, set/variant price and labor, edge cases (negative/zero/fractional). All tests pass.

3. **Parts list UI** — Tabs: All Parts | In Jobs | Needs Attention. Global search and scroll persistence (NavigationContext) unchanged. "New Part" button in header. "In use" badge on parts that appear in at least one job (part_id).

4. **Part detail UI** — BOM / Materials (per set) section now uses a grid of `PartMaterialLink` components. Inline MaterialsListWithCost removed (~200 lines). PartMaterialLink is a standalone, reusable component with live subtotal (qty × unit cost), link to inventory, edit qty/unit, and delete.

5. **Vitest config** — Added `resolve.alias` for `@` in vitest.config.ts so tests resolve `@/lib/...` imports consistently.

---

## Why each UI grouping decision was made

- **Tabs (All / In Jobs / Needs Attention)** — Reduces cognitive load: “All” for full list, “In Jobs” for parts currently used on jobs, “Needs Attention” reserved for future rules (e.g. missing materials). Keeps a single list component with filtered views.
- **“In use” badge on list rows** — Quick scan of which parts are linked to jobs without opening detail; aligns with “In Jobs” tab.
- **PartMaterialLink as standalone component** — Reusable in Part detail (per-set materials) and future Part Form / variant materials; single place for live cost, edit, delete, and link to inventory.
- **BOM / Materials grid** — Same 2/3/4 column responsive grid as before; each cell is now PartMaterialLink for consistency and maintainability.
- **Create Part flow unchanged** — Inline CreatePartForm kept in PartDetail when partId === 'new' to avoid regressions; can be extracted to modal/sheet later.

---

## Files created

| File | Purpose |
|------|---------|
| `SYSTEM_MASTERY_PARTS_v2.md` | Full Parts data model, calculation map, interaction map, audit of bugs/UI pain points, final state, Ready to Test checklist |
| `src/lib/partsCalculations.ts` | Single source of truth for Part calculations; safe quantity wrappers; re-exports |
| `src/temp_parts_calc_audit.test.ts` | Temporary audit tests (15 scenarios) for Parts calculations |
| `src/features/admin/PartMaterialLink.tsx` | Reusable BOM row: material name (link to inventory), qty, unit cost, live subtotal, edit/delete |
| `PARTS_REFRESH_SUMMARY.md` | This file |

---

## Files modified

| File | Change |
|------|--------|
| `vitest.config.ts` | Added `resolve.alias` for `@` → `src` so test imports resolve |
| `src/features/admin/Parts.tsx` | Replaced with tabs (All, In Jobs, Needs Attention), search, scroll restore, "In use" badge, same props |
| `src/features/admin/PartDetail.tsx` | Import PartMaterialLink and partsCalculations; BOM materials section uses PartMaterialLink grid; removed inline MaterialsListWithCost (~200 lines) |
| `src/features/jobs/hooks/useMaterialSync.ts` | Import computeRequiredMaterials and syncJobInventoryFromPart from partsCalculations |
| `src/JobDetail.tsx` | Import syncJobInventoryFromPart from partsCalculations |
| `src/AdminCreateJob.tsx` | Import syncJobInventoryFromPart from partsCalculations |
| `src/components/QuoteCalculator.tsx` | Import calculatePartQuote from partsCalculations |
| `SYSTEM_MASTERY_PARTS_v2.md` | Added “Final state after refresh” and updated “Ready to Test” checklist |

---

## Ready to test checklist

- [ ] Part with N materials: change one material price in inventory; total cost updates in part quote and variant quote.
- [ ] Allocate part to job; required material quantities match job_inventory.
- [ ] Job status in-progress → delivered; Parts-side assumptions hold.
- [ ] Negative/zero/fractional quantities: partsCalculations clamps to 0; UI validates on save.
- [ ] Parts list: tabs (All, In Jobs, Needs Attention), search, scroll restore, "New Part", "In use" badge.
- [ ] Part detail: BOM/Materials section with PartMaterialLink grid (live totals, link to inventory, edit/delete).
- [ ] PartMaterialLink: reusable row with live cost, edit qty/unit, delete.
- [ ] No regressions: Jobs, dashboard, time clock, reports, realtime unchanged.
- [ ] `npm run test` and `npm run build` pass.

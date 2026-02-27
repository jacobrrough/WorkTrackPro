# System Mastery — Parts (v2)

Parts-only audit and data model for the Parts Section Surgical Refresh. Do not modify Inventory, stock, bin, or physical inventory code.

---

## A. Full current Parts data model

### Table: `parts`

| Column | Type | Notes |
|--------|------|--------|
| id | uuid | PK, default gen_random_uuid() |
| part_number | text | NOT NULL, unique |
| name | text | NOT NULL default '' |
| description | text | nullable |
| price_per_set | numeric | nullable |
| labor_hours | numeric | nullable |
| requires_cnc | boolean | default false |
| cnc_time_hours | numeric | nullable |
| requires_3d_print | boolean | default false |
| printer_3d_time_hours | numeric | nullable |
| set_composition | jsonb | Record<string, number>, e.g. {"01": 2, "05": 1} |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

**Relations:**
- 1:N → `part_variants` (part_id)
- 1:N → `part_materials` (where part_id is set; part-level per_set materials)
- 1:N → `attachments` (part_id)
- N:1 ← `jobs` (jobs.part_id, jobs.part_number)

### Table: `part_variants`

| Column | Type | Notes |
|--------|------|--------|
| id | uuid | PK |
| part_id | uuid | NOT NULL, FK → parts(id) ON DELETE CASCADE |
| variant_suffix | text | NOT NULL (e.g. "01", "05") |
| name | text | nullable |
| price_per_variant | numeric | nullable |
| labor_hours | numeric | nullable |
| requires_cnc | boolean | default false |
| cnc_time_hours | numeric | nullable |
| requires_3d_print | boolean | default false |
| printer_3d_time_hours | numeric | nullable |
| created_at | timestamptz | |
| updated_at | timestamptz | |

**Unique:** (part_id, variant_suffix).

**Relations:**
- N:1 → `parts`
- 1:N → `part_materials` (where part_variant_id is set; variant-level materials)

### Table: `part_materials`

| Column | Type | Notes |
|--------|------|--------|
| id | uuid | PK |
| part_id | uuid | nullable, FK → parts; set for part-level (per_set) rows |
| part_variant_id | uuid | nullable (legacy: variant_id); set for variant-level rows |
| inventory_id | uuid | NOT NULL, FK → inventory(id) ON DELETE RESTRICT |
| quantity_per_unit | numeric | NOT NULL default 1 (legacy: quantity) |
| unit | text | NOT NULL default 'units' |
| usage_type | text | NOT NULL default 'per_variant'; 'per_set' for part-level |
| created_at | timestamptz | |
| updated_at | timestamptz | |

**Constraints:**
- Part-level row: part_id set, part_variant_id null, usage_type = 'per_set'.
- Variant-level row: part_variant_id set, usage_type = 'per_variant'.
- Original schema had part_variant_id NOT NULL; migration 20250218000002 made it nullable and added part_id, usage_type.

**Relations:**
- N:1 → `parts` (when part_id set)
- N:1 → `part_variants` (when part_variant_id set)
- N:1 → `inventory`

---

## B. Every calculation that exists today

**Canonical entry point:** `src/lib/partsCalculations.ts` re-exports and wraps the below with safe quantity handling (quantityPerUnit >= 0). Use partsCalculations for Part detail, Job BOM sync, and QuoteCalculator.

| Calculation | Location | Purpose |
|-------------|----------|---------|
| Material qty per set (BOM for one set) | `src/lib/materialFromPart.ts` — `computeRequiredMaterials` | Variant materials × dash qty; part-level per_set × complete sets (or total qty) |
| Set completion (complete sets from dash) | `src/lib/formatJob.ts` — `calculateSetCompletion` | Used by material explosion for per_set multiplier |
| Job BOM sync | `src/lib/materialFromPart.ts` — `syncJobInventoryFromPart` | Writes/updates job_inventory from part + dashQuantities |
| Set price from variants | `src/lib/partDistribution.ts` — `calculateSetPriceFromVariants` | Set price = sum(variant.pricePerVariant × setComposition[variant]) |
| Variant prices from set price | `src/lib/partDistribution.ts` — `variantPricesFromSetPrice` | Proportional split of set price to variants |
| Set labor from variants | `src/lib/partDistribution.ts` — `calculateSetLaborFromVariants` | Set labor = sum(variant.laborHours × setComposition) |
| Set CNC from variants | `src/lib/partDistribution.ts` — `calculateSetCncFromVariants` | Set CNC = sum(variant.cncTimeHours × setComposition) |
| Variant labor/CNC/3D from set | `src/lib/partDistribution.ts` — `variantLaborFromSetComposition`, `variantCncFromSetComposition`, `variantPrinter3DFromSetComposition` | Proportional split by set composition |
| Part quote (material + labor + CNC + 3D) | `src/lib/calculatePartQuote.ts` — `calculatePartQuote` | materialRequirementsForOneSet × qty, inventory prices; optional reverse from manualSetPrice |
| Variant quote | `src/lib/calculatePartQuote.ts` — `calculateVariantQuote` | Per-variant materials × qty; optional reverse from manualVariantPrice |
| Variant labor/CNC targets | `src/lib/variantPricingAuto.ts` — `calculateVariantLaborTargets`, `calculateVariantCncTargets` | Used when propagating set price/labor/CNC to variants |
| Effective set composition | `src/lib/variantPricingAuto.ts` — `buildEffectiveSetComposition` | setComposition or fallback 1 per variant |
| quantityPerUnit / normalizeDash | `src/lib/variantMath.ts` | quantity_per_unit vs legacy quantity; dash suffix normalization |

---

## C. Exact interaction map

### Part → Job

- Job has `part_id` and/or `part_number`. When dash quantities change, `useMaterialSync` (src/features/jobs/hooks/useMaterialSync.ts) calls:
  - `computeRequiredMaterials(part, dashQuantities)` to get required material map
  - `syncJobInventoryFromPart(jobId, part, dashQuantities)` (debounced ~1200ms) to write/update job_inventory.
- JobDetail loads part via `partsService.getPartWithVariants(partId)` for BOM and dash UI.

### part_materials usage

- **Part-level (per_set):** part_id set, part_variant_id null. Applied per “complete set” when setComposition exists, else per total job quantity.
- **Variant-level:** part_variant_id set. Applied per variant dash quantity.
- `getPartWithVariantsAndMaterials` (src/services/api/parts.ts) loads all part_materials, filters by part_id vs variant ids, joins inventory for names. Add/update/delete via partsService: addMaterial, addPartMaterial, updatePartMaterial, deletePartMaterial.

### When calculations run

1. **Part detail:** On load (getPartWithVariants), after variant/material/setComposition save, when set price or labor is edited (QuoteCalculator / handleUpdateVariant).
2. **Job:** When dash quantities change (useMaterialSync debounce).
3. **Server:** No triggers or functions today; all logic is client-side.

---

## D. Calculation bugs / pain points (audit with file:line)

| Issue | File:line / location |
|-------|----------------------|
| Scattered logic | Part quote, set/variant price, labor, CNC in calculatePartQuote, partDistribution, variantPricingAuto, materialFromPart. No single source of truth for “part cost” or “required materials.” |
| Legacy schema handling | parts.ts: mapRowToPartMaterial (quantity_per_unit ?? quantity), part_variant_id ?? variant_id; addMaterial/addPartMaterial retry with quantity/variant_id. Risk of drift between envs. |
| Manual overrides in UI | PartDetail.tsx ~88–89, 161–178: manualVariantPriceOverridesRef; applyManualVariantPriceOverrides on load. loadPart can race after save and variant prices flicker or revert. |
| No validation on quantities | materialFromPart and calculatePartQuote do not explicitly guard negative/zero/fractional in one place; part_materials.quantity_per_unit can be 0 or negative in DB. |
| Inventory price source | Part quote uses current inventory list (inventoryItems); if inventory price changes, part quote changes but part record is not updated. No “last cost” or snapshot on part. |
| Required vs available | Required from part + dash; available from inventory (in_stock, allocated) in inventoryCalculations/inventoryState. Parts UI does not show “shortage” or “required vs available” in one place. |
| Realtime | subscriptions.ts: jobs, shifts, inventory only. No realtime on parts/part_variants/part_materials; PartDetail relies on loadPart after mutations. |

---

## E. Current UI pain points

### features/admin/Parts.tsx

- Single list, search only (partsSearchTerm). No tabs (All / Needs Attention / By Category / By Job Usage), no category/supplier filters, no FAB pattern (button in header). Uses NavigationContext for scroll and search (good).

### features/admin/PartDetail.tsx

- Very large (~3300+ lines). CreatePartForm inline (~3217), MaterialsListWithCost inline (~2631), many accordions and inline handlers. No clear “BOM / Materials” accordion with live subtotal/total; Cost & Pricing mixed into Set Information accordion; Usage History not grouped under a clear section; Notes & Attachments and Quick Actions (Allocate to Job, Duplicate, Export BOM) scattered. More than 6 fields visible in places without collapse. No dedicated PartMaterialLink sub-component.

### Root Parts.tsx / PartDetail.tsx

- Unused (App uses features/admin). Duplicate state (PARTS_LIST_STATE_KEY) vs NavigationContext. Can be removed or left as dead code per product decision.

---

## Final state after refresh

### Single source of truth: `src/lib/partsCalculations.ts`

- Re-exports: computeRequiredMaterials, syncJobInventoryFromPart, calculateSetCompletion, calculatePartQuote, calculateVariantQuote, getPartMaterialCostForOneSet, quantityPerUnit (safe), and partDistribution/variantPricingAuto/variantMath exports.
- Safe quantity handling: quantityPerUnit clamps to >= 0; computeRequiredMaterials, calculatePartQuote, calculateVariantQuote, and syncJobInventoryFromPart use sanitized part/variant so negative/zero DB values do not produce negative requirements or costs.
- Callers updated: useMaterialSync, JobDetail, AdminCreateJob, PartDetail, QuoteCalculator, temp_parts_calc_audit.test.ts import from partsCalculations.

### Parts list UI

- Tabs: All Parts | In Jobs | Needs Attention. Search and scroll persistence unchanged. "New Part" opens part-detail with partId 'new'. "In use" badge on parts that appear in jobs.

### Part detail UI

- BOM / Materials (per set): grid of PartMaterialLink components (live subtotals, link to inventory, edit/delete). Add Material unchanged.
- PartMaterialLink: standalone component in `src/features/admin/PartMaterialLink.tsx`.

### Part Form

- Create flow unchanged: inline CreatePartForm in PartDetail when partId === 'new'.

---

## Ready to Test (final checklist)

- [ ] Part with N materials: change one material price in inventory; total cost updates in part quote and variant quote.
- [ ] Allocate part to job; required material quantities match job_inventory.
- [ ] Job status in-progress → delivered; Parts-side assumptions hold (no inventory logic change in Parts).
- [ ] Negative/zero/fractional quantities: handled in partsCalculations (clamped to 0); UI validates on save.
- [ ] Parts list: tabs (All, In Jobs, Needs Attention), search, scroll restore, "New Part" button.
- [ ] Part detail: BOM/Materials section with PartMaterialLink grid (live totals, link to inventory, edit/delete).
- [ ] PartMaterialLink: reusable row with live cost, edit qty/unit, delete.
- [ ] No regressions: Jobs, dashboard, time clock, reports, realtime subscriptions unchanged.
- [ ] Run: `npm run test` (includes temp_parts_calc_audit) and `npm run build`.

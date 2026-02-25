# Part Detail: Auto Calculations & "Auto" Badge Reference

This document explains how labor hours, labor cost, total price, and the **"auto"** badges are calculated on Part Detail (master part and per-variant quick reference). Use it to verify behavior and fix issues.

---

## 1. Suffix normalization

Variant suffixes are normalized so `"-01"` and `"01"` match:

- **Rule:** `norm(s) = s.replace(/^-/, '')` (strip leading minus).
- **Used in:** `partDistribution.ts` for set composition lookups (e.g. `setComposition["-01"]` vs `variantSuffix "01"`).
- **Check:** If set composition uses keys `"01"`, `"02"` but variants use `"-01"`, `"-02"`, lookups still work because of `norm()`. If your UI stores one form and the other is used in calculations, ensure both go through the same normalization where needed.

---

## 2. Part-level (Set) calculations — QuoteCalculator

**Location:** Part Detail → Set Information accordion → "Quote calculator (per set)".

### 2.1 Auto set price

- **Formula:**  
  `autoSetPrice = sum over variants of (variant.pricePerVariant × setComposition[variant])`  
  Only variants that have **both** a non-null `pricePerVariant` and a positive quantity in `setComposition` are included.
- **Source:** `calculateSetPriceFromVariants(variants, setComposition)` in `src/lib/partDistribution.ts`.
- **When it’s used:**
  - The set price field shows this value when not in “manual” mode.
  - “Use Auto” for set price recalculates this and saves it to the part.
- **When it’s undefined:** No variants, or empty set composition, or no variant has `pricePerVariant` and a positive qty in composition. Then there is **no auto set price** and no “Use Auto” for price.

### 2.2 Auto set labor hours

- **Formula:**  
  `autoSetLaborHours = sum over variants of (variant.laborHours × setComposition[variant])`  
  Only variants with non-null `laborHours` and positive composition qty are included.
- **Source:** `calculateSetLaborFromVariants(variants, setComposition)` in `src/lib/partDistribution.ts`.
- **When it’s used:**  
  The “Use Auto” button next to set labor hours fills the field with this value and saves it.
- **When it’s undefined:** No variants, or empty set composition, or **no variant has `laborHours` set**. So at least one variant must have labor hours for the set-level “Use Auto” labor to appear.

### 2.3 Set quote (Material, Labor, Total)

- **Source:** `calculatePartQuote(part, 1, inventoryItems, { laborRate, cncRate, printer3DRate, manualSetPrice? })` in `src/lib/calculatePartQuote.ts`.
- **Material:** Part-level materials (per set) + variant materials × set composition; then × material multiplier (default 2.25). Uses **part** labor hours for labor cost when not reverse-calculating.
- **Labor:** `laborHours = part.laborHours × quantity` unless `manualSetPrice` is set (reverse calc).
- **Reverse (manual set price):** If `manualSetPrice` is provided, `targetTotal = manualSetPrice × quantity`, then `targetLaborCost = targetTotal - materialCost - cncCost - printerCost`, then `laborHours = targetLaborCost / laborRate`. Then `result.isLaborAutoAdjusted === true`.
- **Auto badge (set):** Shown next to labor when `result.isLaborAutoAdjusted` is true (i.e. set price is manual and labor was solved from that target).

---

## 3. Variant-level (Quick reference) — VariantQuoteMini

**Location:** Part Detail → Variants accordion → each variant card → “Quick reference” block.

### 3.1 Auto labor hours (per variant)

- **Formula:**  
  `autoLaborHours = (partLaborHours × variantQtyInSet) / totalUnitsInSet`  
  where `variantQtyInSet` is this variant’s qty in set composition and `totalUnitsInSet` is the sum of all composition quantities.
- **Source:** `variantLaborFromSetComposition(variant.variantSuffix, partLaborHours, setComposition)` in `src/lib/partDistribution.ts`.
- **When it’s defined:**  
  `partLaborHours != null` (part has labor hours) **and** `setComposition` is non-empty **and** this variant has a positive qty in the composition.
- **Effective labor hours:**  
  `effectiveLaborHours = variant.laborHours ?? autoLaborHours ?? 0`. So: use variant’s saved labor if set, else auto from set, else 0.

### 3.2 When “Labor hours” shows the auto badge

- **Condition:** `isLaborAuto = (variant.laborHours == null) && (autoLaborHours != null)`.
- So: variant has **no** saved labor hours, and auto labor hours from set composition **is** defined. Then the “auto” badge appears next to “Labor hours”.

### 3.3 Labor cost (always calculated)

- **Formula:**  
  `laborCost = effectiveLaborHours × laborRate` (for quantity 1 in the quick reference).
- **Source:** `calculateVariantQuote(..., { laborRate })`; it uses `variant.laborHours` **or** the effective labor we pass in via `variantWithEffectiveLabor`.
- **When “Labor” shows the auto badge:**  
  `isLaborAuto || result.isLaborAutoAdjusted`. So when labor hours are from set (auto) **or** when total was manual and labor was reverse-calculated.

### 3.4 Total (price per variant)

- **Forward (no manual total):**  
  `total = materialCostCustomer + laborCost + cncCost + printer3DCost` (no markup in current variant logic). So total is **auto-calculated** from material + labor + machine.
- **Reverse (manual total):**  
  When the user has edited the total (or we pass `manualVariantPrice`), `total = manualVariantPrice × quantity` and labor is solved so that material + labor + machine = that total; then `result.isReverseCalculated` and `result.isLaborAutoAdjusted` are true.
- **In VariantQuoteMini:**  
  We call `calculateVariantQuote` with `manualVariantPrice` only when `hasUserEditedTotal && totalInput.trim()`. Otherwise we use the variant as-is (including `effectiveLaborHours`), so total is the forward-calculated value.

### 3.5 When “Total” shows the auto badge

- **Condition:**  
  `isTotalAuto = (variant.pricePerVariant == null) && !hasUserEditedTotal && (result != null)`.
- So: variant has **no** saved price, user has **not** edited the total in this session, and we have a quote result. Then the total is the calculated total (material + labor) and the “auto” badge is shown.

### 3.6 Displayed values in the quick reference

- **Material:** Always from `result.materialCostCustomer` (read-only).
- **Labor hours:**  
  - If `hasUserEditedLabor`: show `laborHoursInput`.  
  - Else: show `effectiveLaborHours` (variant or auto).
- **Labor $:** Always `result.laborCost`.
- **Total:**  
  - If `hasUserEditedTotal`: show `totalInput`.  
  - Else: show `result.total.toFixed(2)` (forward or reverse from quote).

---

## 4. Requirements for auto to work

| What you want           | What must be true |
|-------------------------|-------------------|
| Set “Use Auto” labor    | At least one variant has `laborHours` set; set composition non-empty. |
| Set “Use Auto” price    | At least one variant has `pricePerVariant` set; set composition non-empty. |
| Variant labor “auto”    | Part has `laborHours`; set composition non-empty; this variant in composition; variant has no saved `laborHours`. |
| Variant total “auto”    | Variant has no saved `pricePerVariant`; user hasn’t edited total; quote result exists (e.g. materials defined). |

---

## 5. Code locations

| Logic                         | File                          | Function / usage |
|------------------------------|--------------------------------|------------------|
| Set price from variants      | `src/lib/partDistribution.ts`  | `calculateSetPriceFromVariants` |
| Set labor from variants      | `src/lib/partDistribution.ts`  | `calculateSetLaborFromVariants` |
| Variant labor from set       | `src/lib/partDistribution.ts`  | `variantLaborFromSetComposition` |
| Variant prices from set price| `src/lib/partDistribution.ts`  | `variantPricesFromSetPrice` |
| Part quote (set)             | `src/lib/calculatePartQuote.ts`| `calculatePartQuote` |
| Variant quote                | `src/lib/calculatePartQuote.ts`| `calculateVariantQuote` |
| Set UI                       | `src/components/QuoteCalculator.tsx` | Set labor/price + badges |
| Variant quick reference      | `src/features/admin/PartDetail.tsx` | `VariantQuoteMini` |

---

## 6. Troubleshooting

### Auto badge not showing

- **Labor hours (variant):**  
  - Check: part has `laborHours`, set composition has entries, this variant’s suffix appears in composition with qty > 0.  
  - Check: `variant.laborHours` is null/undefined (if it’s set, we’re not “auto”).
- **Total (variant):**  
  - Check: `variant.pricePerVariant` is null/undefined.  
  - Check: user hasn’t just edited total (`hasUserEditedTotal` is false after load).  
  - Check: `result` is not null (variant has materials or at least yields a quote).

### Values not matching expectations

- **Suffix mismatch:** Ensure set composition keys and `variant.variantSuffix` normalize the same way (e.g. both `"01"` or both `"-01"` after norm).
- **Rates:** Labor/cnc/printer come from `settings` (e.g. SettingsContext). Confirm values in admin settings.
- **Material cost:** Uses inventory item `price` and material multiplier (2.25 default). Check inventory prices and multiplier.

### Total overwrites or wrong after manual edit

- Manual total is saved as `variant.pricePerVariant`. After save, we only clear “user edited” when the server returns a value within 0.01 of what we sent (`lastSentTotalRef`). If the server or another flow changes `pricePerVariant`, the UI can show that instead until the user edits again.
- We do **not** push labor to other variants when only `pricePerVariant` is updated; labor push runs only when the user explicitly changes labor hours on a variant.

---

## 7. Formulas summary

- **Set price (auto):**  
  `Σ (variant.pricePerVariant × setComposition[variant])` over variants in composition with a price.
- **Set labor (auto):**  
  `Σ (variant.laborHours × setComposition[variant])` over variants in composition with labor.
- **Variant labor (auto):**  
  `(partLaborHours × variantQtyInSet) / totalUnitsInSet`, rounded to 2 decimals.
- **Variant total (forward):**  
  `Material + Labor + CNC + 3D` (no markup).  
- **Variant total (reverse):**  
  User sets total; labor solved as `(targetTotal - material - cnc - printer) / laborRate`.

Use this doc to trace data (part/variant props, set composition, rates) and the conditions above to verify when “auto” should appear and how each number is derived.

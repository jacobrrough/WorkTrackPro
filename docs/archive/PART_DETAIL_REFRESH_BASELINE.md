# Part Detail Refresh Baseline

This file locks non-breaking behavior for the Part Detail refresh.

## Scope

- Primary target: `src/features/admin/PartDetail.tsx`
- Supporting changes allowed only when required for safety and correctness.

## Existing Behavior To Preserve

- Part load/edit flow, including:
  - direct part lookup
  - `job-*` virtual part fallback behavior
  - part drawings upload/remove flow
- Variant CRUD and auto-derivation behavior:
  - set price/labor/CNC recalculation paths
  - set composition interactions
  - manual override preservation where already implemented
- Materials CRUD and material cost display flow.
- Part update signaling to other views:
  - keep `parts:updated` event dispatch behavior intact.
- Toast-first mutation feedback and current service/action contracts.
- Existing navigation behavior:
  - back action remains `onNavigateBack()`
  - cross-navigation to inventory/job views remains unchanged.

## Key Dependency Map

- Parent wiring: `src/App.tsx`
- Services:
  - `src/services/api/parts.ts`
  - `src/services/api/inventory.ts`
- Pricing/material helpers:
  - `src/lib/partDistribution.ts`
  - `src/lib/variantPricingAuto.ts`
  - `src/lib/calculatePartQuote.ts`
- Shared UI:
  - `src/components/Accordion.tsx`
  - `src/components/MaterialCostDisplay.tsx`
  - `src/components/QuoteCalculator.tsx`
  - `src/FileUploadButton.tsx`
- Contexts:
  - `src/contexts/SettingsContext.tsx`
  - `src/Toast.tsx`

## Refresh Safety Rule

Refactor only by extraction and layout cleanup:
- preserve current service calls and payload semantics
- preserve role-gated pricing visibility
- avoid breaking part-to-job pricing/scheduling propagation

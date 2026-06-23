-- Migration: Per-material "needs CNC'd out" flag on part_materials.
--
-- WHY: CNC-able used to be inferred purely from material category (foam) OR per-variant CNC hours,
-- which over-marked every foam job as needing CNC. The shop wants a per-material slider: each
-- attached foam material carries an explicit flag for whether that foam is actually CNC'd out. The
-- flag drives the CNC milestone (which materials deduct on "CNC done" vs "unit done") and whether a
-- variant appears in the CNC checklist. See docs/cnc-unit-progress-deduction.md and
-- src/lib/cncDeduction.ts (specMaterialRequiresCnc).
--
-- BEHAVIOR: cncDeduction treats an EXPLICIT boolean on a matching spec material as authoritative; an
-- absent flag falls back to the per-variant CNC-hours gate. So existing jobs whose linked part has
-- no flag keep working exactly as before until the part's materials are flagged.
--
-- BACKFILL (seed-from-CNC-hours, per product decision): set requires_cnc=true for foam-category
-- materials whose owning variant/part currently runs CNC (requires_cnc OR cnc_time_hours>0, with a
-- part-level fallback for variant rows). All other materials default false (opt-in going forward).
-- Adding a column with a constant default is metadata-only in PG 11+ (no table rewrite / no lock).
--
-- ROLLBACK:
--   ALTER TABLE public.part_materials DROP COLUMN IF EXISTS requires_cnc;

ALTER TABLE public.part_materials
  ADD COLUMN IF NOT EXISTS requires_cnc boolean NOT NULL DEFAULT false;

-- One-time seed. Categories come from the org setting (default ['foam'] when unset/missing).
WITH cnc_cats AS (
  SELECT jsonb_array_elements_text(
    COALESCE((SELECT cnc_able_categories FROM public.organization_settings LIMIT 1), '["foam"]'::jsonb)
  ) AS cat
)
UPDATE public.part_materials pm
   SET requires_cnc = true
 WHERE EXISTS (
         SELECT 1 FROM public.inventory i
          WHERE i.id = pm.inventory_id
            AND i.category IN (SELECT cat FROM cnc_cats)
       )
   AND (
         -- Variant-level material: the owning variant OR its parent part runs CNC. The part-level
         -- fallback mirrors computeVariantBreakdown, which gives a variant the part's CNC hours when
         -- the variant doesn't define its own.
         EXISTS (
           SELECT 1
             FROM public.part_variants pv
             LEFT JOIN public.parts p ON p.id = pv.part_id
            WHERE pv.id = COALESCE(pm.part_variant_id, pm.variant_id)
              AND (
                   COALESCE(pv.requires_cnc, false) OR COALESCE(pv.cnc_time_hours, 0) > 0
                OR COALESCE(p.requires_cnc, false)  OR COALESCE(p.cnc_time_hours, 0)  > 0
              )
         )
         -- Part-level (per_set) material: the part itself runs CNC.
      OR EXISTS (
           SELECT 1
             FROM public.parts p
            WHERE p.id = pm.part_id
              AND pm.part_variant_id IS NULL
              AND pm.variant_id IS NULL
              AND (COALESCE(p.requires_cnc, false) OR COALESCE(p.cnc_time_hours, 0) > 0)
         )
       );

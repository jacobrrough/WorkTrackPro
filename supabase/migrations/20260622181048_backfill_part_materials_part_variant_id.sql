-- Backfill the canonical part_variant_id link from the legacy variant_id column for
-- variant-level part_materials rows.
--
-- Background: part_materials links a material to a variant via part_variant_id (current)
-- or variant_id (legacy). Rows created before the part_variant_id column existed
-- (Feb–May 2026) have part_id NULL and only variant_id set. The parts loader's primary
-- query filters on `part_id.eq OR part_variant_id.in`, with a fallback to variant_id that
-- only runs when the primary query ERRORS. Once the part_variant_id column was added, the
-- primary query stopped erroring and the fallback never fired, so those legacy rows were
-- silently dropped — variant BOMs came back empty in the job/parts UI.
--
-- Both columns are foreign keys to part_variants(id) and every legacy value is already a
-- valid variant id, so copying variant_id -> part_variant_id is safe. Idempotent: a second
-- run matches 0 rows. (The loader was also hardened to query both columns directly.)
UPDATE public.part_materials
SET part_variant_id = variant_id
WHERE part_variant_id IS NULL
  AND variant_id IS NOT NULL;

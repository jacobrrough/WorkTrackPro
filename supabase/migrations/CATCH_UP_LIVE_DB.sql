-- ============================================
-- CATCH-UP SCRIPT FOR LIVE SUPABASE DATABASE
-- ============================================
-- Generated 2026-05-11 by comparing live schema dump against migration files.
-- Applies ONLY the missing changes. Safe to run multiple times (idempotent).
--
-- DATA SAFETY:
--   - NO rows are deleted
--   - NO existing column values are overwritten
--   - All ALTER TABLE uses ADD COLUMN IF NOT EXISTS (no-op if already present)
--   - All CREATE TABLE uses IF NOT EXISTS (no-op if already present)
--   - Backfill UPDATEs only touch rows with default/empty values
--   - INSERT uses ON CONFLICT DO NOTHING (won't overwrite existing rows)
--   - Constraint is only added after validating no rows would violate it
--
-- Missing items found:
--   1. part_materials: quantity has no DEFAULT (causes 23502 on insert)
--   2. job_parts table missing entirely
--   3. shifts.lunch_minutes_used column missing
--   4. jobs.printer3d_completed_at/printer3d_completed_by columns missing
--   5. jobs.status default is 'pending' instead of 'toBeQuoted'
--   6. attachments.attachments_one_owner_check constraint missing
-- ============================================


-- ============================================
-- 1. Fix part_materials dual-column issue
-- ============================================
-- WHAT THIS DOES:
--   - Adds DEFAULT 0 to the `quantity` column so inserts don't fail with 23502
--   - Creates a sync trigger so FUTURE inserts/updates keep quantity and quantity_per_unit in sync
-- WHAT THIS DOES NOT DO:
--   - Does NOT modify any existing row values (existing data is left untouched)
--   - Does NOT drop any columns
--   - Does NOT change column types or constraints
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'part_materials' AND column_name = 'quantity'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'part_materials' AND column_name = 'quantity_per_unit'
  ) THEN
    -- Add default so inserts setting only quantity_per_unit don't violate NOT NULL on quantity.
    -- This ONLY affects new rows — existing rows keep their current values.
    ALTER TABLE public.part_materials ALTER COLUMN quantity SET DEFAULT 0;

    -- Keep the two columns in sync automatically for FUTURE writes only.
    -- On INSERT/UPDATE: whichever column is set, the other is mirrored.
    CREATE OR REPLACE FUNCTION public.sync_part_material_quantity()
    RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF NEW.quantity_per_unit IS NOT NULL THEN
        NEW.quantity := NEW.quantity_per_unit;
      ELSIF NEW.quantity IS NOT NULL THEN
        NEW.quantity_per_unit := NEW.quantity;
      END IF;
      RETURN NEW;
    END;
    $fn$;

    DROP TRIGGER IF EXISTS part_materials_sync_quantity_trg ON public.part_materials;
    CREATE TRIGGER part_materials_sync_quantity_trg
      BEFORE INSERT OR UPDATE OF quantity, quantity_per_unit
      ON public.part_materials
      FOR EACH ROW
      EXECUTE FUNCTION public.sync_part_material_quantity();
  END IF;
END $$;


-- ============================================
-- 2. Create job_parts table (multi-part jobs)
-- ============================================
-- WHAT THIS DOES:
--   - Creates the job_parts table IF it doesn't already exist
--   - Backfills one row per job that has part_id set (ON CONFLICT DO NOTHING = no duplicates)
-- WHAT THIS DOES NOT DO:
--   - Does NOT modify or delete any existing jobs data
--   - Does NOT remove jobs.part_id (still used as "primary part" for backward compat)
CREATE TABLE IF NOT EXISTS public.job_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  part_id uuid NOT NULL REFERENCES public.parts(id) ON DELETE CASCADE,
  dash_quantities jsonb,
  sort_order int NOT NULL DEFAULT 0,
  rev text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(job_id, part_id)
);

CREATE INDEX IF NOT EXISTS idx_job_parts_job ON public.job_parts(job_id);
CREATE INDEX IF NOT EXISTS idx_job_parts_part ON public.job_parts(part_id);

-- Backfill: copy existing jobs.part_id links into junction table.
-- ON CONFLICT DO NOTHING = if the row already exists, skip it.
INSERT INTO public.job_parts (job_id, part_id, dash_quantities, sort_order)
SELECT id, part_id, COALESCE(dash_quantities, '{}'::jsonb), 0
FROM public.jobs
WHERE part_id IS NOT NULL
ON CONFLICT (job_id, part_id) DO NOTHING;

ALTER TABLE public.job_parts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated job_parts" ON public.job_parts;
CREATE POLICY "Authenticated job_parts" ON public.job_parts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ============================================
-- 3. Add lunch_minutes_used to shifts
-- ============================================
-- WHAT THIS DOES:
--   - Adds column with DEFAULT 0 (existing rows get 0)
--   - Backfills ONLY rows that have lunch_start_time AND lunch_end_time set
--     AND lunch_minutes_used is still 0 (the default)
-- WHAT THIS DOES NOT DO:
--   - Does NOT modify shifts that already have lunch_minutes_used > 0
--   - Does NOT delete or modify lunch_start_time/lunch_end_time values
ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS lunch_minutes_used integer NOT NULL DEFAULT 0;

UPDATE public.shifts
SET lunch_minutes_used = GREATEST(
  0,
  FLOOR(EXTRACT(EPOCH FROM (lunch_end_time - lunch_start_time)) / 60)::integer
)
WHERE lunch_minutes_used = 0
  AND lunch_start_time IS NOT NULL
  AND lunch_end_time IS NOT NULL;

ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_lunch_minutes_used_check;
ALTER TABLE public.shifts ADD CONSTRAINT shifts_lunch_minutes_used_check CHECK (lunch_minutes_used >= 0);


-- ============================================
-- 4. Add 3D print completion tracking to jobs
-- ============================================
-- WHAT THIS DOES:
--   - Adds two nullable columns (no existing data affected)
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS printer3d_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS printer3d_completed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;


-- ============================================
-- 5. Fix jobs.status default
-- ============================================
-- WHAT THIS DOES:
--   - Changes the DEFAULT for new jobs from 'pending' to 'toBeQuoted'
-- WHAT THIS DOES NOT DO:
--   - Does NOT change the status of any existing job
ALTER TABLE public.jobs ALTER COLUMN status SET DEFAULT 'toBeQuoted';


-- ============================================
-- 6. Add attachments one-owner constraint
-- ============================================
-- WHAT THIS DOES:
--   - Adds a CHECK constraint ensuring each attachment has at most one owner
--   - Validates existing rows FIRST — if any row violates, it logs a warning instead of failing
-- WHAT THIS DOES NOT DO:
--   - Does NOT delete or modify any attachment rows
DO $$
DECLARE
  v_violating_count integer;
BEGIN
  -- Drop any old constraint versions (safe — does nothing if they don't exist)
  ALTER TABLE public.attachments DROP CONSTRAINT IF EXISTS attachments_job_or_inventory_check;
  ALTER TABLE public.attachments DROP CONSTRAINT IF EXISTS attachments_one_owner_check;

  -- Count rows that would violate the new constraint (multiple owners set)
  SELECT COUNT(*) INTO v_violating_count
  FROM public.attachments
  WHERE (
    (CASE WHEN job_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN inventory_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN part_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN board_card_id IS NOT NULL THEN 1 ELSE 0 END)
  ) > 1;

  IF v_violating_count > 0 THEN
    RAISE WARNING '% attachment row(s) have multiple owners set — skipping constraint. Fix these rows first, then re-run.', v_violating_count;
  ELSE
    -- All rows pass validation — safe to add constraint
    ALTER TABLE public.attachments ADD CONSTRAINT attachments_one_owner_check CHECK (
      (job_id IS NOT NULL AND inventory_id IS NULL AND part_id IS NULL AND board_card_id IS NULL) OR
      (job_id IS NULL AND inventory_id IS NOT NULL AND part_id IS NULL AND board_card_id IS NULL) OR
      (job_id IS NULL AND inventory_id IS NULL AND part_id IS NOT NULL AND board_card_id IS NULL) OR
      (job_id IS NULL AND inventory_id IS NULL AND part_id IS NULL AND board_card_id IS NOT NULL) OR
      (job_id IS NULL AND inventory_id IS NULL AND part_id IS NULL AND board_card_id IS NULL)
    );
    RAISE NOTICE 'attachments_one_owner_check constraint added successfully.';
  END IF;
END $$;


-- ============================================
-- CATCH-UP COMPLETE
-- ============================================
-- After running, reload PostgREST schema cache:
--   NOTIFY pgrst, 'reload schema';
-- Then hard-refresh the app (Ctrl+F5).

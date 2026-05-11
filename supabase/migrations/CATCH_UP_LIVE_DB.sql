-- ============================================
-- CATCH-UP SCRIPT FOR LIVE SUPABASE DATABASE
-- ============================================
-- Generated 2026-05-11 by comparing live schema dump against migration files.
-- Applies ONLY the missing changes. Safe to run multiple times (idempotent).
--
-- Missing items found:
--   1. part_materials: quantity has no DEFAULT (causes 23502 on insert)
--   2. job_parts table missing entirely
--   3. shifts.lunch_minutes_used column missing
--   4. jobs.printer3d_completed_at/printer3d_completed_by columns missing
--   5. jobs.status default is 'pending' instead of 'toBeQuoted'
--   6. attachments.attachments_one_owner_check constraint missing
-- ============================================

-- 1. Fix part_materials dual-column issue
-- Sync quantity ↔ quantity_per_unit and add default to quantity
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'part_materials' AND column_name = 'quantity'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'part_materials' AND column_name = 'quantity_per_unit'
  ) THEN
    -- Sync quantity_per_unit from quantity where quantity_per_unit still has the migration default
    UPDATE public.part_materials
       SET quantity_per_unit = quantity
     WHERE quantity_per_unit = 1 AND quantity != 1 AND quantity IS NOT NULL;

    -- Sync quantity from quantity_per_unit for any rows where they diverge
    UPDATE public.part_materials
       SET quantity = quantity_per_unit
     WHERE quantity != quantity_per_unit;

    -- Add default so inserts setting only quantity_per_unit don't violate NOT NULL
    ALTER TABLE public.part_materials ALTER COLUMN quantity SET DEFAULT 0;

    -- Keep the two columns in sync automatically
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

-- 2. Create job_parts table (multi-part jobs)
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

-- Backfill from jobs.part_id
INSERT INTO public.job_parts (job_id, part_id, dash_quantities, sort_order)
SELECT id, part_id, COALESCE(dash_quantities, '{}'::jsonb), 0
FROM public.jobs
WHERE part_id IS NOT NULL
ON CONFLICT (job_id, part_id) DO NOTHING;

ALTER TABLE public.job_parts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated job_parts" ON public.job_parts;
CREATE POLICY "Authenticated job_parts" ON public.job_parts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 3. Add lunch_minutes_used to shifts
ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS lunch_minutes_used integer NOT NULL DEFAULT 0;

-- Backfill from existing lunch window tracking
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

-- 4. Add 3D print completion tracking to jobs
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS printer3d_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS printer3d_completed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- 5. Fix jobs.status default
ALTER TABLE public.jobs ALTER COLUMN status SET DEFAULT 'toBeQuoted';

-- 6. Add attachments one-owner constraint
ALTER TABLE public.attachments DROP CONSTRAINT IF EXISTS attachments_job_or_inventory_check;
ALTER TABLE public.attachments DROP CONSTRAINT IF EXISTS attachments_one_owner_check;
ALTER TABLE public.attachments ADD CONSTRAINT attachments_one_owner_check CHECK (
  (job_id IS NOT NULL AND inventory_id IS NULL AND part_id IS NULL AND board_card_id IS NULL) OR
  (job_id IS NULL AND inventory_id IS NOT NULL AND part_id IS NULL AND board_card_id IS NULL) OR
  (job_id IS NULL AND inventory_id IS NULL AND part_id IS NOT NULL AND board_card_id IS NULL) OR
  (job_id IS NULL AND inventory_id IS NULL AND part_id IS NULL AND board_card_id IS NOT NULL) OR
  (job_id IS NULL AND inventory_id IS NULL AND part_id IS NULL AND board_card_id IS NULL)
);

-- ============================================
-- CATCH-UP COMPLETE
-- ============================================
-- After running, reload PostgREST schema cache:
--   NOTIFY pgrst, 'reload schema';
-- Then hard-refresh the app (Ctrl+F5).

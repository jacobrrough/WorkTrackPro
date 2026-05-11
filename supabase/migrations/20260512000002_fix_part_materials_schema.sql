-- Fix part_materials dual-column schema inconsistency.
-- When both initial_schema (quantity NOT NULL) and parts_schema (quantity_per_unit NOT NULL DEFAULT 1)
-- have run, the table has both columns. Inserts using only quantity_per_unit fail with 23502 on quantity.
-- This migration adds a default to quantity and a sync trigger so future inserts succeed.
-- Existing row values are NOT modified.

DO $$
BEGIN
  -- Case 1: both columns exist (initial + parts schema both ran)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'part_materials' AND column_name = 'quantity'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'part_materials' AND column_name = 'quantity_per_unit'
  ) THEN
    -- Add default so inserts setting only quantity_per_unit don't violate NOT NULL on quantity.
    -- Existing rows keep their current values.
    ALTER TABLE public.part_materials ALTER COLUMN quantity SET DEFAULT 0;

    -- Create a trigger to keep quantity in sync with quantity_per_unit on insert/update
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

  -- Case 2: only quantity exists (legacy schema only) — add quantity_per_unit
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'part_materials' AND column_name = 'quantity'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'part_materials' AND column_name = 'quantity_per_unit'
  ) THEN
    ALTER TABLE public.part_materials ADD COLUMN quantity_per_unit numeric NOT NULL DEFAULT 1;
    UPDATE public.part_materials SET quantity_per_unit = quantity;
  END IF;

  -- Case 3: only quantity_per_unit exists — nothing to fix (cleanest state)
END $$;

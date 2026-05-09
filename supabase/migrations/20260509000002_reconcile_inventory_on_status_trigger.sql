-- Migration: Inventory reconciliation trigger on job status change
-- Moves reconciliation from app layer to DB so it is atomic with the status write.
-- Browser crash = no corruption. No partial reconciliation. No multi-tab double-fire.
-- Direct Studio/admin edits reconcile too (trigger fires on any status UPDATE).
--
-- ROLLBACK:
-- DROP TRIGGER IF EXISTS jobs_reconcile_inventory_on_status_trg ON public.jobs;
-- DROP FUNCTION IF EXISTS public.jobs_reconcile_inventory_on_status();
-- DROP FUNCTION IF EXISTS public.is_consumed_status(text);
-- DROP FUNCTION IF EXISTS public.is_production_status(text);
-- ALTER TABLE public.inventory_history ALTER COLUMN user_id SET NOT NULL;

-- Allow NULL user_id for system-context fires (Studio, migrations, cron — no JWT)
ALTER TABLE public.inventory_history ALTER COLUMN user_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.is_consumed_status(s text) RETURNS boolean
  LANGUAGE sql IMMUTABLE SET search_path = public, pg_catalog AS $$
    SELECT s IN ('finished','delivered')
  $$;

CREATE OR REPLACE FUNCTION public.is_production_status(s text) RETURNS boolean
  LANGUAGE sql IMMUTABLE SET search_path = public, pg_catalog AS $$
    SELECT s IN ('pod','rush','pending','inProgress','qualityControl')
  $$;

-- NOTE: The double-deduction cycle (finished → onHold → inProgress → finished) is
-- addressed by migration 20260509000003_jobs_consumed_at.sql, which adds a consumed_at
-- column and updates this function to guard against re-entry.

CREATE OR REPLACE FUNCTION public.jobs_reconcile_inventory_on_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
DECLARE
  r              RECORD;
  sgn            INT;
  new_stock      INT;
  current_stock  INT;
  prev_available INT;
BEGIN
  -- Determine direction
  IF NOT is_consumed_status(OLD.status) AND is_consumed_status(NEW.status) THEN
    sgn := -1;  -- entering consumed: deduct inStock + available
  ELSIF is_consumed_status(OLD.status)
        AND NOT is_consumed_status(NEW.status)
        AND is_production_status(NEW.status) THEN
    sgn := 1;   -- returning to production (rework/mis-click undo): restore
  ELSE
    RETURN NEW; -- no-op: finished->onHold, consumed->consumed, etc.
  END IF;

  -- Process each job_inventory line in inventory_id order
  -- (deterministic order prevents deadlock with concurrent status changes)
  FOR r IN
    SELECT inventory_id, quantity
    FROM public.job_inventory
    WHERE job_id = NEW.id
      AND quantity IS NOT NULL
      AND quantity > 0
    ORDER BY inventory_id
  LOOP
    -- Lock row and read current values atomically (in id order = deadlock-safe)
    SELECT in_stock, available
    INTO current_stock, prev_available
    FROM public.inventory
    WHERE id = r.inventory_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'inventory_missing: row % not found', r.inventory_id;
    END IF;

    -- Prevent going negative on consume
    IF sgn = -1 AND current_stock + sgn * r.quantity < 0 THEN
      RAISE EXCEPTION 'insufficient_stock: inventory % has % in stock, job needs %',
        r.inventory_id, current_stock, r.quantity
        USING ERRCODE = 'check_violation';
    END IF;

    -- Atomic update of both in_stock and available
    UPDATE public.inventory
       SET in_stock   = in_stock   + sgn * r.quantity,
           available  = available  + sgn * r.quantity,
           updated_at = NOW()
     WHERE id = r.inventory_id
    RETURNING in_stock INTO new_stock;

    -- Audit row written in same transaction
    INSERT INTO public.inventory_history
      (inventory_id, user_id, action, reason,
       previous_in_stock, new_in_stock, change_amount, related_job_id,
       previous_available, new_available)
    VALUES (
      r.inventory_id,
      auth.uid(),           -- NULL when no JWT (Studio/cron) -- now allowed
      CASE WHEN sgn = -1 THEN 'reconcile_job' ELSE 'reconcile_job_reversal' END,
      'Job #' || NEW.job_code || ': ' || OLD.status || ' -> ' || NEW.status,
      current_stock,
      new_stock,
      sgn * r.quantity,
      NEW.id,
      prev_available,
      prev_available + sgn * r.quantity
    );
  END LOOP;

  RETURN NEW;
END$$;

CREATE TRIGGER jobs_reconcile_inventory_on_status_trg
  AFTER UPDATE OF status ON public.jobs
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.jobs_reconcile_inventory_on_status();

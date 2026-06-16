-- Migration: Make Finished a non-blocking consumption record (PO'd stays the real stock gate).
--
-- WHY:
--   Two stock gates existed:
--     1. PO'd (allocation time)  — job_inventory_allocate_guard (20260509000001): blocks
--        over-allocation, with a FOR UPDATE lock + consumed-job guard. UNCHANGED here — it
--        remains the authoritative "do we have enough stock?" gate.
--     2. Finished (consume time) — jobs_reconcile_inventory_on_status (20260509000003): on
--        entering a consumed status it deducts in_stock and RAISEd insufficient_stock; the
--        inventory_*_nonneg CHECK constraints also refused to let stock go below zero. So
--        finishing a *physically built* job could be blocked.
--
--   By the time a card reaches QC -> Finished the parts are already built and the materials
--   already physically consumed. Blocking there is wrong; the availability decision belongs
--   at PO'd (gate #1). This migration makes the Finished deduction record the true level
--   (which may go negative when stock was never tracked) instead of blocking:
--     A. Removes the insufficient_stock RAISE from the reconcile trigger.
--     B. Drops the inventory.in_stock / inventory.available non-negative CHECK constraints so
--        the deduction can persist a negative ("true shortfall") value.
--
--   NOTE (negative stock is now allowed table-wide, not only on the consume path): with the
--   CHECK constraints gone, any writer can drive stock negative — the client-callable
--   adjust_inventory_stock RPC (20260603144045), AND a direct UPDATE on public.inventory
--   (the "Authenticated inventory" RLS policy lets any approved user write the column). This
--   is an accepted trade-off for showing the true shortfall; the PO'd allocate guard still
--   blocks new allocations once stock is short (v_in_stock < allocated). If a per-path floor
--   is ever wanted, add it inside the RPC rather than re-adding a table CHECK.
--
-- SCOPE: This migration ONLY changes jobs_reconcile_inventory_on_status() and drops the two
--   CHECK constraints. The reconcile body below is identical to 20260509000003 EXCEPT the
--   consume-path insufficient_stock guard (003 lines 150-157) is removed. is_consumed_status()
--   / is_production_status() are called, not redefined (current definitions: 20260509000005 /
--   20260509000002). job_inventory_allocate_guard() is intentionally NOT touched.
--
-- ROLLBACK (run in order):
--   -- 1. Re-add constraints (only if no rows are currently negative):
--   --    ALTER TABLE public.inventory ADD CONSTRAINT inventory_in_stock_nonneg   CHECK (in_stock  >= 0);
--   --    ALTER TABLE public.inventory ADD CONSTRAINT inventory_available_nonneg  CHECK (available >= 0);
--   -- 2. Recreate jobs_reconcile_inventory_on_status() verbatim from 20260509000003 (guard restored).
--   -- 3. Re-apply the EXECUTE revoke (step C below).

-- A/B. Drop the non-negative guards so the consume deduction can persist a true (negative) level.
ALTER TABLE public.inventory DROP CONSTRAINT IF EXISTS inventory_in_stock_nonneg;
ALTER TABLE public.inventory DROP CONSTRAINT IF EXISTS inventory_available_nonneg;

-- A. Reconcile trigger: deduct on consume / restore on rework, but NEVER block.
--    Verbatim from 20260509000003 except the insufficient_stock guard is removed.
CREATE OR REPLACE FUNCTION public.jobs_reconcile_inventory_on_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
DECLARE
  r                  RECORD;
  sgn                INT;
  v_consumed         TIMESTAMPTZ;
  current_stock      NUMERIC;
  new_stock          NUMERIC;
  prev_available     NUMERIC;
  new_available      NUMERIC;
BEGIN
  -- Determine direction from status transition.
  IF NOT is_consumed_status(OLD.status) AND is_consumed_status(NEW.status) THEN
    sgn := -1;  -- candidate deduction: entering consumed state
  ELSIF is_consumed_status(OLD.status)
        AND NOT is_consumed_status(NEW.status)
        AND is_production_status(NEW.status) THEN
    sgn := 1;   -- candidate restore: returning to production for rework
  ELSE
    RETURN NEW; -- no-op: finished->onHold, consumed->consumed, non-consumed->non-consumed
  END IF;

  -- consumed_at sentinel from OLD (the outer UPDATE holds an exclusive row lock for the whole
  -- transaction, so OLD is authoritative — see 20260509000003).
  v_consumed := OLD.consumed_at;

  IF sgn = -1 THEN
    -- Already consumed (finished -> onHold -> inProgress -> finished): do not deduct twice.
    IF v_consumed IS NOT NULL THEN
      RETURN NEW;
    END IF;
  ELSE
    -- Reversal guard: only restore if a real deduction happened (avoids phantom inventory).
    IF v_consumed IS NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Process each job_inventory line in inventory_id order (deadlock-safe deterministic order).
  FOR r IN
    SELECT inventory_id, quantity
    FROM public.job_inventory
    WHERE job_id = NEW.id
      AND quantity IS NOT NULL
      AND quantity > 0
    ORDER BY inventory_id
  LOOP
    -- Lock the inventory row and read current values atomically.
    SELECT in_stock, available
      INTO current_stock, prev_available
      FROM public.inventory
     WHERE id = r.inventory_id
       FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'inventory_missing: inventory row % not found', r.inventory_id;
    END IF;

    -- NOTE: the previous insufficient_stock guard (003 lines 150-157) is intentionally removed.
    -- A built job must always be allowed to finish; the deduction records the true level, which
    -- may go negative. The availability gate lives at PO'd (job_inventory_allocate_guard).

    -- Atomic update of both columns. May now go negative (CHECK constraints dropped above).
    UPDATE public.inventory
       SET in_stock   = in_stock   + ROUND(sgn * r.quantity)::INT,
           available  = available  + ROUND(sgn * r.quantity)::INT,
           updated_at = NOW()
     WHERE id = r.inventory_id
    RETURNING in_stock, available INTO new_stock, new_available;

    -- Audit row written in the same transaction.
    INSERT INTO public.inventory_history
      (inventory_id, user_id, action, reason,
       previous_in_stock, new_in_stock, change_amount, related_job_id,
       previous_available, new_available)
    VALUES (
      r.inventory_id,
      auth.uid(),
      CASE WHEN sgn = -1 THEN 'reconcile_job' ELSE 'reconcile_job_reversal' END,
      'Job #' || NEW.job_code || ': ' || OLD.status || ' -> ' || NEW.status,
      current_stock,
      new_stock,
      ROUND(sgn * r.quantity),
      NEW.id,
      prev_available,
      new_available
    );
  END LOOP;

  -- Update consumed_at sentinel (only touches consumed_at, so the WHEN clause prevents re-entry).
  IF sgn = -1 THEN
    UPDATE public.jobs
       SET consumed_at = NOW()
     WHERE id = NEW.id
       AND consumed_at IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'consumed_at_race: job % — sentinel write matched 0 rows (logic error, not concurrency; check trigger configuration)',
        NEW.id;
    END IF;
  ELSE
    UPDATE public.jobs
       SET consumed_at = NULL
     WHERE id = NEW.id
       AND consumed_at IS NOT NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'consumed_at_race_reversal: job % — sentinel clear matched 0 rows (logic error, not concurrency; check trigger configuration)',
        NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END$$;

-- C. Re-apply the EXECUTE revoke. CREATE OR REPLACE FUNCTION resets privileges to the default
--    (EXECUTE to PUBLIC), which would undo the trigger-only lockdown from 20260608232336 /
--    20260609142517. This function fires only from a trigger (runs as table owner regardless),
--    so revoking REST/RPC EXECUTE has no effect on trigger firing.
REVOKE EXECUTE ON FUNCTION public.jobs_reconcile_inventory_on_status() FROM public, anon, authenticated;

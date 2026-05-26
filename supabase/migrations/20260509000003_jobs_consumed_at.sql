-- Migration: Prevent double stock deduction on finished → onHold → inProgress → finished cycle
--
-- ROOT CAUSE: The reconciliation trigger (migration 20260509000002) has no memory of whether
-- a job's stock was already consumed. If a finished job is administratively moved to onHold
-- (no-op in the trigger), then back to inProgress (no-op), then finished again, the trigger
-- fires a second deduction — resulting in doubled stock loss.
--
-- FIX: Add consumed_at (timestamptz) to jobs as an idempotency sentinel.
--   • On first deduction (→ finished/delivered): read OLD.consumed_at; skip if non-NULL
--     (already consumed); otherwise deduct and set consumed_at = NOW().
--   • On genuine rework restore (finished → production status): only restore if consumed_at
--     IS NOT NULL (confirms a real deduction occurred); clear sentinel so next →finished
--     deducts exactly once.
--   • finished → onHold → inProgress → finished: consumed_at is set after step 1 and never
--     cleared (onHold is not a production status), so step 4 is skipped. ✓
--
-- COUNCIL FIXES (post-review):
--   A. [SUPERSEDED by G] Re-read consumed_at via SELECT … FOR UPDATE.
--   B. Reversal guard: skip restore if v_consumed IS NULL — prevents phantom stock addition
--      when consumed_at is absent due to direct inserts or data inconsistencies.
--   C. RETURNING in_stock, available both columns — audit trail was using a computed estimate
--      for new_available; now reads the actual post-update value.
--   D. Guard uses ROUND(sgn * r.quantity)::INT — prevents false-positive insufficient_stock
--      rejection when fractional quantity rounds to 0 (e.g. quantity=0.4 with stock=0).
--   E. Idempotent consumed_at write: WHERE consumed_at IS NULL on the deduction SET, and
--      assert FOUND as a last-resort tripwire (see note on E/F below).
--   F. Symmetric consumed_at_race_reversal tripwire on the restore path (see note below).
--   G. Use OLD.consumed_at instead of SELECT…FOR UPDATE (supersedes A): the outer UPDATE
--      holds an exclusive row lock for the entire transaction — no concurrent writer can
--      modify consumed_at between trigger fire and commit. OLD is simpler, cheaper, correct.
--   H. Backfill scoped to jobs with actual reconcile_job audit records — prevents phantom
--      stock restores on legacy pre-trigger finished jobs that never had stock deducted.
--
-- Note on E/F (consumed_at_race / consumed_at_race_reversal):
--   These IF NOT FOUND guards are UNREACHABLE under normal operation. The exclusive row
--   lock (held since the outer UPDATE) prevents any concurrent modification of consumed_at
--   between OLD capture and the sentinel UPDATE. They are retained as last-resort tripwires
--   in case the locking model ever changes (e.g., trigger moved to BEFORE or STATEMENT
--   level). If they ever fire in production, it indicates a trigger configuration change,
--   not a concurrency race.
--
-- ROLLBACK:
--   DROP TRIGGER  IF EXISTS jobs_reconcile_inventory_on_status_trg ON public.jobs;
--   DROP FUNCTION IF EXISTS public.jobs_reconcile_inventory_on_status();
--   -- Recreate previous version from migration 20260509000002.
--   ALTER TABLE public.jobs DROP COLUMN IF EXISTS consumed_at;

-- 1. Add the sentinel column
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ DEFAULT NULL;

-- 2. Backfill: mark ONLY jobs for which the reconcile trigger (20260509000002) actually fired
--    and deducted stock — identified by the presence of a 'reconcile_job' record in
--    inventory_history. Jobs that were already finished BEFORE 20260509000002 deployed have
--    no such record and must NOT be backfilled: the reversal guard (v_consumed IS NULL →
--    RETURN NEW) relies on consumed_at IS NULL to mean "no deduction has occurred". Marking
--    pre-trigger legacy jobs would fool the guard into allowing phantom stock restores on
--    rework, manufacturing inventory that was never actually deducted.
UPDATE public.jobs j
   SET consumed_at = ih.first_reconcile_at
  FROM (
    SELECT related_job_id,
           MIN(created_at) AS first_reconcile_at
      FROM public.inventory_history
     WHERE action = 'reconcile_job'
     GROUP BY related_job_id
  ) ih
 WHERE j.id = ih.related_job_id
   AND j.status IN ('finished', 'delivered')
   AND j.consumed_at IS NULL;
-- Jobs with no reconcile_job record retain consumed_at = NULL.
-- On rework: reversal guard (v_consumed IS NULL) correctly skips restore — no phantom stock.
-- On re-finish: deduction fires for the first time, sentinel is set. Correct.

-- 3. Replace the trigger function with the hardened consumed_at-aware version
CREATE OR REPLACE FUNCTION public.jobs_reconcile_inventory_on_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
DECLARE
  r                  RECORD;
  sgn                INT;
  v_consumed         TIMESTAMPTZ;
  -- NUMERIC matches job_inventory.quantity (which is NUMERIC, not INT).
  -- inventory.in_stock and .available are INT columns; the explicit ROUND()::INT
  -- casts in the UPDATE below make the rounding visible rather than relying on
  -- PostgreSQL's implicit numeric→int coercion.
  current_stock      NUMERIC;
  new_stock          NUMERIC;
  prev_available     NUMERIC;
  new_available      NUMERIC;
BEGIN
  -- Determine direction from status transition
  IF NOT is_consumed_status(OLD.status) AND is_consumed_status(NEW.status) THEN
    sgn := -1;  -- candidate deduction: entering consumed state

  ELSIF is_consumed_status(OLD.status)
        AND NOT is_consumed_status(NEW.status)
        AND is_production_status(NEW.status) THEN
    sgn := 1;   -- candidate restore: returning to production for rework

  ELSE
    RETURN NEW; -- no-op: finished→onHold, consumed→consumed, non-consumed→non-consumed
  END IF;

  -- Read consumed_at from OLD (the pre-transition row).
  -- This is the authoritative sentinel value: it reflects whether a prior execution
  -- of this trigger already performed a deduction. The outer UPDATE jobs SET status=…
  -- holds an exclusive row lock for the entire transaction, so no concurrent writer
  -- can modify consumed_at between when this trigger fires and when it commits.
  -- Using OLD is simpler and cheaper than a redundant SELECT … FOR UPDATE.
  v_consumed := OLD.consumed_at;

  IF sgn = -1 THEN
    -- Guard: skip if this job was already consumed.
    -- Covers: finished → onHold → inProgress → finished (v_consumed IS NOT NULL after step 1).
    IF v_consumed IS NOT NULL THEN
      RETURN NEW;
    END IF;

  ELSE
    -- Reversal guard: only restore stock if a real deduction happened.
    -- If v_consumed IS NULL (direct insert in finished status, or data inconsistency),
    -- restoring would manufacture phantom inventory.
    IF v_consumed IS NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Process each job_inventory line in inventory_id order.
  -- Deterministic ORDER BY prevents deadlock with concurrent status changes on different jobs.
  FOR r IN
    SELECT inventory_id, quantity
    FROM public.job_inventory
    WHERE job_id = NEW.id
      AND quantity IS NOT NULL
      AND quantity > 0
    ORDER BY inventory_id
  LOOP
    -- Lock the inventory row and read current values atomically (id order = deadlock-safe).
    SELECT in_stock, available
      INTO current_stock, prev_available
      FROM public.inventory
     WHERE id = r.inventory_id
       FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'inventory_missing: inventory row % not found', r.inventory_id;
    END IF;

    -- Prevent going negative on consume.
    -- Use ROUND()::INT to match the actual deduction amount — a fractional quantity
    -- (e.g. 0.4) rounds to 0, so the guard must agree rather than false-firing on raw NUMERIC.
    IF sgn = -1 AND current_stock + ROUND(sgn * r.quantity)::INT < 0 THEN
      RAISE EXCEPTION 'insufficient_stock: inventory % has % in stock, job needs %',
        r.inventory_id, current_stock, r.quantity
        USING ERRCODE = 'check_violation';
    END IF;

    -- Atomic update of both in_stock and available.
    -- Explicit ROUND(sgn * r.quantity)::INT makes the integer rounding visible:
    -- job_inventory.quantity is NUMERIC; inventory.in_stock/available are INT.
    -- Without the explicit cast, PostgreSQL would round silently on assignment.
    -- RETURNING both columns records actual post-update values, not computed estimates.
    --
    -- Note on `available`: the DB column is not decremented at allocation time
    -- (job_inventory inserts do not touch inventory.available). The app computes
    -- displayable availability dynamically as in_stock − Σ(active allocations).
    -- The trigger keeps available in sync with in_stock movements so that the DB
    -- column stays directionally correct; the app's dynamic calculation remains
    -- authoritative for actual availability checks.
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
      auth.uid(),           -- NULL when no JWT (Studio/cron) — allowed by migration 20260509000002
      CASE WHEN sgn = -1 THEN 'reconcile_job' ELSE 'reconcile_job_reversal' END,
      'Job #' || NEW.job_code || ': ' || OLD.status || ' -> ' || NEW.status,
      current_stock,
      new_stock,
      ROUND(sgn * r.quantity),   -- matches the actual integer deduction applied above
      NEW.id,
      prev_available,
      new_available        -- actual post-update value from RETURNING (fix C)
    );
  END LOOP;

  -- Update consumed_at sentinel on the jobs row.
  -- Runs after the inventory LOOP to avoid interfering with FOR UPDATE locks above.
  -- This UPDATE only touches consumed_at — not status — so the trigger WHEN clause
  -- (OLD.status IS DISTINCT FROM NEW.status) prevents re-entry.
  IF sgn = -1 THEN
    -- Set the sentinel. WHERE consumed_at IS NULL is a last-resort tripwire:
    -- under normal operation (exclusive row lock held since outer UPDATE) this always
    -- matches exactly 1 row. IF NOT FOUND is unreachable via concurrency; it would
    -- indicate a trigger configuration change (e.g., moved to BEFORE level). Retained
    -- so any such misconfiguration surfaces immediately rather than silently corrupting stock.
    UPDATE public.jobs
       SET consumed_at = NOW()
     WHERE id = NEW.id
       AND consumed_at IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'consumed_at_race: job % — sentinel write matched 0 rows (logic error, not concurrency; check trigger configuration)',
        NEW.id;
    END IF;

  ELSE
    -- Genuine rework restore: clear sentinel so the next →finished deducts exactly once.
    -- WHERE consumed_at IS NOT NULL is the symmetric tripwire (see forward path above).
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

-- Trigger definition is unchanged from migration 20260509000002 — no DROP/CREATE needed
-- because CREATE OR REPLACE FUNCTION above updates the function body in place.
-- The trigger already points to jobs_reconcile_inventory_on_status() by name.

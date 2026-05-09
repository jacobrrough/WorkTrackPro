-- Migration: Block INSERT/UPDATE mutations on consumed job_inventory rows
--
-- PROBLEM: After a job reaches finished/delivered status, the reconciliation trigger
-- (20260509000003) has already deducted stock using the quantities in job_inventory.
--
-- Two mutation paths corrupt in_stock:
--
-- (A) UPDATE quantity/inventory_id/job_id — restoring stock on rework reads the
--     *current* quantities; if they changed post-consumption the restore differs
--     from the original deduction, permanently skewing in_stock. Re-pointing
--     job_id to a consumed job bypasses the INSERT guard entirely.
--
-- (B) INSERT a new row — the new row was never deducted when the job was first
--     consumed, but the rework restore path ignores it (consumed_at clears per job,
--     not per row). On the *next* finish cycle the trigger *will* deduct it,
--     producing a deduction with no matching prior restoration — in_stock goes
--     negative by that quantity with no audit trail.
--
-- FIX: A single shared BEFORE trigger function wired to BEFORE INSERT and
-- BEFORE UPDATE OF quantity, inventory_id, job_id. Locking the jobs row with
-- FOR UPDATE closes the TOCTOU window between reading status and the
-- reconciliation trigger's own exclusive lock on the same row.
--
-- The app-layer service guards in jobService.updateJobInventory and
-- allocateInventoryToJob provide fast-path UX feedback (job_is_consumed error
-- with a toast). This DB trigger is the hard safety net for any path that
-- bypasses the app layer (Studio, direct API, etc.).
--
-- Note: DELETE on job_inventory for consumed jobs is guarded only at the app
-- layer (jobService.removeJobInventory). A DB-level DELETE trigger was
-- evaluated and rejected because it would block deleteJob's explicit
-- job_inventory cleanup, which runs while the job row still exists in a
-- consumed status. The app-layer guard is sufficient for normal usage; Studio
-- admin direct deletes are an accepted operational risk documented in the
-- runbook.
--
-- ROLLBACK:
--   DROP TRIGGER  IF EXISTS job_inventory_insert_consumed_guard_trg ON public.job_inventory;
--   DROP TRIGGER  IF EXISTS job_inventory_update_consumed_guard_trg ON public.job_inventory;
--   DROP FUNCTION IF EXISTS public.job_inventory_no_mutate_on_consumed();

CREATE OR REPLACE FUNCTION public.job_inventory_no_mutate_on_consumed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
DECLARE
  v_status TEXT;
BEGIN
  -- Lock the jobs row so this check is serialized against the reconciliation
  -- trigger's own FOR UPDATE on the same row — closes the TOCTOU window.
  -- Applies to INSERT and UPDATE OF quantity, inventory_id, job_id.
  -- Unit-only changes are cosmetic and are intentionally excluded from the trigger.
  SELECT status INTO v_status
    FROM public.jobs
   WHERE id = NEW.job_id
     FOR UPDATE;

  -- FOUND is false when the job row is gone (concurrent delete or cascade).
  -- In that case there is nothing to protect — allow the mutation through.
  IF FOUND AND is_consumed_status(v_status) THEN
    RAISE EXCEPTION 'job_is_consumed: cannot mutate job_inventory for job % in status %',
      NEW.job_id, v_status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- Lock down direct invocation: trigger functions run as the migration owner (SECURITY DEFINER).
-- Without this, any role (including anon/authenticated via PostgREST) could call the function
-- directly with forged args and acquire exclusive row locks on arbitrary jobs rows —
-- turning the TOCTOU-closing FOR UPDATE into a lock-contention DoS primitive.
REVOKE EXECUTE ON FUNCTION public.job_inventory_no_mutate_on_consumed() FROM PUBLIC;

-- Block inserting new rows against an already-consumed job.
-- Without this guard a new allocation added post-consumption is never matched
-- by a deduction, but is deducted on the next rework finish cycle.
CREATE TRIGGER job_inventory_insert_consumed_guard_trg
  BEFORE INSERT ON public.job_inventory
  FOR EACH ROW
  EXECUTE FUNCTION public.job_inventory_no_mutate_on_consumed();

-- Block updates that affect stock-relevant columns on consumed rows.
-- quantity and inventory_id change what gets deducted/restored.
-- job_id re-pointing a row to a consumed job bypasses the INSERT guard.
-- unit-only updates are allowed (cosmetic, no stock impact).
CREATE TRIGGER job_inventory_update_consumed_guard_trg
  BEFORE UPDATE OF quantity, inventory_id, job_id ON public.job_inventory
  FOR EACH ROW
  EXECUTE FUNCTION public.job_inventory_no_mutate_on_consumed();

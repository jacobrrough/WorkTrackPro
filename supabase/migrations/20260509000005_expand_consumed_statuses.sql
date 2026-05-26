-- Migration: Expand is_consumed_status() to include finance states
--
-- PROBLEM: is_consumed_status() only covered 'finished' and 'delivered', but
-- migration 20260509000001 (allocation guard) already treats 5 statuses as
-- consumed: finished, delivered, waitingForPayment, projectCompleted, paid.
--
-- The gap matters for the rework restore path in migration 20260509000003:
--   is_consumed_status(OLD) AND is_production_status(NEW) → restore stock + consumed_at = NULL
-- A job in waitingForPayment/projectCompleted/paid reworked back to inProgress
-- would NOT trigger the restore (OLD status not considered consumed), leaving
-- in_stock permanently short and the allocated display double-subtracting.
--
-- FIX: Expand is_consumed_status() to include all 5 post-production statuses.
-- Backfill consumed_at for finance-state jobs that were already in these
-- statuses before migration 20260509000003 added the sentinel column — those
-- jobs passed through 'finished' before the trigger existed, so consumed_at
-- was never stamped. Without the backfill, a subsequent rework restore path
-- would skip restoration because consumed_at IS NULL. The backfill aligns
-- the sentinel with reality: stock was already decremented for these jobs.
--
-- ROLLBACK (run in this order):
--   1. Clear consumed_at from finance-state jobs stamped by this migration's backfill.
--      Without this, those jobs would skip stock deduction on re-finish after rollback
--      because the trigger sees consumed_at IS NOT NULL and treats them as already consumed.
--   UPDATE public.jobs
--      SET consumed_at = NULL
--    WHERE status IN ('waitingForPayment', 'projectCompleted', 'paid')
--      AND consumed_at IS NOT NULL;
--
--   2. Restore is_consumed_status() to the 2-status set.
--   CREATE OR REPLACE FUNCTION public.is_consumed_status(s text) RETURNS boolean
--     LANGUAGE sql IMMUTABLE SET search_path = public, pg_catalog AS $$
--       SELECT s IN ('finished','delivered')
--     $$;

CREATE OR REPLACE FUNCTION public.is_consumed_status(s text) RETURNS boolean
  LANGUAGE sql IMMUTABLE SET search_path = public, pg_catalog AS $$
    SELECT s IN ('finished', 'delivered', 'waitingForPayment', 'projectCompleted', 'paid')
  $$;

-- Backfill consumed_at for finance-state jobs that predate migration 20260509000003
-- AND have a confirmed reconcile_job record proving stock was actually decremented.
--
-- Without the reconcile_job guard, a legacy finance-state job that arrived via a
-- direct DB insert (before the trigger existed) and was never decremented would get
-- consumed_at stamped — causing phantom stock restoration on rework.
-- This mirrors migration 20260509000003's own backfill strategy exactly.
--
-- Jobs with no reconcile_job record retain consumed_at = NULL. On rework their
-- trigger's reversal guard (v_consumed IS NULL → skip restore) fires correctly,
-- preventing phantom inventory. On re-finish the deduction fires for the first time.
UPDATE public.jobs j
   SET consumed_at = NOW()
  FROM (
    SELECT DISTINCT related_job_id
      FROM public.inventory_history
     WHERE action = 'reconcile_job'
  ) ih
 WHERE j.id = ih.related_job_id
   AND j.status IN ('waitingForPayment', 'projectCompleted', 'paid')
   AND j.consumed_at IS NULL;

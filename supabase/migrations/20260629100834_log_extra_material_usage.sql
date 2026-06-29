-- Migration: log_extra_material_usage() — one-directional "used more than the estimate" top-up.
--
-- WHY: Stock is deducted per unit from the *intentionally over-padded* BOM
--   (20260622000001 / docs/cnc-unit-progress-deduction.md). When a worker scraps or messes up,
--   real consumption can exceed even the padded estimate, leaving a hidden shortfall. On the
--   In Progress -> Quality Control handoff the UI asks, per BOM material, "used more than the
--   estimate? +how much" — only ever MORE (the pad already biases the system low, so we never
--   restore). This RPC applies those extras atomically.
--
-- INVARIANT (the important part): for each line, job_inventory.quantity += extra AND
--   consumed_quantity += extra in the SAME UPDATE. log_unit_progress clamps consumed_quantity to
--   LEAST(quantity, ...), so consuming beyond the original estimate REQUIRES growing the line —
--   otherwise the extra deduction would be silently capped. Because the allocate guard
--   (20260622000001 D) and the Finished true-up both key off (quantity - consumed_quantity),
--   which is unchanged here, this adds no new reservation, never trips the guard, and leaves the
--   true-up neutral. in_stock / available drop by the extra now.
--
-- ONE-DIRECTIONAL: extras <= 0 are ignored (only MORE, never less). Negative stock stays allowed
--   (no non-negative CHECK re-added), consistent with 20260615000000 — a true shortfall shows.
--
-- Mirrors the client-computes / RPC-applies + security pattern of log_unit_progress.
--
-- ROLLBACK: DROP FUNCTION IF EXISTS public.log_extra_material_usage(uuid, jsonb);

CREATE OR REPLACE FUNCTION public.log_extra_material_usage(
  p_job_id       uuid,
  p_extra_deltas jsonb   -- [{"inventory_id": <uuid>, "extra": <numeric>}, ...]; extra > 0 only
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
DECLARE
  d              RECORD;
  v_job_code     int;
  v_status       text;
  v_uid          uuid := auth.uid();
  current_stock  numeric;
  prev_available numeric;
  new_stock      numeric;
  new_available  numeric;
BEGIN
  -- Only approved users may move stock (mirrors the inventory RLS + RPC lockdown pattern).
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- Lock the job row for the whole edit (job_code for the audit reason; status for the gate
  -- precondition; ordering vs concurrent per-unit logging on the same job).
  SELECT job_code, status INTO v_job_code, v_status
    FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job_not_found: %', p_job_id;
  END IF;

  -- Bind the deduction to its precondition: this RPC is the In Progress -> QC handoff. The status
  -- write happens AFTER this call client-side, so re-check under the row lock — if the job already
  -- left inProgress (stale prompt, concurrent move, or a double-submit after the move) we must NOT
  -- deduct stock for a transition that won't (or already did) happen.
  IF v_status <> 'inProgress' THEN
    RAISE EXCEPTION 'job_not_in_progress: job % is %, expected inProgress', p_job_id, v_status;
  END IF;

  -- Apply each extra in inventory_id order (deterministic = deadlock-safe). Round to int once so
  -- the int in_stock column and the consumed_quantity ledger move by the same amount. GROUP BY the
  -- inventory_id so a payload that repeats a material (the UI builds one row per BOM line, but the
  -- RPC is directly callable) sums to ONE deduction per line instead of double-deducting per row.
  FOR d IN
    SELECT (e->>'inventory_id')::uuid                  AS inventory_id,
           SUM(ROUND((e->>'extra')::numeric)::int)     AS extra
    FROM jsonb_array_elements(COALESCE(p_extra_deltas, '[]'::jsonb)) e
    WHERE (e->>'inventory_id') IS NOT NULL
    GROUP BY (e->>'inventory_id')::uuid
    HAVING SUM(ROUND((e->>'extra')::numeric)::int) > 0   -- only MORE; ignore zero / negative net
    ORDER BY (e->>'inventory_id')::uuid
  LOOP
    -- Defense-in-depth: the line must belong to this job's BOM, else we'd orphan a deduction
    -- (decrement in_stock with no job_inventory line to grow / true-up against).
    IF NOT EXISTS (
      SELECT 1 FROM public.job_inventory
      WHERE job_id = p_job_id AND inventory_id = d.inventory_id
    ) THEN
      RAISE EXCEPTION 'inventory_not_in_job_bom: % not allocated to job %', d.inventory_id, p_job_id;
    END IF;

    -- Grow the line AND its consumed ledger together FIRST. Two reasons for the ordering:
    --   1. consumed_quantity is bumped past the original estimate; growing quantity in lockstep
    --      keeps the documented [0, quantity] bound and keeps net (quantity - consumed_quantity)
    --      constant, so the Finished true-up stays neutral.
    --   2. `update of quantity` fires job_inventory_allocate_guard (20260313000001). The guard
    --      compares total net allocation against in_stock. Because this UPDATE is net-zero AND it
    --      runs BEFORE the in_stock decrement below, the guard evaluates against the un-decremented
    --      stock with a zero delta — so it can never falsely block a consumption (consumption is
    --      non-blocking by design, per 20260615000000). Doing it after the decrement could trip
    --      `insufficient_available_stock` when other jobs hold most of the stock.
    UPDATE public.job_inventory ji
       SET quantity          = ji.quantity + d.extra,
           consumed_quantity = COALESCE(ji.consumed_quantity, 0) + d.extra
     WHERE ji.job_id = p_job_id AND ji.inventory_id = d.inventory_id;

    SELECT in_stock, available INTO current_stock, prev_available
      FROM public.inventory WHERE id = d.inventory_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'inventory_missing: %', d.inventory_id;
    END IF;

    -- Consume the extra now: in_stock and available both drop (net available unchanged because the
    -- line grow above kept quantity - consumed_quantity constant for the allocate guard).
    UPDATE public.inventory
       SET in_stock  = in_stock  - d.extra,
           available  = available - d.extra,
           updated_at = NOW()
     WHERE id = d.inventory_id
    RETURNING in_stock, available INTO new_stock, new_available;

    INSERT INTO public.inventory_history
      (inventory_id, user_id, action, reason,
       previous_in_stock, new_in_stock, change_amount, related_job_id,
       previous_available, new_available)
    VALUES (
      d.inventory_id, v_uid,
      'extra_usage',
      'Job #' || v_job_code || ': used more than estimate',
      current_stock, new_stock, -d.extra, p_job_id,
      prev_available, new_available
    );
  END LOOP;
END$$;

REVOKE ALL ON FUNCTION public.log_extra_material_usage(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.log_extra_material_usage(uuid, jsonb) TO authenticated;

-- ============================================================================================
-- Part B. Allocate guard: never block a non-increasing allocation change.
--
-- WHY: log_extra_material_usage grows job_inventory.quantity AND consumed_quantity in lockstep, a
-- NET-ZERO change to (quantity - consumed_quantity). But `update of quantity` fires this guard,
-- which compares the ABSOLUTE sum of active allocations against in_stock. Once stock has gone
-- negative (allowed since 20260615000000 to show a true shortfall), that sum can already exceed
-- in_stock — so even a net-zero (or decreasing) update trips `insufficient_available_stock` and the
-- whole extra-usage write fails. That blocks exactly the scrap/shortfall case this feature targets.
--
-- A decrease or a no-op can never WORSEN over-allocation, so the availability check only makes sense
-- for a positive net increase. Short-circuit before it when v_quantity <= 0. The job_is_consumed
-- guard above it is preserved. Verbatim from 20260622000001 (D) except for the added early return.
-- The existing trigger binding (20260313000001) and ACL are kept by CREATE OR REPLACE.
--
-- ROLLBACK: recreate job_inventory_allocate_guard() verbatim from 20260622000001 (without the
--   `IF v_quantity <= 0 THEN RETURN NEW` block).
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.job_inventory_allocate_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
DECLARE
  v_inventory_id      uuid;
  v_quantity          numeric;
  v_in_stock          int;
  v_allocated         numeric;
  v_job_status        text;
  v_active_statuses   text[] := ARRAY['pod','rush','pending','inProgress','qualityControl','onHold'];
  v_consumed_statuses text[] := ARRAY['finished','delivered','waitingForPayment','projectCompleted','paid'];
BEGIN
  IF tg_op = 'INSERT' THEN
    v_inventory_id := NEW.inventory_id;
    v_quantity     := NEW.quantity - COALESCE(NEW.consumed_quantity, 0);
  ELSE
    v_inventory_id := NEW.inventory_id;
    v_quantity     := (NEW.quantity - COALESCE(NEW.consumed_quantity, 0))
                      - (OLD.quantity - COALESCE(OLD.consumed_quantity, 0));
  END IF;

  SELECT status INTO v_job_status FROM public.jobs WHERE id = NEW.job_id;
  IF v_job_status = ANY(v_consumed_statuses) THEN
    RAISE EXCEPTION 'job_is_consumed: cannot allocate inventory to job in status %', v_job_status;
  END IF;

  -- A non-increasing net allocation (decrease or net-zero, e.g. the extra-usage grow-both write)
  -- cannot reduce availability for any other job, so skip the availability check entirely. This is
  -- what lets consumption-style writes succeed even when the item is already oversubscribed.
  IF v_quantity <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT in_stock INTO v_in_stock FROM public.inventory WHERE id = v_inventory_id FOR UPDATE;
  IF v_in_stock IS NULL THEN
    RAISE EXCEPTION 'inventory_not_found: % does not exist', v_inventory_id;
  END IF;

  SELECT COALESCE(SUM(ji.quantity - COALESCE(ji.consumed_quantity, 0)), 0) INTO v_allocated
  FROM public.job_inventory ji
  JOIN public.jobs j ON j.id = ji.job_id
  WHERE ji.inventory_id = v_inventory_id
    AND j.status = ANY(v_active_statuses)
    AND ji.id IS DISTINCT FROM NEW.id;

  IF v_allocated + v_quantity > v_in_stock THEN
    RAISE EXCEPTION 'insufficient_available_stock: % in stock, % allocated, % available',
      v_in_stock, v_allocated, v_in_stock - v_allocated;
  END IF;

  RETURN NEW;
END$$;

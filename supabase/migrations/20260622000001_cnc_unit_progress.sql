-- Migration: Per-unit CNC / production progress + incremental inventory deduction.
--
-- WHY: Stock previously only left in_stock when a job entered a consumed status (Finished) via
-- jobs_reconcile_inventory_on_status (20260615000000). The shop wants stock deducted incrementally
-- as units are actually completed, with two per-unit milestones:
--   * CNC done  -> deduct only the CNC-able share of a unit's distributed BOM (foam).
--   * Unit done -> deduct the rest of the unit's distributed BOM (auto-completes CNC).
-- See docs/cnc-unit-progress-deduction.md for the full model.
--
-- DESIGN: The intricate "distribute the padded BOM across the variants that use each material"
-- math lives in TypeScript (src/lib/cncDeduction.ts, unit-tested). This migration provides:
--   A. New state columns (per-variant completed counts on jobs; consumed_quantity per BOM line).
--   B. log_unit_progress(): a thin, atomic applier — given the new variant counts and the already
--      computed per-inventory consume deltas, it locks rows, moves in_stock/available, bumps
--      job_inventory.consumed_quantity, writes inventory_history, and stamps the job. Mirrors the
--      client-computes / RPC-applies pattern of adjust_inventory_stock (20260603144045).
--   C. jobs_reconcile_inventory_on_status(): Finished now deducts only the REMAINING
--      (quantity - consumed_quantity) per line — a true-up backstop for units never logged — and
--      the restore (rework) path reverses exactly what was physically consumed.
--   D. job_inventory_allocate_guard(): "allocated" now nets out consumed_quantity (consumed stock
--      already left in_stock, so it must not also count as an outstanding reservation).
--
-- Negative stock stays allowed (no non-negative CHECK re-added) consistent with 20260615000000.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.log_unit_progress(uuid, jsonb, jsonb, jsonb, boolean);
--   -- restore jobs_reconcile_inventory_on_status() and job_inventory_allocate_guard() verbatim
--   --   from 20260615000000 and 20260509000001 respectively;
--   ALTER TABLE public.job_inventory DROP COLUMN IF EXISTS consumed_quantity;
--   ALTER TABLE public.jobs
--     DROP COLUMN IF EXISTS cnc_done_by_variant,
--     DROP COLUMN IF EXISTS units_done_by_variant;

-- ============================================================================================
-- A. State columns
-- ============================================================================================
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS cnc_done_by_variant   jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS units_done_by_variant jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.job_inventory
  ADD COLUMN IF NOT EXISTS consumed_quantity numeric NOT NULL DEFAULT 0;

-- Which inventory categories are CNC-able (their materials deduct on the CNC milestone).
-- Org-wide setting; defaults to foam.
ALTER TABLE public.organization_settings
  ADD COLUMN IF NOT EXISTS cnc_able_categories jsonb NOT NULL DEFAULT '["foam"]'::jsonb;

-- ============================================================================================
-- B. log_unit_progress() — atomic applier for a single progress edit (CNC and/or unit milestone).
--    p_cnc_delta / p_units_delta : per-variant count DELTAS to apply, e.g. {"-04": 1} or {"-04": -1}.
--      Applied server-side under the jobs row lock (read-modify-write) so concurrent logging on the
--      same job can't lose a count update.
--    p_inventory_deltas : [{"inventory_id": <uuid>, "delta": <numeric>}, ...] where delta is the
--      quantity to CONSUME now (positive = deduct from stock + increase consumed_quantity;
--      negative = restore on un-mark). Caller computes these from the distributed BOM; the delta is
--      ROUNDed to an int here so in_stock (int) and consumed_quantity stay in lockstep.
--    p_cnc_complete : best-effort hint — whether all CNC-able units are CNC-done (stamps/clears
--      cnc_completed_at, a non-terminal legacy badge).
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.log_unit_progress(
  p_job_id        uuid,
  p_cnc_delta     jsonb,
  p_units_delta   jsonb,
  p_inventory_deltas jsonb,
  p_cnc_complete  boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
DECLARE
  d              RECORD;
  c              RECORD;
  v_job_code     int;
  v_uid          uuid := auth.uid();
  v_cnc          jsonb;
  v_units        jsonb;
  cur            numeric;
  current_stock  numeric;
  prev_available numeric;
  new_stock      numeric;
  new_available  numeric;
BEGIN
  -- Only approved users may move stock (mirrors the inventory RLS + RPC lockdown pattern).
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- Lock the job row for the whole edit; read current counts for server-side read-modify-write.
  SELECT job_code, cnc_done_by_variant, units_done_by_variant
    INTO v_job_code, v_cnc, v_units
    FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job_not_found: %', p_job_id;
  END IF;
  v_cnc   := COALESCE(v_cnc, '{}'::jsonb);
  v_units := COALESCE(v_units, '{}'::jsonb);

  -- Apply per-variant count deltas additively (clamped at 0) so a concurrent edit can't clobber.
  FOR c IN
    SELECT key AS k, value::numeric AS delta
    FROM jsonb_each_text(COALESCE(p_cnc_delta, '{}'::jsonb))
  LOOP
    cur := COALESCE((v_cnc->>c.k)::numeric, 0);
    v_cnc := jsonb_set(v_cnc, ARRAY[c.k], to_jsonb(GREATEST(0, cur + c.delta)), true);
  END LOOP;
  FOR c IN
    SELECT key AS k, value::numeric AS delta
    FROM jsonb_each_text(COALESCE(p_units_delta, '{}'::jsonb))
  LOOP
    cur := COALESCE((v_units->>c.k)::numeric, 0);
    v_units := jsonb_set(v_units, ARRAY[c.k], to_jsonb(GREATEST(0, cur + c.delta)), true);
  END LOOP;

  -- Apply each inventory delta in inventory_id order (deterministic = deadlock-safe). Round to int
  -- once so the int in_stock column and the consumed_quantity ledger move by the same amount.
  FOR d IN
    SELECT (e->>'inventory_id')::uuid       AS inventory_id,
           ROUND((e->>'delta')::numeric)::int AS delta
    FROM jsonb_array_elements(COALESCE(p_inventory_deltas, '[]'::jsonb)) e
    WHERE ROUND((e->>'delta')::numeric)::int <> 0
    ORDER BY (e->>'inventory_id')::uuid
  LOOP
    -- Defense-in-depth: the line must belong to this job's BOM, else we'd orphan a deduction
    -- (decrement in_stock with no consumed_quantity row to track or true-up).
    IF NOT EXISTS (
      SELECT 1 FROM public.job_inventory
      WHERE job_id = p_job_id AND inventory_id = d.inventory_id
    ) THEN
      RAISE EXCEPTION 'inventory_not_in_job_bom: % not allocated to job %', d.inventory_id, p_job_id;
    END IF;

    SELECT in_stock, available INTO current_stock, prev_available
      FROM public.inventory WHERE id = d.inventory_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'inventory_missing: %', d.inventory_id;
    END IF;

    -- Consume: in_stock and available both drop by delta (available was already reduced by the
    -- reservation, but allocate_guard nets consumed_quantity below so net available is unchanged).
    UPDATE public.inventory
       SET in_stock  = in_stock  - d.delta,
           available  = available - d.delta,
           updated_at = NOW()
     WHERE id = d.inventory_id
    RETURNING in_stock, available INTO new_stock, new_available;

    -- Track how much of each BOM line has physically left stock (drives the Finished true-up and
    -- nets out of allocated). Bounded to [0, quantity] so it can never under/over-run the line.
    UPDATE public.job_inventory ji
       SET consumed_quantity =
             LEAST(ji.quantity, GREATEST(0, COALESCE(ji.consumed_quantity, 0) + d.delta))
     WHERE ji.job_id = p_job_id AND ji.inventory_id = d.inventory_id;

    INSERT INTO public.inventory_history
      (inventory_id, user_id, action, reason,
       previous_in_stock, new_in_stock, change_amount, related_job_id,
       previous_available, new_available)
    VALUES (
      d.inventory_id, v_uid,
      CASE WHEN d.delta >= 0 THEN 'unit_consume' ELSE 'unit_consume_reversal' END,
      'Job #' || v_job_code || ': per-unit progress',
      current_stock, new_stock, -d.delta, p_job_id,
      prev_available, new_available
    );
  END LOOP;

  -- Persist the merged counts and keep cnc_completed_at in sync (no longer terminal — badge only).
  UPDATE public.jobs
     SET cnc_done_by_variant   = v_cnc,
         units_done_by_variant = v_units,
         cnc_completed_at = CASE WHEN p_cnc_complete THEN COALESCE(cnc_completed_at, NOW()) ELSE NULL END,
         cnc_completed_by = CASE WHEN p_cnc_complete THEN COALESCE(cnc_completed_by, v_uid)  ELSE NULL END,
         updated_at = NOW()
   WHERE id = p_job_id;
END$$;

REVOKE ALL ON FUNCTION public.log_unit_progress(uuid, jsonb, jsonb, jsonb, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.log_unit_progress(uuid, jsonb, jsonb, jsonb, boolean) TO authenticated;

-- ============================================================================================
-- C. Finished reconcile — deduct only the un-consumed remainder; reverse exactly what was consumed.
--    Verbatim from 20260615000000 EXCEPT each line's amount is (quantity - consumed_quantity) on
--    consume / consumed_quantity on restore, and consumed_quantity is stamped accordingly.
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.jobs_reconcile_inventory_on_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
DECLARE
  r              RECORD;
  sgn            INT;
  v_consumed     TIMESTAMPTZ;
  amount         NUMERIC;
  current_stock  NUMERIC;
  new_stock      NUMERIC;
  prev_available NUMERIC;
  new_available  NUMERIC;
BEGIN
  IF NOT is_consumed_status(OLD.status) AND is_consumed_status(NEW.status) THEN
    sgn := -1;  -- entering consumed: true-up deduct the remainder
  ELSIF is_consumed_status(OLD.status)
        AND NOT is_consumed_status(NEW.status)
        AND is_production_status(NEW.status) THEN
    sgn := 1;   -- rework restore
  ELSE
    RETURN NEW;
  END IF;

  v_consumed := OLD.consumed_at;
  IF sgn = -1 THEN
    IF v_consumed IS NOT NULL THEN RETURN NEW; END IF;   -- already consumed once
  ELSE
    IF v_consumed IS NULL THEN RETURN NEW; END IF;       -- nothing was ever consumed
  END IF;

  FOR r IN
    SELECT inventory_id, quantity, COALESCE(consumed_quantity, 0) AS consumed_quantity
    FROM public.job_inventory
    WHERE job_id = NEW.id
      AND quantity IS NOT NULL
    ORDER BY inventory_id
  LOOP
    -- Consume: only the part not already pulled by per-unit logging. Restore: exactly what was
    -- physically pulled (incremental + any true-up).
    IF sgn = -1 THEN
      amount := GREATEST(0, r.quantity - r.consumed_quantity);
    ELSE
      amount := r.consumed_quantity;
    END IF;

    CONTINUE WHEN amount = 0;

    SELECT in_stock, available INTO current_stock, prev_available
      FROM public.inventory WHERE id = r.inventory_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'inventory_missing: inventory row % not found', r.inventory_id;
    END IF;

    UPDATE public.inventory
       SET in_stock   = in_stock   + ROUND(sgn * amount)::INT,
           available  = available  + ROUND(sgn * amount)::INT,
           updated_at = NOW()
     WHERE id = r.inventory_id
    RETURNING in_stock, available INTO new_stock, new_available;

    -- Keep consumed_quantity consistent: fully consumed at Finish, zeroed on restore.
    UPDATE public.job_inventory
       SET consumed_quantity = CASE WHEN sgn = -1 THEN r.quantity ELSE 0 END
     WHERE job_id = NEW.id AND inventory_id = r.inventory_id;

    INSERT INTO public.inventory_history
      (inventory_id, user_id, action, reason,
       previous_in_stock, new_in_stock, change_amount, related_job_id,
       previous_available, new_available)
    VALUES (
      r.inventory_id, auth.uid(),
      CASE WHEN sgn = -1 THEN 'reconcile_job' ELSE 'reconcile_job_reversal' END,
      'Job #' || NEW.job_code || ': ' || OLD.status || ' -> ' || NEW.status,
      current_stock, new_stock, ROUND(sgn * amount), NEW.id,
      prev_available, new_available
    );
  END LOOP;

  IF sgn = -1 THEN
    UPDATE public.jobs SET consumed_at = NOW() WHERE id = NEW.id AND consumed_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'consumed_at_race: job % — sentinel write matched 0 rows', NEW.id;
    END IF;
  ELSE
    -- Rework: clear consumption + per-unit counts so the job starts production clean.
    UPDATE public.jobs
       SET consumed_at = NULL,
           cnc_done_by_variant = '{}'::jsonb,
           units_done_by_variant = '{}'::jsonb
     WHERE id = NEW.id AND consumed_at IS NOT NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'consumed_at_race_reversal: job % — sentinel clear matched 0 rows', NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END$$;

REVOKE EXECUTE ON FUNCTION public.jobs_reconcile_inventory_on_status() FROM public, anon, authenticated;

-- ============================================================================================
-- D. Allocate guard — net consumed_quantity out of "allocated" (consumed stock already left
--    in_stock, so it is no longer an outstanding reservation). Verbatim from 20260509000001
--    except the v_allocated sum subtracts consumed_quantity.
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

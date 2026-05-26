-- Migration: Update job_inventory_allocate_guard trigger
-- Changes:
--   • Remove 'finished' from active statuses (now a consumed status)
--   • Add 'onHold' to active statuses (paused jobs still hold stock)
--   • Add SELECT ... FOR UPDATE on inventory row (fixes concurrent-allocation race)
--   • Add consumed-job INSERT guard (blocks Studio/API inserts to consumed jobs)
--
-- ROLLBACK: restore previous version from 20260313000001_job_inventory_allocate_guard.sql

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
    v_quantity     := NEW.quantity;
  ELSE
    v_inventory_id := NEW.inventory_id;
    v_quantity     := NEW.quantity - OLD.quantity;
  END IF;

  -- Block allocation to consumed jobs (covers Studio/API/direct DB inserts)
  SELECT status INTO v_job_status FROM public.jobs WHERE id = NEW.job_id;
  IF v_job_status = ANY(v_consumed_statuses) THEN
    RAISE EXCEPTION 'job_is_consumed: cannot allocate inventory to job in status %', v_job_status;
  END IF;

  -- Lock inventory row to serialize concurrent allocations
  SELECT in_stock INTO v_in_stock
  FROM public.inventory
  WHERE id = v_inventory_id
  FOR UPDATE;

  IF v_in_stock IS NULL THEN
    RAISE EXCEPTION 'inventory_not_found: % does not exist', v_inventory_id;
  END IF;

  SELECT COALESCE(SUM(ji.quantity), 0) INTO v_allocated
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

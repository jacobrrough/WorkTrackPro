-- Migration: make log_unit_progress tolerant of both `inventory_id` (documented contract) and the
-- legacy `inventoryId` (camelCase) key in p_inventory_deltas elements.
--
-- WHY: the client (src/services/api/unitProgress.ts) sent InventoryDelta as `{ inventoryId, delta }`
-- while the RPC read `e->>'inventory_id'`, so the key parsed to NULL and any job with material to
-- pull failed CNC/unit progress with `inventory_not_in_job_bom: <NULL>`. The client is fixed to send
-- snake_case, but this COALESCE keeps already-deployed clients (and offline-queue replays) working
-- and is harmless once everyone sends snake_case. Verbatim from 20260622000001 except the two reads
-- of the element key now COALESCE both spellings.
--
-- ROLLBACK: re-apply the function body from 20260622000001 (single `e->>'inventory_id'` reads).

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
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT job_code, cnc_done_by_variant, units_done_by_variant
    INTO v_job_code, v_cnc, v_units
    FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job_not_found: %', p_job_id;
  END IF;
  v_cnc   := COALESCE(v_cnc, '{}'::jsonb);
  v_units := COALESCE(v_units, '{}'::jsonb);

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

  -- Accept either `inventory_id` (snake_case contract) or `inventoryId` (legacy camelCase client).
  FOR d IN
    SELECT COALESCE(e->>'inventory_id', e->>'inventoryId')::uuid       AS inventory_id,
           ROUND((e->>'delta')::numeric)::int                          AS delta
    FROM jsonb_array_elements(COALESCE(p_inventory_deltas, '[]'::jsonb)) e
    WHERE ROUND((e->>'delta')::numeric)::int <> 0
    ORDER BY COALESCE(e->>'inventory_id', e->>'inventoryId')::uuid
  LOOP
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

    UPDATE public.inventory
       SET in_stock  = in_stock  - d.delta,
           available  = available - d.delta,
           updated_at = NOW()
     WHERE id = d.inventory_id
    RETURNING in_stock, available INTO new_stock, new_available;

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

-- Fix: "column reference \"in_stock\" is ambiguous" in adjust_inventory_stock_idem.
--
-- RETURNS TABLE(in_stock int, on_order int, applied boolean) creates OUT variables
-- named in_stock / on_order. In the UPDATE's SET clause, the bare RHS references
-- (in_stock + p_in_stock_delta, on_order + p_on_order_delta) match BOTH those OUT
-- variables AND the inventory columns, so PL/pgSQL (default #variable_conflict error)
-- aborts the whole UPDATE — breaking every stock/on-order delta, not just on-order.
--
-- Fix qualifies the RHS with the target table name so they resolve to the columns.
create or replace function public.adjust_inventory_stock_idem(
  p_id uuid,
  p_in_stock_delta int,
  p_on_order_delta int,
  p_client_action_id uuid
) returns table(in_stock int, on_order int, applied boolean)
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_inserted int;
begin
  -- Authorize the caller — this is SECURITY DEFINER and bypasses RLS, so mirror the
  -- guard added to adjust_inventory_stock in 20260618154128. Without this, any
  -- authenticated (even unapproved) user could adjust stock via this RPC.
  if not public.is_approved_user() then
    raise exception 'not authorized';
  end if;

  insert into public.offline_action_log(client_action_id)
  values (p_client_action_id)
  on conflict (client_action_id) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted > 0 then
    -- First time we've seen this action: apply the delta.
    -- RHS is qualified with the table name to disambiguate from the OUT columns.
    return query
      update public.inventory
      set in_stock = inventory.in_stock + p_in_stock_delta,
          on_order = greatest(0, inventory.on_order + p_on_order_delta),
          updated_at = now()
      where id = p_id
      returning inventory.in_stock, inventory.on_order, true;
  else
    -- Already applied (lost-ACK replay): return current state without re-applying.
    return query
      select i.in_stock, i.on_order, false
      from public.inventory i
      where i.id = p_id;
  end if;
end;
$$;

revoke all on function public.adjust_inventory_stock_idem(uuid, int, int, uuid) from public, anon;
grant execute on function public.adjust_inventory_stock_idem(uuid, int, int, uuid) to authenticated;

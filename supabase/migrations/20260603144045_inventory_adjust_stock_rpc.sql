-- Atomic stock adjustment by DELTA, fixing the read-modify-write lost-update race in
-- receiveInventoryOrder / markInventoryOrdered / updateStock (which wrote an absolute
-- value computed from a possibly-stale client cache). Returns the post-update values so
-- callers record accurate inventory_history audit rows. APPLIED to live 2026-06-03.
create or replace function public.adjust_inventory_stock(
  p_id uuid, p_in_stock_delta int, p_on_order_delta int
) returns table(in_stock int, on_order int)
language sql security definer set search_path = public as $$
  update public.inventory
  set in_stock = in_stock + p_in_stock_delta,
      on_order = greatest(0, on_order + p_on_order_delta),
      updated_at = now()
  where id = p_id
  returning inventory.in_stock, inventory.on_order;
$$;
revoke all on function public.adjust_inventory_stock(uuid,int,int) from public, anon;
grant execute on function public.adjust_inventory_stock(uuid,int,int) to authenticated;

-- Permanent, safe-guarded delete of an inventory item.
--
-- A raw DELETE on public.inventory is dangerous: the FKs from job_inventory and part_materials
-- are NO ACTION, so Postgres would reject the delete with a cryptic constraint error whenever the
-- item is allocated to a job or used in a part's BOM. Every other reference is non-blocking
-- (inventory_history / inventory_price_history / tool_events / attachments CASCADE; the
-- accounting.* source_inventory_id crosswalks SET NULL — provenance only, the books are
-- unaffected). So "safe to delete" == not referenced by job_inventory or part_materials.
--
-- This RPC enforces that rule server-side and atomically (the count check and the delete share one
-- transaction, so an item can't be allocated to a job in the gap between checking and deleting).
-- It returns a jsonb verdict instead of raising, so the UI can show a precise reason:
--   { ok: true }
--   { ok: false, reason: 'forbidden' }                     -- caller is not an admin
--   { ok: false, reason: 'not_found' }                     -- already gone
--   { ok: false, reason: 'in_use', job_count, part_count } -- blocked by references
--
-- Destructive and irreversible, so it is admin-only (defense-in-depth behind the UI gate, matching
-- the inventory RLS admin pattern in 20250216000001).

create or replace function public.delete_inventory_item(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job_count int;
  v_part_count int;
begin
  if not exists (
    select 1 from public.profiles where id = auth.uid() and is_admin = true
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  -- Lock the row so a concurrent allocation/BOM insert serializes against this delete.
  perform 1 from public.inventory where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select count(*) into v_job_count from public.job_inventory where inventory_id = p_id;
  select count(*) into v_part_count from public.part_materials where inventory_id = p_id;

  if v_job_count > 0 or v_part_count > 0 then
    return jsonb_build_object(
      'ok', false,
      'reason', 'in_use',
      'job_count', v_job_count,
      'part_count', v_part_count
    );
  end if;

  delete from public.inventory where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.delete_inventory_item(uuid) from public, anon;
grant execute on function public.delete_inventory_item(uuid) to authenticated;

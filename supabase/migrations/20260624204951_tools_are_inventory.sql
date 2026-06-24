-- Tools are now INVENTORY ITEMS in the 'tool' category, managed via the normal inventory add/edit
-- (the item's barcode = the tool's scannable code, its bin = the tool's home bin). This collapses
-- the standalone tools table (20260624175433, no data yet) into `inventory` + a custody dimension.
-- Custody changes still flow through SECURITY DEFINER RPCs for an atomic change + an immutable
-- tool_events audit + server-side home-bin verification on put-away.

-- 1) Custody column on inventory: null = available / in its bin; set = checked out to that user.
alter table public.inventory
  add column if not exists current_holder_id uuid references public.profiles(id) on delete set null;
create index if not exists idx_inventory_current_holder on public.inventory (current_holder_id);

-- 2) Drop the old standalone tools objects (no data). Dropping `tools` also removes it from the
--    realtime publication automatically.
drop function if exists public.tool_take(uuid, text);
drop function if exists public.tool_assign(uuid, uuid, text);
drop function if exists public.tool_put_away(uuid, text, text);
drop function if exists public.tool_retire(uuid, text);
drop table if exists public.tool_events;
drop table if exists public.tools cascade;
drop function if exists public.touch_tools_updated_at();

-- 3) Custody audit, keyed to the inventory item. Written only by the RPCs below (no client INSERT).
create table if not exists public.tool_events (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null references public.inventory(id) on delete cascade,
  event_type text not null check (event_type in ('checkout', 'checkin', 'transfer')),
  actor_id uuid references public.profiles(id) on delete set null,
  previous_holder_id uuid references public.profiles(id) on delete set null,
  new_holder_id uuid references public.profiles(id) on delete set null,
  bin text,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_tool_events_inventory on public.tool_events (inventory_id, created_at desc);

alter table public.tool_events enable row level security;
drop policy if exists tool_events_select on public.tool_events;
create policy tool_events_select on public.tool_events for select to authenticated using (true);

-- 4) Custody RPCs operating on an inventory item id. Approved users only; the audit row + the
--    custody change happen atomically, and put-away verifies the scanned bin server-side.
create or replace function public.tool_take(p_inventory_id uuid, p_notes text default null)
returns public.inventory
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_item public.inventory;
  v_prev uuid;
begin
  if not public.is_approved_user() then
    raise exception 'NOT_AUTHORIZED';
  end if;
  select * into v_item from public.inventory where id = p_inventory_id for update;
  if not found then
    raise exception 'TOOL_NOT_FOUND';
  end if;
  v_prev := v_item.current_holder_id;
  if v_prev = v_uid then
    return v_item; -- already yours; no-op, no duplicate audit row
  end if;
  update public.inventory set current_holder_id = v_uid where id = p_inventory_id returning * into v_item;
  insert into public.tool_events (
    inventory_id, event_type, actor_id, previous_holder_id, new_holder_id, notes
  ) values (
    p_inventory_id, case when v_prev is null then 'checkout' else 'transfer' end, v_uid, v_prev, v_uid, p_notes
  );
  return v_item;
end;
$$;

create or replace function public.tool_assign(
  p_inventory_id uuid, p_new_holder_id uuid, p_notes text default null
)
returns public.inventory
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_item public.inventory;
  v_prev uuid;
begin
  if not public.is_approved_user() then
    raise exception 'NOT_AUTHORIZED';
  end if;
  if p_new_holder_id is null then
    raise exception 'NO_HOLDER';
  end if;
  if not exists (select 1 from public.profiles where id = p_new_holder_id) then
    raise exception 'HOLDER_NOT_FOUND';
  end if;
  select * into v_item from public.inventory where id = p_inventory_id for update;
  if not found then
    raise exception 'TOOL_NOT_FOUND';
  end if;
  v_prev := v_item.current_holder_id;
  if v_prev = p_new_holder_id then
    return v_item;
  end if;
  update public.inventory set current_holder_id = p_new_holder_id where id = p_inventory_id returning * into v_item;
  insert into public.tool_events (
    inventory_id, event_type, actor_id, previous_holder_id, new_holder_id, notes
  ) values (
    p_inventory_id, 'transfer', v_uid, v_prev, p_new_holder_id, p_notes
  );
  return v_item;
end;
$$;

create or replace function public.tool_put_away(
  p_inventory_id uuid, p_scanned_bin text, p_notes text default null
)
returns public.inventory
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_item public.inventory;
  v_prev uuid;
  v_scanned text;
  v_home text;
begin
  if not public.is_approved_user() then
    raise exception 'NOT_AUTHORIZED';
  end if;
  select * into v_item from public.inventory where id = p_inventory_id for update;
  if not found then
    raise exception 'TOOL_NOT_FOUND';
  end if;
  v_scanned := upper(trim(regexp_replace(coalesce(p_scanned_bin, ''), '^BIN:', '', 'i')));
  v_home := upper(trim(coalesce(v_item.bin_location, '')));
  if v_home = '' then
    raise exception 'NO_HOME_BIN';
  end if;
  if v_scanned is distinct from v_home then
    raise exception 'WRONG_BIN:%', v_item.bin_location;
  end if;
  if v_item.current_holder_id is null then
    return v_item; -- already put away; bin verified, no duplicate audit row
  end if;
  v_prev := v_item.current_holder_id;
  update public.inventory set current_holder_id = null where id = p_inventory_id returning * into v_item;
  insert into public.tool_events (
    inventory_id, event_type, actor_id, previous_holder_id, new_holder_id, bin, notes
  ) values (
    p_inventory_id, 'checkin', v_uid, v_prev, null, v_item.bin_location, p_notes
  );
  return v_item;
end;
$$;

revoke all on function public.tool_take(uuid, text) from public, anon;
revoke all on function public.tool_assign(uuid, uuid, text) from public, anon;
revoke all on function public.tool_put_away(uuid, text, text) from public, anon;
grant execute on function public.tool_take(uuid, text) to authenticated;
grant execute on function public.tool_assign(uuid, uuid, text) to authenticated;
grant execute on function public.tool_put_away(uuid, text, text) to authenticated;

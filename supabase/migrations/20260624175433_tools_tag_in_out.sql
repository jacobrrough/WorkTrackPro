-- Tool tag-in / tag-out: a custody + audit system for physical TOOLS (distinct from consumable
-- inventory). Each tool has a unique number, a home bin (A4c format), and an optional current
-- holder. ALL custody changes (take / hand-off / put-away / retire) flow through the SECURITY
-- DEFINER RPCs below, so any approved employee can perform them while direct writes to `tools`
-- stay admin-only and the `tool_events` audit log cannot be forged from the client.

-- ============================ tables ============================
create table if not exists public.tools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tool_number text not null,
  home_bin text not null,
  description text,
  status text not null default 'available' check (status in ('available', 'out', 'retired')),
  current_holder_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Tool number is unique, case-insensitive (the QR codes encode this number).
create unique index if not exists uniq_tools_tool_number_lower on public.tools (lower(tool_number));
create index if not exists idx_tools_status on public.tools (status);
create index if not exists idx_tools_holder on public.tools (current_holder_id);

create table if not exists public.tool_events (
  id uuid primary key default gen_random_uuid(),
  tool_id uuid not null references public.tools(id) on delete cascade,
  event_type text not null check (event_type in ('checkout', 'checkin', 'transfer', 'retire')),
  actor_id uuid references public.profiles(id) on delete set null,
  previous_holder_id uuid references public.profiles(id) on delete set null,
  new_holder_id uuid references public.profiles(id) on delete set null,
  bin text,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_tool_events_tool on public.tool_events (tool_id, created_at desc);

-- ============================ updated_at trigger ============================
create or replace function public.touch_tools_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
revoke all on function public.touch_tools_updated_at() from public, anon;

drop trigger if exists trg_tools_updated_at on public.tools;
create trigger trg_tools_updated_at
  before update on public.tools
  for each row execute function public.touch_tools_updated_at();

-- ============================ RLS ============================
alter table public.tools enable row level security;
alter table public.tool_events enable row level security;

-- tools: every authenticated user can read the catalog; only approved admins manage it.
drop policy if exists tools_select on public.tools;
create policy tools_select on public.tools for select to authenticated using (true);

drop policy if exists tools_admin_insert on public.tools;
create policy tools_admin_insert on public.tools for insert to authenticated
  with check (public.is_admin_approved());

drop policy if exists tools_admin_update on public.tools;
create policy tools_admin_update on public.tools for update to authenticated
  using (public.is_admin_approved())
  with check (public.is_admin_approved());

drop policy if exists tools_admin_delete on public.tools;
create policy tools_admin_delete on public.tools for delete to authenticated
  using (public.is_admin_approved());

-- tool_events: every authenticated user can read history; writes happen ONLY inside the
-- SECURITY DEFINER RPCs below (no insert/update/delete policy => audit log is immutable client-side).
drop policy if exists tool_events_select on public.tool_events;
create policy tool_events_select on public.tool_events for select to authenticated using (true);

-- ============================ custody RPCs ============================
-- Take / use a tool: assign custody to the caller. From 'available' => checkout; from 'out'
-- (held by someone else) => transfer to the caller. Approved users only.
create or replace function public.tool_take(p_tool_id uuid, p_notes text default null)
returns public.tools
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_tool public.tools;
  v_prev uuid;
begin
  if not public.is_approved_user() then
    raise exception 'NOT_AUTHORIZED';
  end if;
  select * into v_tool from public.tools where id = p_tool_id for update;
  if not found then
    raise exception 'TOOL_NOT_FOUND';
  end if;
  if v_tool.status = 'retired' then
    raise exception 'TOOL_RETIRED';
  end if;
  v_prev := v_tool.current_holder_id;
  -- Already checked out to the caller: no-op, no duplicate audit row.
  if v_prev = v_uid then
    return v_tool;
  end if;

  update public.tools
    set current_holder_id = v_uid, status = 'out'
    where id = p_tool_id
    returning * into v_tool;

  insert into public.tool_events (
    tool_id, event_type, actor_id, previous_holder_id, new_holder_id, notes
  ) values (
    p_tool_id,
    case when v_prev is null then 'checkout' else 'transfer' end,
    v_uid, v_prev, v_uid, p_notes
  );
  return v_tool;
end;
$$;

-- Hand a tool off to another employee (the picker). Caller is the actor; target becomes holder.
create or replace function public.tool_assign(
  p_tool_id uuid, p_new_holder_id uuid, p_notes text default null
)
returns public.tools
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_tool public.tools;
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
  select * into v_tool from public.tools where id = p_tool_id for update;
  if not found then
    raise exception 'TOOL_NOT_FOUND';
  end if;
  if v_tool.status = 'retired' then
    raise exception 'TOOL_RETIRED';
  end if;
  v_prev := v_tool.current_holder_id;
  -- Already held by the target: no-op.
  if v_prev = p_new_holder_id then
    return v_tool;
  end if;

  update public.tools
    set current_holder_id = p_new_holder_id, status = 'out'
    where id = p_tool_id
    returning * into v_tool;

  insert into public.tool_events (
    tool_id, event_type, actor_id, previous_holder_id, new_holder_id, notes
  ) values (
    p_tool_id, 'transfer', v_uid, v_prev, p_new_holder_id, p_notes
  );
  return v_tool;
end;
$$;

-- Put a tool away: the scanned bin MUST match the tool's home bin. On mismatch raises
-- 'WRONG_BIN:<home_bin>' so the client can show the correct bin and reprompt a scan.
create or replace function public.tool_put_away(
  p_tool_id uuid, p_scanned_bin text, p_notes text default null
)
returns public.tools
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_tool public.tools;
  v_prev uuid;
  v_scanned text;
  v_home text;
begin
  if not public.is_approved_user() then
    raise exception 'NOT_AUTHORIZED';
  end if;
  select * into v_tool from public.tools where id = p_tool_id for update;
  if not found then
    raise exception 'TOOL_NOT_FOUND';
  end if;

  -- Normalize both sides: strip an optional BIN: prefix, trim, and compare case-insensitively.
  v_scanned := upper(trim(regexp_replace(coalesce(p_scanned_bin, ''), '^BIN:', '', 'i')));
  v_home := upper(trim(v_tool.home_bin));
  if v_scanned is distinct from v_home then
    raise exception 'WRONG_BIN:%', v_tool.home_bin;
  end if;

  -- Already put away: bin verified, nothing to change, no duplicate audit row.
  if v_tool.status <> 'out' then
    return v_tool;
  end if;

  v_prev := v_tool.current_holder_id;
  update public.tools
    set current_holder_id = null, status = 'available'
    where id = p_tool_id
    returning * into v_tool;

  insert into public.tool_events (
    tool_id, event_type, actor_id, previous_holder_id, new_holder_id, bin, notes
  ) values (
    p_tool_id, 'checkin', v_uid, v_prev, null, v_tool.home_bin, p_notes
  );
  return v_tool;
end;
$$;

-- Retire a tool (admin only): take it out of service and log it.
create or replace function public.tool_retire(p_tool_id uuid, p_notes text default null)
returns public.tools
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_tool public.tools;
  v_prev uuid;
begin
  if not public.is_admin_approved() then
    raise exception 'NOT_AUTHORIZED';
  end if;
  select * into v_tool from public.tools where id = p_tool_id for update;
  if not found then
    raise exception 'TOOL_NOT_FOUND';
  end if;
  v_prev := v_tool.current_holder_id;
  update public.tools
    set status = 'retired', current_holder_id = null
    where id = p_tool_id
    returning * into v_tool;

  insert into public.tool_events (
    tool_id, event_type, actor_id, previous_holder_id, new_holder_id, notes
  ) values (
    p_tool_id, 'retire', v_uid, v_prev, null, p_notes
  );
  return v_tool;
end;
$$;

revoke all on function public.tool_take(uuid, text) from public, anon;
revoke all on function public.tool_assign(uuid, uuid, text) from public, anon;
revoke all on function public.tool_put_away(uuid, text, text) from public, anon;
revoke all on function public.tool_retire(uuid, text) from public, anon;
grant execute on function public.tool_take(uuid, text) to authenticated;
grant execute on function public.tool_assign(uuid, uuid, text) to authenticated;
grant execute on function public.tool_put_away(uuid, text, text) to authenticated;
grant execute on function public.tool_retire(uuid, text) to authenticated;

-- ============================ realtime ============================
-- Add `tools` to the realtime publication (if present) so the app's live tool list / custody
-- state updates across devices, matching the core-tables realtime setup.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tools'
    ) then
      alter publication supabase_realtime add table public.tools;
    end if;
  end if;
end $$;

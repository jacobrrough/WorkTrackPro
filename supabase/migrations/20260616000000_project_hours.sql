-- Project Hours tracker: projects + dated hour entries for hourly contractor pay logging.
-- Admin-only (pay data), so RLS is gated to public.is_admin_approved() on every command.
-- This migration is IDEMPOTENT - safe to run multiple times.

-- Shared updated_at trigger fn for public tables. search_path is pinned and EXECUTE is
-- revoked from client roles, matching the hardening enforced in
-- 20260608232336_pin_search_path_and_revoke_trigger_exec.sql.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke execute on function public.touch_updated_at() from anon, authenticated;

-- Projects (one row per project; hours are logged as child entries)
create table if not exists public.project_hours (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  status text not null default 'active' check (status in ('active', 'finished')),
  archived_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Dated hour entries. rate is snapshotted per entry so historical pay never shifts if the
-- rate is renegotiated. hours bounded to a sane single-day max (also rejects NaN).
create table if not exists public.project_hour_entries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.project_hours(id) on delete cascade,
  entry_date date not null,
  hours numeric(6, 2) not null check (hours > 0 and hours <= 24),
  rate numeric(6, 2) not null default 19,
  note text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz default now()
);

do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'idx_project_hours_created_by') then
    create index idx_project_hours_created_by on public.project_hours(created_by);
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'idx_project_hour_entries_project') then
    create index idx_project_hour_entries_project on public.project_hour_entries(project_id);
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'idx_project_hour_entries_date') then
    create index idx_project_hour_entries_date on public.project_hour_entries(entry_date);
  end if;
end $$;

-- DB owns updated_at on project_hours (never stamped client-side).
drop trigger if exists touch_project_hours_updated_at on public.project_hours;
create trigger touch_project_hours_updated_at
  before update on public.project_hours
  for each row execute function public.touch_updated_at();

-- RLS: admin-only on every command. Per-command policies (NOT a single `for all`, whose
-- USING clause does not apply to INSERT and would leave inserts ungated).
alter table public.project_hours enable row level security;
alter table public.project_hour_entries enable row level security;

drop policy if exists "project_hours select" on public.project_hours;
create policy "project_hours select" on public.project_hours
  for select to authenticated using (public.is_admin_approved());

drop policy if exists "project_hours insert" on public.project_hours;
create policy "project_hours insert" on public.project_hours
  for insert to authenticated with check (public.is_admin_approved());

drop policy if exists "project_hours update" on public.project_hours;
create policy "project_hours update" on public.project_hours
  for update to authenticated
  using (public.is_admin_approved()) with check (public.is_admin_approved());

drop policy if exists "project_hours delete" on public.project_hours;
create policy "project_hours delete" on public.project_hours
  for delete to authenticated using (public.is_admin_approved());

drop policy if exists "project_hour_entries select" on public.project_hour_entries;
create policy "project_hour_entries select" on public.project_hour_entries
  for select to authenticated using (public.is_admin_approved());

drop policy if exists "project_hour_entries insert" on public.project_hour_entries;
create policy "project_hour_entries insert" on public.project_hour_entries
  for insert to authenticated with check (public.is_admin_approved());

drop policy if exists "project_hour_entries update" on public.project_hour_entries;
create policy "project_hour_entries update" on public.project_hour_entries
  for update to authenticated
  using (public.is_admin_approved()) with check (public.is_admin_approved());

drop policy if exists "project_hour_entries delete" on public.project_hour_entries;
create policy "project_hour_entries delete" on public.project_hour_entries
  for delete to authenticated using (public.is_admin_approved());

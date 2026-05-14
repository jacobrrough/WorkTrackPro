-- User Dashboard Preferences: per-user quick-action ordering and visibility.
-- Idempotent migration — safe to re-run.

-- =============================================
-- 1. TABLE
-- =============================================
create table if not exists public.user_dashboard_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  preferences jsonb not null default '{"quickActionOrder":[],"hiddenQuickActions":[]}'::jsonb,
  updated_at timestamptz default now()
);

-- =============================================
-- 2. INDEXES
-- =============================================
do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'idx_udp_updated') then
    create index if not exists idx_udp_updated on public.user_dashboard_preferences(updated_at desc);
  end if;
end $$;

-- =============================================
-- 3. RLS
-- =============================================
alter table public.user_dashboard_preferences enable row level security;

drop policy if exists "Users read own dashboard preferences" on public.user_dashboard_preferences;
create policy "Users read own dashboard preferences" on public.user_dashboard_preferences
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users update own dashboard preferences" on public.user_dashboard_preferences;
create policy "Users update own dashboard preferences" on public.user_dashboard_preferences
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Approved users insert own dashboard preferences" on public.user_dashboard_preferences;
create policy "Approved users insert own dashboard preferences" on public.user_dashboard_preferences
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_approved_user());

-- =============================================
-- 4. REALTIME
-- =============================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_dashboard_preferences'
  ) then
    alter publication supabase_realtime add table public.user_dashboard_preferences;
  end if;
end $$;

-- =============================================
-- 5. AUTO-CREATE TRIGGER ON PROFILE INSERT
-- =============================================
create or replace function public.create_default_dashboard_preferences()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_dashboard_preferences (user_id, preferences)
  values (NEW.id, '{"quickActionOrder":[],"hiddenQuickActions":[]}'::jsonb)
  on conflict (user_id) do nothing;
  return NEW;
end;
$$;

drop trigger if exists trg_create_dashboard_preferences on public.profiles;
create trigger trg_create_dashboard_preferences
  after insert on public.profiles
  for each row execute function public.create_default_dashboard_preferences();

-- =============================================
-- 6. BACKFILL EXISTING USERS
-- =============================================
insert into public.user_dashboard_preferences (user_id, preferences)
select
  p.id,
  '{"quickActionOrder":[],"hiddenQuickActions":[]}'::jsonb
from public.profiles p
where not exists (
  select 1 from public.user_dashboard_preferences udp where udp.user_id = p.id
)
on conflict (user_id) do nothing;

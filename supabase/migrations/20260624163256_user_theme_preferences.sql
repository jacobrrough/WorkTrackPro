-- Per-user UI color theme, synced across devices.
-- Mirrors user_notification_preferences (own-row RLS + auto-create trigger + backfill).
-- Idempotent — safe to re-run.

-- =============================================
-- 1. TABLE
-- =============================================
create table if not exists public.user_theme_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  theme text not null default 'midnight-purple',
  updated_at timestamptz default now()
);

-- =============================================
-- 2. RLS — each user reads/writes only their own row
-- =============================================
alter table public.user_theme_preferences enable row level security;

drop policy if exists "Users read own theme" on public.user_theme_preferences;
create policy "Users read own theme" on public.user_theme_preferences
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users update own theme" on public.user_theme_preferences;
create policy "Users update own theme" on public.user_theme_preferences
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Approved users insert own theme" on public.user_theme_preferences;
create policy "Approved users insert own theme" on public.user_theme_preferences
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_approved_user());

-- =============================================
-- 3. AUTO-CREATE ON PROFILE INSERT
-- =============================================
create or replace function public.create_default_theme_preference()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_theme_preferences (user_id, theme)
  values (NEW.id, 'midnight-purple')
  on conflict (user_id) do nothing;
  return NEW;
end;
$$;

drop trigger if exists trg_create_theme_preference on public.profiles;
create trigger trg_create_theme_preference
  after insert on public.profiles
  for each row execute function public.create_default_theme_preference();

-- =============================================
-- 4. BACKFILL EXISTING USERS
-- =============================================
insert into public.user_theme_preferences (user_id, theme)
select p.id, 'midnight-purple'
from public.profiles p
where not exists (
  select 1 from public.user_theme_preferences t where t.user_id = p.id
)
on conflict (user_id) do nothing;

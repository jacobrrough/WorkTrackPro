-- Backfill missing profiles and ensure auth trigger exists
-- Fixes: users can sign in (auth) but see empty app because RLS depends on public.profiles row.

-- Ensure the trigger exists (some environments may be missing it).
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill: create profiles for any existing auth users missing a profile row.
-- These are marked unapproved so the new approval workflow can be used.
insert into public.profiles (id, email, name, initials, is_admin, is_approved, approved_at, approved_by)
select
  u.id,
  u.email,
  coalesce(u.raw_user_meta_data->>'name', split_part(u.email, '@', 1)),
  coalesce(u.raw_user_meta_data->>'initials', upper(left(split_part(u.email, '@', 1), 2))),
  false,
  false,
  null,
  null
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

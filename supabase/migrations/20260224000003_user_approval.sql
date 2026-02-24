-- User approval + admin role management
-- New users default to unapproved; admins approve and optionally grant admin role.
-- Also tightens RLS so unapproved users cannot access app data.

-- 1) Profiles: approval fields
alter table public.profiles
  add column if not exists is_approved boolean not null default false,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references public.profiles(id) on delete set null;

-- Approve existing users so rollout doesn't lock out current team
update public.profiles
set
  is_approved = true,
  approved_at = coalesce(approved_at, now())
where is_approved = false;

-- 2) Helper functions for RLS
create or replace function public.is_approved_user()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_approved = true
  );
$$;

create or replace function public.is_admin_approved()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_admin = true
      and p.is_approved = true
  );
$$;

-- 3) Trigger: new users start unapproved
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, name, initials, is_admin, is_approved, approved_at, approved_by)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'initials', upper(left(split_part(new.email, '@', 1), 2))),
    false,
    false,
    null,
    null
  );
  return new;
end;
$$ language plpgsql security definer;

-- 4) RLS policies
-- Profiles:
-- - Unapproved users can read their own profile (to show pending approval screen).
-- - Approved users can read all profiles (needed for shifts/user display).
-- - Approved admins can update profiles to approve/grant admin.
drop policy if exists "Users can read all profiles" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;
drop policy if exists "Unapproved can read own profile" on public.profiles;
drop policy if exists "Approved users can read all profiles" on public.profiles;
drop policy if exists "Admin manage profiles" on public.profiles;

create policy "Unapproved can read own profile"
on public.profiles
for select
to authenticated
using (auth.uid() = id);

create policy "Approved users can read all profiles"
on public.profiles
for select
to authenticated
using (public.is_approved_user());

create policy "Admin manage profiles"
on public.profiles
for update
to authenticated
using (public.is_admin_approved())
with check (public.is_admin_approved());

create policy "Users can update own profile"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

-- Jobs
drop policy if exists "Authenticated read jobs" on public.jobs;
drop policy if exists "Authenticated insert jobs" on public.jobs;
drop policy if exists "Authenticated update jobs" on public.jobs;
drop policy if exists "Admin delete jobs" on public.jobs;

create policy "Authenticated read jobs"
on public.jobs
for select
to authenticated
using (public.is_approved_user());

create policy "Authenticated insert jobs"
on public.jobs
for insert
to authenticated
with check (public.is_approved_user());

create policy "Authenticated update jobs"
on public.jobs
for update
to authenticated
using (public.is_approved_user())
with check (public.is_approved_user());

create policy "Admin delete jobs"
on public.jobs
for delete
to authenticated
using (public.is_admin_approved());

-- Common tables that were previously wide-open for authenticated users
-- Inventory
drop policy if exists "Authenticated inventory" on public.inventory;
create policy "Authenticated inventory"
on public.inventory
for all
to authenticated
using (public.is_approved_user())
with check (public.is_approved_user());

-- Job inventory
drop policy if exists "Authenticated job_inventory" on public.job_inventory;
create policy "Authenticated job_inventory"
on public.job_inventory
for all
to authenticated
using (public.is_approved_user())
with check (public.is_approved_user());

-- Shifts
drop policy if exists "Authenticated shifts" on public.shifts;
create policy "Authenticated shifts"
on public.shifts
for all
to authenticated
using (public.is_approved_user())
with check (public.is_approved_user());

-- Shift edits
drop policy if exists "Authenticated shift_edits" on public.shift_edits;
create policy "Authenticated shift_edits"
on public.shift_edits
for all
to authenticated
using (public.is_approved_user())
with check (public.is_approved_user());

-- Comments
drop policy if exists "Authenticated comments" on public.comments;
create policy "Authenticated comments"
on public.comments
for all
to authenticated
using (public.is_approved_user())
with check (public.is_approved_user());

-- Attachments
drop policy if exists "Authenticated attachments" on public.attachments;
create policy "Authenticated attachments"
on public.attachments
for all
to authenticated
using (public.is_approved_user())
with check (public.is_approved_user());

-- Checklists + history
drop policy if exists "Authenticated checklists" on public.checklists;
create policy "Authenticated checklists"
on public.checklists
for all
to authenticated
using (public.is_approved_user())
with check (public.is_approved_user());

drop policy if exists "Authenticated checklist history" on public.checklist_history;
drop policy if exists "Authenticated checklist_history" on public.checklist_history;
create policy "Authenticated checklist_history"
on public.checklist_history
for all
to authenticated
using (public.is_approved_user())
with check (public.is_approved_user());

-- Inventory history
drop policy if exists "Authenticated inventory_history" on public.inventory_history;
create policy "Authenticated inventory_history"
on public.inventory_history
for all
to authenticated
using (public.is_approved_user())
with check (public.is_approved_user());

-- Quotes remain admin-only, but also require approval
drop policy if exists "Admin quotes" on public.quotes;
create policy "Admin quotes"
on public.quotes
for all
to authenticated
using (public.is_admin_approved())
with check (public.is_admin_approved());

-- Organization settings: approved users can read; approved admins can write
drop policy if exists "Authenticated read organization settings" on public.organization_settings;
create policy "Authenticated read organization settings"
on public.organization_settings
for select
to authenticated
using (public.is_approved_user());

drop policy if exists "Admin write organization settings" on public.organization_settings;
create policy "Admin write organization settings"
on public.organization_settings
for all
to authenticated
using (public.is_admin_approved())
with check (public.is_admin_approved());

-- Parts (read for approved users; write for approved admins)
drop policy if exists "Authenticated parts" on public.parts;
drop policy if exists "Authenticated parts read" on public.parts;
create policy "Authenticated parts read" on public.parts
for select to authenticated using (public.is_approved_user());
drop policy if exists "Admin parts write" on public.parts;
create policy "Admin parts write" on public.parts
for all to authenticated using (public.is_admin_approved()) with check (public.is_admin_approved());

drop policy if exists "Authenticated part_variants" on public.part_variants;
drop policy if exists "Authenticated variants read" on public.part_variants;
create policy "Authenticated variants read" on public.part_variants
for select to authenticated using (public.is_approved_user());
drop policy if exists "Admin variants write" on public.part_variants;
create policy "Admin variants write" on public.part_variants
for all to authenticated using (public.is_admin_approved()) with check (public.is_admin_approved());

drop policy if exists "Authenticated part_materials" on public.part_materials;
drop policy if exists "Authenticated materials read" on public.part_materials;
create policy "Authenticated materials read" on public.part_materials
for select to authenticated using (public.is_approved_user());
drop policy if exists "Admin materials write" on public.part_materials;
create policy "Admin materials write" on public.part_materials
for all to authenticated using (public.is_admin_approved()) with check (public.is_admin_approved());

-- Storage: attachments bucket should be approved-only
drop policy if exists "Attachments bucket: authenticated insert" on storage.objects;
create policy "Attachments bucket: authenticated insert"
on storage.objects for insert
to authenticated
with check (bucket_id = 'attachments' and public.is_approved_user());

drop policy if exists "Attachments bucket: authenticated select" on storage.objects;
create policy "Attachments bucket: authenticated select"
on storage.objects for select
to authenticated
using (bucket_id = 'attachments' and public.is_approved_user());

drop policy if exists "Attachments bucket: authenticated delete" on storage.objects;
create policy "Attachments bucket: authenticated delete"
on storage.objects for delete
to authenticated
using (bucket_id = 'attachments' and public.is_approved_user());

drop policy if exists "Attachments bucket: authenticated update" on storage.objects;
create policy "Attachments bucket: authenticated update"
on storage.objects for update
to authenticated
using (bucket_id = 'attachments' and public.is_approved_user());

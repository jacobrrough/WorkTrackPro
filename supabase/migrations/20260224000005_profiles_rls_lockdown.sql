-- Lock down profile self-updates to prevent self-approval / self-admin escalation.
-- Users may update non-privileged fields (name/initials), but not approval/admin flags.

-- Replace the permissive policy from initial schema
drop policy if exists "Users can update own profile" on public.profiles;

create policy "Users can update own profile"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (
  auth.uid() = id
  and is_admin = (select p.is_admin from public.profiles p where p.id = auth.uid())
  and is_approved = (select p.is_approved from public.profiles p where p.id = auth.uid())
  and approved_at is not distinct from (select p.approved_at from public.profiles p where p.id = auth.uid())
  and approved_by is not distinct from (select p.approved_by from public.profiles p where p.id = auth.uid())
);

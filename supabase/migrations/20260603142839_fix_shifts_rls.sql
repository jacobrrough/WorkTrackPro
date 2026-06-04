-- SECURITY FIX (high): public.shifts and public.shift_edits each carry a permissive
-- `Authenticated *` policy `for all to authenticated using (is_approved_user())`. The
-- tables ALSO already have tighter per-command policies (shifts_update_own /
-- shifts_delete_own = self-or-admin, etc.), but because PostgreSQL OR-combines permissive
-- policies, the broad ALL policy overrides them and any approved employee can still
-- read/edit/DELETE ANY employee's shift. This migration removes the overriding ALL
-- policies so the existing per-command policies take effect, tightens INSERT so a worker
-- can only create their OWN shift, and adds a column-level trigger so a non-admin editing
-- their own shift can only change clock-out / lunch fields (not clock_in_time / identity).
--
-- Worker flows are unaffected: clockIn inserts the user's own shift; clockOut /
-- start-lunch / end-lunch update clock_out_time / lunch_* on the user's own shift.
-- IDEMPOTENT. Service-role (auth.uid() IS NULL) bypasses RLS and the trigger short-circuits.
-- REVIEW + verify against a live Postgres before applying.

-- 1) Remove the permissive ALL policies that override the per-command policies.
drop policy if exists "Authenticated shifts" on public.shifts;
drop policy if exists "Authenticated shift_edits" on public.shift_edits;

-- 2) Tighten INSERT: a worker may only insert a shift for themselves; admins may insert
--    for anyone. (The prior policy allowed any approved user to insert a shift for any
--    user_id, i.e. fabricate hours for a coworker.)
drop policy if exists "shifts_insert" on public.shifts;
create policy "shifts_insert" on public.shifts
  for insert to authenticated
  with check (
    public.is_approved_user()
    and (user_id = auth.uid() or public.is_admin_approved())
  );

-- 3) Column-level guard. RLS (shifts_update_own) already limits WHICH rows a non-admin can
--    update (their own); this restricts WHICH columns (clock-out + lunch only) so a worker
--    cannot back-date clock_in_time or reassign the shift. Admins / service-role are unrestricted.
create or replace function public.enforce_shift_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Service-role / server-side contexts have no auth.uid(); trust them.
  if auth.uid() is null then
    return new;
  end if;
  -- Approved admins may change anything.
  if public.is_admin_approved() then
    return new;
  end if;
  -- Non-admins may only touch their OWN shift...
  if old.user_id <> auth.uid() then
    raise exception 'shifts: cannot modify another user''s shift';
  end if;
  -- ...and may not rewrite identity / clock-in (only clock-out + lunch are editable).
  if new.clock_in_time is distinct from old.clock_in_time
     or new.user_id is distinct from old.user_id
     or new.job_id is distinct from old.job_id then
    raise exception 'shifts: only clock-out and lunch fields may be edited';
  end if;
  return new;
end;
$$;

-- The trigger function only ever runs as a trigger (triggers fire regardless of the
-- caller's EXECUTE grant), so keep it entirely off the RPC surface.
revoke all on function public.enforce_shift_update() from public, anon, authenticated;

drop trigger if exists trg_enforce_shift_update on public.shifts;
create trigger trg_enforce_shift_update
  before update on public.shifts
  for each row execute function public.enforce_shift_update();

-- NOTE: the existing per-command policies are intentionally preserved and now take effect:
--   shifts:      shifts_select (approved), shifts_update_own / shifts_delete_own (self-or-admin)
--   shift_edits: shift_edits_select / _insert (approved), _update_own / _delete_own (self-or-admin)

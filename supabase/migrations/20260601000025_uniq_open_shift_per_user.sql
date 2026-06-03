-- INTEGRITY FIX (high): shiftService.clockIn does SELECT-then-INSERT with no DB guard,
-- a TOCTOU race that lets two concurrent clock-ins (manual tap racing the offline-sync
-- loop, two devices, a double-tap) create MULTIPLE simultaneous open shifts for one user.
-- Duplicate open shifts double-count labor hours everywhere they are summed.
--
-- This migration (1) reconciles any pre-existing duplicate open shifts, then (2) adds a
-- partial unique index so the DB rejects a second open shift. The application code in
-- shiftService.clockIn is updated separately to treat the resulting unique-violation
-- (SQLSTATE 23505) as "already clocked in" and return false.
--
-- ⚠️ ORDER MATTERS: the index creation FAILS if duplicate open shifts still exist, which
-- is why step (1) runs first. Step (1) is a HEURISTIC — review it before applying:
-- it keeps each user's most-recent open shift active and closes the older duplicates at
-- their own clock_in_time (zero duration) so they no longer inflate labor. If you would
-- rather close them at a different time (or delete them), adjust step (1) accordingly.
-- REVIEW before applying to the live DB.

-- (1) Reconcile existing duplicates: keep the latest open shift per user, zero-close the rest.
with ranked as (
  select
    id,
    row_number() over (partition by user_id order by clock_in_time desc, id) as rn
  from public.shifts
  where clock_out_time is null
)
update public.shifts s
set clock_out_time = s.clock_in_time
from ranked r
where s.id = r.id
  and r.rn > 1;

-- (2) Enforce "at most one open shift per user" at the database level.
create unique index if not exists uniq_open_shift_per_user
  on public.shifts (user_id)
  where clock_out_time is null;

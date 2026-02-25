-- Support incremental breaks up to 60 minutes total per shift.
alter table public.shifts
  add column if not exists lunch_minutes_used integer not null default 0;

-- Backfill legacy single-window lunch tracking into cumulative minutes.
update public.shifts
set lunch_minutes_used = greatest(
  0,
  floor(extract(epoch from (lunch_end_time - lunch_start_time)) / 60)::integer
)
where lunch_minutes_used = 0
  and lunch_start_time is not null
  and lunch_end_time is not null;

alter table public.shifts
  drop constraint if exists shifts_lunch_minutes_used_check;

alter table public.shifts
  add constraint shifts_lunch_minutes_used_check
  check (lunch_minutes_used >= 0);

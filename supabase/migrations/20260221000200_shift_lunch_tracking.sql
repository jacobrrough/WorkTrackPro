-- Add lunch tracking columns for shift-based time tracking popup.
alter table public.shifts
  add column if not exists lunch_start_time timestamptz,
  add column if not exists lunch_end_time timestamptz;

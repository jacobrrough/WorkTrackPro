alter table public.jobs
  add column if not exists cnc_completed_at timestamptz,
  add column if not exists cnc_completed_by uuid references public.profiles (id) on delete set null;

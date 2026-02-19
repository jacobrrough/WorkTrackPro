-- Add part_id to jobs (required for Trello import and job–part linking)
-- Run this in Supabase SQL Editor if you get "Could not find part id column of jobs".
-- The public.parts table must already exist (from parts_schema or initial_schema).

alter table public.jobs add column if not exists part_id uuid references public.parts(id) on delete set null;
create index if not exists idx_jobs_part on public.jobs(part_id);

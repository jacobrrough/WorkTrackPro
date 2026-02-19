-- Add revision and dash_quantities to jobs (required for Trello import and multi-variant jobs)
-- Run this in Supabase SQL Editor if you get "Could not find the 'revision' column of 'jobs'".

alter table public.jobs add column if not exists revision text;
alter table public.jobs add column if not exists dash_quantities jsonb;

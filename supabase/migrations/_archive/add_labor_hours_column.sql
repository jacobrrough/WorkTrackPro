-- Add labor_hours column to jobs table if it doesn't exist
-- Run this in Supabase SQL Editor if you're getting "Could not find the 'labor_hours' column" errors

alter table public.jobs add column if not exists labor_hours numeric;

-- Verify the column was added
select column_name, data_type 
from information_schema.columns 
where table_schema = 'public' 
  and table_name = 'jobs' 
  and column_name = 'labor_hours';

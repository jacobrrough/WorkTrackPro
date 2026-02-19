-- Add OWR# (Order/Work Request number) to jobs for Trello import and display
alter table public.jobs add column if not exists owr_number text;

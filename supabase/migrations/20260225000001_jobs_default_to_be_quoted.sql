-- New jobs default to "To Be Quoted" instead of "pending".
alter table public.jobs
  alter column status set default 'toBeQuoted';

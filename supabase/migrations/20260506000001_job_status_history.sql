-- Job Status History: audit log for job card movements between columns.
-- Idempotent migration.

create table if not exists public.job_status_history (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  previous_status text not null,
  new_status text not null,
  created_at timestamptz default now()
);

do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'idx_job_status_history_job') then
    create index if not exists idx_job_status_history_job on public.job_status_history(job_id);
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'idx_job_status_history_created') then
    create index if not exists idx_job_status_history_created on public.job_status_history(created_at desc);
  end if;
end $$;

alter table public.job_status_history enable row level security;

drop policy if exists "Admin select job status history" on public.job_status_history;
create policy "Admin select job status history" on public.job_status_history
  for select to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true));

drop policy if exists "Authenticated insert job status history" on public.job_status_history;
create policy "Authenticated insert job status history" on public.job_status_history
  for insert to authenticated with check (true);

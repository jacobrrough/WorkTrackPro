-- Multi-part jobs: junction table so a job can reference multiple parts.
-- jobs.part_id / part_number / dash_quantities remain as "primary" (first part) for backward compatibility.

create table if not exists public.job_parts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  part_id uuid not null references public.parts(id) on delete cascade,
  dash_quantities jsonb,
  sort_order int not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(job_id, part_id)
);

create index if not exists idx_job_parts_job on public.job_parts(job_id);
create index if not exists idx_job_parts_part on public.job_parts(part_id);

-- Backfill: one row per job that has part_id set
insert into public.job_parts (job_id, part_id, dash_quantities, sort_order)
select id, part_id, coalesce(dash_quantities, '{}'::jsonb), 0
from public.jobs
where part_id is not null
on conflict (job_id, part_id) do nothing;

-- RLS: same as jobs (authenticated full access for now)
alter table public.job_parts enable row level security;
create policy "Authenticated job_parts" on public.job_parts for all to authenticated using (true) with check (true);

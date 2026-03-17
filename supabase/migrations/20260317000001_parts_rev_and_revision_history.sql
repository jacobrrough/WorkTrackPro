-- Part revision (drawing rev) and revision history for cost tracking.
-- Default rev is '--' (no revision yet).

-- 1) parts.rev: drawing revision (letters, numbers, or symbols)
alter table public.parts add column if not exists rev text not null default '--';
comment on column public.parts.rev is 'Drawing revision (e.g. A, B, 1, --). Required.';

-- Backfill existing parts
update public.parts set rev = '--' where rev is null or trim(rev) = '';

-- 2) part_revision_history: track when rev changed and by whom (for cost/revision tracking)
create table if not exists public.part_revision_history (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null references public.parts(id) on delete cascade,
  rev text not null,
  previous_rev text,
  changed_at timestamptz not null default now(),
  changed_by uuid references public.profiles(id) on delete set null,
  cost_snapshot jsonb,
  notes text
);

create index if not exists idx_part_revision_history_part on public.part_revision_history(part_id);
create index if not exists idx_part_revision_history_changed_at on public.part_revision_history(changed_at desc);

alter table public.part_revision_history enable row level security;
create policy "Authenticated part_revision_history"
  on public.part_revision_history for all to authenticated using (true) with check (true);

-- 3) jobs.part_rev: which part revision this job was built to (when linked to a part)
alter table public.jobs add column if not exists part_rev text;
comment on column public.jobs.part_rev is 'Part drawing rev this job was built to (from parts.rev when linked).';

-- 4) job_parts.rev: revision per part link (if table exists)
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'job_parts') then
    alter table public.job_parts add column if not exists rev text;
  end if;
end $$;

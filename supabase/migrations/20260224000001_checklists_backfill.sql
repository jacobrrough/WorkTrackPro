-- Backfill checklist tables/policies for environments that were initialized
-- without the original checklist schema.
-- Safe to run multiple times.

create table if not exists public.checklists (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.jobs(id) on delete cascade,
  status text not null,
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.checklists add column if not exists job_id uuid references public.jobs(id) on delete cascade;
alter table public.checklists add column if not exists status text;
alter table public.checklists add column if not exists items jsonb not null default '[]'::jsonb;
alter table public.checklists add column if not exists created_at timestamptz default now();
alter table public.checklists add column if not exists updated_at timestamptz default now();

create index if not exists idx_checklists_job on public.checklists(job_id);

create table if not exists public.checklist_history (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references public.checklists(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  item_index int not null,
  item_text text,
  checked boolean not null,
  created_at timestamptz default now()
);

alter table public.checklist_history add column if not exists checklist_id uuid references public.checklists(id) on delete cascade;
alter table public.checklist_history add column if not exists user_id uuid references public.profiles(id);
alter table public.checklist_history add column if not exists item_index int;
alter table public.checklist_history add column if not exists item_text text;
alter table public.checklist_history add column if not exists checked boolean;
alter table public.checklist_history add column if not exists created_at timestamptz default now();

alter table public.checklists enable row level security;
alter table public.checklist_history enable row level security;

drop policy if exists "Authenticated checklists" on public.checklists;
create policy "Authenticated checklists"
on public.checklists
for all
to authenticated
using (true)
with check (true);

drop policy if exists "Authenticated checklist history" on public.checklist_history;
create policy "Authenticated checklist history"
on public.checklist_history
for all
to authenticated
using (true)
with check (true);

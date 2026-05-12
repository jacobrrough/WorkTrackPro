-- Job Deliveries: track partial/full shipments per job with packing-slip data
-- Idempotent migration.

create table if not exists public.deliveries (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  delivery_number int not null default 1,
  delivered_at date not null default current_date,
  carrier text,
  tracking_number text,
  recipient_name text,
  notes text,
  line_items jsonb not null default '[]',
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'idx_deliveries_job') then
    create index if not exists idx_deliveries_job on public.deliveries(job_id);
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'idx_deliveries_date') then
    create index if not exists idx_deliveries_date on public.deliveries(delivered_at desc);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'deliveries_job_number_unique'
    and conrelid = 'public.deliveries'::regclass
  ) then
    alter table public.deliveries
    alter table public.deliveries drop constraint if exists deliveries_job_number_unique;
    add constraint deliveries_job_number_unique unique (job_id, delivery_number);
  end if;
end $$;

alter table public.deliveries enable row level security;

drop policy if exists "Authenticated deliveries" on public.deliveries;
create policy "Authenticated deliveries" on public.deliveries
  for all to authenticated using (true) with check (true);

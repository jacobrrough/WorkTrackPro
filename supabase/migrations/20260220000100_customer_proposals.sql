-- Customer-facing proposal intake for Rough Cut Manufacturing.
-- Creates proposal tables and storage policies for web uploads.

create table if not exists public.customer_proposals (
  id uuid primary key default gen_random_uuid(),
  submission_id text unique,
  contact_name text not null,
  email text not null,
  phone text not null,
  description text not null,
  status text not null default 'needs_quote',
  linked_job_id uuid references public.jobs(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.customer_proposal_files (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.customer_proposals(id) on delete cascade,
  filename text not null,
  storage_path text not null,
  content_type text,
  size_bytes bigint,
  public_url text,
  created_at timestamptz default now()
);

create index if not exists idx_customer_proposals_created_at
  on public.customer_proposals(created_at desc);
create index if not exists idx_customer_proposals_status
  on public.customer_proposals(status);
create index if not exists idx_customer_proposal_files_proposal_id
  on public.customer_proposal_files(proposal_id);

alter table public.customer_proposals enable row level security;
alter table public.customer_proposal_files enable row level security;

drop policy if exists "Admin customer proposals read" on public.customer_proposals;
create policy "Admin customer proposals read"
on public.customer_proposals
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and is_admin = true
  )
);

drop policy if exists "Admin customer proposals write" on public.customer_proposals;
create policy "Admin customer proposals write"
on public.customer_proposals
for all
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and is_admin = true
  )
)
with check (
  exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and is_admin = true
  )
);

drop policy if exists "Admin customer proposal files read" on public.customer_proposal_files;
create policy "Admin customer proposal files read"
on public.customer_proposal_files
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and is_admin = true
  )
);

drop policy if exists "Admin customer proposal files write" on public.customer_proposal_files;
create policy "Admin customer proposal files write"
on public.customer_proposal_files
for all
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and is_admin = true
  )
)
with check (
  exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and is_admin = true
  )
);

-- Storage bucket for customer-uploaded proposal paperwork.
insert into storage.buckets (id, name, public)
values ('customer-proposals', 'customer-proposals', true)
on conflict (id) do nothing;

drop policy if exists "Anon upload customer proposal files" on storage.objects;
create policy "Anon upload customer proposal files"
on storage.objects
for insert
to anon
with check (bucket_id = 'customer-proposals');

drop policy if exists "Anon read customer proposal files" on storage.objects;
create policy "Anon read customer proposal files"
on storage.objects
for select
to anon
using (bucket_id = 'customer-proposals');

drop policy if exists "Admin manage customer proposal files" on storage.objects;
create policy "Admin manage customer proposal files"
on storage.objects
for all
to authenticated
using (
  bucket_id = 'customer-proposals'
  and exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and is_admin = true
  )
)
with check (
  bucket_id = 'customer-proposals'
  and exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and is_admin = true
  )
);

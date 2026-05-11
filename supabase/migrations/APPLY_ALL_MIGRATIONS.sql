-- ============================================
-- CONSOLIDATED MIGRATIONS FOR SUPABASE
-- ============================================
--
-- HOW TO UPDATE SUPABASE:
-- 1. Open your project at https://supabase.com/dashboard
-- 2. Go to SQL Editor
-- 3. Click "New query"
-- 4. Paste this entire file (or run the new migration block below if you already ran the rest)
-- 5. Click "Run" (or Ctrl/Cmd+Enter)
--
-- ============================================

-- Migration 1: Inventory attachments support
-- Add inventory_id support to attachments table
-- Allows attachments to be linked to either jobs or inventory items

-- Make job_id nullable (existing attachments keep their job_id)
alter table public.attachments alter column job_id drop not null;

-- Add inventory_id column
alter table public.attachments add column if not exists inventory_id uuid references public.inventory(id) on delete cascade;

-- (Do not add job_or_inventory_check here: part drawing rows have only part_id set and would violate it.
--  The final one_owner_check is added in Migration 4.)

-- Add index for inventory_id lookups
create index if not exists idx_attachments_inventory on public.attachments(inventory_id);

-- Add attachment_count column to inventory table (similar to jobs)
alter table public.inventory add column if not exists attachment_count integer not null default 0;

-- Migration 2: Part pricing fields
-- Add price_per_set and labor_hours to parts table (for set-level quoting)
alter table public.parts add column if not exists price_per_set numeric;
alter table public.parts add column if not exists labor_hours numeric;
alter table public.parts add column if not exists set_composition jsonb;

-- Add price_per_variant and labor_hours to part_variants table
alter table public.part_variants add column if not exists price_per_variant numeric;
alter table public.part_variants add column if not exists labor_hours numeric;

-- Migration 3: Part-level materials (per_set)
-- Support part-level (per_set) materials: part_id + nullable part_variant_id/variant_id
-- Part-level row: part_id set, part_variant_id null (or variant_id null). Variant-level: part_variant_id set.

alter table public.part_materials add column if not exists part_id uuid references public.parts(id) on delete cascade;
alter table public.part_materials add column if not exists variant_id uuid references public.part_variants(id) on delete cascade;
alter table public.part_materials add column if not exists usage_type text not null default 'per_variant';

-- Make part_variant_id nullable when it exists (newer schema)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'part_materials' and column_name = 'part_variant_id'
  ) then
    alter table public.part_materials alter column part_variant_id drop not null;
  end if;
end $$;

create index if not exists idx_part_materials_part_id on public.part_materials(part_id) where part_id is not null;

-- Migration 4: Part drawing attachments
-- Part drawing: one attachment per part (the only file standard users can access on job cards)

alter table public.attachments add column if not exists part_id uuid references public.parts(id) on delete cascade;
create index if not exists idx_attachments_part on public.attachments(part_id) where part_id is not null;

-- Allow part_id as alternative to job_id/inventory_id (exactly one owner)
-- board_card_id added in Migration 30 (board card attachments)
alter table public.attachments drop constraint if exists attachments_job_or_inventory_check;
alter table public.attachments drop constraint if exists attachments_one_owner_check;
-- Constraint is created in Migration 30 after board_card_id column exists

-- Migration 5: OWR# (Order/Work Request) on jobs
alter table public.jobs add column if not exists owr_number text;

-- Migration 5a: jobs.revision and dash_quantities (Trello import and multi-variant jobs)
alter table public.jobs add column if not exists revision text;
alter table public.jobs add column if not exists dash_quantities jsonb;

-- Migration 5b: jobs.part_id (link job to part for dash quantities and Trello import)
-- Requires public.parts to exist (run parts_schema or initial_schema first if needed)
alter table public.jobs add column if not exists part_id uuid references public.parts(id) on delete set null;
create index if not exists idx_jobs_part on public.jobs(part_id);

-- Migration 6: Separate CNC and 3D printer
-- Separate CNC and 3D printer: replace single machine work toggle with two separate toggles and time fields

-- Drop old columns if they exist
alter table public.parts drop column if exists requires_machine_work;
alter table public.parts drop column if exists machine_time_hours;

-- Add separate CNC fields
alter table public.parts add column if not exists requires_cnc boolean not null default false;
alter table public.parts add column if not exists cnc_time_hours numeric;

-- Add separate 3D printer fields
alter table public.parts add column if not exists requires_3d_print boolean not null default false;
alter table public.parts add column if not exists printer_3d_time_hours numeric;

-- Migration 7: Organization-wide admin settings
-- Shared pricing + scheduling config row for all authenticated users (admins write, everyone reads)

create table if not exists public.organization_settings (
  id uuid primary key default gen_random_uuid(),
  org_key text not null unique default 'default',
  labor_rate numeric not null default 175 check (labor_rate >= 0),
  material_upcharge numeric not null default 1.25 check (material_upcharge > 0),
  cnc_rate numeric not null default 150 check (cnc_rate >= 0),
  printer_3d_rate numeric not null default 100 check (printer_3d_rate >= 0),
  employee_count integer not null default 5 check (employee_count >= 1),
  overtime_multiplier numeric not null default 1.5 check (overtime_multiplier >= 1),
  work_week_schedule jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_settings_default_org_key check (org_key = 'default')
);

do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'idx_organization_settings_org_key') then
    create index idx_organization_settings_org_key on public.organization_settings(org_key);
  end if;
end $$;

alter table public.organization_settings enable row level security;

drop policy if exists "Authenticated read organization settings" on public.organization_settings;
create policy "Authenticated read organization settings" on public.organization_settings
for select to authenticated using (true);

drop policy if exists "Admin write organization settings" on public.organization_settings;
create policy "Admin write organization settings" on public.organization_settings
for all to authenticated
using (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true))
with check (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true));

insert into public.organization_settings (
  org_key,
  labor_rate,
  material_upcharge,
  cnc_rate,
  printer_3d_rate,
  employee_count,
  overtime_multiplier,
  work_week_schedule
)
values ('default', 175, 1.25, 150, 100, 5, 1.5, '{}'::jsonb)
on conflict (org_key) do nothing;

-- Migration 8: Customer proposals intake + file uploads
-- Customer-facing proposal submission and admin review workflow

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

-- Migration 9: Variant machine time + job variant allocation persistence
alter table public.part_variants
  add column if not exists requires_cnc boolean not null default false;
alter table public.part_variants
  add column if not exists cnc_time_hours numeric;
alter table public.part_variants
  add column if not exists requires_3d_print boolean not null default false;
alter table public.part_variants
  add column if not exists printer_3d_time_hours numeric;

alter table public.jobs
  add column if not exists labor_breakdown_by_variant jsonb;
alter table public.jobs
  add column if not exists machine_breakdown_by_variant jsonb;
alter table public.jobs
  add column if not exists allocation_source text;
alter table public.jobs
  add column if not exists allocation_source_updated_at timestamptz;

-- Migration 10: Job-level CNC completion tracking
alter table public.jobs
  add column if not exists cnc_completed_at timestamptz;
alter table public.jobs
  add column if not exists cnc_completed_by uuid references public.profiles(id) on delete set null;

-- Migration 11: Shift lunch tracking
alter table public.shifts
  add column if not exists lunch_start_time timestamptz,
  add column if not exists lunch_end_time timestamptz;

-- Migration 12: Organization settings geofence
alter table public.organization_settings add column if not exists require_on_site boolean not null default false;
alter table public.organization_settings add column if not exists site_lat numeric;
alter table public.organization_settings add column if not exists site_lng numeric;
alter table public.organization_settings add column if not exists site_radius_meters numeric;
alter table public.organization_settings add column if not exists enforce_on_site_at_login boolean not null default false;

-- Migration 13: Checklists backfill
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
alter table public.checklists enable row level security;
alter table public.checklist_history enable row level security;

drop policy if exists "Authenticated checklists" on public.checklists;
create policy "Authenticated checklists" on public.checklists for all to authenticated using (true) with check (true);
drop policy if exists "Authenticated checklist history" on public.checklist_history;
create policy "Authenticated checklist history" on public.checklist_history for all to authenticated using (true) with check (true);

-- Migration 14: User approval + admin role management
alter table public.profiles
  add column if not exists is_approved boolean not null default false,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references public.profiles(id) on delete set null;

update public.profiles set is_approved = true, approved_at = coalesce(approved_at, now()) where is_approved = false;

-- Helper functions (SECURITY DEFINER to avoid RLS recursion — fixes from Migration 17 applied inline)
create or replace function public.is_approved_user()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_approved = true);
$$;

create or replace function public.is_admin_approved()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true and p.is_approved = true);
$$;

-- Trigger: new users start unapproved
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, name, initials, is_admin, is_approved, approved_at, approved_by)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'initials', upper(left(split_part(new.email, '@', 1), 2))),
    false, false, null, null
  );
  return new;
end;
$$ language plpgsql security definer;

-- RLS policies (approval-aware)
drop policy if exists "Users can read all profiles" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;
drop policy if exists "Unapproved can read own profile" on public.profiles;
drop policy if exists "Approved users can read all profiles" on public.profiles;
drop policy if exists "Admin manage profiles" on public.profiles;

create policy "Unapproved can read own profile" on public.profiles for select to authenticated using (auth.uid() = id);
create policy "Approved users can read all profiles" on public.profiles for select to authenticated using (public.is_approved_user());
create policy "Admin manage profiles" on public.profiles for update to authenticated using (public.is_admin_approved()) with check (public.is_admin_approved());

-- Profiles RLS lockdown (Migration 16 — prevent self-approval)
create policy "Users can update own profile" on public.profiles for update to authenticated
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and is_admin = (select p.is_admin from public.profiles p where p.id = auth.uid())
    and is_approved = (select p.is_approved from public.profiles p where p.id = auth.uid())
    and approved_at is not distinct from (select p.approved_at from public.profiles p where p.id = auth.uid())
    and approved_by is not distinct from (select p.approved_by from public.profiles p where p.id = auth.uid())
  );

-- Jobs RLS
drop policy if exists "Authenticated read jobs" on public.jobs;
drop policy if exists "Authenticated insert jobs" on public.jobs;
drop policy if exists "Authenticated update jobs" on public.jobs;
drop policy if exists "Admin delete jobs" on public.jobs;
create policy "Authenticated read jobs" on public.jobs for select to authenticated using (public.is_approved_user());
create policy "Authenticated insert jobs" on public.jobs for insert to authenticated with check (public.is_approved_user());
create policy "Authenticated update jobs" on public.jobs for update to authenticated using (public.is_approved_user()) with check (public.is_approved_user());
create policy "Admin delete jobs" on public.jobs for delete to authenticated using (public.is_admin_approved());

-- Common tables approval-gated RLS
drop policy if exists "Authenticated inventory" on public.inventory;
create policy "Authenticated inventory" on public.inventory for all to authenticated using (public.is_approved_user()) with check (public.is_approved_user());
drop policy if exists "Authenticated job_inventory" on public.job_inventory;
create policy "Authenticated job_inventory" on public.job_inventory for all to authenticated using (public.is_approved_user()) with check (public.is_approved_user());
drop policy if exists "Authenticated shifts" on public.shifts;
create policy "Authenticated shifts" on public.shifts for all to authenticated using (public.is_approved_user()) with check (public.is_approved_user());
drop policy if exists "Authenticated shift_edits" on public.shift_edits;
create policy "Authenticated shift_edits" on public.shift_edits for all to authenticated using (public.is_approved_user()) with check (public.is_approved_user());
drop policy if exists "Authenticated comments" on public.comments;
create policy "Authenticated comments" on public.comments for all to authenticated using (public.is_approved_user()) with check (public.is_approved_user());
drop policy if exists "Authenticated attachments" on public.attachments;
create policy "Authenticated attachments" on public.attachments for all to authenticated using (public.is_approved_user()) with check (public.is_approved_user());
drop policy if exists "Authenticated checklists" on public.checklists;
create policy "Authenticated checklists" on public.checklists for all to authenticated using (public.is_approved_user()) with check (public.is_approved_user());
drop policy if exists "Authenticated checklist history" on public.checklist_history;
drop policy if exists "Authenticated checklist_history" on public.checklist_history;
create policy "Authenticated checklist_history" on public.checklist_history for all to authenticated using (public.is_approved_user()) with check (public.is_approved_user());
drop policy if exists "Authenticated inventory_history" on public.inventory_history;
create policy "Authenticated inventory_history" on public.inventory_history for all to authenticated using (public.is_approved_user()) with check (public.is_approved_user());
drop policy if exists "Admin quotes" on public.quotes;
create policy "Admin quotes" on public.quotes for all to authenticated using (public.is_admin_approved()) with check (public.is_admin_approved());
drop policy if exists "Authenticated read organization settings" on public.organization_settings;
create policy "Authenticated read organization settings" on public.organization_settings for select to authenticated using (public.is_approved_user());
drop policy if exists "Admin write organization settings" on public.organization_settings;
create policy "Admin write organization settings" on public.organization_settings for all to authenticated using (public.is_admin_approved()) with check (public.is_admin_approved());

-- Parts/variants/materials RLS
drop policy if exists "Authenticated parts" on public.parts;
drop policy if exists "Authenticated parts read" on public.parts;
create policy "Authenticated parts read" on public.parts for select to authenticated using (public.is_approved_user());
drop policy if exists "Admin parts write" on public.parts;
create policy "Admin parts write" on public.parts for all to authenticated using (public.is_admin_approved()) with check (public.is_admin_approved());
drop policy if exists "Authenticated part_variants" on public.part_variants;
drop policy if exists "Authenticated variants read" on public.part_variants;
create policy "Authenticated variants read" on public.part_variants for select to authenticated using (public.is_approved_user());
drop policy if exists "Admin variants write" on public.part_variants;
create policy "Admin variants write" on public.part_variants for all to authenticated using (public.is_admin_approved()) with check (public.is_admin_approved());
drop policy if exists "Authenticated part_materials" on public.part_materials;
drop policy if exists "Authenticated materials read" on public.part_materials;
create policy "Authenticated materials read" on public.part_materials for select to authenticated using (public.is_approved_user());
drop policy if exists "Admin materials write" on public.part_materials;
create policy "Admin materials write" on public.part_materials for all to authenticated using (public.is_admin_approved()) with check (public.is_admin_approved());

-- Storage: attachments bucket approval-gated
drop policy if exists "Attachments bucket: authenticated insert" on storage.objects;
create policy "Attachments bucket: authenticated insert" on storage.objects for insert to authenticated with check (bucket_id = 'attachments' and public.is_approved_user());
drop policy if exists "Attachments bucket: authenticated select" on storage.objects;
create policy "Attachments bucket: authenticated select" on storage.objects for select to authenticated using (bucket_id = 'attachments' and public.is_approved_user());
drop policy if exists "Attachments bucket: authenticated delete" on storage.objects;
create policy "Attachments bucket: authenticated delete" on storage.objects for delete to authenticated using (bucket_id = 'attachments' and public.is_approved_user());
drop policy if exists "Attachments bucket: authenticated update" on storage.objects;
create policy "Attachments bucket: authenticated update" on storage.objects for update to authenticated using (bucket_id = 'attachments' and public.is_approved_user());

-- Migration 15: Profiles backfill and trigger
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

insert into public.profiles (id, email, name, initials, is_admin, is_approved, approved_at, approved_by)
select u.id, u.email,
  coalesce(u.raw_user_meta_data->>'name', split_part(u.email, '@', 1)),
  coalesce(u.raw_user_meta_data->>'initials', upper(left(split_part(u.email, '@', 1), 2))),
  false, false, null, null
from auth.users u left join public.profiles p on p.id = u.id where p.id is null;

-- Migration 18: Lunch break increments
alter table public.shifts add column if not exists lunch_minutes_used integer not null default 0;
update public.shifts set lunch_minutes_used = greatest(0, floor(extract(epoch from (lunch_end_time - lunch_start_time)) / 60)::integer)
  where lunch_minutes_used = 0 and lunch_start_time is not null and lunch_end_time is not null;
alter table public.shifts drop constraint if exists shifts_lunch_minutes_used_check;
alter table public.shifts add constraint shifts_lunch_minutes_used_check check (lunch_minutes_used >= 0);

-- Migration 19: Jobs default to "To Be Quoted"
alter table public.jobs alter column status set default 'toBeQuoted';

-- Migration 20: Variants are copies
alter table public.parts add column if not exists variants_are_copies boolean not null default false;

-- Migration 21: Jobs progress estimate percent
alter table public.jobs add column if not exists progress_estimate_percent numeric;

-- Migration 22: Jobs planned completion date
alter table public.jobs add column if not exists planned_completion_date date;

-- Migration 23: Job parts (multi-part jobs)
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

insert into public.job_parts (job_id, part_id, dash_quantities, sort_order)
select id, part_id, coalesce(dash_quantities, '{}'::jsonb), 0 from public.jobs where part_id is not null
on conflict (job_id, part_id) do nothing;

alter table public.job_parts enable row level security;
create policy "Authenticated job_parts" on public.job_parts for all to authenticated using (true) with check (true);

-- Migration 24: Storefront public parts
alter table public.parts add column if not exists show_on_store boolean not null default false;
alter table public.attachments add column if not exists attachment_type text default 'general';
update public.attachments set attachment_type = 'drawing' where part_id is not null and (attachment_type is null or attachment_type = 'general');

create policy "Anon read parts on store" on public.parts for select to anon using (show_on_store = true);
create policy "Anon read part_variants for store parts" on public.part_variants for select to anon
  using (part_id in (select id from public.parts where show_on_store = true));
create policy "Anon read product_image attachments for store parts" on public.attachments for select to anon
  using (part_id is not null and attachment_type = 'product_image' and part_id in (select id from public.parts where show_on_store = true));

create or replace function public.part_id_from_attachment_path(path text) returns uuid language sql stable as $$
  select case when path ~ '^parts/[0-9a-fA-F-]{36}/' then (regexp_match(path, '^parts/([0-9a-fA-F-]{36})/'))[1]::uuid else null end;
$$;

drop policy if exists "Attachments bucket: anon read store product images" on storage.objects;
create policy "Attachments bucket: anon read store product images" on storage.objects for select to anon
  using (bucket_id = 'attachments' and public.part_id_from_attachment_path(name) is not null
    and exists (select 1 from public.parts p where p.id = public.part_id_from_attachment_path(name) and p.show_on_store = true));

-- Migration 25: Parts rev and revision history
alter table public.parts add column if not exists rev text not null default '--';
update public.parts set rev = '--' where rev is null or trim(rev) = '';

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
create policy "Authenticated part_revision_history" on public.part_revision_history for all to authenticated using (true) with check (true);

alter table public.jobs add column if not exists part_rev text;
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'job_parts') then
    alter table public.job_parts add column if not exists rev text;
  end if;
end $$;

-- Migration 26: Job 3D print completion
alter table public.jobs
  add column if not exists printer3d_completed_at timestamptz,
  add column if not exists printer3d_completed_by uuid references public.profiles(id) on delete set null;

-- Migration 27: Custom boards
create table if not exists public.boards (
  id uuid primary key default gen_random_uuid(),
  name text not null, description text,
  created_by uuid not null references public.profiles(id),
  visibility text not null default 'private',
  created_at timestamptz default now(), updated_at timestamptz default now()
);
do $$ begin
  if not exists (select 1 from pg_indexes where indexname = 'idx_boards_created_by') then create index idx_boards_created_by on public.boards(created_by); end if;
  if not exists (select 1 from pg_indexes where indexname = 'idx_boards_visibility') then create index idx_boards_visibility on public.boards(visibility); end if;
end $$;

create table if not exists public.board_columns (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  name text not null, color text,
  sort_order int not null default 0,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
do $$ begin
  if not exists (select 1 from pg_indexes where indexname = 'idx_board_columns_board') then create index idx_board_columns_board on public.board_columns(board_id); end if;
end $$;

create table if not exists public.board_cards (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  column_id uuid not null references public.board_columns(id) on delete cascade,
  title text not null, description text,
  assignee_id uuid references public.profiles(id),
  due_date date, color text,
  sort_order int not null default 0,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
do $$ begin
  if not exists (select 1 from pg_indexes where indexname = 'idx_board_cards_column') then create index idx_board_cards_column on public.board_cards(column_id); end if;
  if not exists (select 1 from pg_indexes where indexname = 'idx_board_cards_board') then create index idx_board_cards_board on public.board_cards(board_id); end if;
end $$;

create table if not exists public.board_members (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'editor',
  created_at timestamptz default now()
);
do $$ begin
  if not exists (select 1 from pg_indexes where indexname = 'idx_board_members_board') then create index idx_board_members_board on public.board_members(board_id); end if;
  if not exists (select 1 from pg_indexes where indexname = 'idx_board_members_user') then create index idx_board_members_user on public.board_members(user_id); end if;
  if not exists (select 1 from pg_constraint where conname = 'board_members_board_user_unique' and conrelid = 'public.board_members'::regclass) then
    alter table public.board_members add constraint board_members_board_user_unique unique (board_id, user_id);
  end if;
end $$;

alter table public.boards enable row level security;
alter table public.board_columns enable row level security;
alter table public.board_cards enable row level security;
alter table public.board_members enable row level security;

drop policy if exists "Board select" on public.boards;
create policy "Board select" on public.boards for select to authenticated using (
  created_by = auth.uid() or visibility = 'everyone'
  or (visibility = 'members' and exists (select 1 from public.board_members where board_members.board_id = boards.id and board_members.user_id = auth.uid()))
);
drop policy if exists "Board insert" on public.boards;
create policy "Board insert" on public.boards for insert to authenticated with check (created_by = auth.uid());
drop policy if exists "Board update" on public.boards;
create policy "Board update" on public.boards for update to authenticated using (created_by = auth.uid());
drop policy if exists "Board delete" on public.boards;
create policy "Board delete" on public.boards for delete to authenticated using (created_by = auth.uid());
drop policy if exists "Authenticated board_columns" on public.board_columns;
create policy "Authenticated board_columns" on public.board_columns for all to authenticated using (true) with check (true);
drop policy if exists "Authenticated board_cards" on public.board_cards;
create policy "Authenticated board_cards" on public.board_cards for all to authenticated using (true) with check (true);
drop policy if exists "Authenticated board_members" on public.board_members;
create policy "Authenticated board_members" on public.board_members for all to authenticated using (true) with check (true);

-- Migration 28: Job deliveries
create table if not exists public.deliveries (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  delivery_number int not null default 1,
  delivered_at date not null default current_date,
  carrier text, tracking_number text, recipient_name text, notes text,
  line_items jsonb not null default '[]',
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(), updated_at timestamptz default now()
);
do $$ begin
  if not exists (select 1 from pg_indexes where indexname = 'idx_deliveries_job') then create index idx_deliveries_job on public.deliveries(job_id); end if;
  if not exists (select 1 from pg_indexes where indexname = 'idx_deliveries_date') then create index idx_deliveries_date on public.deliveries(delivered_at desc); end if;
  if not exists (select 1 from pg_constraint where conname = 'deliveries_job_number_unique' and conrelid = 'public.deliveries'::regclass) then
    alter table public.deliveries add constraint deliveries_job_number_unique unique (job_id, delivery_number);
  end if;
end $$;
alter table public.deliveries enable row level security;
drop policy if exists "Authenticated deliveries" on public.deliveries;
create policy "Authenticated deliveries" on public.deliveries for all to authenticated using (true) with check (true);

-- Migration 29: Board card attachments (adds board_card_id + final owner constraint)
alter table public.attachments add column if not exists board_card_id uuid references public.board_cards(id) on delete cascade;
do $$ begin
  if not exists (select 1 from pg_indexes where indexname = 'idx_attachments_board_card') then
    create index idx_attachments_board_card on public.attachments(board_card_id) where board_card_id is not null;
  end if;
end $$;
alter table public.attachments drop constraint if exists attachments_one_owner_check;
alter table public.attachments add constraint attachments_one_owner_check check (
  (job_id is not null and inventory_id is null and part_id is null and board_card_id is null) or
  (job_id is null and inventory_id is not null and part_id is null and board_card_id is null) or
  (job_id is null and inventory_id is null and part_id is not null and board_card_id is null) or
  (job_id is null and inventory_id is null and part_id is null and board_card_id is not null)
);

-- Migration 30: Job status history
create table if not exists public.job_status_history (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  previous_status text not null,
  new_status text not null,
  created_at timestamptz default now()
);
do $$ begin
  if not exists (select 1 from pg_indexes where indexname = 'idx_job_status_history_job') then create index idx_job_status_history_job on public.job_status_history(job_id); end if;
  if not exists (select 1 from pg_indexes where indexname = 'idx_job_status_history_created') then create index idx_job_status_history_created on public.job_status_history(created_at desc); end if;
end $$;
alter table public.job_status_history enable row level security;
drop policy if exists "Admin select job status history" on public.job_status_history;
create policy "Admin select job status history" on public.job_status_history for select to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true));
drop policy if exists "Authenticated insert job status history" on public.job_status_history;
create policy "Authenticated insert job status history" on public.job_status_history for insert to authenticated with check (true);

-- Migration 31: E2E encrypted chat (with SECURITY DEFINER fixes from Migration 34 applied inline)
create table if not exists public.user_encryption_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  public_key text not null, encrypted_private_key text not null,
  key_salt text not null, key_iv text not null,
  algorithm text not null default 'ECDH-P256-AES-GCM',
  created_at timestamptz default now(), updated_at timestamptz default now()
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'user_encryption_keys_user_unique') then
    alter table public.user_encryption_keys add constraint user_encryption_keys_user_unique unique (user_id);
  end if;
end $$;

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'direct', name text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists public.conversation_members (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  encrypted_conversation_key text, key_iv text,
  role text not null default 'member',
  joined_at timestamptz default now(), left_at timestamptz
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'conversation_members_conv_user_unique') then
    alter table public.conversation_members add constraint conversation_members_conv_user_unique unique (conversation_id, user_id);
  end if;
end $$;

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  encrypted_content text not null, content_iv text not null,
  message_type text not null default 'text',
  created_at timestamptz default now(), updated_at timestamptz default now(), deleted_at timestamptz
);

create table if not exists public.message_receipts (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  delivered_at timestamptz, read_at timestamptz
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'message_receipts_msg_user_unique') then
    alter table public.message_receipts add constraint message_receipts_msg_user_unique unique (message_id, user_id);
  end if;
end $$;

create table if not exists public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  storage_path text not null, encrypted_file_key text not null,
  file_key_iv text not null, file_iv text not null,
  file_name text not null, file_size bigint not null,
  mime_type text not null default 'application/octet-stream'
);

-- Chat helper functions (SECURITY DEFINER to avoid RLS recursion)
create or replace function public.is_conversation_member(conv_id uuid) returns boolean language sql stable security definer as $$
  select exists (select 1 from public.conversation_members where conversation_id = conv_id and user_id = auth.uid() and left_at is null);
$$;

create or replace function public.find_direct_conversation(user_a uuid, user_b uuid) returns uuid language sql stable security definer as $$
  select cm1.conversation_id from public.conversation_members cm1
  join public.conversation_members cm2 on cm1.conversation_id = cm2.conversation_id
  join public.conversations c on c.id = cm1.conversation_id
  where cm1.user_id = user_a and cm2.user_id = user_b and c.type = 'direct' and cm1.left_at is null and cm2.left_at is null limit 1;
$$;

create or replace function public.update_conversation_timestamp() returns trigger security definer as $$
begin update public.conversations set updated_at = now() where id = new.conversation_id; return new; end;
$$ language plpgsql;
drop trigger if exists on_message_insert_update_conversation on public.messages;
create trigger on_message_insert_update_conversation after insert on public.messages for each row execute function public.update_conversation_timestamp();

alter table public.user_encryption_keys enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.message_receipts enable row level security;
alter table public.message_attachments enable row level security;

drop policy if exists "Own keys full access" on public.user_encryption_keys;
create policy "Own keys full access" on public.user_encryption_keys for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "Read public keys" on public.user_encryption_keys;
create policy "Read public keys" on public.user_encryption_keys for select to authenticated using (public.is_approved_user());

drop policy if exists "Members read conversations" on public.conversations;
create policy "Members read conversations" on public.conversations for select to authenticated
  using (public.is_approved_user() and (created_by = auth.uid() or exists (select 1 from public.conversation_members where conversation_id = id and user_id = auth.uid() and left_at is null)));
drop policy if exists "Approved users create conversations" on public.conversations;
create policy "Approved users create conversations" on public.conversations for insert to authenticated with check (public.is_approved_user() and created_by = auth.uid());
drop policy if exists "Conv admins update conversations" on public.conversations;
create policy "Conv admins update conversations" on public.conversations for update to authenticated
  using (public.is_approved_user() and exists (select 1 from public.conversation_members where conversation_id = id and user_id = auth.uid() and role = 'admin' and left_at is null));

drop policy if exists "Members read conversation_members" on public.conversation_members;
create policy "Members read conversation_members" on public.conversation_members for select to authenticated using (public.is_approved_user() and public.is_conversation_member(conversation_id));
drop policy if exists "Add conversation members" on public.conversation_members;
create policy "Add conversation members" on public.conversation_members for insert to authenticated with check (public.is_approved_user());
drop policy if exists "Update conversation members" on public.conversation_members;
create policy "Update conversation members" on public.conversation_members for update to authenticated
  using (public.is_approved_user() and (user_id = auth.uid() or exists (select 1 from public.conversation_members where conversation_id = conversation_members.conversation_id and user_id = auth.uid() and role = 'admin' and left_at is null)));

drop policy if exists "Members read messages" on public.messages;
create policy "Members read messages" on public.messages for select to authenticated using (public.is_approved_user() and public.is_conversation_member(conversation_id));
drop policy if exists "Members send messages" on public.messages;
create policy "Members send messages" on public.messages for insert to authenticated with check (public.is_approved_user() and sender_id = auth.uid() and public.is_conversation_member(conversation_id));
drop policy if exists "Sender update own messages" on public.messages;
create policy "Sender update own messages" on public.messages for update to authenticated using (public.is_approved_user() and sender_id = auth.uid());

drop policy if exists "Members read receipts" on public.message_receipts;
create policy "Members read receipts" on public.message_receipts for select to authenticated
  using (public.is_approved_user() and exists (select 1 from public.messages m where m.id = message_id and public.is_conversation_member(m.conversation_id)));
drop policy if exists "Users insert own receipts" on public.message_receipts;
create policy "Users insert own receipts" on public.message_receipts for insert to authenticated with check (public.is_approved_user() and user_id = auth.uid());
drop policy if exists "Users update own receipts" on public.message_receipts;
create policy "Users update own receipts" on public.message_receipts for update to authenticated using (public.is_approved_user() and user_id = auth.uid());

drop policy if exists "Members read message_attachments" on public.message_attachments;
create policy "Members read message_attachments" on public.message_attachments for select to authenticated
  using (public.is_approved_user() and exists (select 1 from public.messages m where m.id = message_id and public.is_conversation_member(m.conversation_id)));
drop policy if exists "Sender insert message_attachments" on public.message_attachments;
create policy "Sender insert message_attachments" on public.message_attachments for insert to authenticated
  with check (public.is_approved_user() and exists (select 1 from public.messages m where m.id = message_id and m.sender_id = auth.uid()));

drop policy if exists "Chat attachments: member upload" on storage.objects;
create policy "Chat attachments: member upload" on storage.objects for insert to authenticated with check (bucket_id = 'chat-attachments' and public.is_approved_user());
drop policy if exists "Chat attachments: member read" on storage.objects;
create policy "Chat attachments: member read" on storage.objects for select to authenticated using (bucket_id = 'chat-attachments' and public.is_approved_user());
drop policy if exists "Chat attachments: member delete" on storage.objects;
create policy "Chat attachments: member delete" on storage.objects for delete to authenticated using (bucket_id = 'chat-attachments' and public.is_approved_user());

-- Migration 32: System notifications
create table if not exists public.system_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null, title text not null, message text not null,
  link text, metadata jsonb default '{}', read_at timestamptz,
  created_at timestamptz default now()
);
do $$ begin
  if not exists (select 1 from pg_indexes where indexname = 'idx_sn_user_created') then create index idx_sn_user_created on public.system_notifications(user_id, created_at desc); end if;
  if not exists (select 1 from pg_indexes where indexname = 'idx_sn_user_unread') then create index idx_sn_user_unread on public.system_notifications(user_id) where read_at is null; end if;
end $$;
alter table public.system_notifications enable row level security;
drop policy if exists "Users read own notifications" on public.system_notifications;
create policy "Users read own notifications" on public.system_notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists "Approved users insert notifications" on public.system_notifications;
create policy "Approved users insert notifications" on public.system_notifications for insert to authenticated with check (public.is_approved_user());
drop policy if exists "Users update own notifications" on public.system_notifications;
create policy "Users update own notifications" on public.system_notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'system_notifications') then
    alter publication supabase_realtime add table public.system_notifications;
  end if;
end $$;

create or replace function public.notify_job_status_change() returns trigger language plpgsql security definer set search_path = public as $$
declare v_job record; v_changer_name text; v_user_id uuid;
begin
  select id, job_code, name, assigned_users into v_job from public.jobs where id = NEW.job_id;
  if v_job is null or v_job.assigned_users is null or array_length(v_job.assigned_users, 1) is null then return NEW; end if;
  select coalesce(name, email, 'Someone') into v_changer_name from public.profiles where id = NEW.user_id;
  foreach v_user_id in array v_job.assigned_users loop
    if v_user_id = NEW.user_id then continue; end if;
    insert into public.system_notifications (user_id, type, title, message, link, metadata) values (
      v_user_id, 'status_change', 'Job Status Changed',
      'Job #' || v_job.job_code || ' moved from ' || NEW.previous_status || ' to ' || NEW.new_status || ' by ' || v_changer_name,
      'job-detail:' || v_job.id::text,
      jsonb_build_object('job_id', v_job.id, 'job_code', v_job.job_code, 'previous_status', NEW.previous_status, 'new_status', NEW.new_status)
    );
  end loop;
  return NEW;
end; $$;
drop trigger if exists trg_notify_job_status_change on public.job_status_history;
create trigger trg_notify_job_status_change after insert on public.job_status_history for each row execute function public.notify_job_status_change();

create or replace function public.notify_low_stock() returns trigger language plpgsql security definer set search_path = public as $$
declare v_admin record;
begin
  if NEW.reorder_point is null or NEW.reorder_point <= 0 then return NEW; end if;
  if NEW.available > NEW.reorder_point then return NEW; end if;
  if OLD.available <= OLD.reorder_point and OLD.reorder_point > 0 then return NEW; end if;
  for v_admin in select id from public.profiles where is_admin = true and is_approved = true loop
    insert into public.system_notifications (user_id, type, title, message, link, metadata) values (
      v_admin.id, 'low_stock', 'Low Stock Alert',
      'Low stock: ' || NEW.name || ' (' || NEW.available || ' available, reorder point: ' || NEW.reorder_point || ')',
      'inventory-detail:' || NEW.id::text,
      jsonb_build_object('inventory_id', NEW.id, 'available', NEW.available, 'reorder_point', NEW.reorder_point)
    );
  end loop;
  return NEW;
end; $$;
drop trigger if exists trg_notify_low_stock on public.inventory;
create trigger trg_notify_low_stock after update of available on public.inventory for each row execute function public.notify_low_stock();

create or replace function public.notify_mention(p_mentioned_user_id uuid, p_job_id uuid, p_commenter_name text, p_job_code int, p_comment_preview text) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.system_notifications (user_id, type, title, message, link, metadata) values (
    p_mentioned_user_id, 'comment_mention', 'Mentioned in Comment',
    p_commenter_name || ' mentioned you on Job #' || p_job_code || ': "' || left(p_comment_preview, 100) || '"',
    'job-detail:' || p_job_id::text,
    jsonb_build_object('job_id', p_job_id, 'job_code', p_job_code, 'commenter_name', p_commenter_name)
  );
end; $$;

-- Migration 33: Allocation guard (final version — supersedes Migration 24 initial version)
CREATE OR REPLACE FUNCTION public.job_inventory_allocate_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_inventory_id uuid; v_quantity numeric; v_in_stock int; v_allocated numeric;
  v_job_status text;
  v_active_statuses text[] := ARRAY['pod','rush','pending','inProgress','qualityControl','onHold'];
  v_consumed_statuses text[] := ARRAY['finished','delivered','waitingForPayment','projectCompleted','paid'];
BEGIN
  IF tg_op = 'INSERT' THEN v_inventory_id := NEW.inventory_id; v_quantity := NEW.quantity;
  ELSE v_inventory_id := NEW.inventory_id; v_quantity := NEW.quantity - OLD.quantity; END IF;
  SELECT status INTO v_job_status FROM public.jobs WHERE id = NEW.job_id;
  IF v_job_status = ANY(v_consumed_statuses) THEN RAISE EXCEPTION 'job_is_consumed: cannot allocate inventory to job in status %', v_job_status; END IF;
  SELECT in_stock INTO v_in_stock FROM public.inventory WHERE id = v_inventory_id FOR UPDATE;
  IF v_in_stock IS NULL THEN RAISE EXCEPTION 'inventory_not_found: % does not exist', v_inventory_id; END IF;
  SELECT COALESCE(SUM(ji.quantity), 0) INTO v_allocated FROM public.job_inventory ji JOIN public.jobs j ON j.id = ji.job_id
    WHERE ji.inventory_id = v_inventory_id AND j.status = ANY(v_active_statuses) AND ji.id IS DISTINCT FROM NEW.id;
  IF v_allocated + v_quantity > v_in_stock THEN
    RAISE EXCEPTION 'insufficient_available_stock: % in stock, % allocated, % available', v_in_stock, v_allocated, v_in_stock - v_allocated;
  END IF;
  RETURN NEW;
END$$;
drop trigger if exists job_inventory_allocate_guard_trigger on public.job_inventory;
create trigger job_inventory_allocate_guard_trigger before insert or update of quantity, inventory_id on public.job_inventory for each row execute function public.job_inventory_allocate_guard();

-- Migration 34: Inventory reconciliation trigger
ALTER TABLE public.inventory_history ALTER COLUMN user_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.is_consumed_status(s text) RETURNS boolean
  LANGUAGE sql IMMUTABLE SET search_path = public, pg_catalog AS $$
    SELECT s IN ('finished', 'delivered', 'waitingForPayment', 'projectCompleted', 'paid')
  $$;

CREATE OR REPLACE FUNCTION public.is_production_status(s text) RETURNS boolean
  LANGUAGE sql IMMUTABLE SET search_path = public, pg_catalog AS $$
    SELECT s IN ('pod','rush','pending','inProgress','qualityControl')
  $$;

-- Migration 35: Jobs consumed_at sentinel + hardened reconciliation trigger
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ DEFAULT NULL;

UPDATE public.jobs j SET consumed_at = ih.first_reconcile_at
FROM (SELECT related_job_id, MIN(created_at) AS first_reconcile_at FROM public.inventory_history WHERE action = 'reconcile_job' GROUP BY related_job_id) ih
WHERE j.id = ih.related_job_id AND j.status IN ('finished', 'delivered', 'waitingForPayment', 'projectCompleted', 'paid') AND j.consumed_at IS NULL;

CREATE OR REPLACE FUNCTION public.jobs_reconcile_inventory_on_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  r RECORD; sgn INT; v_consumed TIMESTAMPTZ;
  current_stock NUMERIC; new_stock NUMERIC; prev_available NUMERIC; new_available NUMERIC;
BEGIN
  IF NOT is_consumed_status(OLD.status) AND is_consumed_status(NEW.status) THEN sgn := -1;
  ELSIF is_consumed_status(OLD.status) AND NOT is_consumed_status(NEW.status) AND is_production_status(NEW.status) THEN sgn := 1;
  ELSE RETURN NEW; END IF;
  v_consumed := OLD.consumed_at;
  IF sgn = -1 THEN IF v_consumed IS NOT NULL THEN RETURN NEW; END IF;
  ELSE IF v_consumed IS NULL THEN RETURN NEW; END IF; END IF;
  FOR r IN SELECT inventory_id, quantity FROM public.job_inventory WHERE job_id = NEW.id AND quantity IS NOT NULL AND quantity > 0 ORDER BY inventory_id LOOP
    SELECT in_stock, available INTO current_stock, prev_available FROM public.inventory WHERE id = r.inventory_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'inventory_missing: inventory row % not found', r.inventory_id; END IF;
    IF sgn = -1 AND current_stock + ROUND(sgn * r.quantity)::INT < 0 THEN
      RAISE EXCEPTION 'insufficient_stock: inventory % has % in stock, job needs %', r.inventory_id, current_stock, r.quantity USING ERRCODE = 'check_violation';
    END IF;
    UPDATE public.inventory SET in_stock = in_stock + ROUND(sgn * r.quantity)::INT, available = available + ROUND(sgn * r.quantity)::INT, updated_at = NOW() WHERE id = r.inventory_id RETURNING in_stock, available INTO new_stock, new_available;
    INSERT INTO public.inventory_history (inventory_id, user_id, action, reason, previous_in_stock, new_in_stock, change_amount, related_job_id, previous_available, new_available)
    VALUES (r.inventory_id, auth.uid(), CASE WHEN sgn = -1 THEN 'reconcile_job' ELSE 'reconcile_job_reversal' END,
      'Job #' || NEW.job_code || ': ' || OLD.status || ' -> ' || NEW.status, current_stock, new_stock, ROUND(sgn * r.quantity), NEW.id, prev_available, new_available);
  END LOOP;
  IF sgn = -1 THEN
    UPDATE public.jobs SET consumed_at = NOW() WHERE id = NEW.id AND consumed_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'consumed_at_race: job % — sentinel write matched 0 rows', NEW.id; END IF;
  ELSE
    UPDATE public.jobs SET consumed_at = NULL WHERE id = NEW.id AND consumed_at IS NOT NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'consumed_at_race_reversal: job % — sentinel clear matched 0 rows', NEW.id; END IF;
  END IF;
  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS jobs_reconcile_inventory_on_status_trg ON public.jobs;
CREATE TRIGGER jobs_reconcile_inventory_on_status_trg AFTER UPDATE OF status ON public.jobs FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION public.jobs_reconcile_inventory_on_status();

-- Migration 36: Job inventory consumed guard
CREATE OR REPLACE FUNCTION public.job_inventory_no_mutate_on_consumed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM public.jobs WHERE id = NEW.job_id FOR UPDATE;
  IF FOUND AND is_consumed_status(v_status) THEN
    RAISE EXCEPTION 'job_is_consumed: cannot mutate job_inventory for job % in status %', NEW.job_id, v_status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION public.job_inventory_no_mutate_on_consumed() FROM PUBLIC;
DROP TRIGGER IF EXISTS job_inventory_insert_consumed_guard_trg ON public.job_inventory;
CREATE TRIGGER job_inventory_insert_consumed_guard_trg BEFORE INSERT ON public.job_inventory FOR EACH ROW EXECUTE FUNCTION public.job_inventory_no_mutate_on_consumed();
DROP TRIGGER IF EXISTS job_inventory_update_consumed_guard_trg ON public.job_inventory;
CREATE TRIGGER job_inventory_update_consumed_guard_trg BEFORE UPDATE OF quantity, inventory_id, job_id ON public.job_inventory FOR EACH ROW EXECUTE FUNCTION public.job_inventory_no_mutate_on_consumed();

-- Migration 37: Notification preferences
create table if not exists public.user_notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  preferences jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);
do $$ begin
  if not exists (select 1 from pg_indexes where indexname = 'idx_unp_updated') then create index idx_unp_updated on public.user_notification_preferences(updated_at desc); end if;
end $$;
alter table public.user_notification_preferences enable row level security;
drop policy if exists "Users read own preferences" on public.user_notification_preferences;
create policy "Users read own preferences" on public.user_notification_preferences for select to authenticated using (user_id = auth.uid());
drop policy if exists "Users update own preferences" on public.user_notification_preferences;
create policy "Users update own preferences" on public.user_notification_preferences for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "Approved users insert own preferences" on public.user_notification_preferences;
create policy "Approved users insert own preferences" on public.user_notification_preferences for insert to authenticated with check (user_id = auth.uid() and public.is_approved_user());
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_notification_preferences') then
    alter publication supabase_realtime add table public.user_notification_preferences;
  end if;
end $$;

create or replace function public.build_default_notification_preferences(p_is_admin boolean default false) returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'in_app', jsonb_build_object('status_change', true, 'assignment', true, 'unassignment', true, 'rush', true, 'overdue', true, 'comment_mention', true, 'checklist_complete', true, 'delivery_update', true, 'variant_update', true, 'low_stock', true, 'critical_stock', p_is_admin, 'allocation_complete', p_is_admin, 'allocation_reversal', p_is_admin, 'reorder_point_hit', true, 'shift_edit_approved', true, 'shift_edit_requested', true, 'clock_anomaly', true, 'lunch_break_reminder', true, 'chat_mention', true, 'new_direct_message', true, 'thread_reply', true, 'new_user_pending_approval', p_is_admin, 'user_approved', true, 'user_rejected', true, 'proposal_submitted', p_is_admin, 'new_customer_proposal', true, 'quote_assigned', true, 'quote_updated', true, 'delivery_scheduled', true, 'delivery_completed', true, 'delivery_delayed', true, 'daily_summary', false, 'system_alert', true, 'maintenance_notice', false),
    'email', jsonb_build_object('status_change', false, 'assignment', false, 'unassignment', false, 'rush', false, 'overdue', false, 'comment_mention', false, 'checklist_complete', false, 'delivery_update', false, 'variant_update', false, 'low_stock', false, 'critical_stock', false, 'allocation_complete', false, 'allocation_reversal', false, 'reorder_point_hit', false, 'shift_edit_approved', false, 'shift_edit_requested', false, 'clock_anomaly', false, 'lunch_break_reminder', false, 'chat_mention', false, 'new_direct_message', false, 'thread_reply', false, 'new_user_pending_approval', false, 'user_approved', false, 'user_rejected', false, 'proposal_submitted', false, 'new_customer_proposal', false, 'quote_assigned', false, 'quote_updated', false, 'delivery_scheduled', false, 'delivery_completed', false, 'delivery_delayed', false, 'daily_summary', false, 'system_alert', false, 'maintenance_notice', false)
  );
$$;

create or replace function public.create_default_notification_preferences() returns trigger language plpgsql security definer set search_path = public as $$
begin insert into public.user_notification_preferences (user_id, preferences) values (NEW.id, public.build_default_notification_preferences(NEW.is_admin)) on conflict (user_id) do nothing; return NEW; end; $$;
drop trigger if exists trg_create_notification_preferences on public.profiles;
create trigger trg_create_notification_preferences after insert on public.profiles for each row execute function public.create_default_notification_preferences();

insert into public.user_notification_preferences (user_id, preferences)
select p.id, public.build_default_notification_preferences(p.is_admin) from public.profiles p
where not exists (select 1 from public.user_notification_preferences unp where unp.user_id = p.id)
on conflict (user_id) do nothing;

create or replace function public.should_notify(p_user_id uuid, p_notif_type text, p_channel text default 'in_app') returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select (preferences -> p_channel ->> p_notif_type)::boolean from public.user_notification_preferences where user_id = p_user_id), true);
$$;

-- Migration 38: Dashboard preferences
create table if not exists public.user_dashboard_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  preferences jsonb not null default '{"quickActionOrder":[],"hiddenQuickActions":[]}'::jsonb,
  updated_at timestamptz default now()
);
do $$ begin
  if not exists (select 1 from pg_indexes where indexname = 'idx_udp_updated') then create index idx_udp_updated on public.user_dashboard_preferences(updated_at desc); end if;
end $$;
alter table public.user_dashboard_preferences enable row level security;
drop policy if exists "Users read own dashboard preferences" on public.user_dashboard_preferences;
create policy "Users read own dashboard preferences" on public.user_dashboard_preferences for select to authenticated using (user_id = auth.uid());
drop policy if exists "Users update own dashboard preferences" on public.user_dashboard_preferences;
create policy "Users update own dashboard preferences" on public.user_dashboard_preferences for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "Approved users insert own dashboard preferences" on public.user_dashboard_preferences;
create policy "Approved users insert own dashboard preferences" on public.user_dashboard_preferences for insert to authenticated with check (user_id = auth.uid() and public.is_approved_user());
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_dashboard_preferences') then
    alter publication supabase_realtime add table public.user_dashboard_preferences;
  end if;
end $$;

create or replace function public.create_default_dashboard_preferences() returns trigger language plpgsql security definer set search_path = public as $$
begin insert into public.user_dashboard_preferences (user_id, preferences) values (NEW.id, '{"quickActionOrder":[],"hiddenQuickActions":[]}'::jsonb) on conflict (user_id) do nothing; return NEW; end; $$;
drop trigger if exists trg_create_dashboard_preferences on public.profiles;
create trigger trg_create_dashboard_preferences after insert on public.profiles for each row execute function public.create_default_dashboard_preferences();
insert into public.user_dashboard_preferences (user_id, preferences)
select p.id, '{"quickActionOrder":[],"hiddenQuickActions":[]}'::jsonb from public.profiles p
where not exists (select 1 from public.user_dashboard_preferences udp where udp.user_id = p.id) on conflict (user_id) do nothing;

-- Migration 39: Fix part_materials dual-column schema
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'part_materials' AND column_name = 'quantity')
  AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'part_materials' AND column_name = 'quantity_per_unit') THEN
    UPDATE public.part_materials SET quantity_per_unit = quantity WHERE quantity_per_unit = 1 AND quantity != 1 AND quantity IS NOT NULL;
    UPDATE public.part_materials SET quantity = quantity_per_unit WHERE quantity != quantity_per_unit;
    ALTER TABLE public.part_materials ALTER COLUMN quantity SET DEFAULT 0;
    CREATE OR REPLACE FUNCTION public.sync_part_material_quantity() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF NEW.quantity_per_unit IS NOT NULL THEN NEW.quantity := NEW.quantity_per_unit;
      ELSIF NEW.quantity IS NOT NULL THEN NEW.quantity_per_unit := NEW.quantity; END IF;
      RETURN NEW;
    END; $fn$;
    DROP TRIGGER IF EXISTS part_materials_sync_quantity_trg ON public.part_materials;
    CREATE TRIGGER part_materials_sync_quantity_trg BEFORE INSERT OR UPDATE OF quantity, quantity_per_unit ON public.part_materials FOR EACH ROW EXECUTE FUNCTION public.sync_part_material_quantity();
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'part_materials' AND column_name = 'quantity')
  AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'part_materials' AND column_name = 'quantity_per_unit') THEN
    ALTER TABLE public.part_materials ADD COLUMN quantity_per_unit numeric NOT NULL DEFAULT 1;
    UPDATE public.part_materials SET quantity_per_unit = quantity;
  END IF;
END $$;

-- ============================================
-- MIGRATIONS COMPLETE
-- ============================================

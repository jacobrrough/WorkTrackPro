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

-- Allow part_id as alternative to job_id/inventory_id (exactly one of job_id, inventory_id, part_id)
alter table public.attachments drop constraint if exists attachments_job_or_inventory_check;
alter table public.attachments drop constraint if exists attachments_one_owner_check;
alter table public.attachments add constraint attachments_one_owner_check check (
  (job_id is not null and inventory_id is null and part_id is null) or
  (job_id is null and inventory_id is not null and part_id is null) or
  (job_id is null and inventory_id is null and part_id is not null)
);

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

-- ============================================
-- MIGRATIONS COMPLETE
-- ============================================

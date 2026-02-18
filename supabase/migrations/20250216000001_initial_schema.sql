-- WorkTrack Pro: Initial schema for Supabase
-- Run in Supabase SQL Editor or via supabase db push
--
-- This migration is IDEMPOTENT - safe to run multiple times.
-- It uses IF NOT EXISTS for tables, checks for existence before creating indexes/policies,
-- and handles existing constraints gracefully.

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Profiles (extends auth.users: name, initials, is_admin)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  initials text,
  is_admin boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Jobs
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  job_code int not null unique,
  po text,
  name text not null default '',
  qty text,
  description text,
  ecd text,
  due_date date,
  labor_hours numeric,
  active boolean not null default true,
  status text not null default 'pending',
  board_type text default 'shopFloor',
  created_by uuid references public.profiles(id),
  assigned_users uuid[] default '{}',
  is_rush boolean not null default false,
  workers text[] default '{}',
  bin_location text,
  part_number text,
  variant_suffix text, -- e.g., "01", "02" if job uses a specific variant
  est_number text, -- EST# (Estimate number)
  inv_number text, -- INV# (Invoice number)
  rfq_number text, -- RFQ# (Request for Quote number)
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Create indexes only if they don't exist (PostgreSQL doesn't support IF NOT EXISTS for indexes)
do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'idx_jobs_status') then
    create index idx_jobs_status on public.jobs(status);
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'idx_jobs_created_at') then
    create index idx_jobs_created_at on public.jobs(created_at desc);
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'idx_jobs_board_type') then
    create index idx_jobs_board_type on public.jobs(board_type);
  end if;
end $$;

-- Inventory
create table if not exists public.inventory (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  category text not null default 'miscSupplies',
  in_stock int not null default 0,
  available int not null default 0,
  disposed int not null default 0,
  on_order int not null default 0,
  reorder_point int,
  price numeric,
  unit text not null default 'units',
  has_image boolean not null default false,
  image_path text,
  barcode text,
  bin_location text,
  vendor text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'idx_inventory_name') then
    create index idx_inventory_name on public.inventory(name);
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'idx_inventory_category') then
    create index idx_inventory_category on public.inventory(category);
  end if;
end $$;

-- Job-inventory link
create table if not exists public.job_inventory (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  inventory_id uuid not null references public.inventory(id),
  quantity numeric not null,
  unit text not null default 'units',
  created_at timestamptz default now()
);

do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'idx_job_inventory_job') then
    create index idx_job_inventory_job on public.job_inventory(job_id);
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'idx_job_inventory_inventory') then
    create index idx_job_inventory_inventory on public.job_inventory(inventory_id);
  end if;
end $$;

-- Shifts
create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  job_id uuid not null references public.jobs(id),
  clock_in_time timestamptz not null,
  clock_out_time timestamptz,
  notes text,
  created_at timestamptz default now()
);

do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'idx_shifts_user') then
    create index idx_shifts_user on public.shifts(user_id);
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'idx_shifts_job') then
    create index idx_shifts_job on public.shifts(job_id);
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'idx_shifts_clock_in') then
    create index idx_shifts_clock_in on public.shifts(clock_in_time desc);
  end if;
end $$;

-- Shift edits (admin audit)
create table if not exists public.shift_edits (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts(id) on delete cascade,
  edited_by uuid not null references public.profiles(id),
  previous_clock_in timestamptz not null,
  new_clock_in timestamptz not null,
  previous_clock_out timestamptz,
  new_clock_out timestamptz,
  reason text,
  edit_timestamp timestamptz default now()
);

-- Comments
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  text text not null,
  created_at timestamptz default now()
);

do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'idx_comments_job') then
    create index idx_comments_job on public.comments(job_id);
  end if;
end $$;

-- Attachments (file path in Storage; bucket 'attachments')
create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  filename text not null,
  storage_path text not null,
  is_admin_only boolean not null default false,
  created_at timestamptz default now()
);

do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'idx_attachments_job') then
    create index idx_attachments_job on public.attachments(job_id);
  end if;
end $$;

-- Checklists (items = jsonb). job_id null = template checklist
create table if not exists public.checklists (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.jobs(id) on delete cascade,
  status text not null,
  items jsonb not null default '[]',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'idx_checklists_job') then
    create index idx_checklists_job on public.checklists(job_id);
  end if;
end $$;

-- Checklist history
create table if not exists public.checklist_history (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references public.checklists(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  item_index int not null,
  item_text text,
  checked boolean not null,
  created_at timestamptz default now()
);

-- Quotes (line_items, reference_job_ids as jsonb)
create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  product_name text not null,
  description text,
  material_cost numeric not null default 0,
  labor_hours numeric not null default 0,
  labor_rate numeric not null default 0,
  labor_cost numeric not null default 0,
  markup_percent numeric not null default 0,
  subtotal numeric not null default 0,
  markup_amount numeric not null default 0,
  total numeric not null default 0,
  line_items jsonb not null default '[]',
  reference_job_ids uuid[] default '{}',
  notes text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'idx_quotes_created_at') then
    create index idx_quotes_created_at on public.quotes(created_at desc);
  end if;
end $$;

-- Inventory history
create table if not exists public.inventory_history (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null references public.inventory(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  action text not null,
  reason text not null default '',
  previous_in_stock numeric not null,
  new_in_stock numeric not null,
  previous_available numeric,
  new_available numeric,
  change_amount numeric not null,
  related_job_id uuid references public.jobs(id),
  related_po text,
  created_at timestamptz default now()
);

do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'idx_inventory_history_inventory') then
    create index idx_inventory_history_inventory on public.inventory_history(inventory_id);
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'idx_inventory_history_created') then
    create index idx_inventory_history_created on public.inventory_history(created_at desc);
  end if;
end $$;

-- Trigger: create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, name, initials, is_admin)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'initials', upper(left(split_part(new.email, '@', 1), 2))),
    coalesce((new.raw_user_meta_data->>'is_admin')::boolean, false)
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- RLS: enable on all tables (idempotent - safe to run multiple times, won't error if already enabled)
alter table public.profiles enable row level security;
alter table public.jobs enable row level security;
alter table public.inventory enable row level security;
alter table public.job_inventory enable row level security;
alter table public.shifts enable row level security;
alter table public.shift_edits enable row level security;
alter table public.comments enable row level security;
alter table public.attachments enable row level security;
alter table public.checklists enable row level security;
alter table public.checklist_history enable row level security;
alter table public.quotes enable row level security;
alter table public.inventory_history enable row level security;

-- Policies: authenticated users can read/write (simplified; tighten per table if needed)
drop policy if exists "Users can read all profiles" on public.profiles;
create policy "Users can read all profiles" on public.profiles for select to authenticated using (true);
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile" on public.profiles for update to authenticated using (auth.uid() = id);

drop policy if exists "Authenticated read jobs" on public.jobs;
create policy "Authenticated read jobs" on public.jobs for select to authenticated using (true);
drop policy if exists "Authenticated insert jobs" on public.jobs;
create policy "Authenticated insert jobs" on public.jobs for insert to authenticated with check (true);
drop policy if exists "Authenticated update jobs" on public.jobs;
create policy "Authenticated update jobs" on public.jobs for update to authenticated using (true);
drop policy if exists "Admin delete jobs" on public.jobs;
create policy "Admin delete jobs" on public.jobs for delete to authenticated using (
  exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
);

drop policy if exists "Authenticated inventory" on public.inventory;
create policy "Authenticated inventory" on public.inventory for all to authenticated using (true) with check (true);
drop policy if exists "Authenticated job_inventory" on public.job_inventory;
create policy "Authenticated job_inventory" on public.job_inventory for all to authenticated using (true) with check (true);
drop policy if exists "Authenticated shifts" on public.shifts;
create policy "Authenticated shifts" on public.shifts for all to authenticated using (true) with check (true);
drop policy if exists "Authenticated shift_edits" on public.shift_edits;
create policy "Authenticated shift_edits" on public.shift_edits for all to authenticated using (true) with check (true);
drop policy if exists "Authenticated comments" on public.comments;
create policy "Authenticated comments" on public.comments for all to authenticated using (true) with check (true);
drop policy if exists "Authenticated attachments" on public.attachments;
create policy "Authenticated attachments" on public.attachments for all to authenticated using (true) with check (true);
drop policy if exists "Authenticated checklists" on public.checklists;
create policy "Authenticated checklists" on public.checklists for all to authenticated using (true) with check (true);
drop policy if exists "Authenticated checklist_history" on public.checklist_history;
create policy "Authenticated checklist_history" on public.checklist_history for all to authenticated using (true) with check (true);
drop policy if exists "Admin quotes" on public.quotes;
create policy "Admin quotes" on public.quotes for all to authenticated using (
  exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
) with check (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true));
drop policy if exists "Authenticated inventory_history" on public.inventory_history;
create policy "Authenticated inventory_history" on public.inventory_history for all to authenticated using (true) with check (true);

-- Storage buckets (run in Dashboard or via API): attachments, inventory-images
-- In Supabase Dashboard: Storage -> New bucket -> "attachments" (public or private + signed URLs)
-- Same for "inventory-images" if you use images per inventory item.

-- Ensure labor_hours column exists (for existing databases that may not have it)
alter table public.jobs add column if not exists labor_hours numeric;

-- Ensure part_number and variant_suffix columns exist (for existing databases)
alter table public.jobs add column if not exists part_number text;
alter table public.jobs add column if not exists variant_suffix text;
alter table public.jobs add column if not exists est_number text;
alter table public.jobs add column if not exists inv_number text;
alter table public.jobs add column if not exists rfq_number text;
alter table public.jobs add column if not exists dash_quantities jsonb;
alter table public.jobs add column if not exists revision text;

-- Parts (master parts repository - one source of truth for pricing)
create table if not exists public.parts (
  id uuid primary key default gen_random_uuid(),
  part_number text not null unique, -- e.g., "DASH-123" (base part number)
  name text not null,
  description text,
  price_per_set numeric, -- Price for a complete set (all variants)
  labor_hours numeric, -- Expected labor hours for this part
  set_composition jsonb, -- Set composition: how many of each dash number makes one complete set (e.g. {"01": 2, "05": 1, "12": 4})
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'idx_parts_part_number') then
    create index idx_parts_part_number on public.parts(part_number);
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'idx_parts_name') then
    create index idx_parts_name on public.parts(name);
  end if;
end $$;

-- Part Variants (sub-parts like -01, -02)
create table if not exists public.part_variants (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null references public.parts(id) on delete cascade,
  variant_suffix text not null, -- e.g., "01", "02" (without the dash)
  name text, -- Variant-specific name if different
  description text,
  price_per_variant numeric, -- Price for this specific variant
  labor_hours numeric, -- Expected labor hours for this variant
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(part_id, variant_suffix)
);

do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'idx_part_variants_part') then
    create index idx_part_variants_part on public.part_variants(part_id);
  end if;
end $$;

-- Part Materials (materials needed per part/variant)
create table if not exists public.part_materials (
  id uuid primary key default gen_random_uuid(),
  part_id uuid references public.parts(id) on delete cascade,
  variant_id uuid references public.part_variants(id) on delete cascade, -- null = applies to all variants
  inventory_id uuid not null references public.inventory(id),
  quantity numeric not null,
  unit text not null default 'units',
  usage_type text not null default 'per_set', -- 'per_set' or 'per_variant'
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'idx_part_materials_part') then
    create index idx_part_materials_part on public.part_materials(part_id);
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'idx_part_materials_variant') then
    create index idx_part_materials_variant on public.part_materials(variant_id);
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'idx_part_materials_inventory') then
    create index idx_part_materials_inventory on public.part_materials(inventory_id);
  end if;
end $$;

-- Ensure set_composition column exists in parts table (for existing databases; must run after parts table exists)
alter table public.parts add column if not exists set_composition jsonb;

-- RLS policies for parts
alter table public.parts enable row level security;
alter table public.part_variants enable row level security;
alter table public.part_materials enable row level security;

drop policy if exists "Authenticated parts read" on public.parts;
create policy "Authenticated parts read" on public.parts for select to authenticated using (true);
drop policy if exists "Admin parts write" on public.parts;
create policy "Admin parts write" on public.parts for all to authenticated using (
  exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
) with check (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true));

drop policy if exists "Authenticated variants read" on public.part_variants;
create policy "Authenticated variants read" on public.part_variants for select to authenticated using (true);
drop policy if exists "Admin variants write" on public.part_variants;
create policy "Admin variants write" on public.part_variants for all to authenticated using (
  exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
) with check (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true));

drop policy if exists "Authenticated materials read" on public.part_materials;
create policy "Authenticated materials read" on public.part_materials for select to authenticated using (true);
drop policy if exists "Admin materials write" on public.part_materials;
create policy "Admin materials write" on public.part_materials for all to authenticated using (
  exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
) with check (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true));

-- Add foreign key constraint from jobs.part_number to parts.part_number (if it doesn't exist)
do $$
begin
  if not exists (
    select 1 from pg_constraint 
    where conname = 'jobs_part_number_fkey' 
    and conrelid = 'public.jobs'::regclass
  ) then
    alter table public.jobs 
    add constraint jobs_part_number_fkey 
    foreign key (part_number) references public.parts(part_number);
  end if;
end $$;

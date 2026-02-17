-- WorkTrack Pro: Initial schema for Supabase
-- Run in Supabase SQL Editor or via supabase db push

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Profiles (extends auth.users: name, initials, is_admin)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  initials text,
  is_admin boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Jobs
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  job_code int not null unique,
  po text,
  name text not null default '',
  qty text,
  description text,
  ecd text,
  due_date date,
  active boolean not null default true,
  status text not null default 'pending',
  board_type text default 'shopFloor',
  created_by uuid references public.profiles(id),
  assigned_users uuid[] default '{}',
  is_rush boolean not null default false,
  workers text[] default '{}',
  bin_location text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_jobs_status on public.jobs(status);
create index idx_jobs_created_at on public.jobs(created_at desc);
create index idx_jobs_board_type on public.jobs(board_type);

-- Inventory
create table public.inventory (
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

create index idx_inventory_name on public.inventory(name);
create index idx_inventory_category on public.inventory(category);

-- Job-inventory link
create table public.job_inventory (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  inventory_id uuid not null references public.inventory(id),
  quantity numeric not null,
  unit text not null default 'units',
  created_at timestamptz default now()
);

create index idx_job_inventory_job on public.job_inventory(job_id);
create index idx_job_inventory_inventory on public.job_inventory(inventory_id);

-- Shifts
create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  job_id uuid not null references public.jobs(id),
  clock_in_time timestamptz not null,
  clock_out_time timestamptz,
  notes text,
  created_at timestamptz default now()
);

create index idx_shifts_user on public.shifts(user_id);
create index idx_shifts_job on public.shifts(job_id);
create index idx_shifts_clock_in on public.shifts(clock_in_time desc);

-- Shift edits (admin audit)
create table public.shift_edits (
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
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  text text not null,
  created_at timestamptz default now()
);

create index idx_comments_job on public.comments(job_id);

-- Attachments (file path in Storage; bucket 'attachments')
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  filename text not null,
  storage_path text not null,
  is_admin_only boolean not null default false,
  created_at timestamptz default now()
);

create index idx_attachments_job on public.attachments(job_id);

-- Checklists (items = jsonb). job_id null = template checklist
create table public.checklists (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.jobs(id) on delete cascade,
  status text not null,
  items jsonb not null default '[]',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_checklists_job on public.checklists(job_id);

-- Checklist history
create table public.checklist_history (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references public.checklists(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  item_index int not null,
  item_text text,
  checked boolean not null,
  created_at timestamptz default now()
);

-- Quotes (line_items, reference_job_ids as jsonb)
create table public.quotes (
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

create index idx_quotes_created_at on public.quotes(created_at desc);

-- Inventory history
create table public.inventory_history (
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

create index idx_inventory_history_inventory on public.inventory_history(inventory_id);
create index idx_inventory_history_created on public.inventory_history(created_at desc);

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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- RLS: enable on all tables
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
create policy "Users can read all profiles" on public.profiles for select to authenticated using (true);
create policy "Users can update own profile" on public.profiles for update to authenticated using (auth.uid() = id);

create policy "Authenticated read jobs" on public.jobs for select to authenticated using (true);
create policy "Authenticated insert jobs" on public.jobs for insert to authenticated with check (true);
create policy "Authenticated update jobs" on public.jobs for update to authenticated using (true);
create policy "Admin delete jobs" on public.jobs for delete to authenticated using (
  exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
);

create policy "Authenticated inventory" on public.inventory for all to authenticated using (true) with check (true);
create policy "Authenticated job_inventory" on public.job_inventory for all to authenticated using (true) with check (true);
create policy "Authenticated shifts" on public.shifts for all to authenticated using (true) with check (true);
create policy "Authenticated shift_edits" on public.shift_edits for all to authenticated using (true) with check (true);
create policy "Authenticated comments" on public.comments for all to authenticated using (true) with check (true);
create policy "Authenticated attachments" on public.attachments for all to authenticated using (true) with check (true);
create policy "Authenticated checklists" on public.checklists for all to authenticated using (true) with check (true);
create policy "Authenticated checklist_history" on public.checklist_history for all to authenticated using (true) with check (true);
create policy "Admin quotes" on public.quotes for all to authenticated using (
  exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
) with check (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true));
create policy "Authenticated inventory_history" on public.inventory_history for all to authenticated using (true) with check (true);

-- Storage buckets (run in Dashboard or via API): attachments, inventory-images
-- In Supabase Dashboard: Storage -> New bucket -> "attachments" (public or private + signed URLs)
-- Same for "inventory-images" if you use images per inventory item.

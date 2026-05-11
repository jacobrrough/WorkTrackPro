-- WorkTrack Pro: Parts, variants, and part materials (for multi-variant jobs & material explosion)
-- Parts: base part number and name; Variants: e.g. -01, -05; PartMaterial: qty per variant → inventory

-- Parts (base part: part_number is the prefix, e.g. "ABC", variants are ABC-01, ABC-05)
create table if not exists public.parts (
  id uuid primary key default gen_random_uuid(),
  part_number text not null,
  name text not null default '',
  description text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(part_number)
);

create index if not exists idx_parts_part_number on public.parts(part_number);
create index if not exists idx_parts_name on public.parts(name);

-- Part variants (e.g. -01, -05 for part_number "ABC" -> ABC-01, ABC-05)
create table if not exists public.part_variants (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null references public.parts(id) on delete cascade,
  variant_suffix text not null,
  name text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(part_id, variant_suffix)
);

create index if not exists idx_part_variants_part on public.part_variants(part_id);

-- Part materials: per variant, which inventory item and how much per unit
create table if not exists public.part_materials (
  id uuid primary key default gen_random_uuid(),
  part_variant_id uuid not null references public.part_variants(id) on delete cascade,
  inventory_id uuid not null references public.inventory(id) on delete restrict,
  quantity_per_unit numeric not null default 1,
  unit text not null default 'units',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(part_variant_id, inventory_id)
);

-- Ensure columns exist (handles case where initial_schema created table with different columns)
alter table public.part_materials add column if not exists part_variant_id uuid references public.part_variants(id) on delete cascade;
alter table public.part_materials add column if not exists quantity_per_unit numeric not null default 1;

create index if not exists idx_part_materials_variant on public.part_materials(part_variant_id);
create index if not exists idx_part_materials_inventory on public.part_materials(inventory_id);

-- Optional: link jobs to a part (for dash quantities and auto-assignment)
alter table public.jobs add column if not exists part_id uuid references public.parts(id) on delete set null;
create index if not exists idx_jobs_part on public.jobs(part_id);

-- RLS
alter table public.parts enable row level security;
alter table public.part_variants enable row level security;
alter table public.part_materials enable row level security;

drop policy if exists "Authenticated parts" on public.parts;
create policy "Authenticated parts" on public.parts for all to authenticated using (true) with check (true);
drop policy if exists "Authenticated part_variants" on public.part_variants;
create policy "Authenticated part_variants" on public.part_variants for all to authenticated using (true) with check (true);
drop policy if exists "Authenticated part_materials" on public.part_materials;
create policy "Authenticated part_materials" on public.part_materials for all to authenticated using (true) with check (true);

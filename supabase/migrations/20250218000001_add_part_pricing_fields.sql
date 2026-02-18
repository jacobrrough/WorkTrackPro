-- Add price_per_set and labor_hours to parts table (for set-level quoting)
alter table public.parts add column if not exists price_per_set numeric;
alter table public.parts add column if not exists labor_hours numeric;
alter table public.parts add column if not exists set_composition jsonb;

-- Add price_per_variant and labor_hours to part_variants table
alter table public.part_variants add column if not exists price_per_variant numeric;
alter table public.part_variants add column if not exists labor_hours numeric;

-- Add variant-level machine time support and job-level variant breakdown persistence.

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

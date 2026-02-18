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

-- Add flag: when true, only first variant holds BOM/costs; all variants treated as copies.
alter table public.parts add column if not exists variants_are_copies boolean not null default false;

comment on column public.parts.variants_are_copies is 'When true, materials/costs are stored only on first variant and derived for others.';

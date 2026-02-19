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

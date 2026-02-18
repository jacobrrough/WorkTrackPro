-- CNC / 3D print: toggle and machine time per set (included in quote)
alter table public.parts add column if not exists requires_machine_work boolean not null default false;
alter table public.parts add column if not exists machine_time_hours numeric;

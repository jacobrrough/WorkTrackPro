-- Organization-wide admin settings (shared scheduling and pricing configuration)
-- Single-tenant row keyed by org_key='default'

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
  if not exists (
    select 1
    from pg_indexes
    where indexname = 'idx_organization_settings_org_key'
  ) then
    create index idx_organization_settings_org_key on public.organization_settings(org_key);
  end if;
end $$;

alter table public.organization_settings enable row level security;

drop policy if exists "Authenticated read organization settings" on public.organization_settings;
create policy "Authenticated read organization settings"
on public.organization_settings
for select
to authenticated
using (true);

drop policy if exists "Admin write organization settings" on public.organization_settings;
create policy "Admin write organization settings"
on public.organization_settings
for all
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where id = auth.uid() and is_admin = true
  )
)
with check (
  exists (
    select 1
    from public.profiles
    where id = auth.uid() and is_admin = true
  )
);

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
values (
  'default',
  175,
  1.25,
  150,
  100,
  5,
  1.5,
  '{}'::jsonb
)
on conflict (org_key) do nothing;

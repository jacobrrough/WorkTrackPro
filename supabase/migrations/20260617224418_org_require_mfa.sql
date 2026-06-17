-- Org-level "require MFA" kill-switch for app-login MFA enforcement.
-- Default true = MFA enforcement is ON for app login.
-- To DISABLE in an emergency (e.g. an MFA provider outage locking everyone out),
-- open the organization_settings row in the Supabase table editor and flip
-- require_mfa to false. This is a deliberate manual escape hatch — there is no
-- code path that can permanently lock a user out with no recovery.
-- Mirrors the existing enforce_on_site_at_login boolean (20260223000001).
-- Creates organization_settings if it does not exist, then adds the column.
--
-- ROLLBACK:
--   alter table public.organization_settings drop column if exists require_mfa;

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'organization_settings'
  ) then
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
      require_on_site boolean not null default false,
      site_lat numeric,
      site_lng numeric,
      site_radius_meters numeric,
      enforce_on_site_at_login boolean not null default false,
      require_mfa boolean not null default true,
      updated_by uuid references public.profiles(id) on delete set null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint organization_settings_default_org_key check (org_key = 'default')
    );
    create index if not exists idx_organization_settings_org_key on public.organization_settings(org_key);
    alter table public.organization_settings enable row level security;
    drop policy if exists "Authenticated read organization settings" on public.organization_settings;
    create policy "Authenticated read organization settings" on public.organization_settings for select to authenticated using (true);
    drop policy if exists "Admin write organization settings" on public.organization_settings;
    create policy "Admin write organization settings" on public.organization_settings for all to authenticated
      using (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true))
      with check (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true));
    insert into public.organization_settings (org_key, labor_rate, material_upcharge, cnc_rate, printer_3d_rate, employee_count, overtime_multiplier, work_week_schedule)
    values ('default', 175, 1.25, 150, 100, 5, 1.5, '{}'::jsonb)
    on conflict (org_key) do nothing;
  else
    alter table public.organization_settings add column if not exists require_mfa boolean not null default true;
  end if;
end $$;

comment on column public.organization_settings.require_mfa is 'Kill-switch for app-login MFA enforcement. Default true = enforce MFA at login. Flip to false in the table editor to disable in an emergency (e.g. MFA provider outage).';

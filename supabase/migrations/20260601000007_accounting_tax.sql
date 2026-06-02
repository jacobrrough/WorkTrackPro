-- WorkTrackAccounting — Foundation 7/11: sales tax (California-aware)
--
-- California's destination/district sourcing is modeled as composable rate
-- components: a tax_code (what you put on an invoice) aggregates one or more
-- tax_rates (state + district), each owed to a tax_agency.
--
-- NOTE: seeded rates are REPRESENTATIVE examples only. Accurate, current CA district
-- rates require a periodic refresh job or a tax API — DEFERRED for Phase 1. Always
-- verify rates before filing. (See disclaimer in the app settings.)
--
-- This migration is IDEMPOTENT.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS accounting.tax_code_rates CASCADE;
--   DROP TABLE IF EXISTS accounting.tax_rates CASCADE;
--   DROP TABLE IF EXISTS accounting.tax_codes CASCADE;
--   DROP TABLE IF EXISTS accounting.tax_agencies CASCADE;

create table if not exists accounting.tax_agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  liability_account_id uuid references accounting.accounts(id) on delete set null,
  filing_frequency text check (filing_frequency in ('monthly', 'quarterly', 'annual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists accounting.tax_rates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  rate numeric(7,5) not null check (rate >= 0),
  agency_id uuid references accounting.tax_agencies(id) on delete set null,
  jurisdiction text check (jurisdiction in ('state', 'county', 'district', 'city', 'special')),
  effective_date date,
  end_date date,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists accounting.tax_codes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  is_taxable boolean not null default true,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists accounting.tax_code_rates (
  id uuid primary key default gen_random_uuid(),
  tax_code_id uuid not null references accounting.tax_codes(id) on delete cascade,
  tax_rate_id uuid not null references accounting.tax_rates(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (tax_code_id, tax_rate_id)
);

-- Seed: CDTFA agency + representative CA rates/codes.
insert into accounting.tax_agencies (name, liability_account_id, filing_frequency)
  select 'CDTFA', (select id from accounting.accounts where account_number = '2200'), 'quarterly'
on conflict (name) do nothing;

insert into accounting.tax_rates (name, rate, agency_id, jurisdiction, is_active)
  select 'CA Statewide Base', 0.07250, (select id from accounting.tax_agencies where name = 'CDTFA'), 'state', true
  where not exists (select 1 from accounting.tax_rates where name = 'CA Statewide Base');
insert into accounting.tax_rates (name, rate, agency_id, jurisdiction, is_active)
  select 'Los Angeles County District', 0.02250, (select id from accounting.tax_agencies where name = 'CDTFA'), 'district', true
  where not exists (select 1 from accounting.tax_rates where name = 'Los Angeles County District');

insert into accounting.tax_codes (name, description, is_taxable, is_default) values
  ('CA - Statewide (7.25%)', 'California statewide base rate', true, true),
  ('CA - Los Angeles (9.5%)', 'CA base + Los Angeles County district', true, false),
  ('Non-Taxable', 'Exempt from sales tax', false, false),
  ('Resale', 'Sale for resale (resale certificate on file)', false, false)
on conflict (name) do nothing;

-- Link codes to their composing rates.
insert into accounting.tax_code_rates (tax_code_id, tax_rate_id)
  select c.id, r.id
    from accounting.tax_codes c, accounting.tax_rates r
   where c.name = 'CA - Statewide (7.25%)' and r.name = 'CA Statewide Base'
on conflict (tax_code_id, tax_rate_id) do nothing;
insert into accounting.tax_code_rates (tax_code_id, tax_rate_id)
  select c.id, r.id
    from accounting.tax_codes c, accounting.tax_rates r
   where c.name = 'CA - Los Angeles (9.5%)' and r.name in ('CA Statewide Base', 'Los Angeles County District')
on conflict (tax_code_id, tax_rate_id) do nothing;

select accounting._apply_standard_table('tax_agencies');
select accounting._apply_standard_table('tax_rates', false);
select accounting._apply_standard_table('tax_codes');
select accounting._apply_standard_table('tax_code_rates', false);

grant select, insert, update, delete on all tables in schema accounting to authenticated, service_role;

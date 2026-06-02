-- WorkTrackAccounting — Foundation 1/11: schema, roles & module settings
--
-- Creates the isolated `accounting` schema (purely additive: nothing in `public`
-- is altered) plus the role model and RLS helper functions every accounting table
-- will use. Mirrors the recursion-safe SECURITY DEFINER helper pattern established
-- in 20260224000003 / 20260224000006 for public.is_approved_user / is_admin_approved.
--
-- ISOLATION NOTE: the browser supabase-js client can only reach this schema once
-- `accounting` is added to PostgREST "Exposed schemas" (Supabase Dashboard →
-- Project Settings → API). Until then these tables exist but are unreachable from
-- the app — the intended develop-in-isolation kill switch. RLS below is the real
-- per-row guard regardless of exposure.
--
-- This migration is IDEMPOTENT.
--
-- ROLLBACK:
--   DROP SCHEMA IF EXISTS accounting CASCADE;
--   -- (also remove `accounting` from Exposed schemas if it was added)

-- 1) Schema -------------------------------------------------------------------
create schema if not exists accounting;

-- Grants: accounting is reachable by authenticated users and the service role only
-- (never anon). RLS policies below gate every row; these grants just allow the
-- roles to attempt access. Default privileges cover tables/sequences/functions
-- created later in this and subsequent accounting migrations.
grant usage on schema accounting to authenticated, service_role;
alter default privileges in schema accounting
  grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema accounting
  grant usage, select on sequences to authenticated, service_role;
alter default privileges in schema accounting
  grant execute on functions to authenticated, service_role;

-- 2) Roles --------------------------------------------------------------------
-- Additive role model. We DO NOT touch public.profiles — existing admin gating
-- (profiles.is_admin) keeps working, and a global admin is treated as a full
-- accounting admin via the helper functions below.
create table if not exists accounting.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('accounting_admin', 'accountant', 'payroll', 'viewer')),
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  unique (user_id, role)
);

do $$
begin
  if not exists (select 1 from pg_indexes where schemaname = 'accounting' and indexname = 'idx_accounting_user_roles_user') then
    create index idx_accounting_user_roles_user on accounting.user_roles(user_id);
  end if;
end $$;

-- 3) RLS helper functions -----------------------------------------------------
-- SECURITY DEFINER so they bypass RLS on accounting.user_roles when invoked from
-- a policy (prevents the classic policy→function→same-table recursion). Fully
-- schema-qualified reads; search_path pinned for safety.

-- True if the current user holds p_role, OR is a global approved admin (admin ⇒
-- every accounting role). Requires the user to be approved.
create or replace function accounting.has_role(p_role text)
returns boolean
language sql
stable
security definer
set search_path = accounting, public, pg_catalog
as $$
  select public.is_approved_user()
     and (
       public.is_admin_approved()
       or exists (
         select 1 from accounting.user_roles ur
         where ur.user_id = auth.uid() and ur.role = p_role
       )
     );
$$;

-- Any accounting role (or global admin) may read.
create or replace function accounting.can_read()
returns boolean
language sql
stable
security definer
set search_path = accounting, public, pg_catalog
as $$
  select public.is_approved_user()
     and (
       public.is_admin_approved()
       or exists (select 1 from accounting.user_roles ur where ur.user_id = auth.uid())
     );
$$;

-- Accountants and accounting admins (and global admins) may write.
create or replace function accounting.can_write()
returns boolean
language sql
stable
security definer
set search_path = accounting, public, pg_catalog
as $$
  select accounting.has_role('accounting_admin') or accounting.has_role('accountant');
$$;

-- Payroll role and accounting admins (and global admins) may touch payroll tables.
create or replace function accounting.can_payroll()
returns boolean
language sql
stable
security definer
set search_path = accounting, public, pg_catalog
as $$
  select accounting.has_role('payroll') or accounting.has_role('accounting_admin');
$$;

-- 4) Module settings (KV) -----------------------------------------------------
-- Module-local config: default AR/AP/COGS/income/tax-liability account ids,
-- fiscal-year start, base currency, number sequences, feature defaults. Kept
-- separate from public.organization_settings (which is a typed columnar table,
-- not a generic KV store, so it must not be overloaded).
create table if not exists accounting.settings (
  id uuid primary key default gen_random_uuid(),
  setting_key text not null unique,
  setting_value jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into accounting.settings (setting_key, setting_value) values
  ('base_currency', '"USD"'::jsonb),
  ('fiscal_year_start', '"01-01"'::jsonb),
  ('default_accounts', '{}'::jsonb)
on conflict (setting_key) do nothing;

-- 5) RLS ----------------------------------------------------------------------
alter table accounting.user_roles enable row level security;
alter table accounting.settings   enable row level security;

drop policy if exists "acct user_roles read" on accounting.user_roles;
create policy "acct user_roles read" on accounting.user_roles
  for select to authenticated using (accounting.can_read());

-- Only accounting admins (or global admins) manage role grants.
drop policy if exists "acct user_roles manage" on accounting.user_roles;
create policy "acct user_roles manage" on accounting.user_roles
  for all to authenticated
  using (accounting.has_role('accounting_admin'))
  with check (accounting.has_role('accounting_admin'));

drop policy if exists "acct settings read" on accounting.settings;
create policy "acct settings read" on accounting.settings
  for select to authenticated using (accounting.can_read());

drop policy if exists "acct settings write" on accounting.settings;
create policy "acct settings write" on accounting.settings
  for all to authenticated
  using (accounting.can_write())
  with check (accounting.can_write());

-- Belt-and-suspenders explicit grants (default privileges above cover future
-- objects, but make current objects' grants unambiguous).
grant select, insert, update, delete on all tables in schema accounting to authenticated, service_role;
grant usage, select on all sequences in schema accounting to authenticated, service_role;
grant execute on all functions in schema accounting to authenticated, service_role;

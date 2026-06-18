-- Audit finding #4: enforce MFA (aal2) at the DATA LAYER for accounting WRITES, mirroring the
-- client gate (require_mfa && isAdmin). APPLIED to prod 2026-06-18 (this is the recorded copy).
--
-- Lockout-safe: only admins are ever affected; all active admins already have TOTP/aal2 (the
-- only TOTP-less admin is a dormant test@ account); and flipping
-- organization_settings.require_mfa = false (via the Supabase dashboard / service_role) instantly
-- releases the data layer. Recovery is unchanged from the documented MFA kill-switch.
--
-- Design + analysis: docs/proposals/aal2-rls-enforcement.md.
-- ROLLBACK:
--   create or replace function accounting.can_write() returns boolean
--     language sql stable security definer set search_path to 'accounting','public','pg_catalog'
--     as $$ select accounting.has_role('accounting_admin') or accounting.has_role('accountant'); $$;
--   drop trigger if exists trg_guard_require_mfa_aal2 on public.organization_settings;
--   drop function if exists public.guard_require_mfa_aal2();
--   drop function if exists accounting.mfa_satisfied();

-- Predicate: NOT (require_mfa AND is_admin AND not-aal2).
create or replace function accounting.mfa_satisfied()
returns boolean
language sql
stable
security definer
set search_path to 'accounting', 'public', 'pg_catalog'
as $function$
  select
    coalesce((select s.require_mfa from public.organization_settings s limit 1), true) = false
    or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
    or not public.is_admin_approved();
$function$;

-- Bake it into the single write predicate every accounting write policy already uses.
create or replace function accounting.can_write()
returns boolean
language sql
stable
security definer
set search_path to 'accounting', 'public', 'pg_catalog'
as $function$
  select (accounting.has_role('accounting_admin') or accounting.has_role('accountant'))
     and accounting.mfa_satisfied();
$function$;

-- Companion control: an aal1 admin must not be able to disable enforcement by flipping the
-- kill-switch through the API. service_role (auth.uid() is null → dashboard recovery) bypasses.
create or replace function public.guard_require_mfa_aal2()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.require_mfa is distinct from old.require_mfa
     and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'changing require_mfa requires an MFA (aal2) session';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_guard_require_mfa_aal2 on public.organization_settings;
create trigger trg_guard_require_mfa_aal2
  before update on public.organization_settings
  for each row execute function public.guard_require_mfa_aal2();

-- Keep the new helpers internal-only (called from within SECURITY DEFINER can_write / the
-- trigger as the definer) so they don't surface as exposed RPCs (advisor 0028/0029).
revoke all on function accounting.mfa_satisfied() from public, anon, authenticated;
revoke all on function public.guard_require_mfa_aal2() from public, anon, authenticated;

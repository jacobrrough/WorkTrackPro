-- Migration: Pin SECURITY DEFINER search_path + revoke over-broad EXECUTE grants
--
-- WHY:
--   Supabase's security advisor flags two distinct, low-risk hardening gaps:
--
--   (1) SECURITY DEFINER functions without a pinned search_path. A definer
--       function that resolves unqualified object names against a caller-controlled
--       search_path can be tricked into running attacker-shadowed objects with the
--       owner's privileges. Pinning `search_path = public, pg_catalog` closes this
--       without touching any function body or behavior.
--
--   (2) Trigger helper functions that are also EXECUTE-grantable to the PostgREST
--       roles (anon, authenticated). These are only meant to fire from triggers;
--       exposing them over REST lets a client invoke them directly with forged
--       arguments (acquiring exclusive row locks, forcing reconciliation paths,
--       etc.). Revoking EXECUTE from anon/authenticated has NO effect on trigger
--       firing — triggers run as the table owner regardless of grants.
--
-- WHAT THIS DOES NOT DO:
--   • Does NOT change any function body except public.handle_new_user(), and that
--     change only wraps the existing INSERT so a profiles failure cannot abort the
--     auth.users insert (same columns, same values, same RETURN NEW).
--   • Does NOT modify any table, policy, or data.
--
-- SAFETY / IDEMPOTENCY:
--   • Every ALTER/REVOKE is guarded with to_regprocedure(...) IS NOT NULL so a
--     missing overload is skipped rather than raising. Re-running is a no-op.
--   • Argument signatures were taken from the in-repo migrations that define each
--     function (see inline references).

-- =============================================================================
-- 1. Pin search_path on SECURITY DEFINER functions (body unchanged)
-- =============================================================================
do $$
begin
  -- public.handle_new_user() — defined in 20260224000003_user_approval.sql
  if to_regprocedure('public.handle_new_user()') is not null then
    alter function public.handle_new_user() set search_path = public, pg_catalog;
  end if;

  -- public.is_conversation_member(uuid) — defined in 20260507000001_e2e_encrypted_chat.sql
  if to_regprocedure('public.is_conversation_member(uuid)') is not null then
    alter function public.is_conversation_member(uuid) set search_path = public, pg_catalog;
  end if;

  -- public.find_direct_conversation(uuid, uuid) — defined in 20260507000001_e2e_encrypted_chat.sql
  if to_regprocedure('public.find_direct_conversation(uuid, uuid)') is not null then
    alter function public.find_direct_conversation(uuid, uuid) set search_path = public, pg_catalog;
  end if;

  -- public.update_conversation_timestamp() — defined in 20260507000001_e2e_encrypted_chat.sql
  if to_regprocedure('public.update_conversation_timestamp()') is not null then
    alter function public.update_conversation_timestamp() set search_path = public, pg_catalog;
  end if;

  -- public.sync_part_material_quantity() — defined in 20260512000002_fix_part_materials_schema.sql
  if to_regprocedure('public.sync_part_material_quantity()') is not null then
    alter function public.sync_part_material_quantity() set search_path = public, pg_catalog;
  end if;

  -- accounting.touch_updated_at() — defined in 20260603163842_accounting_chart_of_accounts.sql
  if to_regprocedure('accounting.touch_updated_at()') is not null then
    alter function accounting.touch_updated_at() set search_path = public, pg_catalog;
  end if;

  -- accounting._apply_standard_table(text, boolean, text) — defined in 20260603164021_accounting_parties.sql
  if to_regprocedure('accounting._apply_standard_table(text, boolean, text)') is not null then
    alter function accounting._apply_standard_table(text, boolean, text) set search_path = public, pg_catalog;
  end if;
end $$;

-- =============================================================================
-- 2. Revoke EXECUTE from anon/authenticated on trigger-only functions
--    (revoking does NOT affect trigger firing — triggers run as table owner)
-- =============================================================================
do $$
begin
  -- public.jobs_reconcile_inventory_on_status() — defined in 20260509000002_reconcile_inventory_on_status_trigger.sql
  if to_regprocedure('public.jobs_reconcile_inventory_on_status()') is not null then
    revoke execute on function public.jobs_reconcile_inventory_on_status() from anon, authenticated;
  end if;

  -- public.job_inventory_allocate_guard() — defined in 20260313000001_job_inventory_allocate_guard.sql
  --   (updated in 20260509000001_update_allocation_guard.sql)
  if to_regprocedure('public.job_inventory_allocate_guard()') is not null then
    revoke execute on function public.job_inventory_allocate_guard() from anon, authenticated;
  end if;

  -- public.job_inventory_no_mutate_on_consumed() — consumed-guard function in
  --   20260509000004_job_inventory_consumed_guard.sql (already revoked from PUBLIC;
  --   this also strips the explicit anon/authenticated grants if present)
  if to_regprocedure('public.job_inventory_no_mutate_on_consumed()') is not null then
    revoke execute on function public.job_inventory_no_mutate_on_consumed() from anon, authenticated;
  end if;
end $$;

-- =============================================================================
-- 3. handle_new_user(): make profile insertion failure non-fatal to auth signup
--    Faithful recreate of the body from 20260224000003_user_approval.sql with the
--    INSERT wrapped so a failure RAISEs a WARNING instead of aborting the
--    auth.users insert. SECURITY DEFINER + pinned search_path retained.
-- =============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  begin
    insert into public.profiles (id, email, name, initials, is_admin, is_approved, approved_at, approved_by)
    values (
      new.id,
      new.email,
      coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
      coalesce(new.raw_user_meta_data->>'initials', upper(left(split_part(new.email, '@', 1), 2))),
      false,
      false,
      null,
      null
    );
  exception
    when others then
      raise warning 'handle_new_user failed: %', sqlerrm;
  end;
  return new;
end;
$$;

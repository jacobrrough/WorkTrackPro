# Proposal: enforce MFA (AAL2) at the data layer for accounting writes

**Status:** ✅ APPLIED to prod 2026-06-18 as migration `20260618173617_accounting_require_aal2_for_writes` (Phase 1 = writes). (Audit finding #4.)

## Problem

MFA is enforced only at the React gate (`AuthContext.refreshMfaGate` → `App.tsx`). The
database does not check the session's Authenticator Assurance Level: every accounting RLS
policy authorizes via `accounting.can_read()` / `accounting.can_write()`, which check
approval/role but **never** the `aal` JWT claim. So a holder of an *aal1* access token (an
admin who authenticated with a password but has not completed the TOTP step-up — the token
already exists in the browser before the gate is satisfied) can call PostgREST directly and
**mutate the ledger** without ever passing MFA. The client gate is a UX control, not a
security boundary.

## Current state (verified on prod 2026-06-18)

- `accounting.can_write()` = `has_role('accounting_admin') OR has_role('accountant')`, and
  `has_role()` = `is_approved_user() AND (is_admin_approved() OR <row in accounting.user_roles>)`.
- **`accounting.user_roles` has 0 rows** → every accounting writer today qualifies via the
  `is_admin_approved()` branch, i.e. **writers are admins only** (4 admins total).
- `public.organization_settings` has 1 row with `require_mfa = true`.
- The client gate requires MFA for **admins only** (`mfaRequired = requireMfa !== false && isAdmin`).

**Implication:** gating accounting writes on aal2 affects only the 4 admins, who are already
aal2 in the normal app flow. There are no non-admin accounting users to lock out.

## Design

A single SECURITY DEFINER predicate that mirrors the client gate exactly — block only when
(org requires MFA) AND (caller is an admin) AND (session is not aal2):

```sql
create or replace function accounting.mfa_satisfied()
returns boolean
language sql
stable
security definer
set search_path to 'accounting', 'public', 'pg_catalog'
as $function$
  select
    -- Org kill-switch OFF → data layer does not require MFA (matches the client gate).
    coalesce((select s.require_mfa from public.organization_settings s limit 1), true) = false
    -- OR the session has stepped up to aal2 (TOTP completed).
    or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
    -- OR the caller is not someone we require MFA from (non-admins; mirrors mfaRequired&&isAdmin).
    or not public.is_admin_approved();
$function$;
```

Then bake it into the existing write predicate so it propagates to **every** accounting
table's write policy with one change (no per-table policy edits):

```sql
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
```

### Companion control — protect the kill-switch (required)

If an aal1 admin can write `organization_settings`, they can set `require_mfa = false` and
defeat the whole control. Block changing that flag from a non-aal2 session (service_role,
used by the Supabase dashboard/table-editor recovery path, bypasses RLS and is unaffected):

```sql
create or replace function public.guard_require_mfa_aal2()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  if auth.uid() is null then            -- service-role / server context: trusted
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
```

### Why this is lockout-safe

- The only callers ever blocked are **admins** (4 of them), and only when `require_mfa=true`
  **and** the session is aal1 — which the client gate prevents in normal use.
- **Recovery is unchanged and still works:** flip `require_mfa=false` on the
  `organization_settings` row in the **Supabase dashboard / table editor** (service_role →
  bypasses RLS and the trigger). The moment it's false, `mfa_satisfied()` returns true for
  everyone and the data layer stops requiring MFA — same escape hatch documented today.
- Admin "Reset 2FA" (`netlify/functions/reset-user-mfa.mjs`) also still works (service_role).

### Scope (phased)

- **Phase 1 (this proposal): WRITES only.** Highest value (prevents ledger mutation, fake
  invoices/payments, settings tampering) with the least breakage risk.
- **Phase 2 (optional, later):** add `and accounting.mfa_satisfied()` to `can_read()` too,
  to also stop aal1 *reads* of financial data. More likely to surface subtle app-load
  breakage, so gate it behind its own branch test first.

## Test plan (run on a Supabase BRANCH before prod)

1. Create a branch; apply the migration there.
2. Truth-table the predicate without a real session, e.g. inside a transaction:
   ```sql
   begin;
   -- simulate an admin uid + claims; assert can_write() / mfa_satisfied() outcomes:
   --   require_mfa=true,  aal1, admin     -> can_write() = false   (blocked)
   --   require_mfa=true,  aal2, admin     -> can_write() = true
   --   require_mfa=false, aal1, admin     -> can_write() = true    (kill-switch)
   --   require_mfa=true,  aal1, non-admin -> can_write() = true    (not required)
   rollback;
   ```
   (Set `request.jwt.claims` via `set local` and point `auth.uid()` at a known admin/non-admin.)
3. In the app against the branch: a normally-logged-in (aal2) admin can still create an
   invoice/payment and edit settings; confirm no regression.
4. Re-run `get_advisors` + the books-integrity SQL on the branch.

## Rollback

```sql
-- Restore the pre-MFA write predicate and drop the helpers/trigger.
create or replace function accounting.can_write() returns boolean
  language sql stable security definer set search_path to 'accounting','public','pg_catalog'
  as $$ select accounting.has_role('accounting_admin') or accounting.has_role('accountant'); $$;
drop trigger if exists trg_guard_require_mfa_aal2 on public.organization_settings;
drop function if exists public.guard_require_mfa_aal2();
drop function if exists accounting.mfa_satisfied();
```

## Apply checklist (once approved)

1. Verify TOTP is actually enrolled for all 4 admins (so none are stuck at aal1 capability).
   Query: factors per admin via the auth admin API / `auth.mfa_factors`.
2. Apply on a branch, run the test plan, then apply to prod via `apply_migration`.
3. Keep the Supabase table-editor recovery (flip `require_mfa=false`) handy during rollout.
4. Write the repo migration file named to the **recorded** version (apply_migration assigns
   its own timestamp).

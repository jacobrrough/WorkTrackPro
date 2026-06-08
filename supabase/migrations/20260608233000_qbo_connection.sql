-- WorkTrackAccounting — QuickBooks Online (QBO) OAuth connection (Phase 0 backend)
--
-- One SINGLETON row holding the live Intuit OAuth2 connection for this company file:
-- the realm (company) id, the rotating refresh_token, the short-lived access_token and
-- its expiry, plus light bookkeeping (who connected, when, last sync, last CDC cursor).
-- The netlify/functions/qbo-oauth.mjs function is the ONLY reader/writer; it uses the
-- service-role key and therefore bypasses RLS.
--
-- SECRET-BEARING TABLE — service-role ONLY. This table stores OAuth tokens, so it is
-- locked down exactly like public.api_rate_limits: RLS is enabled with NO policy and all
-- privileges are REVOKED from anon + authenticated. The browser client must never be able
-- to read a refresh_token or access_token. (Unlike the rest of the `accounting` schema,
-- this table is intentionally NOT granted to `authenticated`.) Status for the UI is served
-- through the function's `status` endpoint, which returns only non-secret fields.
--
-- SINGLETON: a partial unique index on a constant expression guarantees at most one row,
-- so the "single connection" is enforced at the database layer and the function can upsert
-- against a stable conflict target.
--
-- HARDENING (deferred): refresh_token / access_token are stored in plaintext here. Adding
-- encryption-at-rest (e.g. pgsodium/Vault-managed column encryption or KMS envelope
-- encryption in the function) is a deliberate follow-up and is NOT done in this migration.
--
-- ADDITIVE-ONLY: every object lives in schema `accounting`; the only cross-schema FK is on
-- the accounting (child) side -> public.profiles(id) for connected_by (set-null on profile
-- delete, matching every accounting table's created_by precedent). No public.* object is
-- altered or dropped.
--
-- IDEMPOTENT: CREATE TABLE IF NOT EXISTS, guarded unique-index creation, guarded REVOKEs.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS accounting.qbo_connection CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Singleton QBO OAuth connection (service-role only)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists accounting.qbo_connection (
  id uuid primary key default gen_random_uuid(),
  realm_id text not null,                     -- Intuit company (realm) id
  company_name text,                          -- cached from companyinfo
  refresh_token text not null,                -- rotating OAuth2 refresh token (SECRET)
  access_token text,                          -- short-lived bearer token (SECRET)
  access_token_expires_at timestamptz,        -- now() + expires_in at last token grant
  connected_by uuid references public.profiles(id) on delete set null,
  connected_at timestamptz not null default now(),
  last_sync_at timestamptz,                   -- last successful companyinfo/API touch
  last_cdc_cursor timestamptz,                -- high-water mark for future CDC change polling
  updated_at timestamptz not null default now()
);

-- Enforce a SINGLE row: a partial unique index on a constant expression admits at most one
-- row. The qbo-oauth function upserts against this so connect/reconnect overwrites in place.
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'accounting' and indexname = 'qbo_connection_singleton'
  ) then
    create unique index qbo_connection_singleton
      on accounting.qbo_connection ((true));
  end if;
end $$;

-- RLS on, NO policy: anon + authenticated get ZERO access (service_role bypasses RLS).
alter table accounting.qbo_connection enable row level security;
-- Intentionally NO policies (mirrors public.api_rate_limits): clients cannot read tokens.

-- Belt-and-suspenders: explicitly REVOKE every privilege from anon + authenticated so a
-- broad schema-level grant from a sibling accounting migration can never expose this
-- secret-bearing table. service_role (used by the Netlify function) bypasses RLS and is
-- left with access. This is the deliberate exception to the accounting schema's usual
-- "grant to authenticated" pattern.
revoke all on accounting.qbo_connection from anon, authenticated;

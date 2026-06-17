-- WorkTrackAccounting — Plaid bank feeds (Phase 0 backend)
--
-- Live bank/credit-card transaction feeds via Plaid. Three pieces:
--
--   1) accounting.plaid_items — one row per connected institution (a Plaid "Item").
--      Holds the Plaid item_id, the long-lived access_token, the transactions-sync
--      cursor, and light connection bookkeeping. The Netlify functions are the ONLY
--      reader/writer; they use the service-role key and therefore bypass RLS.
--
--   2) accounting.bank_accounts (existing) gains four nullable Plaid link columns so a
--      bank account can be wired to one Plaid account under an Item. A partial unique
--      index guarantees a given Plaid account maps to at most one bank account.
--
--   3) accounting.plaid_sync_runs — a per-sync audit row (counts + status) for the
--      /transactions/sync orchestration. Non-secret; standard can_read/can_write RLS.
--
-- SECRET-BEARING TABLE — service-role ONLY. accounting.plaid_items stores Plaid
-- access tokens, so it is locked down EXACTLY like accounting.qbo_connection (and
-- public.api_rate_limits): RLS is ENABLED with NO policy and all privileges are
-- REVOKED from anon + authenticated. The browser client must never be able to read an
-- access_token. (Unlike the rest of the `accounting` schema, this table is intentionally
-- NOT granted to `authenticated`.) Connection status for the UI is served through a
-- Netlify function that returns only non-secret fields. Because the access_token must
-- stay service-role-only, this migration grants table privileges PER TABLE (to
-- plaid_sync_runs only) rather than via a schema-wide `grant on all tables`, so the
-- secret table is never accidentally re-granted.
--
-- NOT A SINGLETON: unlike qbo_connection, multiple institutions are allowed — uniqueness
-- is on the Plaid item_id, not a constant expression.
--
-- ENCRYPTION-AT-REST: access_token is stored ENCRYPTED by the app layer via
-- netlify/functions/lib/tokenCrypto.mjs (encryptSecret/decryptSecret), exactly like
-- accounting.qbo_connection's tokens. The column type is plain text; the value is the
-- 'enc:v1:'… envelope when TOKEN_ENC_KEY is set (and transparent plaintext when it is not).
--
-- ADDITIVE-ONLY: every object lives in schema `accounting`; the only cross-schema FK is on
-- the accounting (child) side -> public.profiles(id) for connected_by (set-null on profile
-- delete, matching every accounting table's created_by/connected_by precedent). No public.*
-- object is altered or dropped.
--
-- IDEMPOTENT: CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, guarded index/trigger
-- creation, guarded REVOKE/GRANT, CREATE OR REPLACE.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS accounting.plaid_sync_runs CASCADE;
--   DROP TABLE IF EXISTS accounting.plaid_items CASCADE;
--   DROP INDEX IF EXISTS accounting.uq_acct_bank_accounts_plaid_account;
--   ALTER TABLE accounting.bank_accounts DROP COLUMN IF EXISTS plaid_subtype;
--   ALTER TABLE accounting.bank_accounts DROP COLUMN IF EXISTS plaid_mask;
--   ALTER TABLE accounting.bank_accounts DROP COLUMN IF EXISTS plaid_account_id;
--   ALTER TABLE accounting.bank_accounts DROP COLUMN IF EXISTS plaid_item_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Plaid Items — one per connected institution (service-role only, SECRET)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists accounting.plaid_items (
  id uuid primary key default gen_random_uuid(),
  item_id text not null unique,               -- Plaid Item id (stable per connection)
  access_token text,                          -- Plaid access token, app-layer ENCRYPTED (SECRET)
  institution_id text,                        -- Plaid institution id (e.g. ins_109508)
  institution_name text,                      -- cached display name
  cursor text,                                -- /transactions/sync high-water cursor
  status text not null default 'active'
    check (status in ('active', 'login_required', 'error', 'disconnected')),
  last_error text,                            -- last Plaid error (for the status UI)
  connected_by uuid references public.profiles(id) on delete set null,
  connected_at timestamptz not null default now(),
  last_sync_at timestamptz,                   -- last successful /transactions/sync touch
  updated_at timestamptz not null default now()
);

-- RLS on, NO policy: anon + authenticated get ZERO access (service_role bypasses RLS).
alter table accounting.plaid_items enable row level security;
-- Intentionally NO policies (mirrors accounting.qbo_connection / public.api_rate_limits):
-- clients cannot read access_token.

-- Belt-and-suspenders: explicitly REVOKE every privilege from anon + authenticated so a
-- broad schema-level grant from a sibling accounting migration can never expose this
-- secret-bearing table. service_role (used by the Netlify functions) bypasses RLS and is
-- left with access. This is the deliberate exception to the accounting schema's usual
-- "grant to authenticated" pattern.
revoke all on accounting.plaid_items from anon, authenticated;

-- Standard updated_at touch trigger (same accounting.touch_updated_at() used schema-wide).
-- Attached directly because the secret-bearing table does NOT go through
-- accounting._apply_standard_table (which would add the can_read/can_write policies).
drop trigger if exists touch_plaid_items on accounting.plaid_items;
create trigger touch_plaid_items
  before update on accounting.plaid_items
  for each row execute function accounting.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) bank_accounts — Plaid link columns (+ one-account-per-bank-account index)
-- ─────────────────────────────────────────────────────────────────────────────
alter table accounting.bank_accounts
  add column if not exists plaid_item_id uuid references accounting.plaid_items(id) on delete set null;
alter table accounting.bank_accounts
  add column if not exists plaid_account_id text;
alter table accounting.bank_accounts
  add column if not exists plaid_mask text;
alter table accounting.bank_accounts
  add column if not exists plaid_subtype text;

-- One Plaid account maps to at most one bank account (NULLs exempt — manual accounts have none).
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'accounting' and indexname = 'uq_acct_bank_accounts_plaid_account'
  ) then
    create unique index uq_acct_bank_accounts_plaid_account
      on accounting.bank_accounts (plaid_item_id, plaid_account_id)
      where plaid_account_id is not null;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) plaid_sync_runs — per-sync audit log (non-secret; standard RLS)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists accounting.plaid_sync_runs (
  id uuid primary key default gen_random_uuid(),
  plaid_item_id uuid references accounting.plaid_items(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  added int not null default 0,               -- transactions added this run
  modified int not null default 0,            -- transactions modified this run
  removed int not null default 0,             -- transactions removed this run
  status text not null default 'running' check (status in ('running', 'ok', 'error')),
  error text
);

do $$
begin
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_plaid_sync_runs_item') then
    create index idx_acct_plaid_sync_runs_item on accounting.plaid_sync_runs(plaid_item_id, started_at desc);
  end if;
end $$;

-- Standard RLS (read=can_read, write=can_write) + audit; no updated_at column → pass false.
select accounting._apply_standard_table('plaid_sync_runs', false);

-- Grant PER TABLE (not schema-wide) so accounting.plaid_items stays service-role only.
-- service_role bypasses RLS but is granted here for parity with the rest of the schema.
grant select, insert, update, delete on accounting.plaid_sync_runs to authenticated, service_role;

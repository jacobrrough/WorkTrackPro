-- WorkTrackAccounting — Phase E SECURITY HARDENING 1/3 (E1): pgcrypto field encryption
--
-- ⚠️  HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING. Requires CPA and/or SECURITY sign-off
--     before this module is enabled. Ships FLAG-DARK (UI behind VITE_ACCOUNTING_ENABLED) and the
--     accessors below are NOT wired into the live vendor/bank/employee edit forms in this phase
--     (that is the post-sign-off CUTOVER, see §CUTOVER). They exist + are proven at the DB layer
--     only, so the live forms keep using the retained PLAINTEXT columns until a human signs off.
--
-- WHAT THIS MIGRATION ADDS (purely ADDITIVE; G1 — ZERO public.* change, and NO existing accounting
--   column is altered or dropped; new objects only):
--   • extensions.pgcrypto is ensured (Supabase pre-installs it in schema `extensions`; we never put
--     crypto in public). All crypto is referenced SCHEMA-QUALIFIED as extensions.pgp_sym_encrypt /
--     extensions.pgp_sym_decrypt.
--   • accounting._enc_key()  — a PRIVATE SECURITY DEFINER accessor that reads the symmetric field
--     key from Supabase VAULT (vault.decrypted_secrets where name = 'accounting_field_key').
--     EXECUTE is REVOKED from anon/authenticated/public — only the definer accessors (which run as
--     the function OWNER) can reach it. Fail-CLOSED: if the Vault secret is absent it RAISES rather
--     than silently encrypting under a constant/empty key.
--   • New NULLable bytea ciphertext columns ALONGSIDE the retained plaintext (transition columns):
--       accounting.vendors        → tax_id_enc            (shadow of vendors.tax_id)
--       accounting.bank_accounts  → mask_enc              (shadow of bank_accounts.mask)
--       accounting.employees      → ssn_enc, bank_routing_enc, bank_account_enc, pay_rate_cents_enc
--   • SECURITY DEFINER write accessors (set_*) and read accessors (get_*) — the ONLY authorized
--     path to ciphertext. Each RE-CHECKS the module's RLS-equivalent role helper INSIDE the body
--     (can_write() for vendor/bank, can_payroll() for employee/SSN/wages) so a non-role caller is
--     denied even though the function is EXECUTE-grantable to `authenticated`.
--
-- DOUBLE-ENTRY (G3): this phase moves NO money and posts ZERO journal entries. Vacuously satisfied.
--
-- WHY bytea + accessors (defense-in-depth): the *_enc columns are opaque bytea; even if a client is
--   ever (mis)granted SELECT on the table, the ciphertext is useless without the Vault key, and the
--   key accessor is unreachable from client roles. The plaintext columns remain the source of truth
--   ONLY until the documented cutover nulls them in a SEPARATE future migration (post sign-off).
--
-- KEY MANAGEMENT (a human does this ONCE, out-of-band — the key value is NEVER in a migration/repo):
--     select vault.create_secret(
--       '<a 32+ byte cryptographically-random secret>',   -- e.g. encode(extensions.gen_random_bytes(32),'base64')
--       'accounting_field_key',
--       'WorkTrackAccounting field-encryption symmetric key (Phase E)');
--   Rotation = create a new key, re-encrypt every *_enc column under it, retire the old. pgp_sym is a
--   single symmetric key (no per-row key) — rotation is a deliberate, supervised operation. SEE the
--   "WHAT A HUMAN MUST VERIFY" list in the build report.
--
-- §CUTOVER (documented; performed by a human AFTER security sign-off — NOT executed here):
--   1. Seed the Vault key (above).
--   2. One-time backfill of ciphertext from the retained plaintext, e.g.:
--        select accounting.set_vendor_tax_id(id, tax_id)
--          from accounting.vendors where tax_id is not null;
--        select accounting.set_bank_account_mask(id, mask)
--          from accounting.bank_accounts where mask is not null;
--        select accounting.set_employee_ssn(id, ssn)
--          from accounting.employees where ssn is not null;
--        select accounting.set_employee_bank(id, bank_routing_masked, bank_account_masked)
--          from accounting.employees
--          where bank_routing_masked is not null or bank_account_masked is not null;
--        select accounting.set_employee_pay_rate(id, pay_rate_cents)
--          from accounting.employees;            -- wages are shadow-only (see WAGES note)
--   3. Verify every row round-trips: get_*(id) equals the original plaintext, and *_enc is non-null
--      everywhere the plaintext was non-null.
--   4. ONLY THEN, a FUTURE additive migration may null the plaintext columns (this migration does
--      NOT — additive-only, and the phase ships disabled). Until then plaintext is authoritative and
--      *_enc is a verified shadow.
--
-- WAGES note (HUMAN MUST VERIFY): employees.pay_rate_cents is read in PLAINTEXT by the payroll
--   engine + the commit_pay_run posting path. pay_rate_cents_enc is therefore "designed + (after
--   backfill) populated" belt-and-suspenders-at-rest, but the engine is NOT migrated off plaintext
--   in this phase. A human must decide whether to rework the engine to read via get_employee_pay_rate
--   before the plaintext wage column can ever be retired.
--
-- This migration is IDEMPOTENT (create extension if not exists; add column if not exists;
--   create or replace function; REVOKE/GRANT are idempotent).
--
-- ROLLBACK (lossless — plaintext columns are untouched, so no data is lost):
--   DROP FUNCTION IF EXISTS accounting.get_employee_pay_rate(uuid);
--   DROP FUNCTION IF EXISTS accounting.set_employee_pay_rate(uuid, bigint);
--   DROP FUNCTION IF EXISTS accounting.get_employee_bank(uuid);
--   DROP FUNCTION IF EXISTS accounting.set_employee_bank(uuid, text, text);
--   DROP FUNCTION IF EXISTS accounting.get_employee_ssn(uuid);
--   DROP FUNCTION IF EXISTS accounting.set_employee_ssn(uuid, text);
--   DROP FUNCTION IF EXISTS accounting.get_bank_account_mask(uuid);
--   DROP FUNCTION IF EXISTS accounting.set_bank_account_mask(uuid, text);
--   DROP FUNCTION IF EXISTS accounting.get_vendor_tax_id(uuid);
--   DROP FUNCTION IF EXISTS accounting.set_vendor_tax_id(uuid, text);
--   DROP FUNCTION IF EXISTS accounting.encryption_coverage();
--   DROP FUNCTION IF EXISTS accounting._enc_key();
--   ALTER TABLE accounting.employees     DROP COLUMN IF EXISTS pay_rate_cents_enc;
--   ALTER TABLE accounting.employees     DROP COLUMN IF EXISTS bank_account_enc;
--   ALTER TABLE accounting.employees     DROP COLUMN IF EXISTS bank_routing_enc;
--   ALTER TABLE accounting.employees     DROP COLUMN IF EXISTS ssn_enc;
--   ALTER TABLE accounting.bank_accounts DROP COLUMN IF EXISTS mask_enc;
--   ALTER TABLE accounting.vendors       DROP COLUMN IF EXISTS tax_id_enc;
--   -- (the Vault secret 'accounting_field_key', if seeded, is removed via vault.delete_secret by a human)

-- ─────────────────────────────────────────────────────────────────────────────
-- 0) Ensure pgcrypto in the `extensions` schema (NEVER in public). No-op if present.
-- ─────────────────────────────────────────────────────────────────────────────
create extension if not exists pgcrypto with schema extensions;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Private Vault-sourced key accessor (fail-closed; unreachable from clients)
-- ─────────────────────────────────────────────────────────────────────────────
-- search_path includes `vault` so decrypted_secrets resolves, `extensions` for crypto, and
-- pg_catalog last. SECURITY DEFINER so it can read vault.decrypted_secrets (a privileged view) on
-- behalf of the definer accessors; we IMMEDIATELY revoke EXECUTE from client roles below so the key
-- can only be obtained transitively through a set_/get_ accessor (which itself re-checks the role).
create or replace function accounting._enc_key()
returns text
language plpgsql
stable
security definer
set search_path = vault, extensions, accounting, pg_catalog
as $$
declare
  v_key text;
begin
  select decrypted_secret
    into v_key
    from vault.decrypted_secrets
   where name = 'accounting_field_key'
   limit 1;

  if v_key is null or length(v_key) = 0 then
    -- Fail CLOSED. We refuse to encrypt/decrypt under a missing key rather than fall back to a
    -- constant — a silent constant key would be a critical encryption-at-rest defect.
    raise exception
      'accounting field-encryption key is not configured: seed Vault secret ''accounting_field_key'' (see migration 031 header).'
      using errcode = 'config_file_error';
  end if;

  return v_key;
end;
$$;

-- Lock the key accessor down: clients can NEVER call it directly. Only the SECURITY DEFINER
-- accessors below (running as this function's owner) reach it. (REVOKE is idempotent.)
revoke execute on function accounting._enc_key() from public;
revoke execute on function accounting._enc_key() from anon;
revoke execute on function accounting._enc_key() from authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Additive ciphertext columns (NULLable; plaintext retained alongside)
-- ─────────────────────────────────────────────────────────────────────────────
alter table accounting.vendors        add column if not exists tax_id_enc          bytea;
alter table accounting.bank_accounts  add column if not exists mask_enc            bytea;
alter table accounting.employees      add column if not exists ssn_enc             bytea;
alter table accounting.employees      add column if not exists bank_routing_enc    bytea;
alter table accounting.employees      add column if not exists bank_account_enc    bytea;
alter table accounting.employees      add column if not exists pay_rate_cents_enc  bytea;

comment on column accounting.vendors.tax_id_enc is
  'Phase E: pgp_sym ciphertext of tax_id (shadow of plaintext vendors.tax_id during transition). Read via accounting.get_vendor_tax_id(); write via accounting.set_vendor_tax_id().';
comment on column accounting.bank_accounts.mask_enc is
  'Phase E: pgp_sym ciphertext of mask (shadow of plaintext bank_accounts.mask). Accessors: get/set_bank_account_mask.';
comment on column accounting.employees.ssn_enc is
  'Phase E: pgp_sym ciphertext of ssn (shadow of plaintext employees.ssn). can_payroll()-gated accessors: get/set_employee_ssn.';
comment on column accounting.employees.bank_routing_enc is
  'Phase E: pgp_sym ciphertext of bank_routing_masked (shadow). Accessor: get/set_employee_bank.';
comment on column accounting.employees.bank_account_enc is
  'Phase E: pgp_sym ciphertext of bank_account_masked (shadow). Accessor: get/set_employee_bank.';
comment on column accounting.employees.pay_rate_cents_enc is
  'Phase E: pgp_sym ciphertext of pay_rate_cents (SHADOW-ONLY; payroll engine still reads plaintext pay_rate_cents). Accessor: get/set_employee_pay_rate. HUMAN MUST VERIFY before retiring plaintext.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Accessors — the ONLY authorized read/write path to ciphertext
-- ─────────────────────────────────────────────────────────────────────────────
-- Every accessor: SECURITY DEFINER, search_path pinned to (extensions, accounting, public,
-- pg_catalog), and an INTERNAL role re-check (RLS-equivalent) so EXECUTE-to-authenticated is safe.
-- Writers keep the plaintext column in sync during transition is intentionally NOT done here — the
-- accessors write ONLY ciphertext; the live forms keep writing plaintext until the cutover. (Keeping
-- both writes here would imply the forms already call the accessor, which is the post-sign-off step.)

-- vendors.tax_id ---------------------------------------------------------------
create or replace function accounting.set_vendor_tax_id(p_vendor uuid, p_plaintext text)
returns void
language plpgsql
security definer
set search_path = extensions, accounting, public, pg_catalog
as $$
begin
  if not accounting.can_write() then
    raise exception 'insufficient privileges to set a vendor tax id'
      using errcode = 'insufficient_privilege';
  end if;
  update accounting.vendors
     set tax_id_enc = case
           when p_plaintext is null then null
           else extensions.pgp_sym_encrypt(p_plaintext, accounting._enc_key())
         end
   where id = p_vendor;
  if not found then
    raise exception 'vendor % not found', p_vendor using errcode = 'no_data_found';
  end if;
end;
$$;

create or replace function accounting.get_vendor_tax_id(p_vendor uuid)
returns text
language plpgsql
stable
security definer
set search_path = extensions, accounting, public, pg_catalog
as $$
declare
  v_cipher bytea;
begin
  if not accounting.can_read() then
    raise exception 'insufficient privileges to read a vendor tax id'
      using errcode = 'insufficient_privilege';
  end if;
  select tax_id_enc into v_cipher from accounting.vendors where id = p_vendor;
  if v_cipher is null then
    return null;
  end if;
  return extensions.pgp_sym_decrypt(v_cipher, accounting._enc_key());
end;
$$;

-- bank_accounts.mask -----------------------------------------------------------
create or replace function accounting.set_bank_account_mask(p_account uuid, p_plaintext text)
returns void
language plpgsql
security definer
set search_path = extensions, accounting, public, pg_catalog
as $$
begin
  if not accounting.can_write() then
    raise exception 'insufficient privileges to set a bank account mask'
      using errcode = 'insufficient_privilege';
  end if;
  update accounting.bank_accounts
     set mask_enc = case
           when p_plaintext is null then null
           else extensions.pgp_sym_encrypt(p_plaintext, accounting._enc_key())
         end
   where id = p_account;
  if not found then
    raise exception 'bank account % not found', p_account using errcode = 'no_data_found';
  end if;
end;
$$;

create or replace function accounting.get_bank_account_mask(p_account uuid)
returns text
language plpgsql
stable
security definer
set search_path = extensions, accounting, public, pg_catalog
as $$
declare
  v_cipher bytea;
begin
  if not accounting.can_read() then
    raise exception 'insufficient privileges to read a bank account mask'
      using errcode = 'insufficient_privilege';
  end if;
  select mask_enc into v_cipher from accounting.bank_accounts where id = p_account;
  if v_cipher is null then
    return null;
  end if;
  return extensions.pgp_sym_decrypt(v_cipher, accounting._enc_key());
end;
$$;

-- employees.ssn (can_payroll()-gated — stricter than can_read/can_write) -------
create or replace function accounting.set_employee_ssn(p_employee uuid, p_plaintext text)
returns void
language plpgsql
security definer
set search_path = extensions, accounting, public, pg_catalog
as $$
begin
  if not accounting.can_payroll() then
    raise exception 'insufficient privileges to set an employee SSN'
      using errcode = 'insufficient_privilege';
  end if;
  update accounting.employees
     set ssn_enc = case
           when p_plaintext is null then null
           else extensions.pgp_sym_encrypt(p_plaintext, accounting._enc_key())
         end
   where id = p_employee;
  if not found then
    raise exception 'employee % not found', p_employee using errcode = 'no_data_found';
  end if;
end;
$$;

create or replace function accounting.get_employee_ssn(p_employee uuid)
returns text
language plpgsql
stable
security definer
set search_path = extensions, accounting, public, pg_catalog
as $$
declare
  v_cipher bytea;
begin
  if not accounting.can_payroll() then
    raise exception 'insufficient privileges to read an employee SSN'
      using errcode = 'insufficient_privilege';
  end if;
  select ssn_enc into v_cipher from accounting.employees where id = p_employee;
  if v_cipher is null then
    return null;
  end if;
  return extensions.pgp_sym_decrypt(v_cipher, accounting._enc_key());
end;
$$;

-- employees bank routing/account masks (can_payroll()-gated; one writer for both) -----
create or replace function accounting.set_employee_bank(
  p_employee uuid,
  p_routing_plaintext text,
  p_account_plaintext text
)
returns void
language plpgsql
security definer
set search_path = extensions, accounting, public, pg_catalog
as $$
begin
  if not accounting.can_payroll() then
    raise exception 'insufficient privileges to set employee bank data'
      using errcode = 'insufficient_privilege';
  end if;
  update accounting.employees
     set bank_routing_enc = case
           when p_routing_plaintext is null then null
           else extensions.pgp_sym_encrypt(p_routing_plaintext, accounting._enc_key())
         end,
         bank_account_enc = case
           when p_account_plaintext is null then null
           else extensions.pgp_sym_encrypt(p_account_plaintext, accounting._enc_key())
         end
   where id = p_employee;
  if not found then
    raise exception 'employee % not found', p_employee using errcode = 'no_data_found';
  end if;
end;
$$;

-- Returns the two decrypted values as a single-row table so a caller never has to make two calls.
create or replace function accounting.get_employee_bank(p_employee uuid)
returns table(bank_routing text, bank_account text)
language plpgsql
stable
security definer
set search_path = extensions, accounting, public, pg_catalog
as $$
declare
  v_routing bytea;
  v_account bytea;
begin
  if not accounting.can_payroll() then
    raise exception 'insufficient privileges to read employee bank data'
      using errcode = 'insufficient_privilege';
  end if;
  select bank_routing_enc, bank_account_enc
    into v_routing, v_account
    from accounting.employees where id = p_employee;
  bank_routing := case when v_routing is null then null
                       else extensions.pgp_sym_decrypt(v_routing, accounting._enc_key()) end;
  bank_account := case when v_account is null then null
                       else extensions.pgp_sym_decrypt(v_account, accounting._enc_key()) end;
  return next;
end;
$$;

-- employees.pay_rate_cents (SHADOW-ONLY wage encryption; can_payroll()-gated) --
-- Stored as the decimal text of the bigint cents so the same pgp_sym text codec round-trips it.
create or replace function accounting.set_employee_pay_rate(p_employee uuid, p_pay_rate_cents bigint)
returns void
language plpgsql
security definer
set search_path = extensions, accounting, public, pg_catalog
as $$
begin
  if not accounting.can_payroll() then
    raise exception 'insufficient privileges to set an employee pay rate'
      using errcode = 'insufficient_privilege';
  end if;
  update accounting.employees
     set pay_rate_cents_enc = case
           when p_pay_rate_cents is null then null
           else extensions.pgp_sym_encrypt(p_pay_rate_cents::text, accounting._enc_key())
         end
   where id = p_employee;
  if not found then
    raise exception 'employee % not found', p_employee using errcode = 'no_data_found';
  end if;
end;
$$;

create or replace function accounting.get_employee_pay_rate(p_employee uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = extensions, accounting, public, pg_catalog
as $$
declare
  v_cipher bytea;
begin
  if not accounting.can_payroll() then
    raise exception 'insufficient privileges to read an employee pay rate'
      using errcode = 'insufficient_privilege';
  end if;
  select pay_rate_cents_enc into v_cipher from accounting.employees where id = p_employee;
  if v_cipher is null then
    return null;
  end if;
  return extensions.pgp_sym_decrypt(v_cipher, accounting._enc_key())::bigint;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Read-only encryption-coverage probe (drives the Security Overview transition %)
-- ─────────────────────────────────────────────────────────────────────────────
-- Returns per-field counts of (plaintext non-null) vs (ciphertext non-null) so the UI can show how
-- far the cutover backfill has progressed. can_read()-gated; reveals only COUNTS, never values.
create or replace function accounting.encryption_coverage()
returns table(field text, plaintext_count bigint, encrypted_count bigint)
language plpgsql
stable
security definer
set search_path = accounting, public, pg_catalog
as $$
begin
  if not accounting.can_read() then
    raise exception 'insufficient privileges to read encryption coverage'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select 'vendors.tax_id'::text,
           count(*) filter (where tax_id is not null),
           count(*) filter (where tax_id_enc is not null)
      from accounting.vendors;
  return query
    select 'bank_accounts.mask'::text,
           count(*) filter (where mask is not null),
           count(*) filter (where mask_enc is not null)
      from accounting.bank_accounts;
  return query
    select 'employees.ssn'::text,
           count(*) filter (where ssn is not null),
           count(*) filter (where ssn_enc is not null)
      from accounting.employees;
  return query
    select 'employees.bank_routing'::text,
           count(*) filter (where bank_routing_masked is not null),
           count(*) filter (where bank_routing_enc is not null)
      from accounting.employees;
  return query
    select 'employees.bank_account'::text,
           count(*) filter (where bank_account_masked is not null),
           count(*) filter (where bank_account_enc is not null)
      from accounting.employees;
  return query
    select 'employees.pay_rate_cents'::text,
           count(*) filter (where pay_rate_cents is not null),
           count(*) filter (where pay_rate_cents_enc is not null)
      from accounting.employees;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Grants — accessors are EXECUTE-grantable to authenticated (gating is in-body); _enc_key is NOT.
-- ─────────────────────────────────────────────────────────────────────────────
-- The schema default privileges (migration 001) already grant EXECUTE on new functions to
-- authenticated + service_role. Re-state for the new accessors for unambiguity, then re-revoke the
-- private key accessor (belt-and-suspenders against the default-privilege grant).
grant execute on function accounting.set_vendor_tax_id(uuid, text)            to authenticated, service_role;
grant execute on function accounting.get_vendor_tax_id(uuid)                  to authenticated, service_role;
grant execute on function accounting.set_bank_account_mask(uuid, text)        to authenticated, service_role;
grant execute on function accounting.get_bank_account_mask(uuid)              to authenticated, service_role;
grant execute on function accounting.set_employee_ssn(uuid, text)             to authenticated, service_role;
grant execute on function accounting.get_employee_ssn(uuid)                   to authenticated, service_role;
grant execute on function accounting.set_employee_bank(uuid, text, text)      to authenticated, service_role;
grant execute on function accounting.get_employee_bank(uuid)                  to authenticated, service_role;
grant execute on function accounting.set_employee_pay_rate(uuid, bigint)      to authenticated, service_role;
grant execute on function accounting.get_employee_pay_rate(uuid)              to authenticated, service_role;
grant execute on function accounting.encryption_coverage()                    to authenticated, service_role;

revoke execute on function accounting._enc_key() from public;
revoke execute on function accounting._enc_key() from anon;
revoke execute on function accounting._enc_key() from authenticated;

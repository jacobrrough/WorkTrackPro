-- WorkTrackAccounting — TAX-SYNC: quarterly tax-table auto-refresh + drift alert
--                        (ADVISORY-ONLY — NEVER auto-applies rate changes)
--
-- Implements docs/BIGCAPITAL_MINED_REFERENCE.md §4. A Netlify SCHEDULED function
-- (separate backend lane, server-env-gated) pulls fresh CDTFA/EDD tax tables every
-- quarter, snapshots them, DIFFS them against the active accounting.tax_rates, and on
-- mismatch inserts a "drift" row (status='open'). THAT ROW IS THE ADMIN ALERT and lives
-- ENTIRELY within accounting.* — no public.* / system_notifications writes. A stored
-- tax RATE is only ever changed by the explicit, admin-confirmed apply_tax_table_drift
-- RPC below; the scheduled function NEVER mutates accounting.tax_rates.
--
-- WHY THIS SHAPE (purely additive, schema `accounting` only — G1)
--   Three new tables, all in `accounting`, all wired with accounting._apply_standard_table
--   (RLS read=can_read / write=can_write, audit + touch triggers). §4 names these three
--   tables explicitly with per-row history (one snapshot per pull) and per-row review
--   status (open|reviewed|applied|dismissed) semantics that a single KV settings row
--   cannot express — so unlike D1/C1 this IS the intended additive table shape, not a
--   settings row. Every FK is on the accounting (child) side; the only cross-schema FK is
--   tax_table_drift.reviewed_by -> public.profiles(id) ON DELETE SET NULL (same additive
--   pattern as dimensions.created_by in migration 013 — public.profiles is NOT altered).
--
--   • accounting.tax_table_sources  — what to pull and from where. Seeded with CDTFA
--     (CA sales/use tax) and CA EDD (payroll UI/ETT/SDI/PIT), idempotently (where not
--     exists on the canonical name). url = human landing page; official_file_url = the
--     downloadable data file the fetcher PREFERS over fragile HTML scraping.
--   • accounting.tax_table_snapshots — append-only history; one row per pull. content_hash
--     (sha-256 of the normalized parsed payload) enables no-op/dedupe detection; parsed is
--     the normalized [{jurisdiction, rate, effective_date, ...}] set; raw is the (size-
--     capped, untrusted) fetched text. No updated_at (history rows are never mutated).
--   • accounting.tax_table_drift — one row per detected mismatch. diff is the old-vs-new
--     per-rate detail the UI renders side-by-side; status drives the admin badge/list.
--
--   Two SECURITY DEFINER, accounting_admin-ONLY RPCs (mirroring
--   accounting.set_closed_through_date from migration 016 exactly — has_role gate or raise
--   insufficient_privilege; search_path pinned; writes go through the audited tables):
--     • accounting.apply_tax_table_drift(p_drift_id)   — admin-confirmed: applies the
--       drift's new rates to accounting.tax_rates, then marks the drift 'applied'. This is
--       the ONLY path that mutates accounting.tax_rates. NEVER called by the cron.
--     • accounting.dismiss_tax_table_drift(p_drift_id) — marks the drift 'dismissed'. No
--       rate change.
--   The accounting.tax_rates table policy is can_write() (admin OR accountant); §4 requires
--   rate APPLY to be accounting_admin-ONLY, so the RPC is the enforcement point (it raises
--   for a non-admin). We deliberately do NOT tighten the tax_rates table policy — that would
--   regress accountant edits to other rate fields. The screen calls these RPCs, never a raw
--   tax_rates/drift update.
--
-- HOW APPLY MATCHES A RATE (deterministic, owned by the diff payload — not guessed in SQL)
--   accounting.tax_rates carries a unique-ish human `name` (e.g. 'CA Statewide Base') and a
--   `rate numeric(7,5)` + `effective_date date` (and is_active). It has NO single
--   jurisdiction->rate mapping (jurisdiction is an enum of state|county|district|... and
--   many rows share a value). So each diff entry the JS layer produces carries the EXACT
--   target accounting.tax_rates.name as `rate_name`, plus the proposed `new_rate` and
--   optional `effective_date`. apply_tax_table_drift updates the matching active rate by
--   name (or inserts a new active rate if none exists). IMPORTANT: accounting.tax_rates was
--   created with _apply_standard_table('tax_rates', false) — it has NO updated_at column —
--   so the apply path must NOT set updated_at on tax_rates.
--
-- NO MONEY MOVED, NO JOURNAL ENTRY (G3 vacuous — advisory-only):
--   This module posts ZERO journal entries and moves ZERO money. The only thing it ever
--   changes in the books is REFERENCE DATA (a stored tax rate), and only via the explicit
--   admin RPC. Changing a stored rate is not a financial transaction (no debit/credit); it
--   only affects how FUTURE invoices compute tax, each of which posts its own balanced JE
--   through the existing A1 path. There is no post_journal_entry call anywhere here. This
--   module's equivalent invariant proofs are: (1) the scheduled function with the env flag
--   OFF performs no fetch and no DB write; (2) ONLY the admin RPC — not the cron — can
--   mutate accounting.tax_rates.
--
-- LEGAL (G9): the CDTFA/EDD source URLs + seeded cadence are starting points a human MUST
--   verify against the live files (each parser is marked "VERIFY against the live format").
--   Every TAX-SYNC screen/export must show: "Not certified tax software. Always verify with
--   a CPA/EA." The DB cannot enforce that banner; it is enforced in the TAX-SYNC UI lane.
--
-- This migration is IDEMPOTENT (create table if not exists; guarded index creation; insert
--   ... where not exists; create or replace function; _apply_standard_table is drop/create).
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS accounting.dismiss_tax_table_drift(uuid);
--   DROP FUNCTION IF EXISTS accounting.apply_tax_table_drift(uuid);
--   DROP TABLE IF EXISTS accounting.tax_table_drift CASCADE;
--   DROP TABLE IF EXISTS accounting.tax_table_snapshots CASCADE;
--   DROP TABLE IF EXISTS accounting.tax_table_sources CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Sources — what to pull and from where
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists accounting.tax_table_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  kind text not null check (kind in ('sales', 'payroll')),
  jurisdiction text,
  -- url = human-readable landing page (for the admin to click through and verify).
  url text,
  -- official_file_url = the downloadable data file the fetcher PREFERS over HTML scraping.
  official_file_url text,
  check_frequency_days int not null default 90 check (check_frequency_days > 0),
  active boolean not null default true,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Snapshots — append-only history; one row per pull
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists accounting.tax_table_snapshots (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references accounting.tax_table_sources(id) on delete cascade,
  fetched_at timestamptz not null default now(),
  -- sha-256 (hex) of the normalized parsed payload — no-op/dedupe detection across pulls.
  content_hash text,
  -- normalized [{ jurisdiction, rate, effective_date, ... }] produced by the source parser.
  parsed jsonb,
  -- raw fetched text (size-capped + treated as untrusted by the fetcher before insert).
  raw text,
  -- non-null on a fetch/parse failure so a failed pull is RECORDED, never silent (fail-safe).
  error text,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Drift — one row per detected mismatch; THIS ROW IS THE ADMIN ALERT
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists accounting.tax_table_drift (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references accounting.tax_table_sources(id) on delete cascade,
  snapshot_id uuid references accounting.tax_table_snapshots(id) on delete set null,
  detected_at timestamptz not null default now(),
  -- old-vs-new detail the UI renders side-by-side. Each element (produced by the JS diff
  -- layer) carries at least: rate_name (the accounting.tax_rates.name to target),
  -- jurisdiction, current_rate, new_rate, and optionally effective_date + a change label.
  diff jsonb,
  severity text not null check (severity in ('info', 'warning', 'critical')) default 'warning',
  status text not null check (status in ('open', 'reviewed', 'applied', 'dismissed')) default 'open',
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes ---------------------------------------------------------------------
do $$
begin
  -- snapshot history per source, newest first.
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_tax_snapshots_source') then
    create index idx_acct_tax_snapshots_source
      on accounting.tax_table_snapshots(source_id, fetched_at desc);
  end if;
  -- powers the "open drift" badge + list query (status='open' ordered by recency).
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_tax_drift_status') then
    create index idx_acct_tax_drift_status
      on accounting.tax_table_drift(status, detected_at desc);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_tax_drift_source') then
    create index idx_acct_tax_drift_source
      on accounting.tax_table_drift(source_id);
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Seed the two sources (idempotent: insert only when the canonical name is absent)
-- ─────────────────────────────────────────────────────────────────────────────
-- CDTFA — California sales & use tax rates. official_file_url points at the CDTFA open-data
-- portal "Effective Sales and Use Tax Rates" dataset (a downloadable data file, preferred
-- over scraping the HTML rates page). VERIFY the live file format before enabling sync.
insert into accounting.tax_table_sources (name, kind, jurisdiction, url, official_file_url, check_frequency_days, active)
  select
    'CDTFA — CA Sales & Use Tax',
    'sales',
    'CA',
    'https://cdtfa.ca.gov/taxes-and-fees/sales-use-tax-rates.htm',
    'https://cdtfa.ca.gov/dataportal/dataset.htm?url=SalesTaxRates',
    90,
    true
  where not exists (select 1 from accounting.tax_table_sources where name = 'CDTFA — CA Sales & Use Tax');

-- CA EDD — payroll UI/ETT/SDI/PIT rates. official_file_url points at DE 201 (the annual
-- "California Payroll Taxes" rate sheet PDF); url is the rates-and-withholding landing page.
-- VERIFY the live file format before enabling sync.
insert into accounting.tax_table_sources (name, kind, jurisdiction, url, official_file_url, check_frequency_days, active)
  select
    'CA EDD — Payroll (UI/ETT/SDI/PIT)',
    'payroll',
    'CA',
    'https://edd.ca.gov/en/payroll_taxes/rates_and_withholding/',
    'https://edd.ca.gov/siteassets/files/pdf_pub_ctr/de201.pdf',
    90,
    true
  where not exists (select 1 from accounting.tax_table_sources where name = 'CA EDD — Payroll (UI/ETT/SDI/PIT)');

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Standard RLS + audit + touch wiring
-- ─────────────────────────────────────────────────────────────────────────────
-- sources/drift carry updated_at (touch trigger); snapshots are append-only history (no
-- updated_at -> pass false). All three: RLS read=can_read(), write=can_write(), audit.
-- The scheduled function writes snapshots/drift via the SERVICE ROLE (which bypasses RLS);
-- the admin RPCs below run SECURITY DEFINER. can_write() gates any direct authenticated
-- write path.
select accounting._apply_standard_table('tax_table_sources');
select accounting._apply_standard_table('tax_table_snapshots', false);
select accounting._apply_standard_table('tax_table_drift');

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) Admin-only RPC: APPLY a drift's new rates to accounting.tax_rates
-- ─────────────────────────────────────────────────────────────────────────────
-- accounting_admin-ONLY (mirrors set_closed_through_date). Iterates the drift's diff array;
-- for each entry with a target rate_name + a numeric new_rate, UPDATEs the matching ACTIVE
-- accounting.tax_rates row (rate + effective_date when supplied), or INSERTs a new active
-- rate if none matches by name. Then marks the drift 'applied' with reviewer + timestamp.
-- This is the ONLY path that mutates accounting.tax_rates; it requires an explicit admin
-- call and is NEVER invoked by the scheduled function.
--
-- NOTE on updated_at: accounting.tax_rates has NO updated_at column (created via
-- _apply_standard_table('tax_rates', false)), so we never set it here. accounting.tax_rates
-- also has no audit/touch trigger (same reason) — that is the pre-existing schema; this RPC
-- does not change it. The DRIFT row's transition to 'applied' IS audited (drift carries the
-- standard audit trigger), capturing actor + before/after for the admin action.
create or replace function accounting.apply_tax_table_drift(p_drift_id uuid)
returns uuid
language plpgsql
security definer
set search_path = accounting, public, pg_catalog
as $$
declare
  v_status text;
  v_diff   jsonb;
  v_entry  jsonb;
  v_name   text;
  v_rate   numeric(7,5);
  v_eff    date;
  v_updated int;
begin
  if not accounting.has_role('accounting_admin') then
    raise exception 'only accounting_admin may apply tax-table drift'
      using errcode = 'insufficient_privilege';
  end if;

  select status, diff into v_status, v_diff
    from accounting.tax_table_drift
   where id = p_drift_id
   for update;

  if not found then
    raise exception 'tax-table drift % not found', p_drift_id;
  end if;

  -- Only an open or already-reviewed drift may be applied; applied/dismissed are terminal.
  if v_status not in ('open', 'reviewed') then
    raise exception 'tax-table drift % is % and cannot be applied (only open/reviewed may be applied)',
      p_drift_id, v_status using errcode = 'check_violation';
  end if;

  -- Walk each proposed rate change. Defensive: skip entries lacking a usable rate_name or a
  -- numeric new_rate rather than failing the whole apply (the diff is built from external,
  -- best-effort parsed data).
  if v_diff is not null and jsonb_typeof(v_diff) = 'array' then
    for v_entry in select * from jsonb_array_elements(v_diff)
    loop
      v_name := nullif(trim(coalesce(v_entry ->> 'rate_name', '')), '');

      -- new_rate must be JSON-numeric; ignore non-numeric / missing values.
      if v_name is null
         or v_entry -> 'new_rate' is null
         or jsonb_typeof(v_entry -> 'new_rate') <> 'number' then
        continue;
      end if;

      v_rate := (v_entry ->> 'new_rate')::numeric(7,5);
      -- effective_date is optional; tolerate absent/empty/invalid by leaving it null.
      begin
        v_eff := nullif(trim(coalesce(v_entry ->> 'effective_date', '')), '')::date;
      exception when others then
        v_eff := null;
      end;

      if v_rate < 0 then
        continue; -- rates are non-negative (matches the tax_rates CHECK); skip bad data.
      end if;

      -- Update the matching active rate by name; only overwrite effective_date when provided.
      update accounting.tax_rates
         set rate = v_rate,
             effective_date = coalesce(v_eff, effective_date)
       where name = v_name
         and is_active = true;
      get diagnostics v_updated = row_count;

      -- No active rate by that name -> create one (advisory apply may introduce a new rate).
      if v_updated = 0 then
        insert into accounting.tax_rates (name, rate, jurisdiction, effective_date, is_active)
        values (v_name, v_rate, null, v_eff, true);
      end if;
    end loop;
  end if;

  update accounting.tax_table_drift
     set status = 'applied',
         reviewed_by = auth.uid(),
         reviewed_at = now()
   where id = p_drift_id;

  return p_drift_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) Admin-only RPC: DISMISS a drift (no rate change)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function accounting.dismiss_tax_table_drift(p_drift_id uuid)
returns uuid
language plpgsql
security definer
set search_path = accounting, public, pg_catalog
as $$
declare
  v_status text;
begin
  if not accounting.has_role('accounting_admin') then
    raise exception 'only accounting_admin may dismiss tax-table drift'
      using errcode = 'insufficient_privilege';
  end if;

  select status into v_status
    from accounting.tax_table_drift
   where id = p_drift_id
   for update;

  if not found then
    raise exception 'tax-table drift % not found', p_drift_id;
  end if;

  if v_status not in ('open', 'reviewed') then
    raise exception 'tax-table drift % is % and cannot be dismissed (only open/reviewed may be dismissed)',
      p_drift_id, v_status using errcode = 'check_violation';
  end if;

  update accounting.tax_table_drift
     set status = 'dismissed',
         reviewed_by = auth.uid(),
         reviewed_at = now()
   where id = p_drift_id;

  return p_drift_id;
end;
$$;

-- Belt-and-suspenders explicit grants (default privileges from migration 001 already cover
-- new objects; restated for unambiguous current-object grants, matching the convention in
-- migrations 007/013/016).
grant select, insert, update, delete on all tables in schema accounting to authenticated, service_role;
grant usage, select on all sequences in schema accounting to authenticated, service_role;
grant execute on all functions in schema accounting to authenticated, service_role;

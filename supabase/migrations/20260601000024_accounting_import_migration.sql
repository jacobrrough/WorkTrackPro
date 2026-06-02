-- WorkTrackAccounting — IMPORT/MIGRATION 2/2: import batches, staging, account map, commit RPC
--
-- ⚠️  UNVERIFIED / HELD MODULE — NOT FOR FILING. Historical-data import from
--     QuickBooks Online (CSV/JSON), QuickBooks Desktop (IIF), and generic Excel/CSV
--     into accounting.*. Ships FLAG-DARK; requires CPA and/or security sign-off
--     before the module is enabled. HUMANS MUST VERIFY: account-mapping fidelity,
--     no double-posting, and that opening balances reconcile to the source trial
--     balance (see the build report). The "UNVERIFIED — NOT FOR FILING" banner is
--     rendered on every screen + export by the UI; this header records the hold.
--
-- WHAT THIS MIGRATION ADDS (all additive, all in schema accounting; ZERO public.* change):
--   • accounting.import_batches      — one row per import job (header: source, status,
--                                       file_meta, summary).
--   • accounting.import_staging      — one row per parsed source record (raw + mapped
--                                       jsonb, status, error). DEDUP via
--                                       unique (batch_id, content_hash), mirroring
--                                       bank_transactions' unique (bank_account_id, external_id).
--   • accounting.import_account_map  — the chart-of-accounts mapping wizard's persistence:
--                                       source account -> accounting.accounts target
--                                       (or "create as new").
--   • accounting.commit_import_batch(uuid) -> jsonb  — the ONLY path that touches the
--                                       ledger. SECURITY DEFINER, ADMIN-ONLY. Builds
--                                       BALANCED opening-balance journal entries as
--                                       DRAFTS and posts them through the EXISTING
--                                       accounting.post_journal_entry (so the GL guard
--                                       enforces debits = credits + >= 2 lines). Uses
--                                       3050 Opening Balance Equity / 2050 Opening
--                                       Balance Liabilities (resolved from
--                                       settings.default_accounts) as the offset.
--                                       Idempotent: committing a batch twice is a no-op.
--
-- DOUBLE-ENTRY (G3): The three TABLES move ZERO money — they are staging only. ALL money
--   movement happens exclusively inside commit_import_batch, which NEVER writes to
--   journal_lines on a posted entry and NEVER flips status to 'posted' directly: it
--   inserts draft entries + lines, then calls accounting.post_journal_entry, whose
--   guard_journal_entry trigger validates balance and line count at the single
--   draft->posted enforcement point. An unbalanced import therefore CANNOT post — the
--   guard raises and the whole commit transaction rolls back (no half-posted import).
--
-- RLS / AUDIT: all three tables get the standard RLS + audit + touch wiring via
--   accounting._apply_standard_table, but with a STRICTER write check: import is an
--   admin-only operation, so write = accounting.has_role('accounting_admin') (not the
--   default can_write(), which also admits the 'accountant' role). Reads use the
--   standard can_read(). The commit RPC re-checks has_role('accounting_admin') itself
--   (defense in depth: RLS guards table writes, the RPC guards the posting path).
--
-- This migration is IDEMPOTENT (create table if not exists; guarded index creation;
--   create or replace function; _apply_standard_table is itself idempotent).
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS accounting.commit_import_batch(uuid);
--   DROP TABLE IF EXISTS accounting.import_staging CASCADE;
--   DROP TABLE IF EXISTS accounting.import_account_map CASCADE;
--   DROP TABLE IF EXISTS accounting.import_batches CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Tables
-- ─────────────────────────────────────────────────────────────────────────────

-- Header: one row per import job.
create table if not exists accounting.import_batches (
  id uuid primary key default gen_random_uuid(),
  -- source system. 'qbd' = QuickBooks Desktop (.IIF). 'qbo' = QuickBooks Online
  -- (CSV or JSON export). 'csv' = generic Excel/CSV.
  source text not null check (source in ('qbo', 'qbd', 'csv')),
  -- finer-grained shape within source, e.g. 'qbo_csv' | 'qbo_json' | 'iif' | 'xlsx' | 'csv'.
  source_detail text,
  -- lifecycle. draft -> mapping -> ready -> committed (terminal). failed/discarded are
  -- terminal off-ramps. ONLY a 'ready' batch may be committed.
  status text not null default 'draft'
    check (status in ('draft', 'mapping', 'ready', 'committed', 'failed', 'discarded')),
  -- {name, bytes, rowCount, sha256, importedShapes[], storagePath?} — storagePath (if
  -- the source file is parked in the existing storage bucket) lives here; no new infra.
  file_meta jsonb not null default '{}'::jsonb,
  -- post-commit summary: counts by entity, opening-balance total cents, posted JE ids,
  -- accounts created, dedup inserted/skipped.
  summary jsonb not null default '{}'::jsonb,
  -- the opening-balance "as of" date used for the posted entries (defaults at the API
  -- layer to the day before fiscal-year start). Plain date column.
  opening_balance_date date,
  committed_at timestamptz,
  committed_by uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The chart-of-accounts mapping wizard's persistence: source COA account -> target.
-- Created BEFORE import_staging so nothing depends on table order; both child tables
-- cascade-delete with the batch.
create table if not exists accounting.import_account_map (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references accounting.import_batches(id) on delete cascade,
  -- the source account's stable key as it appeared in the file (number or name).
  source_account_key text not null,
  source_account_name text,
  -- the source system's type string, used only by the suggested-match heuristic.
  source_account_type text,
  -- the chosen target in our chart. on delete restrict: you cannot delete an
  -- accounting.accounts row that a mapping still points at.
  target_account_id uuid references accounting.accounts(id) on delete restrict,
  -- if true and target is null, commit creates a new accounting.accounts row for this
  -- source account (additive) before posting. The fields below seed that new account.
  create_as_new boolean not null default false,
  new_account_number text,
  new_account_type text check (new_account_type in ('asset', 'liability', 'equity', 'income', 'expense')),
  new_account_subtype text,
  status text not null default 'unmapped' check (status in ('unmapped', 'mapped', 'ignored')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (batch_id, source_account_key)
);

-- One row per parsed source record. raw = verbatim parse; mapped = normalized shape
-- the commit RPC consumes (see the mapped-shape contract on commit_import_batch below).
create table if not exists accounting.import_staging (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references accounting.import_batches(id) on delete cascade,
  entity_type text not null check (entity_type in (
    'account', 'customer', 'vendor', 'open_invoice', 'open_bill',
    'opening_balance', 'journal_entry', 'unsupported'
  )),
  raw jsonb not null,
  -- null until the wizard maps the row. For 'opening_balance'/'journal_entry' rows the
  -- commit RPC reads the resolved posting data from here (see contract below).
  mapped jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'mapped', 'skipped', 'committed', 'error')),
  error text,
  -- sha256 of the canonicalized raw record within (batch, entity_type), computed by the
  -- client parser. DEDUP: re-staging the same source record is a no-op (unique below).
  content_hash text not null,
  -- stamped by commit_import_batch with the entry this row contributed to (audit trail).
  posted_journal_entry_id uuid references accounting.journal_entries(id) on delete set null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  -- DEDUP (mirrors bank_transactions' unique(bank_account_id, external_id)): the same
  -- content_hash cannot be staged twice in one batch.
  unique (batch_id, content_hash)
);

-- Indexes (guarded; mirrors the pattern used by every prior accounting migration).
do $$
begin
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_import_batches_status') then
    create index idx_acct_import_batches_status on accounting.import_batches(status, created_at desc);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_import_staging_batch') then
    create index idx_acct_import_staging_batch on accounting.import_staging(batch_id, status);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_import_staging_entity') then
    create index idx_acct_import_staging_entity on accounting.import_staging(batch_id, entity_type);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_import_acctmap_batch') then
    create index idx_acct_import_acctmap_batch on accounting.import_account_map(batch_id, status);
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) RLS + audit + touch (admin-only write)
-- ─────────────────────────────────────────────────────────────────────────────
-- read = can_read(); write = has_role('accounting_admin') — import is admin-only,
-- stricter than the default can_write() (which also admits 'accountant').
select accounting._apply_standard_table('import_batches',     true,  'accounting.has_role(''accounting_admin'')');
select accounting._apply_standard_table('import_account_map',  true,  'accounting.has_role(''accounting_admin'')');
select accounting._apply_standard_table('import_staging',      false, 'accounting.has_role(''accounting_admin'')');

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Commit RPC — the ONLY path that touches the ledger
-- ─────────────────────────────────────────────────────────────────────────────
-- accounting.commit_import_batch(p_batch_id) -> jsonb
--
-- MAPPED-SHAPE CONTRACT (set by the client/API before the batch is marked 'ready'):
--   • entity_type='opening_balance' rows — mapped =
--       { "target_account_id": "<uuid>",   -- resolved target in accounting.accounts
--         "debit_cents":  <int >= 0>,      -- opening debit  (assets, contra-equity, ...)
--         "credit_cents": <int >= 0>,      -- opening credit (liabilities, equity, ...)
--         "offset": "equity" | "liability" -- which offset account carries this row's plug
--                                          --   (default 'equity' -> 3050; 'liability' -> 2050)
--         "memo": "<optional text>",
--         "customer_id": "<uuid|null>", "vendor_id": "<uuid|null>", "job_id": "<uuid|null>" }
--     All opening_balance rows of a batch post into ONE balanced journal entry:
--       Dr/Cr each target by its mapped cents, then a single offset line per distinct
--       'offset' bucket carries the net so the entry balances. Σdebits = Σcredits or
--       the guard rejects it and the whole commit rolls back.
--   • entity_type='journal_entry' rows (historical GL re-post; advanced) — mapped =
--       { "memo": "<text>", "lines": [ { "account_id": "<uuid>", "debit_cents": <int>,
--         "credit_cents": <int>, "memo": "<text|null>", "customer_id": ..., "vendor_id": ...,
--         "job_id": ... }, ... ] }
--     Each such row posts as its own balanced entry (the source already balances; if a
--     line fails to map the API leaves the row status='error' and commit aborts).
--   • Rows with status='skipped' or entity_type in ('account','customer','vendor',
--     'open_invoice','open_bill','unsupported') are NOT posted here (open AR/AP enter via
--     the opening_balance control-account rows; party/account masters are created by the
--     service layer / the create_as_new map). This is the key guard against double-counting.
--
-- All amounts are integer cents in the mapped jsonb; converted to numeric(14,2) dollars
-- for journal_lines (cents / 100.0). source_type = 'opening_balance' on every entry.
--
-- Runs entirely in the caller's transaction: any RAISE (mapping gap, unbalanced entry,
-- missing offset) rolls back EVERYTHING — no partial/half-posted import.
create or replace function accounting.commit_import_batch(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = accounting, public, pg_catalog
as $$
declare
  v_status        text;
  v_ob_date       date;
  v_defaults      jsonb;
  v_obe_id        uuid;   -- 3050 Opening Balance Equity
  v_obl_id        uuid;   -- 2050 Opening Balance Liabilities
  v_entry_id      uuid;
  v_posted_ids    uuid[] := '{}';
  v_accounts_made int := 0;
  v_ob_rows       int := 0;
  v_je_rows       int := 0;
  v_line_count    int := 0;
  v_total_debit   numeric(14,2) := 0;
  v_sort          int;
  v_net_equity    numeric(14,2);
  v_net_liab      numeric(14,2);
  r               record;
  m               record;
  v_line          jsonb;  -- one element of a historical journal-entry's mapped 'lines' array
begin
  -- (1) ADMIN-ONLY. Defense in depth: RLS already gates table writes; this gates the
  -- posting path itself so the ledger is never touched by a non-admin.
  if not accounting.has_role('accounting_admin') then
    raise exception 'only an accounting admin may commit an import batch'
      using errcode = 'insufficient_privilege';
  end if;

  -- (2) Lock the batch row and validate state. Idempotency: a re-click on an already
  -- committed batch returns the stored summary unchanged (no double-posting).
  select status, opening_balance_date
    into v_status, v_ob_date
    from accounting.import_batches
   where id = p_batch_id
   for update;
  if not found then
    raise exception 'import batch % not found', p_batch_id;
  end if;
  if v_status = 'committed' then
    return (select summary from accounting.import_batches where id = p_batch_id);
  end if;
  if v_status <> 'ready' then
    raise exception 'import batch % must be in status ''ready'' to commit (is %)',
      p_batch_id, v_status using errcode = 'check_violation';
  end if;

  v_ob_date := coalesce(v_ob_date, current_date);

  -- Resolve the offset accounts by key (never hardcoded numbers/ids).
  select setting_value into v_defaults
    from accounting.settings where setting_key = 'default_accounts';
  v_obe_id := nullif(v_defaults ->> 'opening_balance_equity', '')::uuid;
  v_obl_id := nullif(v_defaults ->> 'opening_balance_liabilities', '')::uuid;
  if v_obe_id is null then
    raise exception 'default_accounts.opening_balance_equity is not configured (run migration 021)'
      using errcode = 'check_violation';
  end if;
  -- v_obl_id may legitimately be needed only if some row uses offset='liability';
  -- checked at point of use below.

  -- (3) Create-as-new accounts from the mapping wizard (additive). Each such map row
  -- inserts a fresh accounting.accounts row, then is repointed at it.
  for m in
    select id, source_account_key, source_account_name, new_account_number,
           new_account_type, new_account_subtype
      from accounting.import_account_map
     where batch_id = p_batch_id
       and create_as_new = true
       and target_account_id is null
       and status <> 'ignored'
  loop
    if m.new_account_type is null then
      raise exception 'create-as-new account "%" is missing new_account_type',
        coalesce(m.source_account_name, m.source_account_key) using errcode = 'check_violation';
    end if;
    insert into accounting.accounts
      (account_number, name, account_type, account_subtype, normal_balance, is_system, created_by)
    values (
      m.new_account_number,
      coalesce(m.source_account_name, m.source_account_key),
      m.new_account_type,
      m.new_account_subtype,
      case when m.new_account_type in ('asset', 'expense') then 'debit' else 'credit' end,
      false,
      auth.uid()
    )
    returning id into v_entry_id;  -- reuse v_entry_id as a scratch uuid here
    update accounting.import_account_map
       set target_account_id = v_entry_id, status = 'mapped', updated_at = now()
     where id = m.id;
    v_accounts_made := v_accounts_made + 1;
  end loop;
  v_entry_id := null;

  -- (4a) OPENING-BALANCE rows -> ONE balanced journal entry for the whole batch.
  select count(*) into v_ob_rows
    from accounting.import_staging
   where batch_id = p_batch_id
     and entity_type = 'opening_balance'
     and status <> 'skipped';

  if v_ob_rows > 0 then
    insert into accounting.journal_entries (entry_date, memo, source_type, source_id, status, created_by)
    values (v_ob_date,
            'Imported opening balances (batch ' || p_batch_id::text || ')',
            'opening_balance', p_batch_id, 'draft', auth.uid())
    returning id into v_entry_id;

    v_sort := 0;
    v_net_equity := 0;
    v_net_liab := 0;

    -- One target line per opening-balance staging row.
    for r in
      select id, mapped
        from accounting.import_staging
       where batch_id = p_batch_id
         and entity_type = 'opening_balance'
         and status <> 'skipped'
       order by sort_order, created_at
    loop
      if r.mapped is null or (r.mapped ->> 'target_account_id') is null then
        raise exception 'opening-balance staging row % is not mapped to a target account', r.id
          using errcode = 'check_violation';
      end if;

      v_sort := v_sort + 1;
      insert into accounting.journal_lines
        (journal_entry_id, account_id, debit, credit, line_memo, customer_id, vendor_id, job_id, sort_order)
      values (
        v_entry_id,
        (r.mapped ->> 'target_account_id')::uuid,
        round(coalesce((r.mapped ->> 'debit_cents')::numeric, 0) / 100.0, 2),
        round(coalesce((r.mapped ->> 'credit_cents')::numeric, 0) / 100.0, 2),
        r.mapped ->> 'memo',
        nullif(r.mapped ->> 'customer_id', '')::uuid,
        nullif(r.mapped ->> 'vendor_id', '')::uuid,
        nullif(r.mapped ->> 'job_id', '')::uuid,
        v_sort
      );

      -- Accumulate each row's net into its chosen offset bucket. A debit target needs a
      -- credit on the offset (and vice versa), so the offset carries the NEGATIVE of the
      -- row's (debit - credit).
      if coalesce(r.mapped ->> 'offset', 'equity') = 'liability' then
        v_net_liab := v_net_liab
          + round(coalesce((r.mapped ->> 'debit_cents')::numeric, 0) / 100.0, 2)
          - round(coalesce((r.mapped ->> 'credit_cents')::numeric, 0) / 100.0, 2);
      else
        v_net_equity := v_net_equity
          + round(coalesce((r.mapped ->> 'debit_cents')::numeric, 0) / 100.0, 2)
          - round(coalesce((r.mapped ->> 'credit_cents')::numeric, 0) / 100.0, 2);
      end if;

      update accounting.import_staging
         set posted_journal_entry_id = v_entry_id, status = 'committed'
       where id = r.id;
    end loop;

    -- Offset (plug) line(s): credit the equity offset by the net equity-bucket debit
    -- excess (or debit it if the net is negative). Same for the liability bucket on 2050.
    if v_net_equity <> 0 then
      v_sort := v_sort + 1;
      insert into accounting.journal_lines
        (journal_entry_id, account_id, debit, credit, line_memo, sort_order)
      values (
        v_entry_id, v_obe_id,
        case when v_net_equity < 0 then -v_net_equity else 0 end,  -- debit if net credit excess
        case when v_net_equity > 0 then  v_net_equity else 0 end,  -- credit if net debit excess
        'Opening Balance Equity offset', v_sort
      );
    end if;

    if v_net_liab <> 0 then
      if v_obl_id is null then
        raise exception 'default_accounts.opening_balance_liabilities is not configured (run migration 023)'
          using errcode = 'check_violation';
      end if;
      v_sort := v_sort + 1;
      insert into accounting.journal_lines
        (journal_entry_id, account_id, debit, credit, line_memo, sort_order)
      values (
        v_entry_id, v_obl_id,
        case when v_net_liab < 0 then -v_net_liab else 0 end,
        case when v_net_liab > 0 then  v_net_liab else 0 end,
        'Opening Balance Liabilities offset', v_sort
      );
    end if;

    -- Post through the EXISTING path so guard_journal_entry enforces balance + >=2 lines.
    -- If unbalanced or single-line, post_journal_entry raises and the whole commit rolls back.
    perform accounting.post_journal_entry(v_entry_id);
    v_posted_ids := array_append(v_posted_ids, v_entry_id);
    v_total_debit := v_total_debit
      + (select coalesce(sum(debit), 0) from accounting.journal_lines where journal_entry_id = v_entry_id);
    v_line_count := v_line_count
      + (select count(*) from accounting.journal_lines where journal_entry_id = v_entry_id);
    v_entry_id := null;
  end if;

  -- (4b) Imported historical JOURNAL_ENTRY rows -> one balanced entry each (advanced).
  for r in
    select id, mapped
      from accounting.import_staging
     where batch_id = p_batch_id
       and entity_type = 'journal_entry'
       and status <> 'skipped'
     order by sort_order, created_at
  loop
    if r.mapped is null or jsonb_typeof(r.mapped -> 'lines') <> 'array'
       or jsonb_array_length(r.mapped -> 'lines') < 2 then
      raise exception 'imported journal-entry staging row % must carry >= 2 mapped lines', r.id
        using errcode = 'check_violation';
    end if;

    insert into accounting.journal_entries (entry_date, memo, source_type, source_id, status, created_by)
    values (v_ob_date, coalesce(r.mapped ->> 'memo', 'Imported journal entry'),
            'opening_balance', p_batch_id, 'draft', auth.uid())
    returning id into v_entry_id;

    v_sort := 0;
    -- Iterate the mapped 'lines' array. NOTE: jsonb_array_elements yields a column
    -- named "value" (a table alias does NOT rename the column), so we select that
    -- element straight into the jsonb loop variable v_line rather than via a record.
    for v_line in select value from jsonb_array_elements(r.mapped -> 'lines')
    loop
      if (v_line ->> 'account_id') is null then
        raise exception 'imported journal-entry row % has a line with no account_id', r.id
          using errcode = 'check_violation';
      end if;
      v_sort := v_sort + 1;
      insert into accounting.journal_lines
        (journal_entry_id, account_id, debit, credit, line_memo, customer_id, vendor_id, job_id, sort_order)
      values (
        v_entry_id,
        (v_line ->> 'account_id')::uuid,
        round(coalesce((v_line ->> 'debit_cents')::numeric, 0) / 100.0, 2),
        round(coalesce((v_line ->> 'credit_cents')::numeric, 0) / 100.0, 2),
        v_line ->> 'memo',
        nullif(v_line ->> 'customer_id', '')::uuid,
        nullif(v_line ->> 'vendor_id', '')::uuid,
        nullif(v_line ->> 'job_id', '')::uuid,
        v_sort
      );
    end loop;

    perform accounting.post_journal_entry(v_entry_id);
    update accounting.import_staging
       set posted_journal_entry_id = v_entry_id, status = 'committed'
     where id = r.id;
    v_posted_ids := array_append(v_posted_ids, v_entry_id);
    v_total_debit := v_total_debit
      + (select coalesce(sum(debit), 0) from accounting.journal_lines where journal_entry_id = v_entry_id);
    v_line_count := v_line_count
      + (select count(*) from accounting.journal_lines where journal_entry_id = v_entry_id);
    v_je_rows := v_je_rows + 1;
    v_entry_id := null;
  end loop;

  -- (5) Stamp the batch committed with a summary. Mark any remaining non-posting,
  -- non-skipped staging rows (account/customer/vendor/open_invoice/open_bill masters)
  -- as committed for completeness; they posted no money here by design.
  update accounting.import_staging
     set status = 'committed'
   where batch_id = p_batch_id
     and status not in ('committed', 'skipped', 'error');

  update accounting.import_batches
     set status = 'committed',
         committed_at = now(),
         committed_by = auth.uid(),
         summary = jsonb_build_object(
           'posted_entry_ids',     to_jsonb(v_posted_ids),
           'lines',                v_line_count,
           'openingBalanceCents',  round(v_total_debit * 100)::bigint,
           'accountsCreated',      v_accounts_made,
           'openingBalanceRows',   v_ob_rows,
           'journalEntryRows',     v_je_rows
         ),
         updated_at = now()
   where id = p_batch_id;

  return (select summary from accounting.import_batches where id = p_batch_id);
end;
$$;

-- Grants (mirrors every prior accounting migration).
grant select, insert, update, delete on all tables in schema accounting to authenticated, service_role;
grant usage, select on all sequences in schema accounting to authenticated, service_role;
grant execute on all functions in schema accounting to authenticated, service_role;

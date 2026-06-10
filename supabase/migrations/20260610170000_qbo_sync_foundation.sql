-- WorkTrackAccounting — QBO full-replica sync foundation (Phases 1+ of docs/QUICKBOOKS_IMPORT_PLAN.md)
--
-- The QuickBooks Online API sync upserts QBO entities into the existing accounting tables.
-- To make every run IDEMPOTENT and RE-RUNNABLE (and to let payments resolve which
-- invoice/bill they apply to by QBO id), each synced row carries its QBO id:
--
--   1) `external_qbo_id text` on the nine entity tables the sync writes
--      (accounts, items, customers, vendors, estimates, invoices, bills, payments,
--      vendor_payments), with a UNIQUE partial index per table (NULLs exempt — rows
--      created in-app never carry one). A re-run UPDATES the matching row instead of
--      duplicating it.
--
--   2) `accounting.qbo_import_runs` — one row per sync run: mode (full/incremental),
--      per-phase progress (resumable cursor state for the client-stepped orchestration),
--      per-entity counts, error. The browser (accountant, can_write) and the qbo-sync
--      Netlify function (service-role) both read/write it.
--
--   3) `accounting.qbo_import_log` — per-record audit trail (entity, qbo_id, action,
--      outcome, message) for drill-down and retry. High-volume append-only.
--
-- NOTE: tokens stay in accounting.qbo_connection (service-role only; migration
-- 20260608233000). Nothing here stores secrets, so the standard can_read/can_write RLS
-- applies via accounting._apply_standard_table.
--
-- ADDITIVE-ONLY: no existing column is altered or dropped. IDEMPOTENT throughout.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS accounting.qbo_import_log CASCADE;
--   DROP TABLE IF EXISTS accounting.qbo_import_runs CASCADE;
--   -- per entity table t in (accounts, items, customers, vendors, estimates, invoices,
--   --                        bills, payments, vendor_payments):
--   --   DROP INDEX IF EXISTS accounting.uq_acct_<t>_external_qbo_id;
--   --   ALTER TABLE accounting.<t> DROP COLUMN IF EXISTS external_qbo_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) external_qbo_id on every synced entity table (+ unique partial index)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  t text;
  idx text;
begin
  foreach t in array array[
    'accounts', 'items', 'customers', 'vendors',
    'estimates', 'invoices', 'bills', 'payments', 'vendor_payments'
  ]
  loop
    execute format('alter table accounting.%I add column if not exists external_qbo_id text', t);

    idx := format('uq_acct_%s_external_qbo_id', t);
    if not exists (
      select 1 from pg_indexes where schemaname = 'accounting' and indexname = idx
    ) then
      execute format(
        'create unique index %I on accounting.%I (external_qbo_id) where external_qbo_id is not null',
        idx, t
      );
    end if;
  end loop;
end $$;

comment on column accounting.invoices.external_qbo_id is
  'QuickBooks Online Txn id this row was synced from (qbo-sync). NULL for rows created in-app.';
comment on column accounting.customers.external_qbo_id is
  'QuickBooks Online entity id this row was synced from (qbo-sync). NULL for rows created in-app.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Sync run tracking (one row per run; resumable client-stepped state)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists accounting.qbo_import_runs (
  id uuid primary key default gen_random_uuid(),
  mode text not null default 'full' check (mode in ('full', 'incremental')),
  status text not null default 'running'
    check (status in ('running', 'completed', 'failed', 'cancelled')),
  phase text,                                   -- current step label ('accounts', 'invoices', 'reconcile', …)
  progress jsonb not null default '{}'::jsonb,  -- resumable cursor state, e.g. {"invoices":{"startPosition":2001,"done":false}}
  counts jsonb not null default '{}'::jsonb,    -- per-entity tallies, e.g. {"customers":{"created":3,"updated":120,"skipped":0,"failed":0}}
  error text,
  changed_since timestamptz,                    -- incremental high-water mark this run queried from
  started_by uuid references public.profiles(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Per-record import log (append-only drill-down / retry trail)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists accounting.qbo_import_log (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references accounting.qbo_import_runs(id) on delete cascade,
  entity text not null,        -- QBO entity name ('Account', 'Item', 'Customer', 'Invoice', …)
  qbo_id text,                 -- QBO record id (null for run-level notes)
  action text not null,        -- 'create' | 'update' | 'skip' | 'post' | 'void' | 'apply' | 'error'
  status text not null default 'ok' check (status in ('ok', 'error')),
  message text,
  record_id uuid,              -- the accounting.* row this touched, when applicable
  at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_qbo_import_runs_started') then
    create index idx_acct_qbo_import_runs_started on accounting.qbo_import_runs(started_at desc);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_qbo_import_log_run') then
    create index idx_acct_qbo_import_log_run on accounting.qbo_import_log(run_id);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_qbo_import_log_entity_qbo') then
    create index idx_acct_qbo_import_log_entity_qbo on accounting.qbo_import_log(entity, qbo_id);
  end if;
end $$;

-- Standard RLS (read=can_read, write=can_write) + audit; log table has no updated_at.
select accounting._apply_standard_table('qbo_import_runs');
select accounting._apply_standard_table('qbo_import_log', false);

grant select, insert, update, delete on all tables in schema accounting to authenticated, service_role;

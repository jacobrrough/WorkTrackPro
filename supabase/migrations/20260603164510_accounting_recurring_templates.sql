-- WorkTrackAccounting — B2 (2/2): recurring transaction templates
--
-- Adds accounting.recurring_templates: a schedule + a jsonb payload describing the
-- next document/journal entry to materialize. A template's `kind` (invoice|bill|journal)
-- decides which document the app's "generate due" action builds; that action ALWAYS
-- posts a BALANCED journal entry through accounting.post_journal_entry (it never writes
-- ledger rows directly), so double-entry integrity (G3) is preserved end to end. This
-- table stores intent only — it performs NO posting itself.
--
-- ADDITIVE-ONLY: a brand-new table in schema `accounting`. NO public.* table is touched.
-- The only cross-schema FK is created_by -> public.profiles on this child table
-- (on delete set null), matching every other accounting table.
--
-- RLS/AUDIT: wired with accounting._apply_standard_table (read=can_read, write=can_write,
-- audit + touch_updated_at). last_generated_id is a PLAIN uuid (no FK) on purpose: it can
-- point at an invoice, bill, or journal entry depending on `kind`, so it stays
-- kind-agnostic and never blocks a delete of the generated document.
--
-- MONEY: this table holds none. The numeric amounts that eventually post live inside the
-- jsonb payload (validated in the TS layer) and become numeric(14,2) journal_lines via
-- post_journal_entry. JS sums those in integer cents (accountingViewModel.toCents); the
-- DB balance trigger is the final gate (G6).
--
-- This migration is IDEMPOTENT (CREATE TABLE IF NOT EXISTS, guarded index creation,
-- _apply_standard_table is itself idempotent).
--
-- ROLLBACK:
--   DROP INDEX IF EXISTS accounting.idx_acct_recurring_kind;
--   DROP INDEX IF EXISTS accounting.idx_acct_recurring_due;
--   DROP TABLE IF EXISTS accounting.recurring_templates CASCADE;

create table if not exists accounting.recurring_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('invoice', 'bill', 'journal')),

  -- schedule -----------------------------------------------------------------
  frequency text not null
    check (frequency in ('daily', 'weekly', 'monthly', 'quarterly', 'yearly')),
  interval_count int not null default 1 check (interval_count >= 1),
  start_date date not null,
  end_date date,                       -- null = open-ended
  next_run_date date not null,
  day_of_month int check (day_of_month between 1 and 31),  -- optional monthly anchor
  last_run_date date,

  -- generation bookkeeping ---------------------------------------------------
  -- plain uuid (NO fk): points at whichever document type `kind` implies.
  last_generated_id uuid,
  occurrences_generated int not null default 0 check (occurrences_generated >= 0),

  -- the document/JE blueprint. Shape is validated in the TS layer; stored as jsonb.
  payload jsonb not null default '{}'::jsonb,

  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- belt-and-suspenders: the window must not be inverted.
  constraint recurring_templates_dates check (end_date is null or end_date >= start_date)
);

do $$
begin
  -- the "due" query: active templates whose next_run_date <= as-of date.
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'accounting' and indexname = 'idx_acct_recurring_due'
  ) then
    create index idx_acct_recurring_due
      on accounting.recurring_templates(active, next_run_date);
  end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'accounting' and indexname = 'idx_acct_recurring_kind'
  ) then
    create index idx_acct_recurring_kind
      on accounting.recurring_templates(kind);
  end if;
end $$;

-- RLS + audit + touch_updated_at via the standard helper.
select accounting._apply_standard_table('recurring_templates');

-- Belt-and-suspenders explicit grants (default privileges already cover new objects).
grant select, insert, update, delete on all tables in schema accounting to authenticated, service_role;
grant usage, select on all sequences in schema accounting to authenticated, service_role;
grant execute on all functions in schema accounting to authenticated, service_role;

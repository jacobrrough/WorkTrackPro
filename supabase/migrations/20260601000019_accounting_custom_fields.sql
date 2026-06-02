-- WorkTrackAccounting — D4: custom fields on accounting entities
--
-- Adds two additive master/value tables that let an admin define extra fields per
-- accounting entity type (invoice/bill/customer/vendor/account/journal_entry) and
-- store per-entity values for them:
--   • accounting.custom_field_defs   — admin-defined field definitions (the schema of
--                                       the custom data: key/label/data_type/options/...).
--   • accounting.custom_field_values — one boxed JSON value per (def, entity) pair.
--
-- These are pure METADATA / master data. They move NO money, so per invariant G3 they
-- post NO journal entry — the same rationale the dimensions migration (013), the
-- books-closed lock (016) and the budgets migration (017) document for pure
-- reporting/control features. There is no debit/credit, no post_journal_entry call and
-- no posting math anywhere in this migration.
--
-- ADDITIVE-ONLY (G1): every object lives in schema `accounting`. CRUCIALLY, unlike the
-- dimensions migration, this adds NO columns to any existing table — custom values live
-- in their own custom_field_values table keyed by (entity_type, entity_id). That means
-- existing invoice/bill/customer/vendor rows and the INSERT statements that create them
-- are byte-for-byte unchanged, so this cannot break existing forms at the DB layer. The
-- only cross-schema FK is on the accounting (child) side -> public.profiles(id) for
-- created_by (matches every other accounting table). NO public.* table or column is
-- altered or dropped. No existing accounting.* table is altered.
--
-- entity_id is a PLAIN uuid with NO cross-table foreign key, on purpose: one column
-- cannot FK six different parent tables, and a hard FK would couple custom values to a
-- single entity table. Integrity is by application + the entity_type-match trigger
-- below. This mirrors the deliberate "plain uuid, no FK" precedent on
-- accounting.audit_log.record_id and keeps the feature additive and decoupled.
--
-- RLS/AUDIT (G2, G7): both tables are wired with accounting._apply_standard_table
-- (read = can_read(), write = can_write(), plus the audit() and touch_updated_at()
-- triggers), exactly like accounting.dimensions in migration 013.
--
-- INTEGRITY: a BEFORE INSERT/UPDATE trigger (accounting.assert_custom_field_value_type,
-- SECURITY DEFINER) asserts that a value's entity_type equals the referenced def's
-- entity_type, so a value can't be filed under the wrong entity type. The pattern is
-- copied from accounting.assert_line_dimension_types in migration 013. A CHECK could not
-- express this (a CHECK may not run a subquery), hence the trigger. Pure validation — no
-- money movement, no posting math.
--
-- This migration is IDEMPOTENT (CREATE TABLE IF NOT EXISTS, guarded index creation via
-- pg_indexes checks, CREATE OR REPLACE / idempotent _apply_standard_table, DROP/CREATE
-- TRIGGER, additive grants).
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS cfv_check_entity_type ON accounting.custom_field_values;
--   DROP FUNCTION IF EXISTS accounting.assert_custom_field_value_type() CASCADE;
--   DROP INDEX IF EXISTS accounting.idx_acct_cfv_entity;
--   DROP INDEX IF EXISTS accounting.idx_acct_cfv_def;
--   DROP TABLE IF EXISTS accounting.custom_field_values CASCADE;
--   DROP INDEX IF EXISTS accounting.idx_acct_cf_defs_entity_active;
--   DROP TABLE IF EXISTS accounting.custom_field_defs CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Custom field definitions — the admin-defined "schema" of the extra fields
-- ─────────────────────────────────────────────────────────────────────────────
-- entity_type partitions defs by which accounting entity they extend. key is the
-- machine-readable snake_case identifier used to address the value; label is the human
-- caption shown on forms. data_type picks the editor/coercion; options holds the choice
-- list for data_type='select' (a jsonb array of {value,label}); it stays '[]' for the
-- other types. sort_order controls render order within an entity_type; active toggles a
-- field on/off WITHOUT deleting it (so historical values keep their definition).
-- (entity_type, key) is unique so a key is unambiguous within an entity type.
create table if not exists accounting.custom_field_defs (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (
    entity_type in ('invoice', 'bill', 'customer', 'vendor', 'account', 'journal_entry')
  ),
  key text not null,
  label text not null,
  data_type text not null check (
    data_type in ('text', 'number', 'date', 'boolean', 'select')
  ),
  -- choice list for data_type='select' (array of {value,label}); empty for other types.
  options jsonb not null default '[]'::jsonb,
  -- optional helper caption rendered under the field on forms.
  help_text text,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_type, key)
);

-- Powers the render-order query "active defs for this entity type, in order".
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'accounting' and indexname = 'idx_acct_cf_defs_entity_active'
  ) then
    create index idx_acct_cf_defs_entity_active
      on accounting.custom_field_defs (entity_type, active, sort_order);
  end if;
end $$;

-- RLS + audit + touch_updated_at via the standard helper.
select accounting._apply_standard_table('custom_field_defs');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Custom field values — one boxed JSON value per (def, entity)
-- ─────────────────────────────────────────────────────────────────────────────
-- def_id ties a value to its definition (cascade-delete with the def). entity_type +
-- entity_id identify the host row (entity_id is a plain uuid, NO cross-table FK — see
-- the header). value is the typed value boxed as JSON: a JSON string for text/date and
-- for a selected option value, a JSON number for number, a JSON boolean for boolean;
-- NULL / row-absent means "unset". (def_id, entity_id) is unique so each field has at
-- most one value per entity, which also lets the service upsert on conflict.
create table if not exists accounting.custom_field_values (
  id uuid primary key default gen_random_uuid(),
  def_id uuid not null references accounting.custom_field_defs(id) on delete cascade,
  entity_type text not null check (
    entity_type in ('invoice', 'bill', 'customer', 'vendor', 'account', 'journal_entry')
  ),
  entity_id uuid not null,
  value jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (def_id, entity_id)
);

-- Powers the per-entity value fetch "all values for this entity".
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'accounting' and indexname = 'idx_acct_cfv_entity'
  ) then
    create index idx_acct_cfv_entity
      on accounting.custom_field_values (entity_type, entity_id);
  end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'accounting' and indexname = 'idx_acct_cfv_def'
  ) then
    create index idx_acct_cfv_def
      on accounting.custom_field_values (def_id);
  end if;
end $$;

-- RLS + audit + touch_updated_at via the standard helper.
select accounting._apply_standard_table('custom_field_values');

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) entity_type-match validation trigger
-- ─────────────────────────────────────────────────────────────────────────────
-- Asserts that a value's entity_type equals its def's entity_type, so a value defined
-- for (say) 'invoice' can never be filed against a 'customer'. SECURITY DEFINER so it
-- can read accounting.custom_field_defs regardless of the writer's row visibility
-- (can_read already covers them, but definer keeps it robust under future policy
-- tweaks). Pure validation; never moves money. Pattern copied from
-- accounting.assert_line_dimension_types (migration 013).
create or replace function accounting.assert_custom_field_value_type()
returns trigger
language plpgsql
security definer
set search_path = accounting, pg_catalog
as $$
declare
  v_def_entity text;
begin
  select entity_type into v_def_entity
    from accounting.custom_field_defs
   where id = new.def_id;

  if v_def_entity is null then
    raise exception 'def_id % is not a known custom field definition', new.def_id
      using errcode = 'foreign_key_violation';
  elsif v_def_entity <> new.entity_type then
    raise exception 'custom field value entity_type % does not match its definition entity_type %',
      new.entity_type, v_def_entity
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists cfv_check_entity_type on accounting.custom_field_values;
create trigger cfv_check_entity_type
  before insert or update on accounting.custom_field_values
  for each row execute function accounting.assert_custom_field_value_type();

-- Belt-and-suspenders explicit grants (default privileges already cover new objects;
-- restated for unambiguous current-object grants, matching sibling migrations).
grant select, insert, update, delete on all tables in schema accounting to authenticated, service_role;
grant usage, select on all sequences in schema accounting to authenticated, service_role;
grant execute on all functions in schema accounting to authenticated, service_role;

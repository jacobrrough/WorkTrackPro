-- WorkTrackAccounting — B2 (1/2): reporting dimensions (class/location/department)
--
-- Adds accounting.dimensions (a small master of reporting tags) and three additive,
-- NULLABLE dimension columns (class_id/location_id/department_id) onto the three
-- accounting-owned line tables: journal_lines, invoice_lines, bill_lines. These are
-- pure reporting tags — they move NO money. They flow onto journal_lines so postings
-- can be sliced by class/location/department for reporting.
--
-- ADDITIVE-ONLY: every object lives in schema `accounting`. The new columns are
-- ADD COLUMN IF NOT EXISTS on accounting tables we own (precedent: migration 012,
-- which added nullable columns to accounting.bank_transactions). NO public.* table is
-- touched. All FKs sit on the accounting (child) side -> accounting.dimensions.
--
-- RLS/AUDIT: accounting.dimensions is wired with accounting._apply_standard_table
-- (read=can_read, write=can_write, audit + touch_updated_at). The three line tables
-- keep their EXISTING table-level RLS policies — those policies gate the whole row, so
-- new columns are covered automatically with no policy change (same reasoning as
-- migration 012). journal_lines/invoice_lines/bill_lines audit triggers are likewise
-- unchanged. guard_journal_line still governs journal_lines: dimension columns may only
-- change while the parent entry is draft, so posted entries stay immutable.
--
-- INTEGRITY: a BEFORE INSERT/UPDATE trigger on each line table asserts that a
-- referenced dimension's dim_type matches its column (class_id must point at a 'class'
-- row, etc.), so a location id can't be stuffed into the class slot. Pure validation —
-- no money movement, no posting math.
--
-- This migration is IDEMPOTENT (CREATE ... IF NOT EXISTS, ADD COLUMN IF NOT EXISTS,
-- CREATE OR REPLACE FUNCTION, guarded index creation, DROP/CREATE TRIGGER).
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS dim_check_bill_lines ON accounting.bill_lines;
--   DROP TRIGGER IF EXISTS dim_check_invoice_lines ON accounting.invoice_lines;
--   DROP TRIGGER IF EXISTS dim_check_journal_lines ON accounting.journal_lines;
--   DROP FUNCTION IF EXISTS accounting.assert_line_dimension_types() CASCADE;
--   DROP INDEX IF EXISTS accounting.idx_acct_bill_lines_department;
--   DROP INDEX IF EXISTS accounting.idx_acct_bill_lines_location;
--   DROP INDEX IF EXISTS accounting.idx_acct_bill_lines_class;
--   DROP INDEX IF EXISTS accounting.idx_acct_invoice_lines_department;
--   DROP INDEX IF EXISTS accounting.idx_acct_invoice_lines_location;
--   DROP INDEX IF EXISTS accounting.idx_acct_invoice_lines_class;
--   DROP INDEX IF EXISTS accounting.idx_acct_jl_department;
--   DROP INDEX IF EXISTS accounting.idx_acct_jl_location;
--   DROP INDEX IF EXISTS accounting.idx_acct_jl_class;
--   ALTER TABLE accounting.bill_lines    DROP COLUMN IF EXISTS department_id;
--   ALTER TABLE accounting.bill_lines    DROP COLUMN IF EXISTS location_id;
--   ALTER TABLE accounting.bill_lines    DROP COLUMN IF EXISTS class_id;
--   ALTER TABLE accounting.invoice_lines DROP COLUMN IF EXISTS department_id;
--   ALTER TABLE accounting.invoice_lines DROP COLUMN IF EXISTS location_id;
--   ALTER TABLE accounting.invoice_lines DROP COLUMN IF EXISTS class_id;
--   ALTER TABLE accounting.journal_lines DROP COLUMN IF EXISTS department_id;
--   ALTER TABLE accounting.journal_lines DROP COLUMN IF EXISTS location_id;
--   ALTER TABLE accounting.journal_lines DROP COLUMN IF EXISTS class_id;
--   DROP INDEX IF EXISTS accounting.idx_acct_dimensions_type_active;
--   DROP TABLE IF EXISTS accounting.dimensions CASCADE;

-- 1) Dimensions master --------------------------------------------------------
-- A flat-with-optional-hierarchy list of reporting tags. dim_type partitions the
-- list into class/location/department; (dim_type, name) is unique within a type.
create table if not exists accounting.dimensions (
  id uuid primary key default gen_random_uuid(),
  dim_type text not null check (dim_type in ('class', 'location', 'department')),
  name text not null,
  code text,
  -- optional self-hierarchy (e.g. a sub-department under a department). The match
  -- trigger does not enforce that parent shares dim_type, but the app keeps them aligned.
  parent_id uuid references accounting.dimensions(id) on delete set null,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (dim_type, name)
);

do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'accounting' and indexname = 'idx_acct_dimensions_type_active'
  ) then
    create index idx_acct_dimensions_type_active
      on accounting.dimensions(dim_type, is_active);
  end if;
end $$;

-- RLS + audit + touch_updated_at via the standard helper.
select accounting._apply_standard_table('dimensions');

-- 2) Additive NULLABLE dimension columns on the line tables -------------------
-- journal_lines: postings sliced by dimension for reporting.
alter table accounting.journal_lines
  add column if not exists class_id uuid references accounting.dimensions(id) on delete set null;
alter table accounting.journal_lines
  add column if not exists location_id uuid references accounting.dimensions(id) on delete set null;
alter table accounting.journal_lines
  add column if not exists department_id uuid references accounting.dimensions(id) on delete set null;

-- invoice_lines: dimensions carried on AR lines, stamped onto the income JE lines.
alter table accounting.invoice_lines
  add column if not exists class_id uuid references accounting.dimensions(id) on delete set null;
alter table accounting.invoice_lines
  add column if not exists location_id uuid references accounting.dimensions(id) on delete set null;
alter table accounting.invoice_lines
  add column if not exists department_id uuid references accounting.dimensions(id) on delete set null;

-- bill_lines: dimensions carried on AP lines, stamped onto the expense JE lines.
alter table accounting.bill_lines
  add column if not exists class_id uuid references accounting.dimensions(id) on delete set null;
alter table accounting.bill_lines
  add column if not exists location_id uuid references accounting.dimensions(id) on delete set null;
alter table accounting.bill_lines
  add column if not exists department_id uuid references accounting.dimensions(id) on delete set null;

-- 3) Reporting indexes on journal_lines dimension columns ----------------------
-- These three power the by-dimension reporting filters; invoice/bill line dimension
-- columns also get indexes so the recurring generator + reports can join cheaply.
do $$
begin
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_jl_class') then
    create index idx_acct_jl_class on accounting.journal_lines(class_id);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_jl_location') then
    create index idx_acct_jl_location on accounting.journal_lines(location_id);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_jl_department') then
    create index idx_acct_jl_department on accounting.journal_lines(department_id);
  end if;

  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_invoice_lines_class') then
    create index idx_acct_invoice_lines_class on accounting.invoice_lines(class_id);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_invoice_lines_location') then
    create index idx_acct_invoice_lines_location on accounting.invoice_lines(location_id);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_invoice_lines_department') then
    create index idx_acct_invoice_lines_department on accounting.invoice_lines(department_id);
  end if;

  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_bill_lines_class') then
    create index idx_acct_bill_lines_class on accounting.bill_lines(class_id);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_bill_lines_location') then
    create index idx_acct_bill_lines_location on accounting.bill_lines(location_id);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_bill_lines_department') then
    create index idx_acct_bill_lines_department on accounting.bill_lines(department_id);
  end if;
end $$;

-- 4) Dimension-type-match validation trigger ----------------------------------
-- Generic trigger usable by any line table that has class_id/location_id/department_id.
-- Asserts each non-null dimension column points at a dimension row of the matching
-- dim_type. SECURITY DEFINER so it can read accounting.dimensions regardless of the
-- writer's row visibility (can_read already covers them, but definer keeps it robust
-- under future policy tweaks). Pure validation; never moves money.
create or replace function accounting.assert_line_dimension_types()
returns trigger
language plpgsql
security definer
set search_path = accounting, pg_catalog
as $$
declare
  v_type text;
begin
  if new.class_id is not null then
    select dim_type into v_type from accounting.dimensions where id = new.class_id;
    if v_type is null then
      raise exception 'class_id % is not a known dimension', new.class_id using errcode = 'foreign_key_violation';
    elsif v_type <> 'class' then
      raise exception 'class_id % must reference a class dimension (got %)', new.class_id, v_type using errcode = 'check_violation';
    end if;
  end if;

  if new.location_id is not null then
    select dim_type into v_type from accounting.dimensions where id = new.location_id;
    if v_type is null then
      raise exception 'location_id % is not a known dimension', new.location_id using errcode = 'foreign_key_violation';
    elsif v_type <> 'location' then
      raise exception 'location_id % must reference a location dimension (got %)', new.location_id, v_type using errcode = 'check_violation';
    end if;
  end if;

  if new.department_id is not null then
    select dim_type into v_type from accounting.dimensions where id = new.department_id;
    if v_type is null then
      raise exception 'department_id % is not a known dimension', new.department_id using errcode = 'foreign_key_violation';
    elsif v_type <> 'department' then
      raise exception 'department_id % must reference a department dimension (got %)', new.department_id, v_type using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists dim_check_journal_lines on accounting.journal_lines;
create trigger dim_check_journal_lines
  before insert or update on accounting.journal_lines
  for each row execute function accounting.assert_line_dimension_types();

drop trigger if exists dim_check_invoice_lines on accounting.invoice_lines;
create trigger dim_check_invoice_lines
  before insert or update on accounting.invoice_lines
  for each row execute function accounting.assert_line_dimension_types();

drop trigger if exists dim_check_bill_lines on accounting.bill_lines;
create trigger dim_check_bill_lines
  before insert or update on accounting.bill_lines
  for each row execute function accounting.assert_line_dimension_types();

-- Belt-and-suspenders explicit grants (default privileges already cover new objects;
-- added columns inherit table grants — restated for unambiguous current-object grants).
grant select, insert, update, delete on all tables in schema accounting to authenticated, service_role;
grant usage, select on all sequences in schema accounting to authenticated, service_role;
grant execute on all functions in schema accounting to authenticated, service_role;

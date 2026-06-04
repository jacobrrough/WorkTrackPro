-- WorkTrackAccounting — D2: budgeting & forecasting
--
-- Adds two additive master tables for budgets:
--   • accounting.budgets       — a named plan for a fiscal year (draft/active/archived).
--   • accounting.budget_lines  — one cell per (budget, account, calendar month 1-12),
--                                holding the planned amount for that account/month.
--
-- These are PLANNING artifacts only. They move NO money, so per invariant G3 they post
-- NO journal entry — same rationale the dimensions migration (013) and the books-closed
-- lock (016) document for pure reporting/control features. The Budget-vs-Actual report
-- compares these planned cells against ACTUALS computed at read time from POSTED journal
-- lines on the SAME basis as accounting.v_trial_balance (status = 'posted'); the cash-flow
-- forecast projects from open AR/AP due dates (the columns v_ar_aging / v_ap_aging already
-- expose). All of that comparison/projection lives in the JS report layer — this migration
-- only persists the user-entered plan.
--
-- ADDITIVE-ONLY (G1): every object lives in schema `accounting`. The only cross-schema FK
-- is on the accounting (child) side -> public.profiles(id) for created_by (matches every
-- other accounting table). NO public.* table or column is altered or dropped. Existing
-- accounting tables are untouched.
--
-- RLS/AUDIT (G2, G7): both tables are wired with accounting._apply_standard_table
-- (read = can_read(), write = can_write(), plus the audit() and touch_updated_at()
-- triggers), exactly like accounting.dimensions in migration 013.
--
-- MONEY (G6): budget_lines.amount is numeric(14,2) in the DB; all summation/variance math
-- runs in integer cents in JS (accountingViewModel.toCents). No floats for balances.
--
-- This migration is IDEMPOTENT (CREATE TABLE IF NOT EXISTS, guarded index creation via
-- pg_indexes checks, CREATE OR REPLACE / idempotent _apply_standard_table, additive grants).
--
-- ROLLBACK:
--   DROP INDEX IF EXISTS accounting.idx_acct_budget_lines_account;
--   DROP INDEX IF EXISTS accounting.idx_acct_budget_lines_budget;
--   DROP INDEX IF EXISTS accounting.idx_acct_budgets_fy;
--   DROP TABLE IF EXISTS accounting.budget_lines CASCADE;
--   DROP TABLE IF EXISTS accounting.budgets CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Budgets master — one named plan per fiscal year
-- ─────────────────────────────────────────────────────────────────────────────
-- status partitions the lifecycle: draft (being built) -> active (the plan in use)
-- -> archived (kept for history). (name, fiscal_year) is unique so two plans can't
-- collide for the same year. created_by is the only cross-schema FK (child side).
create table if not exists accounting.budgets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  fiscal_year int not null check (fiscal_year between 2000 and 2100),
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  description text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name, fiscal_year)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Budget lines — one cell per (budget, account, month)
-- ─────────────────────────────────────────────────────────────────────────────
-- period_month is a calendar month 1-12 (the grid's 12 columns). amount is the planned
-- figure for that account in that month, numeric(14,2) per G6. The unique key is the
-- upsert target for the editor grid (save = upsert each non-zero cell, delete cleared
-- cells). account_id ON DELETE RESTRICT: an account that has budget lines can't be
-- silently removed out from under a plan. budget_id ON DELETE CASCADE: deleting a budget
-- removes its cells.
create table if not exists accounting.budget_lines (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null references accounting.budgets(id) on delete cascade,
  account_id uuid not null references accounting.accounts(id) on delete restrict,
  period_month int not null check (period_month between 1 and 12),
  amount numeric(14, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (budget_id, account_id, period_month)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Indexes (guarded so the migration is re-runnable)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'accounting' and indexname = 'idx_acct_budgets_fy'
  ) then
    create index idx_acct_budgets_fy on accounting.budgets(fiscal_year);
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'accounting' and indexname = 'idx_acct_budget_lines_budget'
  ) then
    create index idx_acct_budget_lines_budget on accounting.budget_lines(budget_id);
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'accounting' and indexname = 'idx_acct_budget_lines_account'
  ) then
    create index idx_acct_budget_lines_account on accounting.budget_lines(account_id);
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) RLS + audit + touch_updated_at via the standard helper (G2)
-- ─────────────────────────────────────────────────────────────────────────────
select accounting._apply_standard_table('budgets');
select accounting._apply_standard_table('budget_lines');

-- Belt-and-suspenders explicit grants (default privileges already cover new objects;
-- restated for unambiguous current-object grants, matching migrations 013/014).
grant select, insert, update, delete on all tables in schema accounting to authenticated, service_role;
grant usage, select on all sequences in schema accounting to authenticated, service_role;
grant execute on all functions in schema accounting to authenticated, service_role;

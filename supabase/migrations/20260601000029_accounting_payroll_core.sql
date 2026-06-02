-- WorkTrackAccounting — C2 PAYROLL 3/4: employees, schedules, runs, paychecks, liabilities
--
-- ⚠️  HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING. Core payroll entities. Ships FLAG-DARK;
--     requires CPA/EA payroll AND/OR security sign-off before enabling. The UI banners every
--     screen/report/export. SECURITY POSTURE (Phase E DEFERRED): employees.ssn and the bank
--     routing/account columns are PLACEHOLDER columns with NO pgcrypto encryption yet (G8 says
--     do encryption as a complete phase, never half-done). They exist so the schema is stable,
--     but a security professional MUST sign off and Phase E (pgcrypto field encryption + key
--     management) MUST land before any real SSN / bank data is entered. See the build report.
--
-- WHAT THIS MIGRATION ADDS (five additive tables in schema accounting; ZERO public.* change; G1):
--   • accounting.employees           — the payroll employee master (W-4/DE-4 fields, pay setup).
--                                       OPTIONAL child-side FKs to public.profiles(id) (link to
--                                       an app login) and public.jobs(id) (default cost job),
--                                       both ON DELETE SET NULL — public.profiles/jobs untouched.
--   • accounting.pay_schedules       — frequency + the next period/pay dates a run is opened for.
--   • accounting.pay_runs            — one payroll run header (period, pay date, lifecycle status,
--                                       the posted JE id once committed).
--   • accounting.paychecks           — one row per employee per run: hours (sourced READ-ONLY
--                                       from public.shifts), gross, the per-tax breakdown (taxes
--                                       jsonb), deductions jsonb, employer-tax total, net, and
--                                       source_shift_ids[] provenance. ALL money INTEGER CENTS.
--   • accounting.payroll_liabilities — one accrual row per (run, tax_kind, party): what is owed
--                                       to each agency, which liability account carries it, and
--                                       (later) the deposit JE that clears it.
--
-- DOUBLE-ENTRY (G3): These five TABLES move ZERO money — they are the payroll data model only.
--   ALL money movement happens exclusively inside accounting.commit_pay_run (migration 030),
--   which builds ONE balanced DRAFT journal entry from the paycheck/liability cents and posts it
--   through the EXISTING accounting.post_journal_entry (guard enforces debits = credits + >= 2
--   lines). No posting logic is authored in THIS migration.
--
-- READ-ONLY HOURS SOURCE (G4): public.shifts is the timekeeping source of truth and is NEVER
--   written by payroll. paychecks.source_shift_ids records WHICH shift rows fed a paycheck
--   (provenance), and the pure TS helper payrollHours.ts derives regular/OT hour-cents from the
--   shift clock_in/clock_out times. There is NO FK from paychecks to public.shifts (a uuid[]
--   cannot be a FK, and we deliberately avoid coupling payroll to shift deletion) — the array is
--   an audit reference, not a constraint. CA daily/weekly overtime rules + lunch deduction live
--   in the engine and are on the HUMAN-VERIFY list.
--
-- MONEY MATH (G6): every monetary column is *_cents bigint (integer cents). Nothing in this
--   schema is numeric dollars — the dollar conversion happens only at the journal-line boundary
--   inside commit_pay_run (cents / 100.0 -> numeric(14,2)).
--
-- RLS / AUDIT (G2): all five tables wired via accounting._apply_standard_table(<t>, true,
--   'accounting.can_payroll()') — read = can_read(), WRITE = can_payroll(), plus audit() +
--   touch_updated_at(). Payroll is a payroll-privileged surface, stricter than the default
--   can_write() (which also admits a plain 'accountant').
--
-- This migration is IDEMPOTENT (create table if not exists; guarded index creation;
--   _apply_standard_table is drop/create).
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS accounting.payroll_liabilities CASCADE;
--   DROP TABLE IF EXISTS accounting.paychecks         CASCADE;
--   DROP TABLE IF EXISTS accounting.pay_runs          CASCADE;
--   DROP TABLE IF EXISTS accounting.pay_schedules     CASCADE;
--   DROP TABLE IF EXISTS accounting.employees         CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Employees — the payroll master (W-4 / DE-4 fields + pay setup)
-- ─────────────────────────────────────────────────────────────────────────────
-- profile_id / default_job_id are OPTIONAL child-side FKs (ON DELETE SET NULL) so deleting an
-- app user or job never deletes payroll history — it only unlinks. employment_type drives
-- W-2 vs 1099 treatment (the pay-run withholds for w2; a 1099 contractor receives gross with no
-- withholding and feeds the 1099-NEC stub). All withholding-input dollar fields are *_cents.
create table if not exists accounting.employees (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  display_name text not null,
  email text,
  employment_type text not null default 'w2' check (employment_type in ('w2', '1099')),

  -- Federal W-4 (2020+ redesign) inputs --------------------------------------------------------
  fed_filing_status text not null default 'single'
    check (fed_filing_status in ('single', 'married_joint', 'married_separate', 'head_of_household')),
  fed_multiple_jobs boolean not null default false,         -- W-4 Step 2 checkbox
  fed_dependents_amount_cents bigint not null default 0,    -- W-4 Step 3 total
  fed_other_income_cents bigint not null default 0,         -- W-4 Step 4(a)
  fed_deductions_cents bigint not null default 0,           -- W-4 Step 4(b)
  fed_extra_withholding_cents bigint not null default 0,    -- W-4 Step 4(c) per pay period

  -- California DE-4 inputs ---------------------------------------------------------------------
  ca_filing_status text not null default 'single'
    check (ca_filing_status in ('single', 'married_joint', 'married_separate', 'head_of_household')),
  ca_allowances int not null default 0 check (ca_allowances >= 0),       -- DE-4 regular allowances
  ca_extra_withholding_cents bigint not null default 0,                  -- DE-4 additional amount

  -- Pay setup ----------------------------------------------------------------------------------
  pay_type text not null default 'hourly' check (pay_type in ('hourly', 'salary')),
  pay_rate_cents bigint not null default 0 check (pay_rate_cents >= 0),  -- hourly: cents/hour; salary: cents/year
  default_job_id uuid references public.jobs(id) on delete set null,     -- default cost-allocation job

  -- SECURITY-SENSITIVE PLACEHOLDERS — Phase E (pgcrypto) DEFERRED. NULL for now. See header (G8).
  ssn text,                          -- DO NOT store a real SSN until Phase E encryption lands.
  bank_routing_masked text,          -- display-only mask (e.g. '••••1234'); no real ACH (NACHA is a stub).
  bank_account_masked text,          -- display-only mask; no real bank rail.

  is_active boolean not null default true,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Pay schedules — frequency + the next window a run is opened for
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists accounting.pay_schedules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  frequency text not null check (frequency in ('weekly', 'biweekly', 'semimonthly', 'monthly')),
  anchor_date date not null,            -- a known period boundary the rest are computed from
  next_period_start date,
  next_period_end date,
  next_pay_date date,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Pay runs — one payroll run header
-- ─────────────────────────────────────────────────────────────────────────────
-- Lifecycle mirrors the import batch: draft -> calculated -> committed (terminal). 'void'
-- is the post-commit off-ramp (reverses the posted JE). ONLY a 'calculated' run may be
-- committed (the migration-030 RPC enforces this). posted_journal_entry_id is stamped on commit;
-- ON DELETE SET NULL so the run survives if its (immutable) JE is ever administratively detached
-- — though posted JEs are corrected by void/reverse, never deleted.
create table if not exists accounting.pay_runs (
  id uuid primary key default gen_random_uuid(),
  pay_schedule_id uuid references accounting.pay_schedules(id) on delete set null,
  period_start date not null,
  period_end date not null,
  pay_date date not null,
  tax_year int not null,
  status text not null default 'draft' check (status in ('draft', 'calculated', 'committed', 'void')),
  -- post-commit roll-up: totals (gross/net/employee-tax/employer-tax cents), paycheck count, etc.
  summary jsonb not null default '{}'::jsonb,
  posted_journal_entry_id uuid references accounting.journal_entries(id) on delete set null,
  committed_at timestamptz,
  committed_by uuid references public.profiles(id) on delete set null,
  voided_at timestamptz,
  voided_by uuid references public.profiles(id) on delete set null,
  void_reason text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pay_runs_period_order check (period_end >= period_start)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Paychecks — one row per employee per run (ALL money integer cents; G6)
-- ─────────────────────────────────────────────────────────────────────────────
-- hours_* are in HUNDREDTHS OF AN HOUR (i.e. "hour-cents": 1.5h = 150) so partial hours stay
-- integer and the engine's cents math never sees a float. gross/net/employer_taxes are cents.
-- taxes jsonb carries the per-tax employee+employer cents AND the payroll_tax_tables version id
-- used, so a paycheck is fully auditable: { "fed_income_pit": {"employee_cents": N},
-- "fica_ss": {"employee_cents": N, "employer_cents": N, "table_id": "<uuid>"}, ... }.
-- deductions jsonb carries other (non-statutory) deductions: [{ "code","label","amount_cents",
-- "pretax": bool }]. source_shift_ids is provenance only (NOT a FK; see header).
create table if not exists accounting.paychecks (
  id uuid primary key default gen_random_uuid(),
  pay_run_id uuid not null references accounting.pay_runs(id) on delete cascade,
  employee_id uuid not null references accounting.employees(id) on delete restrict,
  hours_regular_cents bigint not null default 0 check (hours_regular_cents >= 0),  -- hundredths of an hour
  hours_ot_cents bigint not null default 0 check (hours_ot_cents >= 0),            -- hundredths of an hour
  gross_cents bigint not null default 0 check (gross_cents >= 0),
  taxes jsonb not null default '{}'::jsonb,            -- per-tax employee/employer cents + table_id
  deductions jsonb not null default '[]'::jsonb,       -- other (non-statutory) deductions
  employer_taxes_cents bigint not null default 0 check (employer_taxes_cents >= 0),
  employee_taxes_cents bigint not null default 0 check (employee_taxes_cents >= 0),  -- Σ employee withholdings (convenience)
  other_deductions_cents bigint not null default 0 check (other_deductions_cents >= 0),
  net_cents bigint not null default 0 check (net_cents >= 0),
  source_shift_ids uuid[] not null default '{}',       -- provenance: which public.shifts fed this check
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- one paycheck per employee per run (idempotency anchor for recalc; the run is recomputed by
  -- delete+reinsert while in 'draft'/'calculated', so this prevents accidental duplicates).
  unique (pay_run_id, employee_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Payroll liabilities — per-agency accrual bridge to 2300 + future deposits
-- ─────────────────────────────────────────────────────────────────────────────
-- One row per (run, tax_kind, party) accrued by the commit. liability_account_id points at the
-- account the credit lands in (2300 Payroll Liabilities by default; ON DELETE RESTRICT so an
-- in-use liability account can't be removed). status moves accrued -> paid when a (future,
-- out-of-scope) tax-deposit JE is posted; paid_journal_entry_id records that deposit. This table
-- shape supports deposits WITHOUT this build implementing them.
create table if not exists accounting.payroll_liabilities (
  id uuid primary key default gen_random_uuid(),
  pay_run_id uuid not null references accounting.pay_runs(id) on delete cascade,
  jurisdiction text not null check (jurisdiction in ('federal', 'CA')),
  tax_kind text not null,                              -- mirrors payroll_tax_tables.tax_kind values
  party text not null check (party in ('employee', 'employer')),
  amount_cents bigint not null default 0 check (amount_cents >= 0),
  liability_account_id uuid references accounting.accounts(id) on delete restrict,
  status text not null default 'accrued' check (status in ('accrued', 'paid')),
  paid_journal_entry_id uuid references accounting.journal_entries(id) on delete set null,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) Indexes (guarded so the migration is re-runnable)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_employees_active') then
    create index idx_acct_employees_active on accounting.employees(is_active);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_employees_profile') then
    create index idx_acct_employees_profile on accounting.employees(profile_id);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_pay_schedules_active') then
    create index idx_acct_pay_schedules_active on accounting.pay_schedules(is_active);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_pay_runs_status') then
    create index idx_acct_pay_runs_status on accounting.pay_runs(status, pay_date desc);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_pay_runs_schedule') then
    create index idx_acct_pay_runs_schedule on accounting.pay_runs(pay_schedule_id);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_paychecks_run') then
    create index idx_acct_paychecks_run on accounting.paychecks(pay_run_id);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_paychecks_employee') then
    create index idx_acct_paychecks_employee on accounting.paychecks(employee_id);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_payroll_liab_run') then
    create index idx_acct_payroll_liab_run on accounting.payroll_liabilities(pay_run_id);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_payroll_liab_status') then
    create index idx_acct_payroll_liab_status on accounting.payroll_liabilities(status, jurisdiction, tax_kind);
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) Standard RLS + audit + touch wiring (WRITE = can_payroll())
-- ─────────────────────────────────────────────────────────────────────────────
select accounting._apply_standard_table('employees',           true, 'accounting.can_payroll()');
select accounting._apply_standard_table('pay_schedules',        true, 'accounting.can_payroll()');
select accounting._apply_standard_table('pay_runs',             true, 'accounting.can_payroll()');
select accounting._apply_standard_table('paychecks',            true, 'accounting.can_payroll()');
select accounting._apply_standard_table('payroll_liabilities',  true, 'accounting.can_payroll()');

-- Belt-and-suspenders explicit grants (default privileges already cover new objects; restated
-- for unambiguous current-object grants, matching the convention in migrations 015/017/018/024).
grant select, insert, update, delete on all tables in schema accounting to authenticated, service_role;
grant usage, select on all sequences in schema accounting to authenticated, service_role;
grant execute on all functions in schema accounting to authenticated, service_role;

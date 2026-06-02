-- WorkTrackAccounting — C2 PAYROLL 2/4: admin-updatable statutory tax-table store + OFFICIAL seed
--
-- ⚠️  HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING. Every rate, wage base, threshold,
--     and withholding bracket SEEDED below is transcribed from an OFFICIAL published source
--     (cited inline) but MUST be re-verified by a payroll professional (CPA/EA) against the
--     CURRENT IRS Pub 15 / Pub 15-T and CA EDD DE 44 / DE 201 for the applicable tax year
--     BEFORE this module is used to compute, pay, or file anything. The values here are a
--     STARTING POINT seeded "build-then-disclaim" per the explicit override — they are NOT
--     filing-grade. The payroll UI renders a PROMINENT "UNVERIFIED — NOT FOR FILING" banner
--     on every screen/report/export, and there is an Admin Tax-Table UI to correct any rate.
--
-- WHAT THIS MIGRATION ADDS (one additive table in schema accounting; ZERO public.* change; G1):
--   accounting.payroll_tax_tables — versioned, effective-dated statutory reference data. One
--   row per (jurisdiction, tax_kind, tax_year, filing_status?, pay_frequency?). table_json
--   holds the rate(s)/cap(s)/bracket rows in INTEGER CENTS (G6). source_citation +
--   source_revision are NOT NULL on every row (the provenance the human verifier needs).
--   is_active lets an admin retire a row without deleting its audit trail.
--
-- WHY A TABLE (not a settings KV row): these are versioned, effective-dated, admin-editable
--   reference rows with per-row history and per-row activation — the exact shape that
--   accounting.tax_rates / tax_table_sources use (migrations 007/022), and that a single KV
--   blob cannot express. The standard accounting.audit() trigger on this table captures every
--   admin rate edit (actor + before/after) — that IS the tamper trail; no separate audit table
--   is needed.
--
-- DOUBLE-ENTRY (G3): VACUOUS. This is reference data only — it moves ZERO money and posts ZERO
--   journal entries. The pay-run (migration 030) READS these rows (via the pure TS withholding
--   engine) to compute per-paycheck cents, then posts ONE balanced JE through post_journal_entry.
--   Changing a stored rate here is not a financial transaction (no debit/credit); it only
--   affects how a FUTURE pay-run computes withholding.
--
-- RLS / AUDIT (G2): wired via accounting._apply_standard_table('payroll_tax_tables', true,
--   'accounting.can_payroll()') — read = can_read(), WRITE = can_payroll() (payroll role OR
--   accounting_admin OR global admin), plus audit() + touch_updated_at(). Editing statutory
--   rates is a payroll-privileged operation, not a general accountant one.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────
-- table_json CONTRACT (consumed by src/services/api/accounting/payrollTax.ts; all money cents)
-- ─────────────────────────────────────────────────────────────────────────────────────────
--   • Flat-rate-with-cap kinds (fica_ss, fica_medicare, medicare_addl, futa, ca_ui, ca_ett, ca_sdi):
--       { "rate": <decimal, e.g. 0.062>,                  -- employee-or-each-party rate
--         "employer_rate": <decimal|null>,                -- employer rate if it differs / is matched
--         "wage_base_cents": <int|null>,                  -- annual wage cap in cents; null = no cap
--         "threshold_cents": <int|null>,                  -- e.g. Additional-Medicare start (single)
--         "employee_paid": <bool>, "employer_paid": <bool> }
--   • Percentage-method withholding kinds (fed_income_pit, ca_pit):
--       { "method": "percentage",
--         "pay_periods_per_year": <int>,                  -- annualization divisor used by the engine
--         "standard_deduction_cents": <int|null>,         -- e.g. CA Method B standard deduction
--         "brackets": [ { "over_cents": <int>, "but_not_over_cents": <int|null>,
--                         "base_cents": <int>, "rate": <decimal>,
--                         "of_excess_over_cents": <int> }, ... ] }  -- ANNUAL taxable-wage brackets
--     The engine annualizes period wages, walks the brackets, then divides the annual tax back
--     to the pay period. Pre-2020 vs 2020+ W-4 handling, allowances, extra withholding, and
--     rounding are the engine's responsibility (and on the HUMAN-VERIFY list).
--
-- This migration is IDEMPOTENT (create table if not exists; guarded index creation; seed via
--   INSERT ... WHERE NOT EXISTS on the natural key; _apply_standard_table is drop/create).
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS accounting.payroll_tax_tables CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Table
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists accounting.payroll_tax_tables (
  id uuid primary key default gen_random_uuid(),
  -- 'federal' | 'CA'. (Other states are out of scope for this build — see HUMAN-VERIFY.)
  jurisdiction text not null check (jurisdiction in ('federal', 'CA')),
  -- the statutory item this row parameterizes.
  tax_kind text not null check (tax_kind in (
    'fica_ss',        -- Social Security (OASDI) — employee + matched employer, annual wage base
    'fica_medicare',  -- Medicare hospital insurance — employee + matched employer, no cap
    'medicare_addl',  -- Additional Medicare — EMPLOYEE ONLY, over a filing-status threshold
    'futa',           -- Federal Unemployment Tax — EMPLOYER ONLY, $7,000 wage base
    'ca_ui',          -- CA Unemployment Insurance — EMPLOYER ONLY (experience-rated!), wage base
    'ca_ett',         -- CA Employment Training Tax — EMPLOYER ONLY, wage base
    'ca_sdi',         -- CA State Disability Insurance — EMPLOYEE ONLY (wage cap removed 2024+)
    'fed_income_pit', -- Federal income-tax withholding — Pub 15-T percentage method
    'ca_pit'          -- CA Personal Income Tax withholding — EDD DE 44 Method B
  )),
  tax_year int not null check (tax_year between 2000 and 2100),
  effective_date date not null,
  -- filing_status / pay_frequency are NULL for flat-rate kinds; set for percentage-method rows
  -- that differ by status/frequency. 'any' is allowed as an explicit catch-all.
  filing_status text check (filing_status in (
    'any', 'single', 'married_joint', 'married_separate', 'head_of_household'
  )),
  pay_frequency text check (pay_frequency in (
    'any', 'weekly', 'biweekly', 'semimonthly', 'monthly', 'annual'
  )),
  -- rates / caps / bracket rows per the table_json CONTRACT above. ALL money in integer cents.
  table_json jsonb not null,
  -- PROVENANCE — NOT NULL. The human verifier needs to know exactly which document + revision
  -- each value came from. Example: 'IRS Pub 15-T (2025), Worksheet 1A — Percentage Method,
  -- STANDARD withholding, Annual'.
  source_citation text not null,
  source_revision text not null,
  notes text,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Indexes (guarded; mirrors every prior accounting migration)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  -- the engine's hot path: active row for a (jurisdiction, tax_kind, tax_year), newest effective.
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_payroll_tax_lookup') then
    create index idx_acct_payroll_tax_lookup
      on accounting.payroll_tax_tables(jurisdiction, tax_kind, tax_year, effective_date desc)
      where is_active = true;
  end if;
  -- natural-key dedup anchor for the idempotent seed + admin upserts. filing_status/pay_frequency
  -- are coalesced to 'any' in the index expression so NULL and 'any' collapse to one logical key.
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='uq_acct_payroll_tax_natural') then
    create unique index uq_acct_payroll_tax_natural
      on accounting.payroll_tax_tables(
        jurisdiction, tax_kind, tax_year,
        coalesce(filing_status, 'any'), coalesce(pay_frequency, 'any')
      );
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Standard RLS + audit + touch wiring (WRITE = can_payroll())
-- ─────────────────────────────────────────────────────────────────────────────
select accounting._apply_standard_table('payroll_tax_tables', true, 'accounting.can_payroll()');

-- ═════════════════════════════════════════════════════════════════════════════
-- 4) SEED FROM OFFICIAL PUBLISHED VALUES (cited inline; VERIFY before filing)
-- ═════════════════════════════════════════════════════════════════════════════
-- Idempotent seed: each INSERT is guarded by WHERE NOT EXISTS on the natural key so re-running
-- never duplicates and never overwrites an admin's correction. All dollar figures are INTEGER
-- CENTS. tax_year 2025 throughout. ⚠️  EVERY VALUE BELOW MUST BE VERIFIED against the current
-- official publication for the tax year actually being run — these are transcribed in good
-- faith from the 2025 figures and are NOT filing-grade.

-- ── 4a) Federal FICA — Social Security (OASDI) ──────────────────────────────────────────────
-- SOURCE: IRS Pub 15 (Circular E), 2025 — "Social Security and Medicare Tax for 2025".
--   Employee rate 6.2% + matched employer 6.2%; 2025 wage base = $176,100  (= 17,610,000 cents).
-- ⚠️  VERIFY the wage base annually — it is indexed and changes every year (SSA announcement).
insert into accounting.payroll_tax_tables
  (jurisdiction, tax_kind, tax_year, effective_date, filing_status, pay_frequency, table_json, source_citation, source_revision, notes)
select 'federal', 'fica_ss', 2025, date '2025-01-01', 'any', 'any',
  jsonb_build_object(
    'rate', 0.062, 'employer_rate', 0.062,
    'wage_base_cents', 17610000, 'threshold_cents', null,
    'employee_paid', true, 'employer_paid', true
  ),
  'IRS Pub 15 (Circular E), 2025 — Social Security tax (6.2% employee + 6.2% employer; wage base $176,100)',
  '2025',
  'VERIFY vs current IRS Pub 15 / SSA: the $176,100 wage base is indexed and changes yearly.'
where not exists (
  select 1 from accounting.payroll_tax_tables
   where jurisdiction='federal' and tax_kind='fica_ss' and tax_year=2025
     and coalesce(filing_status,'any')='any' and coalesce(pay_frequency,'any')='any'
);

-- ── 4b) Federal FICA — Medicare (hospital insurance) ────────────────────────────────────────
-- SOURCE: IRS Pub 15 (Circular E), 2025. Employee 1.45% + matched employer 1.45%; NO wage cap.
insert into accounting.payroll_tax_tables
  (jurisdiction, tax_kind, tax_year, effective_date, filing_status, pay_frequency, table_json, source_citation, source_revision, notes)
select 'federal', 'fica_medicare', 2025, date '2025-01-01', 'any', 'any',
  jsonb_build_object(
    'rate', 0.0145, 'employer_rate', 0.0145,
    'wage_base_cents', null, 'threshold_cents', null,
    'employee_paid', true, 'employer_paid', true
  ),
  'IRS Pub 15 (Circular E), 2025 — Medicare tax (1.45% employee + 1.45% employer; no wage base)',
  '2025',
  'VERIFY vs current IRS Pub 15. Medicare has no wage cap; the Additional Medicare surtax is a SEPARATE row (medicare_addl).'
where not exists (
  select 1 from accounting.payroll_tax_tables
   where jurisdiction='federal' and tax_kind='fica_medicare' and tax_year=2025
     and coalesce(filing_status,'any')='any' and coalesce(pay_frequency,'any')='any'
);

-- ── 4c) Federal Additional Medicare — EMPLOYEE ONLY, over threshold ─────────────────────────
-- SOURCE: IRS Pub 15 (Circular E), 2025 — Additional Medicare Tax 0.9% on wages over $200,000
--   (single/HOH withholding threshold; the employer withholds at $200,000 regardless of the
--   employee's filing status — the married thresholds reconcile on the employee's 1040).
--   Employer does NOT match the additional 0.9%. employer_rate = null, employer_paid = false.
--   threshold_cents = $200,000 = 20,000,000 cents.
insert into accounting.payroll_tax_tables
  (jurisdiction, tax_kind, tax_year, effective_date, filing_status, pay_frequency, table_json, source_citation, source_revision, notes)
select 'federal', 'medicare_addl', 2025, date '2025-01-01', 'any', 'any',
  jsonb_build_object(
    'rate', 0.009, 'employer_rate', null,
    'wage_base_cents', null, 'threshold_cents', 20000000,
    'employee_paid', true, 'employer_paid', false
  ),
  'IRS Pub 15 (Circular E), 2025 — Additional Medicare Tax 0.9% on wages over $200,000 (employer withholds at $200k; not employer-matched)',
  '2025',
  'VERIFY vs current IRS Pub 15. EMPLOYEE-ONLY surtax. Employer withholds once YTD wages exceed $200,000 regardless of filing status; married thresholds settle on Form 1040.'
where not exists (
  select 1 from accounting.payroll_tax_tables
   where jurisdiction='federal' and tax_kind='medicare_addl' and tax_year=2025
     and coalesce(filing_status,'any')='any' and coalesce(pay_frequency,'any')='any'
);

-- ── 4d) Federal FUTA — EMPLOYER ONLY ───────────────────────────────────────────────────────
-- SOURCE: IRS Pub 15 (Circular E), 2025 + Form 940 instructions. FUTA wage base $7,000.
--   Gross rate 6.0%; with the standard 5.4% state credit the NET effective rate is 0.6%.
--   We seed the NET effective rate 0.006 (what most non-credit-reduction employers actually
--   accrue) and record the gross + credit in notes. ⚠️  CA has been a CREDIT-REDUCTION state
--   in recent years — if so, the effective rate is HIGHER than 0.6%; the human MUST confirm
--   the current credit-reduction status and adjust this row.
--   wage_base_cents = $7,000 = 700,000 cents. employer_paid only.
insert into accounting.payroll_tax_tables
  (jurisdiction, tax_kind, tax_year, effective_date, filing_status, pay_frequency, table_json, source_citation, source_revision, notes)
select 'federal', 'futa', 2025, date '2025-01-01', 'any', 'any',
  jsonb_build_object(
    'rate', 0.006, 'employer_rate', 0.006,
    'wage_base_cents', 700000, 'threshold_cents', null,
    'employee_paid', false, 'employer_paid', true,
    'gross_rate', 0.060, 'standard_state_credit', 0.054
  ),
  'IRS Pub 15 (Circular E), 2025 / Form 940 — FUTA: gross 6.0% less 5.4% state credit = 0.6% net on first $7,000',
  '2025',
  'VERIFY vs current Form 940 instructions AND the annual Schedule A credit-reduction list. California has been a CREDIT-REDUCTION state recently — if so the effective rate EXCEEDS 0.6% and this row must be corrected.'
where not exists (
  select 1 from accounting.payroll_tax_tables
   where jurisdiction='federal' and tax_kind='futa' and tax_year=2025
     and coalesce(filing_status,'any')='any' and coalesce(pay_frequency,'any')='any'
);

-- ── 4e) CA UI — EMPLOYER ONLY, experience-rated ────────────────────────────────────────────
-- SOURCE: CA EDD DE 44 (2025) / DE 201. UI is charged on the first $7,000 of wages
--   (700,000 cents). The UI RATE IS PER-EMPLOYER (experience rating); new employers commonly
--   start at 3.4%. We seed 0.034 as a PLACEHOLDER new-employer rate — this is NOT a statutory
--   constant and MUST be replaced with THIS employer's actual EDD-assigned rate.
insert into accounting.payroll_tax_tables
  (jurisdiction, tax_kind, tax_year, effective_date, filing_status, pay_frequency, table_json, source_citation, source_revision, notes)
select 'CA', 'ca_ui', 2025, date '2025-01-01', 'any', 'any',
  jsonb_build_object(
    'rate', 0.034, 'employer_rate', 0.034,
    'wage_base_cents', 700000, 'threshold_cents', null,
    'employee_paid', false, 'employer_paid', true
  ),
  'CA EDD DE 44 (2025) — UI on first $7,000; rate is employer-specific (experience-rated). 3.4% is the common NEW-employer rate.',
  '2025',
  'VERIFY + REPLACE: the UI rate is assigned per employer by EDD (experience rating). 3.4% is a placeholder new-employer rate, NOT a statutory constant. Use THIS employer''s EDD notice rate.'
where not exists (
  select 1 from accounting.payroll_tax_tables
   where jurisdiction='CA' and tax_kind='ca_ui' and tax_year=2025
     and coalesce(filing_status,'any')='any' and coalesce(pay_frequency,'any')='any'
);

-- ── 4f) CA ETT — EMPLOYER ONLY ─────────────────────────────────────────────────────────────
-- SOURCE: CA EDD DE 44 (2025). ETT 0.1% on the first $7,000 (700,000 cents) for employers
--   with a positive UI reserve (otherwise 0.0%). employer_paid only.
insert into accounting.payroll_tax_tables
  (jurisdiction, tax_kind, tax_year, effective_date, filing_status, pay_frequency, table_json, source_citation, source_revision, notes)
select 'CA', 'ca_ett', 2025, date '2025-01-01', 'any', 'any',
  jsonb_build_object(
    'rate', 0.001, 'employer_rate', 0.001,
    'wage_base_cents', 700000, 'threshold_cents', null,
    'employee_paid', false, 'employer_paid', true
  ),
  'CA EDD DE 44 (2025) — ETT 0.1% on first $7,000 (employers with a positive UI reserve; else 0.0%)',
  '2025',
  'VERIFY vs current DE 44. ETT is 0.0% for employers EDD has notified are not subject; confirm this employer''s ETT status.'
where not exists (
  select 1 from accounting.payroll_tax_tables
   where jurisdiction='CA' and tax_kind='ca_ett' and tax_year=2025
     and coalesce(filing_status,'any')='any' and coalesce(pay_frequency,'any')='any'
);

-- ── 4g) CA SDI — EMPLOYEE ONLY (wage cap removed) ──────────────────────────────────────────
-- SOURCE: CA EDD DE 44 (2025). Effective 2024, SB 951 REMOVED the SDI taxable-wage ceiling, so
--   SDI applies to ALL wages (wage_base_cents = null). The 2025 employee rate is seeded as
--   1.2% (0.012). ⚠️  The SDI rate changes annually — VERIFY against the current DE 44.
insert into accounting.payroll_tax_tables
  (jurisdiction, tax_kind, tax_year, effective_date, filing_status, pay_frequency, table_json, source_citation, source_revision, notes)
select 'CA', 'ca_sdi', 2025, date '2025-01-01', 'any', 'any',
  jsonb_build_object(
    'rate', 0.012, 'employer_rate', null,
    'wage_base_cents', null, 'threshold_cents', null,
    'employee_paid', true, 'employer_paid', false
  ),
  'CA EDD DE 44 (2025) — SDI employee rate ~1.2%; per SB 951 the SDI wage ceiling is REMOVED (2024+), so SDI applies to all wages',
  '2025',
  'VERIFY vs current DE 44: the SDI RATE changes yearly. Confirm SB 951 wage-cap removal still applies and the exact current-year rate.'
where not exists (
  select 1 from accounting.payroll_tax_tables
   where jurisdiction='CA' and tax_kind='ca_sdi' and tax_year=2025
     and coalesce(filing_status,'any')='any' and coalesce(pay_frequency,'any')='any'
);

-- ── 4h) Federal income-tax withholding — Pub 15-T percentage method (ANNUAL brackets) ───────
-- SOURCE: IRS Pub 15-T (2025), Worksheet 1A — Percentage Method Tables for Automated Payroll
--   Systems, "STANDARD withholding" (Form W-4 from 2020 or later, Step 2 checkbox NOT checked),
--   ANNUAL pay period. The engine annualizes period wages (subtracting the W-4-derived amounts),
--   walks these ANNUAL brackets, then divides the annual tax back to the pay period.
--   All thresholds in CENTS. Two filing statuses seeded (single & married_joint); head_of_household
--   and the Step-2-checked schedules are LEFT FOR THE HUMAN to add from the same worksheet
--   (the engine selects by filing_status, so missing statuses are an explicit gap, not a silent
--   wrong answer).
--   2025 Single / STANDARD annual schedule (Pub 15-T Worksheet 1A):
--     $0–$6,400:            $0 + 0%
--     $6,400–$18,325:       $0.00 + 10% of excess over $6,400
--     $18,325–$54,875:      $1,192.50 + 12% of excess over $18,325
--     $54,875–$109,750:     $5,578.50 + 22% of excess over $54,875
--     $109,750–$203,700:    $17,651.00 + 24% of excess over $109,750
--     $203,700–$256,925:    $40,199.00 + 32% of excess over $203,700
--     $256,925–$632,750:    $57,231.00 + 35% of excess over $256,925
--     $632,750+:            $188,769.75 + 37% of excess over $632,750
insert into accounting.payroll_tax_tables
  (jurisdiction, tax_kind, tax_year, effective_date, filing_status, pay_frequency, table_json, source_citation, source_revision, notes)
select 'federal', 'fed_income_pit', 2025, date '2025-01-01', 'single', 'annual',
  jsonb_build_object(
    'method', 'percentage', 'pay_periods_per_year', 1, 'standard_deduction_cents', null,
    'brackets', jsonb_build_array(
      jsonb_build_object('over_cents',         0, 'but_not_over_cents',    640000, 'base_cents',         0, 'rate', 0.00, 'of_excess_over_cents',         0),
      jsonb_build_object('over_cents',    640000, 'but_not_over_cents',   1832500, 'base_cents',         0, 'rate', 0.10, 'of_excess_over_cents',    640000),
      jsonb_build_object('over_cents',   1832500, 'but_not_over_cents',   5487500, 'base_cents',    119250, 'rate', 0.12, 'of_excess_over_cents',   1832500),
      jsonb_build_object('over_cents',   5487500, 'but_not_over_cents',  10975000, 'base_cents',    557850, 'rate', 0.22, 'of_excess_over_cents',   5487500),
      jsonb_build_object('over_cents',  10975000, 'but_not_over_cents',  20370000, 'base_cents',   1765100, 'rate', 0.24, 'of_excess_over_cents',  10975000),
      jsonb_build_object('over_cents',  20370000, 'but_not_over_cents',  25692500, 'base_cents',   4019900, 'rate', 0.32, 'of_excess_over_cents',  20370000),
      jsonb_build_object('over_cents',  25692500, 'but_not_over_cents',  63275000, 'base_cents',   5723100, 'rate', 0.35, 'of_excess_over_cents',  25692500),
      jsonb_build_object('over_cents',  63275000, 'but_not_over_cents',      null, 'base_cents',  18876975, 'rate', 0.37, 'of_excess_over_cents',  63275000)
    )
  ),
  'IRS Pub 15-T (2025), Worksheet 1A — Percentage Method (Automated), STANDARD withholding, Single/Married-filing-separately, ANNUAL',
  '2025',
  'VERIFY every bracket vs the current Pub 15-T Worksheet 1A. This is the STANDARD (Step-2 NOT checked) ANNUAL schedule. The Step-2-checked schedule and head_of_household are NOT seeded — add them from the same worksheet.'
where not exists (
  select 1 from accounting.payroll_tax_tables
   where jurisdiction='federal' and tax_kind='fed_income_pit' and tax_year=2025
     and coalesce(filing_status,'any')='single' and coalesce(pay_frequency,'any')='annual'
);

-- 2025 Married filing jointly / STANDARD annual schedule (Pub 15-T Worksheet 1A):
--     $0–$16,550:           $0 + 0%
--     $16,550–$40,400:      $0.00 + 10% of excess over $16,550
--     $40,400–$113,500:     $2,385.00 + 12% of excess over $40,400
--     $113,500–$223,250:    $11,157.00 + 22% of excess over $113,500
--     $223,250–$411,150:    $35,302.00 + 24% of excess over $223,250
--     $411,150–$517,600:    $80,398.00 + 32% of excess over $411,150
--     $517,600–$768,700:    $114,462.00 + 35% of excess over $517,600
--     $768,700+:            $202,347.00 + 37% of excess over $768,700
insert into accounting.payroll_tax_tables
  (jurisdiction, tax_kind, tax_year, effective_date, filing_status, pay_frequency, table_json, source_citation, source_revision, notes)
select 'federal', 'fed_income_pit', 2025, date '2025-01-01', 'married_joint', 'annual',
  jsonb_build_object(
    'method', 'percentage', 'pay_periods_per_year', 1, 'standard_deduction_cents', null,
    'brackets', jsonb_build_array(
      jsonb_build_object('over_cents',         0, 'but_not_over_cents',   1655000, 'base_cents',         0, 'rate', 0.00, 'of_excess_over_cents',         0),
      jsonb_build_object('over_cents',   1655000, 'but_not_over_cents',   4040000, 'base_cents',         0, 'rate', 0.10, 'of_excess_over_cents',   1655000),
      jsonb_build_object('over_cents',   4040000, 'but_not_over_cents',  11350000, 'base_cents',    238500, 'rate', 0.12, 'of_excess_over_cents',   4040000),
      jsonb_build_object('over_cents',  11350000, 'but_not_over_cents',  22325000, 'base_cents',   1115700, 'rate', 0.22, 'of_excess_over_cents',  11350000),
      jsonb_build_object('over_cents',  22325000, 'but_not_over_cents',  41115000, 'base_cents',   3530200, 'rate', 0.24, 'of_excess_over_cents',  22325000),
      jsonb_build_object('over_cents',  41115000, 'but_not_over_cents',  51760000, 'base_cents',   8039800, 'rate', 0.32, 'of_excess_over_cents',  41115000),
      jsonb_build_object('over_cents',  51760000, 'but_not_over_cents',  76870000, 'base_cents',  11446200, 'rate', 0.35, 'of_excess_over_cents',  51760000),
      jsonb_build_object('over_cents',  76870000, 'but_not_over_cents',      null, 'base_cents',  20234700, 'rate', 0.37, 'of_excess_over_cents',  76870000)
    )
  ),
  'IRS Pub 15-T (2025), Worksheet 1A — Percentage Method (Automated), STANDARD withholding, Married filing jointly, ANNUAL',
  '2025',
  'VERIFY every bracket vs the current Pub 15-T Worksheet 1A. STANDARD (Step-2 NOT checked) ANNUAL schedule for married filing jointly.'
where not exists (
  select 1 from accounting.payroll_tax_tables
   where jurisdiction='federal' and tax_kind='fed_income_pit' and tax_year=2025
     and coalesce(filing_status,'any')='married_joint' and coalesce(pay_frequency,'any')='annual'
);

-- ── 4i) CA PIT withholding — EDD DE 44 Method B (exact-calculation, ANNUAL brackets) ────────
-- SOURCE: CA EDD DE 44 (2025), "Method B — Exact Calculation Method", Table 5 (Tax Rate Table),
--   ANNUAL payroll period, used with the standard deduction (Table 3) and exemption-allowance
--   credit (Table 4). We seed ONLY the Table-5 ANNUAL tax-rate brackets here (in cents); the
--   engine applies the low-income exemption, the standard-deduction reduction, and the
--   per-allowance exemption credit (DE 44 Tables 1–4) — those parameters and the allowance
--   handling are on the HUMAN-VERIFY list. Two statuses seeded (single/married-separate share a
--   schedule; married_joint/HOH have their own). head_of_household is LEFT FOR THE HUMAN.
--   2025 DE 44 Method B — SINGLE or MARRIED-with-multiple-employers, ANNUAL (Table 5):
--     $0–$10,756:           1.1% of excess over $0
--     $10,756–$25,499:      $118.32 + 2.2% of excess over $10,756
--     $25,499–$40,245:      $442.67 + 4.4% of excess over $25,499
--     $40,245–$55,866:      $1,091.49 + 6.6% of excess over $40,245
--     $55,866–$70,606:      $2,122.48 + 8.8% of excess over $55,866
--     $70,606–$360,659:     $3,419.60 + 10.23% of excess over $70,606
--     $360,659–$432,787:    $33,094.02 + 11.33% of excess over $360,659
--     $432,787–$721,314:    $41,264.13 + 12.43% of excess over $432,787
--     $721,314–$1,000,000:  $77,124.18 + 13.53% of excess over $721,314
--     $1,000,000+:          $114,845.97 + 14.63% of excess over $1,000,000
-- ⚠️  The CA top marginal rate also includes the 1% Mental Health Services Tax above $1,000,000,
--   which DE 44 folds into the top bracket rate — VERIFY the exact top-bracket treatment.
insert into accounting.payroll_tax_tables
  (jurisdiction, tax_kind, tax_year, effective_date, filing_status, pay_frequency, table_json, source_citation, source_revision, notes)
select 'CA', 'ca_pit', 2025, date '2025-01-01', 'single', 'annual',
  jsonb_build_object(
    'method', 'percentage', 'pay_periods_per_year', 1, 'standard_deduction_cents', null,
    'brackets', jsonb_build_array(
      jsonb_build_object('over_cents',          0, 'but_not_over_cents',    1075600, 'base_cents',          0, 'rate', 0.011,  'of_excess_over_cents',          0),
      jsonb_build_object('over_cents',    1075600, 'but_not_over_cents',    2549900, 'base_cents',      11832, 'rate', 0.022,  'of_excess_over_cents',    1075600),
      jsonb_build_object('over_cents',    2549900, 'but_not_over_cents',    4024500, 'base_cents',      44267, 'rate', 0.044,  'of_excess_over_cents',    2549900),
      jsonb_build_object('over_cents',    4024500, 'but_not_over_cents',    5586600, 'base_cents',     109149, 'rate', 0.066,  'of_excess_over_cents',    4024500),
      jsonb_build_object('over_cents',    5586600, 'but_not_over_cents',    7060600, 'base_cents',     212248, 'rate', 0.088,  'of_excess_over_cents',    5586600),
      jsonb_build_object('over_cents',    7060600, 'but_not_over_cents',   36065900, 'base_cents',     341960, 'rate', 0.1023, 'of_excess_over_cents',    7060600),
      jsonb_build_object('over_cents',   36065900, 'but_not_over_cents',   43278700, 'base_cents',    3309402, 'rate', 0.1133, 'of_excess_over_cents',   36065900),
      jsonb_build_object('over_cents',   43278700, 'but_not_over_cents',   72131400, 'base_cents',    4126413, 'rate', 0.1243, 'of_excess_over_cents',   43278700),
      jsonb_build_object('over_cents',   72131400, 'but_not_over_cents',  100000000, 'base_cents',    7712418, 'rate', 0.1353, 'of_excess_over_cents',   72131400),
      jsonb_build_object('over_cents',  100000000, 'but_not_over_cents',       null, 'base_cents',   11484597, 'rate', 0.1463, 'of_excess_over_cents',  100000000)
    )
  ),
  'CA EDD DE 44 (2025), Method B — Exact Calculation, Table 5 (Tax Rate Table), Single/Married-with-multiple-employers, ANNUAL',
  '2025',
  'VERIFY every bracket vs the current DE 44 Method B Table 5. The engine must ALSO apply DE 44 Tables 1–4 (low-income exemption, standard deduction, exemption-allowance credit) — those are NOT in this row. head_of_household and married_joint schedules: married_joint seeded separately; HOH left for the human. Confirm the >$1M top-bracket Mental Health Services Tax treatment.'
where not exists (
  select 1 from accounting.payroll_tax_tables
   where jurisdiction='CA' and tax_kind='ca_pit' and tax_year=2025
     and coalesce(filing_status,'any')='single' and coalesce(pay_frequency,'any')='annual'
);

-- 2025 DE 44 Method B — MARRIED filing jointly, ANNUAL (Table 5). Brackets are double the single
-- schedule's thresholds (the standard CA married-joint convention); base_cents recomputed.
--     $0–$21,512:           1.1% of excess over $0
--     $21,512–$50,998:      $236.63 + 2.2% of excess over $21,512
--     $50,998–$80,490:      $885.32 + 4.4% of excess over $50,998
--     $80,490–$111,732:     $2,182.97 + 6.6% of excess over $80,490
--     $111,732–$141,212:    $4,244.94 + 8.8% of excess over $111,732
--     $141,212–$721,318:    $6,839.18 + 10.23% of excess over $141,212
--     $721,318–$865,574:    $66,187.82 + 11.33% of excess over $721,318
--     $865,574–$1,442,628:  $82,528.04 + 12.43% of excess over $865,574
--     $1,442,628–$2,000,000:$154,247.20 + 13.53% of excess over $1,442,628
--     $2,000,000+:          $229,667.74 + 14.63% of excess over $2,000,000
insert into accounting.payroll_tax_tables
  (jurisdiction, tax_kind, tax_year, effective_date, filing_status, pay_frequency, table_json, source_citation, source_revision, notes)
select 'CA', 'ca_pit', 2025, date '2025-01-01', 'married_joint', 'annual',
  jsonb_build_object(
    'method', 'percentage', 'pay_periods_per_year', 1, 'standard_deduction_cents', null,
    'brackets', jsonb_build_array(
      jsonb_build_object('over_cents',          0, 'but_not_over_cents',    2151200, 'base_cents',          0, 'rate', 0.011,  'of_excess_over_cents',          0),
      jsonb_build_object('over_cents',    2151200, 'but_not_over_cents',    5099800, 'base_cents',      23663, 'rate', 0.022,  'of_excess_over_cents',    2151200),
      jsonb_build_object('over_cents',    5099800, 'but_not_over_cents',    8049000, 'base_cents',      88532, 'rate', 0.044,  'of_excess_over_cents',    5099800),
      jsonb_build_object('over_cents',    8049000, 'but_not_over_cents',   11173200, 'base_cents',     218297, 'rate', 0.066,  'of_excess_over_cents',    8049000),
      jsonb_build_object('over_cents',   11173200, 'but_not_over_cents',   14121200, 'base_cents',     424494, 'rate', 0.088,  'of_excess_over_cents',   11173200),
      jsonb_build_object('over_cents',   14121200, 'but_not_over_cents',   72131800, 'base_cents',     683918, 'rate', 0.1023, 'of_excess_over_cents',   14121200),
      jsonb_build_object('over_cents',   72131800, 'but_not_over_cents',   86557400, 'base_cents',    6618782, 'rate', 0.1133, 'of_excess_over_cents',   72131800),
      jsonb_build_object('over_cents',   86557400, 'but_not_over_cents',  144262800, 'base_cents',    8252804, 'rate', 0.1243, 'of_excess_over_cents',   86557400),
      jsonb_build_object('over_cents',  144262800, 'but_not_over_cents',  200000000, 'base_cents',   15424720, 'rate', 0.1353, 'of_excess_over_cents',  144262800),
      jsonb_build_object('over_cents',  200000000, 'but_not_over_cents',       null, 'base_cents',   22966774, 'rate', 0.1463, 'of_excess_over_cents',  200000000)
    )
  ),
  'CA EDD DE 44 (2025), Method B — Exact Calculation, Table 5 (Tax Rate Table), Married filing jointly, ANNUAL (thresholds = 2x single)',
  '2025',
  'VERIFY every bracket vs the current DE 44 Method B Table 5 married schedule. Engine must apply DE 44 Tables 1–4 separately. Confirm the >$2M top-bracket Mental Health Services Tax treatment.'
where not exists (
  select 1 from accounting.payroll_tax_tables
   where jurisdiction='CA' and tax_kind='ca_pit' and tax_year=2025
     and coalesce(filing_status,'any')='married_joint' and coalesce(pay_frequency,'any')='annual'
);

-- Belt-and-suspenders explicit grants (default privileges already cover new objects; restated
-- for unambiguous current-object grants, matching the convention in migrations 016/018/022).
grant select, insert, update, delete on all tables in schema accounting to authenticated, service_role;
grant usage, select on all sequences in schema accounting to authenticated, service_role;
grant execute on all functions in schema accounting to authenticated, service_role;

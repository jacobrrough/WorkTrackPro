-- WorkTrackAccounting — C2 PAYROLL: 2026 statutory tax-table seed (ADDITIVE; supersedes nothing)
--
-- ⚠️  HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING. Every rate, wage base, threshold, and
--     withholding bracket SEEDED below was transcribed in good faith DIRECTLY from the OFFICIAL
--     2026 published source (cited inline, with the .gov document each value came from) but MUST
--     still be re-verified by a payroll professional (CPA/EA) against the CURRENT IRS Pub 15 /
--     Pub 15-T and CA EDD DE 44 / DE 201 for the tax year being run BEFORE this module is used to
--     compute, pay, or file anything. These are a STARTING POINT seeded "build-then-disclaim" per
--     the explicit override — they are NOT filing-grade. The payroll UI renders a PROMINENT
--     "UNVERIFIED — NOT FOR FILING" banner on every screen/report/export, and an Admin Tax-Table
--     UI lets a verified professional correct any rate.
--
-- WHY THIS MIGRATION EXISTS:
--   Migration 20260601000028 seeded tax_year 2025 from the 2025 publications. This migration adds
--   the tax_year 2026 rows from the freshly published 2026 .gov sources (the original request:
--   "double check .gov websites for the most up to date tax tables"). It is PURELY ADDITIVE — it
--   inserts new (jurisdiction, tax_kind, 2026, ...) rows and NEVER touches the 2025 rows or any
--   admin correction. The pure withholding engine (src/services/api/accounting/payrollTax.ts)
--   selects rows by tax_year via buildTaxTableSet(taxYear, rows), so a 2026 pay-run automatically
--   picks these up and a 2025 pay-run is unaffected. ZERO public.* change (G1). VACUOUS for
--   double-entry (G3): reference data only — moves no money, posts no journal entry.
--
-- DEPENDS ON: 20260601000028 (owns the accounting.payroll_tax_tables table DDL + RLS/audit wiring
--   via _apply_standard_table). This file is SEED-ONLY and assumes that table already exists; in
--   the normal ordered migration apply it always runs after 028, so no DDL is repeated here.
--
-- WHAT'S NEW IN 2026 vs the 2025 seed (the values a human should sanity-check first):
--   • Federal Social Security wage base: $176,100 → $184,500 (SSA, +4.8% AWI indexing).
--   • Federal income-tax withholding brackets: refreshed to IRS Pub 15-T (2026) STANDARD
--     schedules; ALSO now seeds head_of_household (the 2025 seed left HOH to the human).
--   • CA SDI employee rate: 1.2% → 1.3% (EDD; SB 951 wage ceiling still removed → no cap).
--   • CA PIT withholding brackets: refreshed to CA EDD DE 44 / "2026 Withholding Schedules —
--     Method B", ANNUAL Tables 5/6/7; ALSO now seeds head_of_household (Table 7).
--   • Unchanged statutory items re-seeded for 2026 completeness: Medicare 1.45%×2 (no cap),
--     Additional Medicare 0.9% over $200,000 (employee-only), FUTA $7,000 base / 0.6% net,
--     CA UI $7,000 base / 3.4% new-employer placeholder, CA ETT 0.1% / $7,000.
--
-- table_json CONTRACT: identical to migration 028 (see that file's header). All money INTEGER
--   CENTS (G6). Percentage rows: {method:'percentage', pay_periods_per_year, standard_deduction_cents,
--   brackets:[{over_cents, but_not_over_cents, base_cents, rate, of_excess_over_cents}]} (ANNUAL).
--
-- This migration is IDEMPOTENT: every INSERT is guarded by WHERE NOT EXISTS on the natural key
--   (jurisdiction, tax_kind, tax_year, coalesce(filing_status,'any'), coalesce(pay_frequency,'any')),
--   so re-running never duplicates and never overwrites an admin's correction.
--
-- ROLLBACK:
--   delete from accounting.payroll_tax_tables where tax_year = 2026 and source_revision = '2026-seed';

-- ═════════════════════════════════════════════════════════════════════════════
-- FEDERAL — flat-rate-with-cap kinds (2026)
-- ═════════════════════════════════════════════════════════════════════════════

-- ── Federal FICA — Social Security (OASDI) 2026 ─────────────────────────────────────────────
-- SOURCE: SSA "Contribution and Benefit Base" announcement for 2026 (ssa.gov/oact/cola/cbb.html)
--   + IRS Pub 15 (Circular E) 2026. Employee 6.2% + matched employer 6.2%; 2026 wage base =
--   $184,500 (= 18,450,000 cents), up from $176,100 in 2025. ⚠️  VERIFY the wage base annually.
insert into accounting.payroll_tax_tables
  (jurisdiction, tax_kind, tax_year, effective_date, filing_status, pay_frequency, table_json, source_citation, source_revision, notes)
select 'federal', 'fica_ss', 2026, date '2026-01-01', 'any', 'any',
  jsonb_build_object(
    'rate', 0.062, 'employer_rate', 0.062,
    'wage_base_cents', 18450000, 'threshold_cents', null,
    'employee_paid', true, 'employer_paid', true
  ),
  'SSA Contribution & Benefit Base 2026 + IRS Pub 15 (Circular E) 2026 — Social Security 6.2% employee + 6.2% employer; wage base $184,500',
  '2026-seed',
  'VERIFY vs current IRS Pub 15 / SSA: the $184,500 wage base is indexed and changes yearly (was $176,100 in 2025).'
where not exists (
  select 1 from accounting.payroll_tax_tables
   where jurisdiction='federal' and tax_kind='fica_ss' and tax_year=2026
     and coalesce(filing_status,'any')='any' and coalesce(pay_frequency,'any')='any'
);

-- ── Federal FICA — Medicare 2026 (unchanged statutory) ──────────────────────────────────────
-- SOURCE: IRS Pub 15 (Circular E), 2026. Employee 1.45% + matched employer 1.45%; NO wage cap.
insert into accounting.payroll_tax_tables
  (jurisdiction, tax_kind, tax_year, effective_date, filing_status, pay_frequency, table_json, source_citation, source_revision, notes)
select 'federal', 'fica_medicare', 2026, date '2026-01-01', 'any', 'any',
  jsonb_build_object(
    'rate', 0.0145, 'employer_rate', 0.0145,
    'wage_base_cents', null, 'threshold_cents', null,
    'employee_paid', true, 'employer_paid', true
  ),
  'IRS Pub 15 (Circular E), 2026 — Medicare 1.45% employee + 1.45% employer; no wage base',
  '2026-seed',
  'VERIFY vs current IRS Pub 15. Medicare has no wage cap; the Additional Medicare surtax is a SEPARATE row (medicare_addl).'
where not exists (
  select 1 from accounting.payroll_tax_tables
   where jurisdiction='federal' and tax_kind='fica_medicare' and tax_year=2026
     and coalesce(filing_status,'any')='any' and coalesce(pay_frequency,'any')='any'
);

-- ── Federal Additional Medicare 2026 — EMPLOYEE ONLY (unchanged statutory threshold) ────────
-- SOURCE: IRS Pub 15 (Circular E), 2026 — 0.9% on wages over $200,000 (the $200k withholding
--   threshold is NOT indexed; the employer withholds at $200k regardless of filing status).
insert into accounting.payroll_tax_tables
  (jurisdiction, tax_kind, tax_year, effective_date, filing_status, pay_frequency, table_json, source_citation, source_revision, notes)
select 'federal', 'medicare_addl', 2026, date '2026-01-01', 'any', 'any',
  jsonb_build_object(
    'rate', 0.009, 'employer_rate', null,
    'wage_base_cents', null, 'threshold_cents', 20000000,
    'employee_paid', true, 'employer_paid', false
  ),
  'IRS Pub 15 (Circular E), 2026 — Additional Medicare 0.9% on wages over $200,000 (employer withholds at $200k; not employer-matched)',
  '2026-seed',
  'VERIFY vs current IRS Pub 15. EMPLOYEE-ONLY surtax. The $200,000 withholding threshold is statutory (not indexed); married thresholds settle on Form 1040.'
where not exists (
  select 1 from accounting.payroll_tax_tables
   where jurisdiction='federal' and tax_kind='medicare_addl' and tax_year=2026
     and coalesce(filing_status,'any')='any' and coalesce(pay_frequency,'any')='any'
);

-- ── Federal FUTA 2026 — EMPLOYER ONLY ───────────────────────────────────────────────────────
-- SOURCE: IRS Pub 15 (Circular E), 2026 / Form 940. $7,000 wage base; gross 6.0% less standard
--   5.4% state credit = 0.6% net. ⚠️  CALIFORNIA HAS BEEN A CREDIT-REDUCTION STATE in recent
--   years — if CA is on the current Schedule A (Form 940) credit-reduction list, the effective
--   rate EXCEEDS 0.6% and this row MUST be corrected. We seed 0.6% net (no reduction) as the
--   placeholder; the human verifier confirms the current-year reduction.
insert into accounting.payroll_tax_tables
  (jurisdiction, tax_kind, tax_year, effective_date, filing_status, pay_frequency, table_json, source_citation, source_revision, notes)
select 'federal', 'futa', 2026, date '2026-01-01', 'any', 'any',
  jsonb_build_object(
    'rate', 0.006, 'employer_rate', 0.006,
    'wage_base_cents', 700000, 'threshold_cents', null,
    'employee_paid', false, 'employer_paid', true,
    'gross_rate', 0.060, 'standard_state_credit', 0.054
  ),
  'IRS Pub 15 (Circular E), 2026 / Form 940 — FUTA gross 6.0% less 5.4% state credit = 0.6% net on first $7,000',
  '2026-seed',
  'VERIFY vs current Form 940 instructions AND the annual Schedule A credit-reduction list. California has been a CREDIT-REDUCTION state recently — if so the effective rate EXCEEDS 0.6% and this row must be corrected.'
where not exists (
  select 1 from accounting.payroll_tax_tables
   where jurisdiction='federal' and tax_kind='futa' and tax_year=2026
     and coalesce(filing_status,'any')='any' and coalesce(pay_frequency,'any')='any'
);

-- ═════════════════════════════════════════════════════════════════════════════
-- CALIFORNIA — flat-rate-with-cap kinds (2026)
-- ═════════════════════════════════════════════════════════════════════════════

-- ── CA UI 2026 — EMPLOYER ONLY, experience-rated ────────────────────────────────────────────
-- SOURCE: CA EDD "Contribution Rates, Withholding Schedules" 2026 — UI on first $7,000; rate is
--   per-employer (experience rating). 3.4% is the common NEW-employer rate (placeholder).
insert into accounting.payroll_tax_tables
  (jurisdiction, tax_kind, tax_year, effective_date, filing_status, pay_frequency, table_json, source_citation, source_revision, notes)
select 'CA', 'ca_ui', 2026, date '2026-01-01', 'any', 'any',
  jsonb_build_object(
    'rate', 0.034, 'employer_rate', 0.034,
    'wage_base_cents', 700000, 'threshold_cents', null,
    'employee_paid', false, 'employer_paid', true
  ),
  'CA EDD Rates & Withholding 2026 — UI on first $7,000; rate is employer-specific (experience-rated). 3.4% is the common NEW-employer rate.',
  '2026-seed',
  'VERIFY + REPLACE: the UI rate is assigned per employer by EDD (experience rating). 3.4% is a placeholder new-employer rate, NOT a statutory constant. Use THIS employer''s EDD notice rate.'
where not exists (
  select 1 from accounting.payroll_tax_tables
   where jurisdiction='CA' and tax_kind='ca_ui' and tax_year=2026
     and coalesce(filing_status,'any')='any' and coalesce(pay_frequency,'any')='any'
);

-- ── CA ETT 2026 — EMPLOYER ONLY ─────────────────────────────────────────────────────────────
-- SOURCE: CA EDD Rates & Withholding 2026 — ETT 0.1% on the first $7,000 (employers with a
--   positive UI reserve; otherwise 0.0%).
insert into accounting.payroll_tax_tables
  (jurisdiction, tax_kind, tax_year, effective_date, filing_status, pay_frequency, table_json, source_citation, source_revision, notes)
select 'CA', 'ca_ett', 2026, date '2026-01-01', 'any', 'any',
  jsonb_build_object(
    'rate', 0.001, 'employer_rate', 0.001,
    'wage_base_cents', 700000, 'threshold_cents', null,
    'employee_paid', false, 'employer_paid', true
  ),
  'CA EDD Rates & Withholding 2026 — ETT 0.1% on first $7,000 (employers with a positive UI reserve; else 0.0%)',
  '2026-seed',
  'VERIFY vs current EDD rates. ETT is 0.0% for employers EDD has notified are not subject; confirm this employer''s ETT status.'
where not exists (
  select 1 from accounting.payroll_tax_tables
   where jurisdiction='CA' and tax_kind='ca_ett' and tax_year=2026
     and coalesce(filing_status,'any')='any' and coalesce(pay_frequency,'any')='any'
);

-- ── CA SDI 2026 — EMPLOYEE ONLY (no wage cap per SB 951) ─────────────────────────────────────
-- SOURCE: CA EDD Rates & Withholding 2026 — SDI employee rate 1.3% (up from 1.2% in 2025); per
--   SB 951 the SDI taxable-wage ceiling remains REMOVED (2024+), so SDI applies to ALL wages.
insert into accounting.payroll_tax_tables
  (jurisdiction, tax_kind, tax_year, effective_date, filing_status, pay_frequency, table_json, source_citation, source_revision, notes)
select 'CA', 'ca_sdi', 2026, date '2026-01-01', 'any', 'any',
  jsonb_build_object(
    'rate', 0.013, 'employer_rate', null,
    'wage_base_cents', null, 'threshold_cents', null,
    'employee_paid', true, 'employer_paid', false
  ),
  'CA EDD Rates & Withholding 2026 — SDI employee rate 1.3%; per SB 951 the SDI wage ceiling is REMOVED (2024+), so SDI applies to all wages',
  '2026-seed',
  'VERIFY vs current EDD rates: the SDI RATE changes yearly (1.2% in 2025 → 1.3% in 2026). Confirm SB 951 wage-cap removal still applies and the exact current-year rate.'
where not exists (
  select 1 from accounting.payroll_tax_tables
   where jurisdiction='CA' and tax_kind='ca_sdi' and tax_year=2026
     and coalesce(filing_status,'any')='any' and coalesce(pay_frequency,'any')='any'
);

-- ═════════════════════════════════════════════════════════════════════════════
-- FEDERAL income-tax withholding — IRS Pub 15-T (2026), Worksheet 1A, STANDARD, ANNUAL
-- ═════════════════════════════════════════════════════════════════════════════
-- SOURCE: IRS Publication 15-T (2026), "2026 Percentage Method Tables for Automated Payroll
--   Systems", STANDARD Withholding Rate Schedules (use when the Form W-4 is from 2019 or earlier,
--   OR from 2020+ with the Step-2 box NOT checked), ANNUAL pay period. The engine annualizes
--   period wages, walks these ANNUAL brackets, then divides the annual tax back to the pay period.
--   The Step-2-checked schedules are LEFT FOR THE HUMAN (the engine selects by filing_status, so a
--   missing schedule is an explicit gap, not a silent wrong answer).

-- 2026 Single or Married-filing-separately / STANDARD annual (Pub 15-T 2026):
--   $0–$7,500:            $0 + 0%
--   $7,500–$19,900:       $0 + 10% over $7,500
--   $19,900–$57,900:      $1,240.00 + 12% over $19,900
--   $57,900–$113,200:     $5,800.00 + 22% over $57,900
--   $113,200–$209,275:    $17,966.00 + 24% over $113,200
--   $209,275–$263,725:    $41,024.00 + 32% over $209,275
--   $263,725–$648,100:    $58,448.00 + 35% over $263,725
--   $648,100+:            $192,979.25 + 37% over $648,100
insert into accounting.payroll_tax_tables
  (jurisdiction, tax_kind, tax_year, effective_date, filing_status, pay_frequency, table_json, source_citation, source_revision, notes)
select 'federal', 'fed_income_pit', 2026, date '2026-01-01', 'single', 'annual',
  jsonb_build_object(
    'method', 'percentage', 'pay_periods_per_year', 1, 'standard_deduction_cents', null,
    'brackets', jsonb_build_array(
      jsonb_build_object('over_cents',         0, 'but_not_over_cents',    750000, 'base_cents',         0, 'rate', 0.00, 'of_excess_over_cents',         0),
      jsonb_build_object('over_cents',    750000, 'but_not_over_cents',   1990000, 'base_cents',         0, 'rate', 0.10, 'of_excess_over_cents',    750000),
      jsonb_build_object('over_cents',   1990000, 'but_not_over_cents',   5790000, 'base_cents',    124000, 'rate', 0.12, 'of_excess_over_cents',   1990000),
      jsonb_build_object('over_cents',   5790000, 'but_not_over_cents',  11320000, 'base_cents',    580000, 'rate', 0.22, 'of_excess_over_cents',   5790000),
      jsonb_build_object('over_cents',  11320000, 'but_not_over_cents',  20927500, 'base_cents',   1796600, 'rate', 0.24, 'of_excess_over_cents',  11320000),
      jsonb_build_object('over_cents',  20927500, 'but_not_over_cents',  26372500, 'base_cents',   4102400, 'rate', 0.32, 'of_excess_over_cents',  20927500),
      jsonb_build_object('over_cents',  26372500, 'but_not_over_cents',  64810000, 'base_cents',   5844800, 'rate', 0.35, 'of_excess_over_cents',  26372500),
      jsonb_build_object('over_cents',  64810000, 'but_not_over_cents',      null, 'base_cents',  19297925, 'rate', 0.37, 'of_excess_over_cents',  64810000)
    )
  ),
  'IRS Pub 15-T (2026), Percentage Method (Automated), STANDARD withholding, Single/Married-filing-separately, ANNUAL',
  '2026-seed',
  'VERIFY every bracket vs IRS Pub 15-T (2026). STANDARD (Step-2 NOT checked) ANNUAL schedule. The Step-2-checked schedule is NOT seeded — add it from the same table if needed.'
where not exists (
  select 1 from accounting.payroll_tax_tables
   where jurisdiction='federal' and tax_kind='fed_income_pit' and tax_year=2026
     and coalesce(filing_status,'any')='single' and coalesce(pay_frequency,'any')='annual'
);

-- 2026 Married filing jointly / STANDARD annual (Pub 15-T 2026):
--   $0–$19,300:           $0 + 0%
--   $19,300–$44,100:      $0 + 10% over $19,300
--   $44,100–$120,100:     $2,480.00 + 12% over $44,100
--   $120,100–$230,700:    $11,600.00 + 22% over $120,100
--   $230,700–$422,850:    $35,932.00 + 24% over $230,700
--   $422,850–$531,750:    $82,048.00 + 32% over $422,850
--   $531,750–$788,000:    $116,896.00 + 35% over $531,750
--   $788,000+:            $206,583.50 + 37% over $788,000
insert into accounting.payroll_tax_tables
  (jurisdiction, tax_kind, tax_year, effective_date, filing_status, pay_frequency, table_json, source_citation, source_revision, notes)
select 'federal', 'fed_income_pit', 2026, date '2026-01-01', 'married_joint', 'annual',
  jsonb_build_object(
    'method', 'percentage', 'pay_periods_per_year', 1, 'standard_deduction_cents', null,
    'brackets', jsonb_build_array(
      jsonb_build_object('over_cents',         0, 'but_not_over_cents',   1930000, 'base_cents',         0, 'rate', 0.00, 'of_excess_over_cents',         0),
      jsonb_build_object('over_cents',   1930000, 'but_not_over_cents',   4410000, 'base_cents',         0, 'rate', 0.10, 'of_excess_over_cents',   1930000),
      jsonb_build_object('over_cents',   4410000, 'but_not_over_cents',  12010000, 'base_cents',    248000, 'rate', 0.12, 'of_excess_over_cents',   4410000),
      jsonb_build_object('over_cents',  12010000, 'but_not_over_cents',  23070000, 'base_cents',   1160000, 'rate', 0.22, 'of_excess_over_cents',  12010000),
      jsonb_build_object('over_cents',  23070000, 'but_not_over_cents',  42285000, 'base_cents',   3593200, 'rate', 0.24, 'of_excess_over_cents',  23070000),
      jsonb_build_object('over_cents',  42285000, 'but_not_over_cents',  53175000, 'base_cents',   8204800, 'rate', 0.32, 'of_excess_over_cents',  42285000),
      jsonb_build_object('over_cents',  53175000, 'but_not_over_cents',  78800000, 'base_cents',  11689600, 'rate', 0.35, 'of_excess_over_cents',  53175000),
      jsonb_build_object('over_cents',  78800000, 'but_not_over_cents',      null, 'base_cents',  20658350, 'rate', 0.37, 'of_excess_over_cents',  78800000)
    )
  ),
  'IRS Pub 15-T (2026), Percentage Method (Automated), STANDARD withholding, Married filing jointly, ANNUAL',
  '2026-seed',
  'VERIFY every bracket vs IRS Pub 15-T (2026). STANDARD (Step-2 NOT checked) ANNUAL schedule for married filing jointly.'
where not exists (
  select 1 from accounting.payroll_tax_tables
   where jurisdiction='federal' and tax_kind='fed_income_pit' and tax_year=2026
     and coalesce(filing_status,'any')='married_joint' and coalesce(pay_frequency,'any')='annual'
);

-- 2026 Head of household / STANDARD annual (Pub 15-T 2026) — NEW for 2026 (2025 seed omitted HOH):
--   $0–$15,550:           $0 + 0%
--   $15,550–$33,250:      $0 + 10% over $15,550
--   $33,250–$83,000:      $1,770.00 + 12% over $33,250
--   $83,000–$121,250:     $7,740.00 + 22% over $83,000
--   $121,250–$217,300:    $16,155.00 + 24% over $121,250
--   $217,300–$271,750:    $39,207.00 + 32% over $217,300
--   $271,750–$656,150:    $56,631.00 + 35% over $271,750
--   $656,150+:            $191,171.00 + 37% over $656,150
insert into accounting.payroll_tax_tables
  (jurisdiction, tax_kind, tax_year, effective_date, filing_status, pay_frequency, table_json, source_citation, source_revision, notes)
select 'federal', 'fed_income_pit', 2026, date '2026-01-01', 'head_of_household', 'annual',
  jsonb_build_object(
    'method', 'percentage', 'pay_periods_per_year', 1, 'standard_deduction_cents', null,
    'brackets', jsonb_build_array(
      jsonb_build_object('over_cents',         0, 'but_not_over_cents',   1555000, 'base_cents',         0, 'rate', 0.00, 'of_excess_over_cents',         0),
      jsonb_build_object('over_cents',   1555000, 'but_not_over_cents',   3325000, 'base_cents',         0, 'rate', 0.10, 'of_excess_over_cents',   1555000),
      jsonb_build_object('over_cents',   3325000, 'but_not_over_cents',   8300000, 'base_cents',    177000, 'rate', 0.12, 'of_excess_over_cents',   3325000),
      jsonb_build_object('over_cents',   8300000, 'but_not_over_cents',  12125000, 'base_cents',    774000, 'rate', 0.22, 'of_excess_over_cents',   8300000),
      jsonb_build_object('over_cents',  12125000, 'but_not_over_cents',  21730000, 'base_cents',   1615500, 'rate', 0.24, 'of_excess_over_cents',  12125000),
      jsonb_build_object('over_cents',  21730000, 'but_not_over_cents',  27175000, 'base_cents',   3920700, 'rate', 0.32, 'of_excess_over_cents',  21730000),
      jsonb_build_object('over_cents',  27175000, 'but_not_over_cents',  65615000, 'base_cents',   5663100, 'rate', 0.35, 'of_excess_over_cents',  27175000),
      jsonb_build_object('over_cents',  65615000, 'but_not_over_cents',      null, 'base_cents',  19117100, 'rate', 0.37, 'of_excess_over_cents',  65615000)
    )
  ),
  'IRS Pub 15-T (2026), Percentage Method (Automated), STANDARD withholding, Head of Household, ANNUAL',
  '2026-seed',
  'VERIFY every bracket vs IRS Pub 15-T (2026). STANDARD (Step-2 NOT checked) ANNUAL schedule for head of household (newly seeded for 2026).'
where not exists (
  select 1 from accounting.payroll_tax_tables
   where jurisdiction='federal' and tax_kind='fed_income_pit' and tax_year=2026
     and coalesce(filing_status,'any')='head_of_household' and coalesce(pay_frequency,'any')='annual'
);

-- ═════════════════════════════════════════════════════════════════════════════
-- CALIFORNIA PIT withholding — EDD DE 44 "2026 Withholding Schedules — Method B", ANNUAL
-- ═════════════════════════════════════════════════════════════════════════════
-- SOURCE: CA EDD "California Withholding Schedules for 2026" — Method B (Exact Calculation),
--   ANNUAL payroll period Tax Rate Tables: Table 5 (Single/Dual Income Married/Multiple Employers),
--   Table 6 (Married Persons), Table 7 (Unmarried/Head of Household). We seed ONLY the ANNUAL
--   tax-rate brackets (in cents). The engine must ALSO apply the DE 44 supporting tables (which
--   are on the HUMAN-VERIFY list and NOT applied by the current engine):
--     • Table 1 Low Income Exemption (ANNUAL): $18,896 single/dual or married 0–1; $37,791 married 2+ / HOH.
--     • Table 3 Standard Deduction (ANNUAL): $5,706 single/dual; $11,412 married 2+ / HOH.
--     • Table 4 Exemption Allowance credit (ANNUAL): $168.30 per regular withholding allowance.
--   ⚠️  The CA top bracket folds in the 1% Mental Health Services Tax (>$1,000,000) — VERIFY the
--   exact top-bracket treatment.

-- 2026 DE 44 Method B Table 5 — SINGLE / Dual-Income-Married / Married-with-multiple-employers, ANNUAL:
--   $0–$11,079:           1.100% over $0
--   $11,079–$26,264:      $121.87 + 2.200% over $11,079
--   $26,264–$41,452:      $455.94 + 4.400% over $26,264
--   $41,452–$57,542:      $1,124.21 + 6.600% over $41,452
--   $57,542–$72,724:      $2,186.15 + 8.800% over $57,542
--   $72,724–$371,479:     $3,522.17 + 10.230% over $72,724
--   $371,479–$445,771:    $34,084.81 + 11.330% over $371,479
--   $445,771–$742,953:    $42,502.09 + 12.430% over $445,771
--   $742,953–$1,000,000:  $79,441.81 + 13.530% over $742,953
--   $1,000,000+:          $114,220.27 + 14.630% over $1,000,000
insert into accounting.payroll_tax_tables
  (jurisdiction, tax_kind, tax_year, effective_date, filing_status, pay_frequency, table_json, source_citation, source_revision, notes)
select 'CA', 'ca_pit', 2026, date '2026-01-01', 'single', 'annual',
  jsonb_build_object(
    'method', 'percentage', 'pay_periods_per_year', 1, 'standard_deduction_cents', null,
    'brackets', jsonb_build_array(
      jsonb_build_object('over_cents',          0, 'but_not_over_cents',    1107900, 'base_cents',          0, 'rate', 0.011,  'of_excess_over_cents',          0),
      jsonb_build_object('over_cents',    1107900, 'but_not_over_cents',    2626400, 'base_cents',      12187, 'rate', 0.022,  'of_excess_over_cents',    1107900),
      jsonb_build_object('over_cents',    2626400, 'but_not_over_cents',    4145200, 'base_cents',      45594, 'rate', 0.044,  'of_excess_over_cents',    2626400),
      jsonb_build_object('over_cents',    4145200, 'but_not_over_cents',    5754200, 'base_cents',     112421, 'rate', 0.066,  'of_excess_over_cents',    4145200),
      jsonb_build_object('over_cents',    5754200, 'but_not_over_cents',    7272400, 'base_cents',     218615, 'rate', 0.088,  'of_excess_over_cents',    5754200),
      jsonb_build_object('over_cents',    7272400, 'but_not_over_cents',   37147900, 'base_cents',     352217, 'rate', 0.1023, 'of_excess_over_cents',    7272400),
      jsonb_build_object('over_cents',   37147900, 'but_not_over_cents',   44577100, 'base_cents',    3408481, 'rate', 0.1133, 'of_excess_over_cents',   37147900),
      jsonb_build_object('over_cents',   44577100, 'but_not_over_cents',   74295300, 'base_cents',    4250209, 'rate', 0.1243, 'of_excess_over_cents',   44577100),
      jsonb_build_object('over_cents',   74295300, 'but_not_over_cents',  100000000, 'base_cents',    7944181, 'rate', 0.1353, 'of_excess_over_cents',   74295300),
      jsonb_build_object('over_cents',  100000000, 'but_not_over_cents',       null, 'base_cents',   11422027, 'rate', 0.1463, 'of_excess_over_cents',  100000000)
    )
  ),
  'CA EDD DE 44 — 2026 Withholding Schedules Method B, Table 5 (Single/Dual Income Married/Multiple Employers), ANNUAL',
  '2026-seed',
  'VERIFY every bracket vs the 2026 DE 44 Method B Table 5. Engine must ALSO apply DE 44 Tables 1/3/4 (low-income exemption $18,896, standard deduction $5,706, allowance credit $168.30) — NOT applied in this build. Confirm the >$1M Mental Health Services Tax top-bracket treatment.'
where not exists (
  select 1 from accounting.payroll_tax_tables
   where jurisdiction='CA' and tax_kind='ca_pit' and tax_year=2026
     and coalesce(filing_status,'any')='single' and coalesce(pay_frequency,'any')='annual'
);

-- 2026 DE 44 Method B Table 6 — MARRIED Persons, ANNUAL (published directly; not 2x single):
--   $0–$22,158:           1.100% over $0
--   $22,158–$52,528:      $243.74 + 2.200% over $22,158
--   $52,528–$82,904:      $911.88 + 4.400% over $52,528
--   $82,904–$115,084:     $2,248.42 + 6.600% over $82,904
--   $115,084–$145,448:    $4,372.30 + 8.800% over $115,084
--   $145,448–$742,958:    $7,044.33 + 10.230% over $145,448
--   $742,958–$891,542:    $68,169.60 + 11.330% over $742,958
--   $891,542–$1,000,000:  $85,004.17 + 12.430% over $891,542
--   $1,000,000–$1,485,906:$98,485.50 + 13.530% over $1,000,000
--   $1,485,906+:          $164,228.58 + 14.630% over $1,485,906
insert into accounting.payroll_tax_tables
  (jurisdiction, tax_kind, tax_year, effective_date, filing_status, pay_frequency, table_json, source_citation, source_revision, notes)
select 'CA', 'ca_pit', 2026, date '2026-01-01', 'married_joint', 'annual',
  jsonb_build_object(
    'method', 'percentage', 'pay_periods_per_year', 1, 'standard_deduction_cents', null,
    'brackets', jsonb_build_array(
      jsonb_build_object('over_cents',          0, 'but_not_over_cents',    2215800, 'base_cents',          0, 'rate', 0.011,  'of_excess_over_cents',          0),
      jsonb_build_object('over_cents',    2215800, 'but_not_over_cents',    5252800, 'base_cents',      24374, 'rate', 0.022,  'of_excess_over_cents',    2215800),
      jsonb_build_object('over_cents',    5252800, 'but_not_over_cents',    8290400, 'base_cents',      91188, 'rate', 0.044,  'of_excess_over_cents',    5252800),
      jsonb_build_object('over_cents',    8290400, 'but_not_over_cents',   11508400, 'base_cents',     224842, 'rate', 0.066,  'of_excess_over_cents',    8290400),
      jsonb_build_object('over_cents',   11508400, 'but_not_over_cents',   14544800, 'base_cents',     437230, 'rate', 0.088,  'of_excess_over_cents',   11508400),
      jsonb_build_object('over_cents',   14544800, 'but_not_over_cents',   74295800, 'base_cents',     704433, 'rate', 0.1023, 'of_excess_over_cents',   14544800),
      jsonb_build_object('over_cents',   74295800, 'but_not_over_cents',   89154200, 'base_cents',    6816960, 'rate', 0.1133, 'of_excess_over_cents',   74295800),
      jsonb_build_object('over_cents',   89154200, 'but_not_over_cents',  100000000, 'base_cents',    8500417, 'rate', 0.1243, 'of_excess_over_cents',   89154200),
      jsonb_build_object('over_cents',  100000000, 'but_not_over_cents',  148590600, 'base_cents',    9848550, 'rate', 0.1353, 'of_excess_over_cents',  100000000),
      jsonb_build_object('over_cents',  148590600, 'but_not_over_cents',       null, 'base_cents',   16422858, 'rate', 0.1463, 'of_excess_over_cents',  148590600)
    )
  ),
  'CA EDD DE 44 — 2026 Withholding Schedules Method B, Table 6 (Married Persons), ANNUAL',
  '2026-seed',
  'VERIFY every bracket vs the 2026 DE 44 Method B Table 6. Engine must apply DE 44 Tables 1/3/4 separately (married standard deduction $11,412, low-income exemption $37,791). Confirm the top-bracket Mental Health Services Tax treatment.'
where not exists (
  select 1 from accounting.payroll_tax_tables
   where jurisdiction='CA' and tax_kind='ca_pit' and tax_year=2026
     and coalesce(filing_status,'any')='married_joint' and coalesce(pay_frequency,'any')='annual'
);

-- 2026 DE 44 Method B Table 7 — UNMARRIED/HEAD OF HOUSEHOLD, ANNUAL — NEW for 2026:
--   $0–$22,173:           1.100% over $0
--   $22,173–$52,530:      $243.90 + 2.200% over $22,173
--   $52,530–$67,716:      $911.75 + 4.400% over $52,530
--   $67,716–$83,805:      $1,579.93 + 6.600% over $67,716
--   $83,805–$98,990:      $2,641.80 + 8.800% over $83,805
--   $98,990–$505,208:     $3,978.08 + 10.230% over $98,990
--   $505,208–$606,251:    $45,534.18 + 11.330% over $505,208
--   $606,251–$1,000,000:  $56,982.35 + 12.430% over $606,251
--   $1,000,000–$1,010,417:$105,925.35 + 13.530% over $1,000,000
--   $1,010,417+:          $107,334.77 + 14.630% over $1,010,417
insert into accounting.payroll_tax_tables
  (jurisdiction, tax_kind, tax_year, effective_date, filing_status, pay_frequency, table_json, source_citation, source_revision, notes)
select 'CA', 'ca_pit', 2026, date '2026-01-01', 'head_of_household', 'annual',
  jsonb_build_object(
    'method', 'percentage', 'pay_periods_per_year', 1, 'standard_deduction_cents', null,
    'brackets', jsonb_build_array(
      jsonb_build_object('over_cents',          0, 'but_not_over_cents',    2217300, 'base_cents',          0, 'rate', 0.011,  'of_excess_over_cents',          0),
      jsonb_build_object('over_cents',    2217300, 'but_not_over_cents',    5253000, 'base_cents',      24390, 'rate', 0.022,  'of_excess_over_cents',    2217300),
      jsonb_build_object('over_cents',    5253000, 'but_not_over_cents',    6771600, 'base_cents',      91175, 'rate', 0.044,  'of_excess_over_cents',    5253000),
      jsonb_build_object('over_cents',    6771600, 'but_not_over_cents',    8380500, 'base_cents',     157993, 'rate', 0.066,  'of_excess_over_cents',    6771600),
      jsonb_build_object('over_cents',    8380500, 'but_not_over_cents',    9899000, 'base_cents',     264180, 'rate', 0.088,  'of_excess_over_cents',    8380500),
      jsonb_build_object('over_cents',    9899000, 'but_not_over_cents',   50520800, 'base_cents',     397808, 'rate', 0.1023, 'of_excess_over_cents',    9899000),
      jsonb_build_object('over_cents',   50520800, 'but_not_over_cents',   60625100, 'base_cents',    4553418, 'rate', 0.1133, 'of_excess_over_cents',   50520800),
      jsonb_build_object('over_cents',   60625100, 'but_not_over_cents',  100000000, 'base_cents',    5698235, 'rate', 0.1243, 'of_excess_over_cents',   60625100),
      jsonb_build_object('over_cents',  100000000, 'but_not_over_cents',  101041700, 'base_cents',   10592535, 'rate', 0.1353, 'of_excess_over_cents',  100000000),
      jsonb_build_object('over_cents',  101041700, 'but_not_over_cents',       null, 'base_cents',   10733477, 'rate', 0.1463, 'of_excess_over_cents',  101041700)
    )
  ),
  'CA EDD DE 44 — 2026 Withholding Schedules Method B, Table 7 (Unmarried/Head of Household), ANNUAL',
  '2026-seed',
  'VERIFY every bracket vs the 2026 DE 44 Method B Table 7. Engine must apply DE 44 Tables 1/3/4 separately (HOH standard deduction $11,412, low-income exemption $37,791). Newly seeded for 2026.'
where not exists (
  select 1 from accounting.payroll_tax_tables
   where jurisdiction='CA' and tax_kind='ca_pit' and tax_year=2026
     and coalesce(filing_status,'any')='head_of_household' and coalesce(pay_frequency,'any')='annual'
);

-- Belt-and-suspenders explicit grants (default privileges already cover new objects; restated for
-- unambiguous current-object grants, matching the convention in migrations 016/018/022/028).
grant select, insert, update, delete on all tables in schema accounting to authenticated, service_role;
grant usage, select on all sequences in schema accounting to authenticated, service_role;
grant execute on all functions in schema accounting to authenticated, service_role;

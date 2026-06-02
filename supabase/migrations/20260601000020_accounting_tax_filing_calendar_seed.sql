-- WorkTrackAccounting — C1: sales-tax filing calendar config (seed only)
--
-- C1 ships TWO read-only surfaces: a Sales-Tax Liability report (tax COLLECTED =
-- posted credits to account 2200 "Sales Tax Payable", grouped by agency/jurisdiction,
-- with a CDTFA-style taxable/non-taxable summary) and a read-only Tax-Calendar
-- dashboard of upcoming filing deadlines. BOTH are REPORTING ONLY — no e-filing, no
-- money movement, no payroll, NO notification delivery.
--
-- WHY THIS SHAPE (purely additive, schema `accounting` only — G1)
--   • NO new table and NO new column. Everything the C1 *report* needs already exists
--     and is read at query time from the POSTED ledger + existing tax_* tables:
--       - tax COLLECTED  = SUM(journal_lines.credit - journal_lines.debit) on lines
--         where account_id = the 2200 "Sales Tax Payable" account (resolved at runtime
--         via settings.default_accounts.sales_tax_payable — never hardcoded), joined to
--         journal_entries with status = 'posted' and entry_date in range.
--       - agency/jurisdiction attribution = journal_entries.source_id (source_type =
--         'invoice') -> accounting.invoices.tax_code_id -> tax_code_rates -> tax_rates
--         -> tax_agencies. Any 2200 credit that cannot be tied back to a source invoice/
--         agency is surfaced in an explicit "Unattributed / review" bucket with a
--         reconciliation delta (stop-condition: surface, do not guess) — this is JS
--         report logic, not DB.
--       - taxable vs non-taxable sales = invoice_lines of those same posted invoices.
--     None of that requires a schema change. (Confirmed against migrations 004 GL,
--     007 tax, 008 sales.)
--
--   • The Tax-CALENDAR dashboard is driven by config the task specifies lives "from
--     accounting.settings". Each agency already carries tax_agencies.filing_frequency
--     (monthly/quarterly/annual). To let the dashboard show concrete DUE DATES and
--     human notes on a fresh DB — and to let an admin tune them later WITHOUT a code
--     change — we seed ONE KV row in the EXISTING accounting.settings table:
--         setting_key   = 'tax_filing_calendar'
--         setting_value = a JSON ARRAY of per-agency filing rules (see below).
--     This is the SAME mechanism D1 used for 'closed_through_date' (migration 016):
--     a single settings row, seeded idempotently, reusing settings' existing RLS
--     (read = can_read(), write = can_write()) and its audit + touch triggers (wired
--     in migration 016). The JS layer (taxCalendarMath.ts) computes upcoming/overdue
--     deadlines from this config relative to "as of"; if the row is ABSENT it falls
--     back to representative CDTFA cadence derived from filing_frequency alone — so
--     this seed is a UX convenience, and the module degrades gracefully without it.
--
--   • Calendar entry shape (each element of the array):
--       { "agency":       <tax_agencies.name>,        -- which agency this rule is for
--         "frequency":    "monthly|quarterly|annual", -- filing cadence (mirrors agency)
--         "period_basis": "calendar",                 -- periods align to calendar Q/M/Y
--         "due_day":      <int>,                       -- day-of-month the return is due
--         "due_month_offset": <int>,                   -- months after period-end the due
--                                                       --   day falls in (CDTFA quarterly:
--                                                       --   1 = last day of the month AFTER
--                                                       --   quarter-end)
--         "notes":        <text> }                     -- shown on the dashboard
--     Representative CDTFA quarterly cadence: returns/payment due the LAST day of the
--     month following each calendar quarter (Q1 Jan-Mar -> due Apr 30, Q2 -> Jul 31,
--     Q3 -> Oct 31, Q4 -> Jan 31). due_day = 31 with the JS clamping to month length.
--
-- NO MONEY MOVED, NO DDL: this migration only INSERTs a settings row (DATA, not schema).
-- It posts no journal entry (G3 vacuous — C1 is reporting only). It does NOT create or
-- alter any table/column, does NOT call accounting._apply_standard_table (the settings
-- table already owns its RLS in migration 001 and its audit/touch triggers in migration
-- 016 — re-applying would needlessly churn its policies), and touches NO public.* object
-- (G1 preserved). RLS is unchanged: settings reads require can_read(), writes can_write().
--
-- LEGAL (G9): seeded rates/cadences are REPRESENTATIVE examples only (same caveat as the
-- tax_* seed in migration 007). Every C1 screen and export must show:
--   "Not certified tax software. Always verify with a CPA/EA. Representative rates only."
-- The DB cannot enforce that banner; it is enforced in the C1 UI/export lane.
--
-- This migration is IDEMPOTENT (single insert ... on conflict (setting_key) do nothing;
-- re-running is a no-op and never overwrites an admin-edited calendar).
--
-- ROLLBACK:
--   -- The settings row is harmless config and may be left in place. To fully revert:
--   DELETE FROM accounting.settings WHERE setting_key = 'tax_filing_calendar';

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed the tax-filing calendar config (KV row in the existing accounting.settings)
-- ─────────────────────────────────────────────────────────────────────────────
-- One rule per seeded agency. Today only 'CDTFA' is seeded (migration 007); this seed
-- references it by the SAME canonical name. If CDTFA is later renamed/removed the JS
-- layer simply has no matching agency and shows nothing for it (no FK here by design —
-- settings is a generic KV store; the agency link is resolved in the report layer).
-- on conflict (setting_key) do nothing => never clobbers an admin's later edits.
insert into accounting.settings (setting_key, setting_value) values (
  'tax_filing_calendar',
  '[
    {
      "agency": "CDTFA",
      "frequency": "quarterly",
      "period_basis": "calendar",
      "due_day": 31,
      "due_month_offset": 1,
      "notes": "California sales & use tax. Representative cadence: quarterly return/payment due the last day of the month after each calendar quarter (Apr 30, Jul 31, Oct 31, Jan 31). Verify your exact CDTFA filing frequency and due dates."
    }
  ]'::jsonb
)
on conflict (setting_key) do nothing;

-- Belt-and-suspenders explicit grants (default privileges from migration 001 already
-- cover the settings table; restated for unambiguous current-object grants, matching
-- the convention in migrations 007/013/014/017).
grant select, insert, update, delete on all tables in schema accounting to authenticated, service_role;

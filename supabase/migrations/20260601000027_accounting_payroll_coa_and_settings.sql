-- WorkTrackAccounting — C2 PAYROLL 1/4: payroll chart-of-accounts + settings keys
--
-- ⚠️  HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING. This is the first of four
--     additive migrations that stand up the PAYROLL module. Payroll ships FLAG-DARK
--     (VITE_ACCOUNTING_ENABLED off) and requires a CPA/EA payroll professional AND/OR
--     security sign-off before it is enabled. The UI renders a PROMINENT
--     "UNVERIFIED — NOT FOR FILING" banner on every payroll screen, report, and export.
--     This SQL header records the hold; the DB cannot render the banner.
--
-- WHAT THIS MIGRATION ADDS (data/config ONLY — ZERO DDL, ZERO public.* change; G1):
--   Mirrors COA-EXPAND (migration 021) exactly: it only INSERTs rows into the EXISTING
--   accounting.accounts table and MERGEs new keys into the EXISTING
--   accounting.settings.default_accounts jsonb blob. No new table, no new column, no
--   altered constraint, no policy churn — accounting.accounts already owns its RLS
--   (read=can_read / write=can_write), its touch_updated_at trigger, and its audit()
--   trigger (migration 003); accounting.settings already owns its RLS + audit/touch
--   (migrations 001/016). Therefore this migration does NOT call _apply_standard_table
--   and does NOT (re)declare any policy, matching the precedent of the other data-only
--   migrations (007/016/020/021).
--
-- THE THREE NEW POSTING ACCOUNTS (future targets for the pay-run JE in migration 030):
--   • 6500 Wages & Salaries Expense        (expense / expense, normal debit)
--       — Σ paycheck GROSS pay (the employer's gross-wage cost).
--   • 6510 Employer Payroll Tax Expense    (expense / expense, normal debit)
--       — the EMPLOYER half only: employer FICA + employer Medicare + FUTA + CA UI + CA ETT.
--         Employee withholdings are NOT expense — they are a reduction of net pay that the
--         employer remits, so they credit 2300 (see migration 030's posting table).
--   • 1010 Payroll Clearing                (asset / bank, normal debit)
--       — net-pay cash CLEARING. The pay-run credits NET pay here, never a real bank rail.
--         A later, separate balanced JE (or the NACHA stub, which is export-only) clears
--         1010 against real cash. This is the mechanism that keeps ACH a STUB: no payroll
--         action ever touches a live bank account or moves real money out the door.
--   2300 Payroll Liabilities already exists (seeded is_system in migration 003) and is the
--   single statutory-liability parent that carries every withholding + employer tax payable
--   until each agency deposit is made (each deposit will be its own balanced JE — out of
--   scope for this build, but accounting.payroll_liabilities in migration 029 records the
--   per-agency accruals that bridge to it).
--
-- DOUBLE-ENTRY (G3): VACUOUS here. This migration creates ACCOUNT DEFINITIONS and settings
--   mappings only; it moves ZERO money and posts ZERO journal entries. All payroll money
--   movement happens exclusively inside accounting.commit_pay_run (migration 030), which
--   posts ONE balanced DRAFT entry through the EXISTING accounting.post_journal_entry so
--   guard_journal_entry enforces debits = credits + >= 2 lines at the single enforcement
--   point.
--
-- MONEY MATH (G6): N/A here (no amounts). Cents-based math lives in the pure TS engine and
--   the migration-030 RPC.
--
-- CONSTRAINT RECONCILIATION (against the live CHECKs in migration 003):
--   • account_type CHECK allows only asset|liability|equity|income|expense; both 6500 and
--     6510 are type 'expense'. account_subtype 'expense' is valid for both.
--   • 1010 Payroll Clearing uses subtype 'bank' (consistent with how 1000 Cash and 1030
--     Petty Cash are seeded 'bank'); it is a clearing asset with a normal DEBIT balance.
--   • All three carry is_system = true (structural; the platform's payroll posting depends
--     on them, so they are protected from deletion by convention like the other is_system
--     seeds). 1010 sits numerically just above 1000 Cash, intentionally, as a cash-adjacent
--     clearing account.
--
-- This migration is IDEMPOTENT (INSERT ... ON CONFLICT (account_number) DO NOTHING +
--   a guarded, merge-only settings UPDATE). Re-running is a no-op.
--
-- ROLLBACK:
--   -- The new accounts and the added default_accounts keys are harmless additive config
--   -- and may be left in place. To fully revert (only if NONE are referenced by a posted
--   -- journal line or a settings consumer):
--   --   UPDATE accounting.settings
--   --      SET setting_value = setting_value
--   --            - 'wagesExpense' - 'employerPayrollTaxExpense'
--   --            - 'payrollClearing' - 'payrollLiabilities'
--   --    WHERE setting_key = 'default_accounts';
--   --   DELETE FROM accounting.accounts WHERE account_number IN ('6500','6510','1010');

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Additive account rows (INSERT ... ON CONFLICT (account_number) DO NOTHING)
-- ─────────────────────────────────────────────────────────────────────────────
-- Columns/values reconciled against the live CHECK constraints in migration 003.
-- normal_balance: expenses = debit; the clearing asset = debit.
insert into accounting.accounts (account_number, name, account_type, account_subtype, normal_balance, is_system) values
  ('1010', 'Payroll Clearing',            'asset',   'bank',    'debit', true),
  ('6500', 'Wages & Salaries Expense',    'expense', 'expense', 'debit', true),
  ('6510', 'Employer Payroll Tax Expense','expense', 'expense', 'debit', true)
on conflict (account_number) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Register the four payroll default-account mappings (additive blob merge)
-- ─────────────────────────────────────────────────────────────────────────────
-- Extend the existing default_accounts KV blob so the migration-030 commit RPC and the
-- payroll UI can resolve these accounts by key without hardcoding ids:
--   wagesExpense              -> 6500
--   employerPayrollTaxExpense -> 6510
--   payrollClearing           -> 1010
--   payrollLiabilities        -> 2300  (the already-seeded statutory-liability parent)
-- NOTE on key casing: existing default_accounts keys use snake_case (cash, accounts_receivable,
-- opening_balance_equity, ...). The PLAN names these four payroll keys in camelCase
-- (wagesExpense, ...). We seed them in camelCase here to match the PLAN's DefaultAccounts TS
-- type extension (the API lane reads exactly these key names); the API mapper tolerates both
-- casings for the other keys. The jsonb blob is a free-form map, so mixed casing is legal —
-- the contract is that the TS reader and this seed agree on the literal key strings, which
-- they do.
-- `||` merges the new keys; the keys written by migrations 003/018/021 are preserved.
-- Guarded: only writes when all four referenced accounts resolve, so the merge is never
-- partial. Re-runnable / idempotent.
do $$
declare
  v_wages    uuid;
  v_emp_tax  uuid;
  v_clearing uuid;
  v_liab     uuid;
begin
  select id into v_wages    from accounting.accounts where account_number = '6500';
  select id into v_emp_tax  from accounting.accounts where account_number = '6510';
  select id into v_clearing from accounting.accounts where account_number = '1010';
  select id into v_liab     from accounting.accounts where account_number = '2300';

  if v_wages is not null and v_emp_tax is not null
     and v_clearing is not null and v_liab is not null then
    update accounting.settings
       set setting_value = setting_value || jsonb_build_object(
             'wagesExpense',              v_wages,
             'employerPayrollTaxExpense', v_emp_tax,
             'payrollClearing',           v_clearing,
             'payrollLiabilities',        v_liab
           ),
           updated_at = now()
     where setting_key = 'default_accounts';
  end if;
end $$;

-- Belt-and-suspenders explicit grants (default privileges from migration 001 already cover
-- the accounts/settings tables; restated for unambiguous current-object grants, matching the
-- convention in migrations 007/013/016/021).
grant select, insert, update, delete on all tables in schema accounting to authenticated, service_role;

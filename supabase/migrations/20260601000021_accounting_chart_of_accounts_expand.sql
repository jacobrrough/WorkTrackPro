-- WorkTrackAccounting — COA-EXPAND: standard chart-of-accounts additions
--
-- Adds the standard small-business accounts our seed (migration 003) lacked, per
-- docs/BIGCAPITAL_MINED_REFERENCE.md §1 (non-copyrightable account numbers/names —
-- facts only, re-expressed in our conventions). PURELY ADDITIVE: this migration
-- only INSERTs rows into the EXISTING accounting.accounts table and MERGEs four new
-- keys into the EXISTING accounting.settings.default_accounts KV blob. It performs
-- NO DDL — no new table, no new column, no altered constraint — and touches NO
-- public.* object (G1 preserved).
--
-- WHY THIS SHAPE
--   • accounting.accounts already exists (migration 003) with exactly the columns
--     these rows need (account_number, name, account_type, account_subtype,
--     normal_balance, is_system) and already owns its RLS (read=can_read/write=
--     can_write), its touch_updated_at trigger, and its audit() trigger. New rows
--     are pure `INSERT ... ON CONFLICT (account_number) DO NOTHING`, so this is
--     re-runnable and never disturbs an existing account (or an admin edit to one).
--   • accounting.settings likewise already exists (migration 001) and already owns
--     its RLS + audit/touch triggers (wired in migration 016). The new default-account
--     mappings are an ADDITIVE jsonb merge (`||`), exactly like migration 018 added
--     the fixed-asset keys — existing keys written by migrations 003/018 are preserved.
--   • Therefore this migration does NOT call accounting._apply_standard_table(...) and
--     does NOT (re)declare any policy — re-applying RLS to tables that already own it
--     would needlessly churn their policies. This matches the precedent set by the
--     other data-only / settings-only migrations (007/016/020).
--
-- DOUBLE-ENTRY (G3): VACUOUS. COA-EXPAND is reference-data / configuration only. It
-- creates account DEFINITIONS and settings mappings; it moves ZERO money and posts
-- ZERO journal entries. The new accounts are FUTURE posting targets used by later
-- modules (the import/migration module posts imported opening balances against 3050
-- Opening Balance Equity / 2050 Opening Balance Liabilities; the bank-feed rules
-- engine lands uncategorized rows in 1250/4900/6900 and clears processors through
-- 1260). No posting logic is authored here.
--
-- CONSTRAINT RECONCILIATION (the two §1 labels that are not literally constraint-legal):
--   • account_type CHECK (migration 003) allows ONLY asset|liability|equity|income|
--     expense. There is NO `other_expense` *type*. The §1 "other_expense" label is a
--     SUBTYPE in our schema, so 7000 Exchange Gain/Loss is account_type='expense' with
--     account_subtype='other_expense'.
--   • account_subtype CHECK (migration 003) has NO `cash` value. The §1 "cash" label
--     for 1030 Petty Cash maps to subtype='bank' — consistent with how 1000 Cash itself
--     is seeded ('bank'). This is the ONE deliberate deviation from the §1 table's
--     casual subtype label; flagged here and in the build report.
--   • 3200 Owner Drawings is a CONTRA-EQUITY account: equity by type, but it carries a
--     DEBIT normal_balance (owner withdrawals REDUCE equity). It is the only equity row
--     here whose normal_balance is 'debit'; every other equity/liability/income row is
--     'credit' and every asset/expense row is 'debit'.
--
-- IS_SYSTEM: the structural accounts the platform depends on (the two opening-balance
-- offsets, the three uncategorized bank-feed inboxes, and the payment-processor
-- clearing account) are marked is_system=true (protected from deletion by convention,
-- enforced in the service/guard layer like the other is_system seeds). The ordinary
-- chart-detail accounts (petty cash, prepaid, deferred revenue, loans, drawings,
-- exchange gain/loss, and the 61xx–64xx expense detail) are is_system=false so an
-- admin may rename/deactivate them.
--
-- This migration is IDEMPOTENT (INSERT ... ON CONFLICT DO NOTHING + a guarded,
-- merge-only settings UPDATE). Re-running is a no-op.
--
-- ROLLBACK:
--   -- The new accounts and the added default_accounts keys are harmless additive
--   -- config and may be left in place. To fully revert (only if NONE are referenced
--   -- by a posted journal line or a settings consumer):
--   --   UPDATE accounting.settings
--   --      SET setting_value = setting_value
--   --            - 'opening_balance_equity' - 'uncategorized_income'
--   --            - 'uncategorized_expense'  - 'payment_processor_clearing'
--   --    WHERE setting_key = 'default_accounts';
--   --   DELETE FROM accounting.accounts
--   --    WHERE account_number IN
--   --      ('2050','3050','1250','4900','6900','1260','1400','2400','1030',
--   --       '2500','3200','7000','6100','6200','6300','6400');

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Additive account rows (INSERT ... ON CONFLICT (account_number) DO NOTHING)
-- ─────────────────────────────────────────────────────────────────────────────
-- Columns/values reconciled against the live CHECK constraints in migration 003.
-- normal_balance: assets/expenses = debit; liabilities/equity/income = credit;
-- EXCEPT 3200 Owner Drawings (contra-equity) = debit.
insert into accounting.accounts (account_number, name, account_type, account_subtype, normal_balance, is_system) values
  -- Structural (is_system = true) ----------------------------------------------
  ('2050', 'Opening Balance Liabilities', 'liability', 'other_current_liability', 'credit', true),
  ('3050', 'Opening Balance Equity',      'equity',    'equity',                  'credit', true),
  ('1250', 'Uncategorized Asset',         'asset',     'other_current_asset',     'debit',  true),
  ('4900', 'Uncategorized Income',        'income',    'income',                  'credit', true),
  ('6900', 'Uncategorized Expense',       'expense',   'expense',                 'debit',  true),
  ('1260', 'Payment Processor Clearing',  'asset',     'other_current_asset',     'debit',  true),
  -- Ordinary chart detail (is_system = false) ----------------------------------
  ('1400', 'Prepaid Expenses',            'asset',     'other_current_asset',     'debit',  false),
  ('2400', 'Deferred/Unearned Revenue',   'liability', 'other_current_liability', 'credit', false),
  ('1030', 'Petty Cash',                  'asset',     'bank',                    'debit',  false),
  ('2500', 'Loans Payable',               'liability', 'long_term_liability',     'credit', false),
  ('3200', 'Owner Drawings',              'equity',    'equity',                  'debit',  false),
  ('7000', 'Exchange Gain/Loss',          'expense',   'other_expense',           'debit',  false),
  ('6100', 'Rent',                        'expense',   'expense',                 'debit',  false),
  ('6200', 'Office',                      'expense',   'expense',                 'debit',  false),
  ('6300', 'Bank Fees',                   'expense',   'expense',                 'debit',  false),
  ('6400', 'Depreciation Expense',        'expense',   'expense',                 'debit',  false)
on conflict (account_number) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Register the four new default-account mappings (additive blob merge)
-- ─────────────────────────────────────────────────────────────────────────────
-- Extend the existing default_accounts KV blob so posting/categorization code can
-- resolve these structural accounts by key without hardcoding ids:
--   opening_balance_equity     -> 3050  (import/migration equity offset)
--   uncategorized_income       -> 4900  (bank-feed income inbox)
--   uncategorized_expense      -> 6900  (bank-feed expense inbox)
--   payment_processor_clearing -> 1260  (Stripe/PayPal settlement clearing)
-- `||` merges the new keys; the keys written by migrations 003 and 018 are preserved.
-- Guarded: only writes when all four referenced accounts resolve (they always do
-- after section 1 above), so the merge is never partial. Re-runnable / idempotent.
do $$
declare
  v_obe   uuid;
  v_uninc uuid;
  v_unexp uuid;
  v_ppc   uuid;
begin
  select id into v_obe   from accounting.accounts where account_number = '3050';
  select id into v_uninc from accounting.accounts where account_number = '4900';
  select id into v_unexp from accounting.accounts where account_number = '6900';
  select id into v_ppc   from accounting.accounts where account_number = '1260';

  if v_obe is not null and v_uninc is not null and v_unexp is not null and v_ppc is not null then
    update accounting.settings
       set setting_value = setting_value || jsonb_build_object(
             'opening_balance_equity',     v_obe,
             'uncategorized_income',       v_uninc,
             'uncategorized_expense',      v_unexp,
             'payment_processor_clearing', v_ppc
           ),
           updated_at = now()
     where setting_key = 'default_accounts';
  end if;
end $$;

-- Belt-and-suspenders explicit grants (default privileges from migration 001 already
-- cover the accounts/settings tables; restated for unambiguous current-object grants,
-- matching the convention in migrations 007/013/014/017/018/020).
grant select, insert, update, delete on all tables in schema accounting to authenticated, service_role;

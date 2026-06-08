-- WorkTrackAccounting — add accounting.accounts.cash_flow_category for the
-- Statement of Cash Flows (report #5).
--
-- The indirect-method cash-flow statement classifies every NON-CASH balance-sheet
-- account movement into Operating / Investing / Financing, reconciling to the change
-- in the `cash`-category accounts. Income/expense accounts are intentionally left
-- NULL — their cash effect is already captured through period net income, so they
-- must NOT carry a category.
--
-- This is ADDITIVE and IDEMPOTENT:
--   * the column is added only if missing (ADD COLUMN IF NOT EXISTS);
--   * the seed only fills rows where cash_flow_category IS NULL, so re-running it
--     never clobbers an admin's manual reclassification and is safe on every deploy.
--
-- It moves NO money and books NO journal entry (a pure reference-data column), so it
-- is double-entry vacuous — there is nothing to keep in balance.
--
-- ROLLBACK:
--   alter table accounting.accounts drop column if exists cash_flow_category;

alter table accounting.accounts
  add column if not exists cash_flow_category text
    check (cash_flow_category in ('operating', 'investing', 'financing', 'cash', 'non_cash'));

-- Idempotent seed by account_subtype (only fills not-yet-classified rows). The subtype
-- vocabulary is the CHECK set from 20260603163842_accounting_chart_of_accounts.sql.
--   bank                                                  -> cash
--   AR/AP, inventory, the "current" + credit-card buckets -> operating
--   fixed asset / accumulated depreciation / other asset  -> investing
--   long-term liability / equity                          -> financing
--   income/expense subtypes                               -> left NULL (effect via net income)
update accounting.accounts
  set cash_flow_category = 'cash'
  where cash_flow_category is null
    and account_subtype = 'bank';

update accounting.accounts
  set cash_flow_category = 'operating'
  where cash_flow_category is null
    and account_subtype in (
      'accounts_receivable', 'accounts_payable', 'inventory',
      'other_current_asset', 'other_current_liability', 'credit_card'
    );

update accounting.accounts
  set cash_flow_category = 'investing'
  where cash_flow_category is null
    and account_subtype in ('fixed_asset', 'accumulated_depreciation', 'other_asset');

update accounting.accounts
  set cash_flow_category = 'financing'
  where cash_flow_category is null
    and account_subtype in ('long_term_liability', 'equity');

-- Belt-and-suspenders: restate the schema-wide grant so the new column is reachable
-- by the same roles as the rest of the table (matches the convention in the other
-- accounting migrations; harmless if already granted).
grant select, insert, update, delete on all tables in schema accounting to authenticated, service_role;

-- WorkTrackAccounting — Inventory↔Accounting Reconciliation 1/4: revaluation account
--
-- Adds the cost-variance account used when stock ALREADY on hand is revalued because its
-- per-unit cost changed (the gated revaluation flow). PURELY ADDITIVE / DATA-ONLY: it INSERTs
-- one row into the EXISTING accounting.accounts table (only if absent) and MERGEs one new key
-- into the EXISTING accounting.settings.default_accounts KV blob. NO DDL, touches NO public.*
-- object (G1). accounting.accounts/settings already own their RLS + audit/touch triggers, so
-- this does NOT call accounting._apply_standard_table(...) and declares no policy.
--
-- CHART-AGNOSTIC (critical): PRODUCTION runs the IMPORTED chart of accounts, NOT the standard
-- seed. There is no '1300', Opening Balance Equity is '30000', and '1310' is ALREADY TAKEN by
-- "Due from Officer". So we DO NOT pick an account by number. We create "Inventory Revaluation"
-- identified BY NAME (idempotent) with a NULL account_number — matching how the imported chart's
-- other structural posting accounts (Inventory Asset, Cost of Goods Sold) are themselves
-- null-numbered — and wire it into default_accounts by its id under the key 'inventory_revaluation'.
-- Every consumer (post_inventory_revaluation, the price-sync trigger, the reconciliation views)
-- resolves it via that settings KEY, never by number.
--
-- ACCOUNT SEMANTICS (decision 2, "Gated revaluation"): Inventory Revaluation is an ASSET /
-- 'inventory' subtype with a DEBIT normal balance, kept in the asset section next to Inventory
-- Asset so re-marking open FIFO layers and the offsetting movement stay internally consistent on
-- the Balance Sheet; the variance is not recognized in P&L until the stock is consumed (Dr COGS /
-- Cr Inventory Asset at job finish). is_system=true (structural posting target).
--
-- DOUBLE-ENTRY (G3): VACUOUS — this creates an account DEFINITION + a settings mapping only;
-- it moves ZERO money and posts ZERO journal entries.
--
-- IDEMPOTENT: name-guarded insert + merge-only settings update. Re-running is a no-op.
--
-- ROLLBACK (only if the account is unreferenced by any posted line / settings consumer):
--   UPDATE accounting.settings
--      SET setting_value = setting_value - 'inventory_revaluation'
--    WHERE setting_key = 'default_accounts';
--   DELETE FROM accounting.accounts WHERE name = 'Inventory Revaluation' AND account_type = 'asset';

do $$
declare
  v_reval uuid;
begin
  -- Find an existing Inventory Revaluation account (idempotent re-run); else create it.
  -- A NULL account_number avoids any collision with a numbered imported account (e.g. 1310
  -- "Due from Officer") and matches the imported chart's structural-account convention.
  select id into v_reval
    from accounting.accounts
   where name = 'Inventory Revaluation' and account_type = 'asset'
   order by created_at
   limit 1;

  if v_reval is null then
    insert into accounting.accounts
      (account_number, name, account_type, account_subtype, normal_balance, is_system)
    values
      (null, 'Inventory Revaluation', 'asset', 'inventory', 'debit', true)
    returning id into v_reval;
  end if;

  -- Register the default-account mapping BY ID (additive blob merge; preserves every existing key).
  update accounting.settings
     set setting_value = setting_value || jsonb_build_object('inventory_revaluation', v_reval),
         updated_at = now()
   where setting_key = 'default_accounts';
end $$;

-- Belt-and-suspenders explicit grants (default privileges from migration 001 already cover the
-- accounts/settings tables; restated for unambiguous current-object grants, matching the
-- convention in the COA-EXPAND and other data-only migrations).
grant select, insert, update, delete on all tables in schema accounting to authenticated, service_role;

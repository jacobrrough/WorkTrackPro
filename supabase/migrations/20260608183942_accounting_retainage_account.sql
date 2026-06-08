-- WorkTrackAccounting — #10: Retainage Receivable account (1210)
--
-- Adds the one chart-of-accounts account progress billing needs: 1210 "Retainage
-- Receivable", the asset that holds amounts billed but withheld (retained) until the
-- project's retainage is released. PURELY ADDITIVE — exactly the shape of
-- 20260603165219_accounting_chart_of_accounts_expand: it only INSERTs one row into the
-- EXISTING accounting.accounts table and MERGEs one key into the EXISTING
-- accounting.settings.default_accounts KV blob. NO DDL — no new table, no new column, no
-- altered constraint — and it touches NO public.* object.
--
-- WHY THIS SHAPE
--   • accounting.accounts already exists with the columns this row needs and already owns
--     its RLS + audit + touch triggers, so the new row is a pure
--     `INSERT ... ON CONFLICT (account_number) DO NOTHING` — re-runnable, never disturbing
--     an existing account or an admin edit to one.
--   • accounting.settings likewise already owns its RLS/audit/touch triggers, so the new
--     default-account mapping is an ADDITIVE jsonb merge (`||`), exactly like the COA-EXPAND
--     migration and the fixed-asset keys before it — existing keys are preserved.
--   • Therefore this migration does NOT call accounting._apply_standard_table(...) and does
--     NOT (re)declare any policy, matching the data-only / settings-only precedent.
--
-- ACCOUNT SHAPE: 1210 is an ASSET with account_subtype 'accounts_receivable' and a DEBIT
-- normal balance (retainage receivable is a receivable — money owed to us, withheld for now),
-- and is_system=true (the platform posts against it, so it is protected from deletion by the
-- is_system convention). It sorts right after 1200 Accounts Receivable in the chart.
--
-- DOUBLE-ENTRY (G3): VACUOUS. This migration creates an account DEFINITION and a settings
-- mapping; it moves ZERO money and posts ZERO journal entries. 1210 is the future posting
-- target the progress-billing posting builder debits for the withheld retainage portion and
-- credits on release (buildProgressInvoiceJournalLines / buildRetainageReleaseJournalLines).
--
-- This migration is IDEMPOTENT (INSERT ... ON CONFLICT DO NOTHING + a guarded, merge-only
-- settings UPDATE). Re-running is a no-op.
--
-- ROLLBACK:
--   -- The new account and the added key are harmless additive config and may be left in
--   -- place. To fully revert (only if 1210 is referenced by NO posted journal line):
--   --   UPDATE accounting.settings
--   --      SET setting_value = setting_value - 'retainage_receivable'
--   --    WHERE setting_key = 'default_accounts';
--   --   DELETE FROM accounting.accounts WHERE account_number = '1210';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Additive account row (INSERT ... ON CONFLICT (account_number) DO NOTHING)
-- ─────────────────────────────────────────────────────────────────────────────
insert into accounting.accounts (account_number, name, account_type, account_subtype, normal_balance, is_system) values
  ('1210', 'Retainage Receivable', 'asset', 'accounts_receivable', 'debit', true)
on conflict (account_number) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Register the retainage_receivable default-account mapping (additive blob merge)
-- ─────────────────────────────────────────────────────────────────────────────
-- Extend the existing default_accounts KV blob so the posting layer can resolve 1210 by key
-- without hardcoding its id. `||` merges the new key; all keys written by earlier migrations
-- are preserved. Guarded: only writes when 1210 resolves (it always does after section 1).
do $$
declare
  v_retainage uuid;
begin
  select id into v_retainage from accounting.accounts where account_number = '1210';

  if v_retainage is not null then
    update accounting.settings
       set setting_value = setting_value || jsonb_build_object('retainage_receivable', v_retainage),
           updated_at = now()
     where setting_key = 'default_accounts';
  end if;
end $$;

-- Belt-and-suspenders explicit grants (default privileges already cover accounts/settings;
-- restated for unambiguous current-object grants, matching the COA-EXPAND convention).
grant select, insert, update, delete on all tables in schema accounting to authenticated, service_role;

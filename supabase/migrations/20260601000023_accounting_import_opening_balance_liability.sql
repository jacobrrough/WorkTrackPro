-- WorkTrackAccounting — IMPORT/MIGRATION 1/2: opening-balance-liability settings key
--
-- ⚠️  UNVERIFIED / HELD MODULE — NOT FOR FILING. This migration is part of the
--     historical-data Import/Migration feature, which ships FLAG-DARK and requires
--     CPA and/or security sign-off before the module is enabled. It moves ZERO money
--     and is purely additive configuration. The "UNVERIFIED" banner is rendered by
--     the UI/exports, not the DB; this header records the hold for the build trail.
--
-- WHAT THIS DOES (settings-only, NO DDL):
--   Registers ONE additional mapping in the EXISTING accounting.settings.default_accounts
--   KV blob so the import commit path can resolve the liability-side opening-balance
--   offset by key (never by a hardcoded account number/id):
--       opening_balance_liabilities -> 2050  (Opening Balance Liabilities)
--
-- WHY ONLY A SETTINGS KEY (and no account INSERT):
--   • Account 2050 "Opening Balance Liabilities" ALREADY EXISTS — it was seeded by
--     migration 021 (COA-EXPAND) as a structural is_system account
--     (liability / other_current_liability / credit). We do NOT re-insert it.
--   • migration 021 added the equity-side key (opening_balance_equity -> 3050) to
--     default_accounts but did NOT add the matching liability-side key. The import
--     module needs both offsets resolvable by key, so this migration adds the one
--     missing key. (opening_balance_equity is already present and is reused, not
--     re-added.)
--   • accounting.settings already exists (migration 001) and already owns its RLS +
--     audit/touch triggers (wired in migration 016). The new mapping is an ADDITIVE
--     jsonb merge (`||`), exactly like migrations 003/018/021 extended this same blob —
--     existing keys are preserved. Therefore this migration does NOT call
--     accounting._apply_standard_table(...) and declares no policy, matching the
--     precedent of the other data-only / settings-only migrations (007/016/020/021).
--
-- DOUBLE-ENTRY (G3): VACUOUS. Configuration only — no journal entry is posted here.
--   2050 becomes a FUTURE posting target used by accounting.commit_import_batch
--   (migration 024) as the liability-side offset for imported opening balances.
--
-- TOUCHES NO public.* OBJECT (G1 preserved). IDEMPOTENT: guarded, merge-only UPDATE;
-- re-running is a no-op (the `||` merge simply rewrites the same key to the same id).
--
-- ROLLBACK:
--   -- The added default_accounts key is harmless additive config and may be left in
--   -- place. To fully revert (only if NO settings consumer / import commit references it):
--   --   UPDATE accounting.settings
--   --      SET setting_value = setting_value - 'opening_balance_liabilities'
--   --    WHERE setting_key = 'default_accounts';

-- ─────────────────────────────────────────────────────────────────────────────
-- Register the opening-balance-liability mapping (additive blob merge)
-- ─────────────────────────────────────────────────────────────────────────────
-- Resolve 2050 by account_number and merge its id under the new key. `||` adds the
-- key; every key written by migrations 003/018/021 is preserved. Guarded so the
-- merge is never partial: it only writes when 2050 actually resolves (it always does
-- after migration 021). Re-runnable / idempotent.
do $$
declare
  v_obl uuid;
begin
  select id into v_obl from accounting.accounts where account_number = '2050';

  if v_obl is not null then
    update accounting.settings
       set setting_value = setting_value || jsonb_build_object(
             'opening_balance_liabilities', v_obl
           ),
           updated_at = now()
     where setting_key = 'default_accounts';
  end if;
end $$;

-- Belt-and-suspenders explicit grants (default privileges from migration 001 already
-- cover the settings table; restated for unambiguous current-object grants, matching
-- the convention in migrations 007/013/014/017/018/020/021).
grant select, insert, update, delete on all tables in schema accounting to authenticated, service_role;

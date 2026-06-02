-- WorkTrackAccounting — Phase E SECURITY HARDENING 3/3 (E5/E4 support): security settings seed
--
-- ⚠️  HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING. Requires CPA and/or SECURITY sign-off before
--     this module is enabled.
--
-- WHAT THIS MIGRATION ADDS (NO new table, NO public.* change; G1): two rows in the EXISTING
--   accounting.settings KV table (created in migration 001, already RLS-protected:
--   read = can_read(), write = can_write()):
--     • 'security_rate_limits' — default per-route limits the E5 Netlify rate-limiter reads (the
--       limiter is server-gated OFF by default via ACCOUNTING_SECURITY_HARDENING_ENABLED; these are
--       the values it uses ONCE a human turns it on). Window-based, best-effort per instance.
--     • 'backup_policy'        — copy + parameters surfaced READ-ONLY on the Backup/Restore STUB
--       screen (E4). The screen performs NO destructive action; this is documentation, not a job.
--
-- DOUBLE-ENTRY (G3): this phase moves NO money and posts ZERO journal entries. Vacuously satisfied.
--
-- IDEMPOTENT: on conflict (setting_key) do nothing — existing operator-tuned values are never
--   overwritten by a re-run.
--
-- ROLLBACK:
--   DELETE FROM accounting.settings WHERE setting_key IN ('security_rate_limits', 'backup_policy');

insert into accounting.settings (setting_key, setting_value) values
  (
    'security_rate_limits',
    jsonb_build_object(
      'defaultPerMinute',     30,   -- fallback fixed-window limit for any hardened route
      'taxRefreshPerHour',    12,   -- manual tax-table-refresh POST path
      'submitProposalPerHour',20,   -- public submit-proposal function
      'addonPerMinute',       60,   -- Gmail add-on helper endpoints
      'maxBodyBytes',         262144 -- 256 KiB JSON body cap for input-hardening
    )
  ),
  (
    'backup_policy',
    jsonb_build_object(
      'schedule',      'manual',            -- this build automates NOTHING; backups are operator-run
      'encryption',    'AES-256-GCM',       -- documented at-rest cipher for the dump artifact
      'retentionDays', 30,
      'restoreMode',   'manual-supervised', -- restore is a supervised DBA procedure; NO app action
      'pitrExpectation','per-Supabase-plan' -- point-in-time-restore depends on the Supabase plan tier
    )
  )
on conflict (setting_key) do nothing;

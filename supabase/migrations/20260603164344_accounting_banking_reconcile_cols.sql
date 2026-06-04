-- WorkTrackAccounting — A4 Banking: per-statement clearing + rule-audit columns
--
-- Migration 010 created accounting.bank_transactions / bank_rules / reconciliations
-- but a real reconciliation must remember WHICH transactions cleared against WHICH
-- statement, and the rules engine should record which rule auto-categorized a row.
-- This migration adds three additive, nullable columns to the EXISTING
-- accounting.bank_transactions table (schema `accounting` only — no public.* touched,
-- no column dropped/altered). Table-level RLS policies from migration 010 already
-- cover new columns, so no policy change is required; audit/updated_at triggers are
-- likewise unchanged (bank_transactions has no updated_at by design).
--
--   • reconciliation_id  -> links a cleared txn to the statement reconciliation it
--                           was matched into (set null if that reconciliation is gone).
--   • cleared_at         -> when the txn was marked cleared/reconciled.
--   • applied_rule_id     -> which bank_rule auto-categorized the txn (audit/explain).
--
-- This migration is IDEMPOTENT (ADD COLUMN IF NOT EXISTS + guarded index creation).
--
-- ROLLBACK:
--   DROP INDEX IF EXISTS accounting.idx_acct_banktxn_recon;
--   ALTER TABLE accounting.bank_transactions DROP COLUMN IF EXISTS applied_rule_id;
--   ALTER TABLE accounting.bank_transactions DROP COLUMN IF EXISTS cleared_at;
--   ALTER TABLE accounting.bank_transactions DROP COLUMN IF EXISTS reconciliation_id;

alter table accounting.bank_transactions
  add column if not exists reconciliation_id uuid
    references accounting.reconciliations(id) on delete set null;

alter table accounting.bank_transactions
  add column if not exists cleared_at timestamptz;

alter table accounting.bank_transactions
  add column if not exists applied_rule_id uuid
    references accounting.bank_rules(id) on delete set null;

-- Index the per-statement clearing link so the reconciliation screen can list a
-- statement's cleared transactions cheaply.
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'accounting' and indexname = 'idx_acct_banktxn_recon'
  ) then
    create index idx_acct_banktxn_recon
      on accounting.bank_transactions(reconciliation_id);
  end if;
end $$;

-- Belt-and-suspenders explicit grants (default privileges already cover the table;
-- added columns inherit table grants, so this is a no-op safety restatement).
grant select, insert, update, delete on all tables in schema accounting to authenticated, service_role;

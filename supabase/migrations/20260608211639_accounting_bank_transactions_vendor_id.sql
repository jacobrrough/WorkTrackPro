-- WorkTrackAccounting — A4 Banking (#1 finish): record the vendor a rule assigns
--
-- The bank-rule engine already supports a "set vendor" action (accounting.bank_rules.
-- set_vendor_id, applied by applyRules), but accounting.bank_transactions had nowhere to
-- store the vendor a matched rule assigns. This additive column closes that gap: a rule can
-- now stamp a vendor onto a transaction at import / rule re-apply time. It is an informational
-- AP linkage only — it MOVES NO money and posts NO journal entry; the bill/payment flow is
-- unchanged. ON DELETE SET NULL so removing a vendor never orphans a bank transaction.
--
-- This migration is IDEMPOTENT (ADD COLUMN IF NOT EXISTS).
--
-- ROLLBACK:
--   ALTER TABLE accounting.bank_transactions DROP COLUMN IF EXISTS vendor_id;

alter table accounting.bank_transactions
  add column if not exists vendor_id uuid references accounting.vendors(id) on delete set null;

grant select, insert, update, delete on all tables in schema accounting to authenticated, service_role;

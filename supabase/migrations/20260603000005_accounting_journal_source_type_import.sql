-- WorkTrackAccounting — add 'import' to journal_entries.source_type
--
-- Historical transactions loaded from a prior system (QuickBooks) via the import
-- wizard are tagged source_type = 'import' so they are distinguishable from
-- manual / adjustment / opening_balance entries in reports and audits, and so a
-- botched history import can be identified and bulk-voided if ever needed.
--
-- This is a WIDENING-only change to the CHECK constraint: every existing row
-- remains valid. IDEMPOTENT (drop-if-exists then re-add).
--
-- ROLLBACK (only safe once no rows use 'import'):
--   alter table accounting.journal_entries drop constraint if exists journal_entries_source_type_check;
--   alter table accounting.journal_entries add constraint journal_entries_source_type_check
--     check (source_type in ('manual','invoice','payment','bill','vendor_payment',
--       'bank_txn','payroll','depreciation','adjustment','opening_balance'));

alter table accounting.journal_entries
  drop constraint if exists journal_entries_source_type_check;

alter table accounting.journal_entries
  add constraint journal_entries_source_type_check check (source_type in (
    'manual', 'invoice', 'payment', 'bill', 'vendor_payment', 'bank_txn',
    'payroll', 'depreciation', 'adjustment', 'opening_balance', 'import'
  ));

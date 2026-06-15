-- WorkTrackAccounting — QBO replica sync: 'qbo' source type + legacy-GL bulk void
--
-- 1) WIDEN journal_entries.source_type with 'qbo': the API sync's COMPLETENESS pass
--    posts the QBO transaction types we don't model as documents (JournalEntry,
--    Deposit, Transfer, CreditMemo, SalesReceipt, RefundReceipt, VendorCredit,
--    Purchase) as faithful balanced JEs tagged source_type='qbo' with a deterministic
--    source_id (UUIDv5 of the QBO type+id). Keeping them distinct from the legacy
--    CSV GL import ('import') is what makes the reconciliation step PRECISE: the
--    void below targets 'import' rows only, never the API-sourced replacements —
--    on first runs and on every re-run/top-up thereafter.
--
-- 2) accounting.void_legacy_import_entries(p_reason): ONE-transaction, set-based
--    void of every POSTED source_type='import' entry — the "retire the raw GL"
--    step of docs/QUICKBOOKS_IMPORT_PLAN.md. Voiding is the ledger's non-destructive
--    correction (rows + lines retained, immutable audit), exactly what
--    accounting.void_journal_entry does per-entry; doing it set-based avoids 14k
--    client round-trips. Honors the D1 books-closed lock (whole batch rejected if
--    any affected entry sits in a closed period — clear the lock first, like the
--    import itself). can_write()-guarded; meant to run ONLY from the sync's gated
--    reconcile step after the document + completeness passes have re-posted
--    everything from the API.
--
-- This migration is IDEMPOTENT.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS accounting.void_legacy_import_entries(text);
--   -- (only safe once no rows use 'qbo':)
--   alter table accounting.journal_entries drop constraint if exists journal_entries_source_type_check;
--   alter table accounting.journal_entries add constraint journal_entries_source_type_check
--     check (source_type in ('manual','invoice','payment','bill','vendor_payment',
--       'bank_txn','payroll','depreciation','adjustment','opening_balance','import'));

alter table accounting.journal_entries
  drop constraint if exists journal_entries_source_type_check;

alter table accounting.journal_entries
  add constraint journal_entries_source_type_check check (source_type in (
    'manual', 'invoice', 'payment', 'bill', 'vendor_payment', 'bank_txn',
    'payroll', 'depreciation', 'adjustment', 'opening_balance', 'import', 'qbo'
  ));

-- ─────────────────────────────────────────────────────────────────────────────
-- Bulk void of the legacy CSV-imported GL (reconcile step; gated in the UI)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function accounting.void_legacy_import_entries(p_reason text)
returns integer
language plpgsql
security definer
set search_path = accounting, public, pg_catalog
as $$
declare
  v_closed date;
  v_blocked integer;
  v_count integer;
begin
  if not accounting.can_write() then
    raise exception 'insufficient privileges to void journal entries'
      using errcode = 'insufficient_privilege';
  end if;

  -- D1 period lock: refuse the whole batch if ANY affected entry sits in a closed
  -- period (mirrors void_journal_entry; all-or-nothing keeps the ledger coherent).
  v_closed := accounting.closed_through_date();
  if v_closed is not null then
    select count(*) into v_blocked
      from accounting.journal_entries
     where source_type = 'import' and status = 'posted' and entry_date <= v_closed;
    if v_blocked > 0 then
      raise exception
        'cannot void % legacy import entries dated on or before the books-closed date % — clear the closed-period lock first',
        v_blocked, v_closed using errcode = 'check_violation';
    end if;
  end if;

  update accounting.journal_entries
     set status = 'void',
         voided_at = now(),
         voided_by = auth.uid(),
         void_reason = coalesce(nullif(btrim(p_reason), ''), 'Superseded by QuickBooks document import')
   where source_type = 'import' and status = 'posted';
  get diagnostics v_count = row_count;

  return v_count;
end;
$$;

grant execute on function accounting.void_legacy_import_entries(text) to authenticated;
revoke execute on function accounting.void_legacy_import_entries(text) from anon;

-- WorkTrackAccounting — #12: 1099 vendor tracking (W-9 master data + 1099-NEC worklist)
--
-- ADVISORY / COMPLIANCE ONLY. This migration adds W-9 master data and a reporting
-- read-model for a 1099-NEC worklist. It MOVES NO MONEY: there is no posting path here,
-- nothing calls accounting.post_journal_entry, and the view only SUMS already-posted
-- vendor_payments (accounting.vendor_payments from migration 20260603164225). E-FILE IS
-- OUT OF SCOPE — there is no paid filing provider; this is tracking + report + export.
--
-- accounting.vendor_tax_info is the per-vendor W-9 record (legal name, TIN, address,
-- federal entity type, exemption). It is 1:1 with accounting.vendors (vendor_id PK).
-- The vendors table already carries the lightweight is_1099 flag + tax_id; this table
-- holds the richer W-9 detail the 1099-NEC worklist needs for completeness checks.
--
-- accounting.v_1099_vendor_totals rolls each 1099 vendor's posted payments up by calendar
-- year, EXCLUDING method='card'. Card / third-party-network payments are reported on a
-- 1099-K by the card processor / TPSO, NOT on the payer's 1099-NEC — including them would
-- double-count. The $600 1099-NEC threshold is applied in the app (form1099Math), not here,
-- so the view stays a faithful per-vendor/per-year rollup the report can filter.
--
-- This migration is IDEMPOTENT.
--
-- ROLLBACK:
--   DROP VIEW IF EXISTS accounting.v_1099_vendor_totals;
--   DROP TABLE IF EXISTS accounting.vendor_tax_info CASCADE;

-- W-9 master data for a vendor (1:1 with accounting.vendors). Moves NO money — pure
-- master data the 1099-NEC worklist reads for the "W-9 complete?" check.
create table if not exists accounting.vendor_tax_info (
  vendor_id uuid primary key references accounting.vendors(id) on delete cascade,
  legal_name text,
  -- PII. The vendor's Taxpayer Identification Number (SSN/EIN). Stored plaintext for now;
  -- the Phase-E pgcrypto field-encryption pass will encrypt this column (the same deferred
  -- target noted on accounting.vendors.tax_id). Do not expose it outside the accounting RLS.
  tax_id text,
  address jsonb,
  -- The W-9 federal tax classification. Null until the admin records the W-9.
  federal_entity_type text
    check (federal_entity_type in
      ('individual', 'sole_prop', 'c_corp', 's_corp', 'partnership', 'llc', 'other')),
  -- The payee is exempt from 1099 reporting (e.g. a corporation for most box-1 NEC, or an
  -- exempt payee code on the W-9). The worklist still lists exempt vendors but flags them.
  exempt boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table accounting.vendor_tax_info is
  'W-9 master data per vendor (1:1 with accounting.vendors). Advisory/compliance only; moves no money. tax_id is PII (Phase-E pgcrypto encryption target).';

select accounting._apply_standard_table('vendor_tax_info');

-- 1099-NEC rollup: per (vendor, calendar year) sum of POSTED vendor payments, excluding
-- card / third-party-network payments (those are 1099-K reportable by the processor, not
-- 1099-NEC). Restricted to vendors flagged is_1099 = true. security_invoker so the
-- querying user's accounting.can_read RLS applies (same pattern as the read-model views in
-- migration 20260603164318). The $600 threshold is applied in the app, not here.
create or replace view accounting.v_1099_vendor_totals with (security_invoker = true) as
select vp.vendor_id,
       v.display_name as vendor_name,
       extract(year from vp.payment_date)::int as year,
       coalesce(sum(vp.amount), 0) as total_paid,
       count(*)::int as payment_count
  from accounting.vendor_payments vp
  join accounting.vendors v on v.id = vp.vendor_id
  -- Only count payments whose posting journal entry is still POSTED. A vendor payment is
  -- corrected by VOIDING its JE (the vendor_payments row persists, it is never deleted), so
  -- without this join a voided payment would still inflate the vendor's 1099 total → wrong
  -- filings (accounting review, CRITICAL). The inner join also drops any payment with no
  -- posted JE (never report money that did not actually post).
  join accounting.journal_entries je on je.id = vp.journal_entry_id and je.status = 'posted'
 where v.is_1099 = true
   and vp.method <> 'card'
 group by vp.vendor_id, v.display_name, extract(year from vp.payment_date);

grant select on accounting.v_1099_vendor_totals to authenticated, service_role;

grant select, insert, update, delete on all tables in schema accounting to authenticated, service_role;

-- WorkTrackAccounting — #12 follow-up: W-9 completeness projection (NO raw TIN on the wire)
--
-- ADVISORY / COMPLIANCE ONLY. accounting.v_vendor_w9_status exposes ONLY the 1099-NEC
-- worklist's completeness signal for a vendor — legal name, a has_tax_id boolean, and the
-- exempt flag — and NEVER the raw tax_id (PII). The worklist path
-- (vendor1099Service.list1099Totals) reads this view instead of vendor_tax_info so the
-- plaintext TIN is never materialized client-side; the W-9 editor still reads vendor_tax_info
-- directly (it must show the value to edit it). security_invoker = true so the caller's
-- accounting.can_read RLS on the underlying vendor_tax_info applies (same pattern as the other
-- read-model views). When the Phase-E pgcrypto pass encrypts tax_id, only this view's
-- has_tax_id expression changes — no client code moves.
--
-- This migration is IDEMPOTENT.
--
-- ROLLBACK:
--   DROP VIEW IF EXISTS accounting.v_vendor_w9_status;

create or replace view accounting.v_vendor_w9_status with (security_invoker = true) as
select vti.vendor_id,
       vti.legal_name,
       (vti.tax_id is not null and length(btrim(vti.tax_id)) > 0) as has_tax_id,
       vti.exempt
  from accounting.vendor_tax_info vti;

grant select on accounting.v_vendor_w9_status to authenticated, service_role;

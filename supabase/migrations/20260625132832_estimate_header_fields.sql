-- QuickBooks-style estimate header fields.
--
-- Estimates post NO ledger, so these are purely informational header columns: no triggers,
-- no posting impact, no totals impact (Shipping/Deposit were intentionally NOT added).
--   * po_number / sales_rep — print on the customer-facing estimate.
--   * accepted_by / accepted_date — manual acceptance capture, DISTINCT from the existing
--     estimates.accepted_at workflow timestamp (which the Accept action stamps).
--
-- Column adds inherit the table's existing RLS; no policy changes are required.
alter table accounting.estimates
  add column if not exists po_number text,
  add column if not exists sales_rep text,
  add column if not exists accepted_by text,
  add column if not exists accepted_date date;

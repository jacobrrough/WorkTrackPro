-- Persist the quoted price snapshot on a job so an invoice bills what was quoted,
-- not a re-quote derived from the current (possibly since-edited) part state.
--
-- Jobs already store quoted labor/CNC hours (labor_hours / *_breakdown_by_variant),
-- but NOT the customer-facing quoted total or material cost. invoiceLinesFromJob
-- re-quotes from the live part at invoice time, so editing a part after the job was
-- created silently changes the invoice price. These columns capture the quote at
-- creation so the invoice can prefer the snapshot and only re-quote for older jobs.
--
-- Additive + NULLABLE (no default): existing jobs are unaffected and read back NULL,
-- which the invoice path treats as "no snapshot -> fall back to the re-quote".
-- IDEMPOTENT (add column if not exists). SQL-only.
alter table public.jobs
  add column if not exists quoted_price         numeric,
  add column if not exists quoted_material_cost numeric,
  add column if not exists quoted_labor_hours   numeric;

comment on column public.jobs.quoted_price is
  'Customer-facing quoted total captured at job creation (snapshot). NULL for jobs created before this column existed; invoiceLinesFromJob falls back to re-quoting the part when NULL.';
comment on column public.jobs.quoted_material_cost is
  'Quoted material cost captured at job creation (snapshot). NULL when unknown at creation.';
comment on column public.jobs.quoted_labor_hours is
  'Quoted labor hours captured at job creation (snapshot). NULL for older jobs.';

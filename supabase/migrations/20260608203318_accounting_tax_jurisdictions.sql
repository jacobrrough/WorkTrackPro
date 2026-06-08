-- WorkTrackAccounting — #13: sales-tax RATE AUTOMATION (address-based tax-code selection)
--
-- ADVISORY-ONLY, INTERNAL geo tables — NO paid provider (no Avalara / no rooftop API).
-- accounting.tax_jurisdictions maps a geography (country/state/county/city/zip) to the
-- COMPOSITE accounting.tax_codes row to apply (the same code an invoice/estimate already
-- carries). It does NOT invent rates: a jurisdiction points at a tax_code that was already
-- seeded in migration 20260603164113 (tax_agencies / tax_rates / tax_codes / tax_code_rates),
-- so the existing tax-table/drift framework (TAX-SYNC) keeps those rates current. The map
-- only answers "given this address, which already-defined tax code is the best match?".
--
-- accounting.resolve_tax_code_for_address(country, state, county, city, zip) returns the
-- best-matching jurisdiction's tax_code_id by SPECIFICITY (zip > city > county > state),
-- tie-broken by the row's `priority` (higher wins) then most-recent. NULL when nothing
-- matches — the caller then falls back to the customer/org default and the user can always
-- override. The function NEVER moves money or posts a journal entry; it is a lookup.
--
-- DISCLAIMER (G9): the seeded jurisdictions are REPRESENTATIVE ONLY. ZIP-level mapping is an
-- approximation (a ZIP can straddle districts; rooftop/parcel accuracy needs a paid provider,
-- a future upgrade). Always verify with a CPA/EA before filing. Surfaced on every screen that
-- shows a resolved code (TaxDisclaimer representativeRates).
--
-- This migration is IDEMPOTENT.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS accounting.resolve_tax_code_for_address(text, text, text, text, text);
--   DROP TABLE IF EXISTS accounting.tax_jurisdictions CASCADE;

-- A geography → composite tax_code mapping. Any field except tax_code_id may be NULL: a NULL
-- component means "this rule does not constrain on that component" (e.g. a state-wide rule
-- leaves county/city/zip NULL). The resolver scores a candidate by how many of its non-null
-- components match the requested address, weighted by specificity.
create table if not exists accounting.tax_jurisdictions (
  id uuid primary key default gen_random_uuid(),
  country text not null default 'US',
  state text,
  county text,
  city text,
  zip text,
  tax_code_id uuid not null references accounting.tax_codes(id) on delete cascade,
  -- Manual tie-breaker when two rules are equally specific (higher wins). Lets an admin
  -- pin a preferred mapping without inventing a more specific (and possibly wrong) row.
  priority int not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_tax_jur_state_zip') then
    create index idx_acct_tax_jur_state_zip on accounting.tax_jurisdictions(state, zip);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_tax_jur_zip') then
    create index idx_acct_tax_jur_zip on accounting.tax_jurisdictions(zip);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_tax_jur_code') then
    create index idx_acct_tax_jur_code on accounting.tax_jurisdictions(tax_code_id);
  end if;
end $$;

-- Resolve the best-matching tax_code for an address. SECURITY DEFINER + pinned search_path
-- so it runs deterministically regardless of the caller's search_path; the function only
-- READS accounting.tax_jurisdictions (which is RLS-protected — but SECURITY DEFINER bypasses
-- RLS for this read, which is safe: it returns a single uuid the caller may already see, and
-- writes nothing). Matching rules:
--   • A candidate is eligible only if EVERY one of its non-null components case-insensitively
--     equals the corresponding requested component (a non-null component the request leaves
--     NULL disqualifies the candidate — we never match a more-specific rule against a vaguer
--     address). Country defaults to 'US' on both sides.
--   • Among eligible candidates the most SPECIFIC wins: zip (1000) > city (100) > county (10)
--     > state (1), summed over the components the rule actually constrains. Ties break on
--     `priority` (higher first) then `updated_at` (newest first).
-- Returns NULL when no rule is eligible.
create or replace function accounting.resolve_tax_code_for_address(
  p_country text default 'US',
  p_state text default null,
  p_county text default null,
  p_city text default null,
  p_zip text default null
)
returns uuid
language sql
stable
security definer
set search_path = accounting, public, pg_catalog
as $$
  select j.tax_code_id
    from accounting.tax_jurisdictions j
   where lower(coalesce(j.country, 'US')) = lower(coalesce(p_country, 'US'))
     -- Each constrained (non-null) component must match the request; a NULL component
     -- on the rule is a wildcard. A constrained component with a NULL request value is
     -- not a match (the inner comparison is NULL → excluded by the `is not false` guard
     -- only when the rule side is NULL).
     and (j.state is null  or (p_state  is not null and lower(j.state)  = lower(p_state)))
     and (j.county is null or (p_county is not null and lower(j.county) = lower(p_county)))
     and (j.city is null   or (p_city   is not null and lower(j.city)   = lower(p_city)))
     and (j.zip is null    or (p_zip    is not null and j.zip = p_zip))
   order by
     ( (case when j.zip is not null then 1000 else 0 end)
     + (case when j.city is not null then 100 else 0 end)
     + (case when j.county is not null then 10 else 0 end)
     + (case when j.state is not null then 1 else 0 end) ) desc,
     j.priority desc,
     j.updated_at desc
   limit 1;
$$;

grant execute on function accounting.resolve_tax_code_for_address(text, text, text, text, text)
  to authenticated, service_role;

-- ── Representative seed (REPRESENTATIVE ONLY) ─────────────────────────────────────────────
-- Map a couple of CA geographies to the EXISTING seeded CA tax codes. We do NOT create any
-- new rate here — each row points at a tax_code already seeded in 20260603164113. Guarded so
-- re-running the migration inserts nothing twice (no natural unique key, so we gate on a
-- not-exists over the same geo+code tuple).

-- A statewide CA fallback → "CA - Statewide (7.25%)".
insert into accounting.tax_jurisdictions (country, state, county, city, zip, tax_code_id, priority)
  select 'US', 'CA', null, null, null, c.id, 0
    from accounting.tax_codes c
   where c.name = 'CA - Statewide (7.25%)'
     and not exists (
       select 1 from accounting.tax_jurisdictions j
        where coalesce(j.country,'') = 'US' and coalesce(j.state,'') = 'CA'
          and j.county is null and j.city is null and j.zip is null
          and j.tax_code_id = c.id
     );

-- Los Angeles County (CA) → "CA - Los Angeles (9.5%)".
insert into accounting.tax_jurisdictions (country, state, county, city, zip, tax_code_id, priority)
  select 'US', 'CA', 'Los Angeles', null, null, c.id, 0
    from accounting.tax_codes c
   where c.name = 'CA - Los Angeles (9.5%)'
     and not exists (
       select 1 from accounting.tax_jurisdictions j
        where coalesce(j.country,'') = 'US' and coalesce(j.state,'') = 'CA'
          and coalesce(j.county,'') = 'Los Angeles' and j.city is null and j.zip is null
          and j.tax_code_id = c.id
     );

-- A representative Los Angeles ZIP (90001) → "CA - Los Angeles (9.5%)". Constrained on
-- state+zip ONLY (no county) so a typical customer address that carries a ZIP but no county
-- still resolves; the ZIP score (1000) makes this win over the statewide/county rules.
insert into accounting.tax_jurisdictions (country, state, county, city, zip, tax_code_id, priority)
  select 'US', 'CA', null, null, '90001', c.id, 0
    from accounting.tax_codes c
   where c.name = 'CA - Los Angeles (9.5%)'
     and not exists (
       select 1 from accounting.tax_jurisdictions j
        where coalesce(j.country,'') = 'US' and coalesce(j.state,'') = 'CA'
          and j.county is null and j.city is null
          and coalesce(j.zip,'') = '90001'
          and j.tax_code_id = c.id
     );

select accounting._apply_standard_table('tax_jurisdictions');

grant select, insert, update, delete on all tables in schema accounting to authenticated, service_role;

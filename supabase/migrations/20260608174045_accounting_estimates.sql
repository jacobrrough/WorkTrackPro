-- WorkTrackAccounting — #8: estimates (quotes) → invoice
--
-- Estimates are the pre-sale quote document. They MIRROR the AR invoice header/lines
-- (accounting.invoices / invoice_lines from migration 20260603164151) but carry NO
-- money to the ledger: an estimate is an intent, not a posted transaction. Money posts
-- only when its converted invoice is later SENT (the existing invoice send-flow posts
-- the balanced revenue JE). estimates.source_proposal_id references the existing
-- public.customer_proposals lead READ-ONLY (proposals stay untouched — they are inbound
-- leads, not the estimate store); converted_invoice_id links forward to the invoice an
-- estimate produced.
--
-- accounting.convert_estimate_to_invoice(p_estimate_id) clones a DRAFT invoice + its
-- lines from a non-converted estimate, flips the estimate to 'converted', and links the
-- two — all in ONE transaction (SECURITY DEFINER, pinned search_path, can_write guard).
-- It is idempotent: a second call on an already-converted estimate returns the existing
-- invoice id without creating a duplicate.
--
-- This migration is IDEMPOTENT.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS accounting.convert_estimate_to_invoice(uuid);
--   DROP TABLE IF EXISTS accounting.estimate_lines CASCADE;
--   DROP TABLE IF EXISTS accounting.estimates CASCADE;

create table if not exists accounting.estimates (
  id uuid primary key default gen_random_uuid(),
  estimate_number text unique,
  customer_id uuid not null references accounting.customers(id) on delete restrict,
  job_id uuid references public.jobs(id) on delete set null,
  -- Read-only link back to the inbound lead this quote came from (proposals untouched).
  source_proposal_id uuid references public.customer_proposals(id) on delete set null,
  estimate_date date not null default current_date,
  expiry_date date,
  terms text,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'accepted', 'declined', 'expired', 'converted')),
  subtotal numeric(14,2) not null default 0,
  discount_total numeric(14,2) not null default 0,
  tax_total numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  tax_code_id uuid references accounting.tax_codes(id) on delete set null,
  -- The invoice this estimate was converted into (null until converted).
  converted_invoice_id uuid references accounting.invoices(id) on delete set null,
  accepted_at timestamptz,
  memo text,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists accounting.estimate_lines (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references accounting.estimates(id) on delete cascade,
  item_id uuid references accounting.items(id) on delete set null,
  description text,
  quantity numeric(14,4) not null default 1,
  unit_price numeric(14,4) not null default 0,
  line_total numeric(14,2) not null default 0,
  discount numeric(14,2) not null default 0,
  tax_code_id uuid references accounting.tax_codes(id) on delete set null,
  taxable boolean not null default true,
  income_account_id uuid references accounting.accounts(id) on delete set null,
  job_id uuid references public.jobs(id) on delete set null,
  -- B2 reporting dimensions, persisted on the line and copied onto the invoice line on convert.
  class_id uuid references accounting.dimensions(id) on delete set null,
  location_id uuid references accounting.dimensions(id) on delete set null,
  department_id uuid references accounting.dimensions(id) on delete set null,
  sort_order int not null default 0
);

do $$
begin
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_estimates_customer') then
    create index idx_acct_estimates_customer on accounting.estimates(customer_id);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_estimates_job') then
    create index idx_acct_estimates_job on accounting.estimates(job_id);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_estimates_status') then
    create index idx_acct_estimates_status on accounting.estimates(status);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_estimate_lines_estimate') then
    create index idx_acct_estimate_lines_estimate on accounting.estimate_lines(estimate_id);
  end if;
end $$;

-- Convert an estimate into a DRAFT invoice, atomically and idempotently. The client
-- still SENDS the resulting invoice to post the revenue JE (no money posts here); this
-- only clones header + lines and marks the estimate converted. Mirrors the
-- record_*_payment RPCs' permission + search_path conventions.
create or replace function accounting.convert_estimate_to_invoice(p_estimate_id uuid)
returns uuid
language plpgsql
security definer
set search_path = accounting, public, pg_catalog
as $$
declare
  v_estimate accounting.estimates%rowtype;
  v_invoice_id uuid;
begin
  if not accounting.can_write() then
    raise exception 'insufficient privileges to convert an estimate' using errcode = 'insufficient_privilege';
  end if;

  -- Lock the estimate so two concurrent converts cannot each create an invoice.
  select * into v_estimate from accounting.estimates where id = p_estimate_id for update;
  if not found then
    raise exception 'estimate % not found', p_estimate_id using errcode = 'no_data_found';
  end if;

  -- Idempotent: an already-converted estimate returns its existing invoice.
  if v_estimate.status = 'converted' and v_estimate.converted_invoice_id is not null then
    return v_estimate.converted_invoice_id;
  end if;
  if v_estimate.status = 'declined' then
    raise exception 'a declined estimate cannot be converted' using errcode = 'check_violation';
  end if;

  -- Clone the header into a DRAFT invoice (balance_due = total; no JE yet).
  insert into accounting.invoices (
    customer_id, job_id, invoice_date, due_date, terms, status,
    subtotal, discount_total, tax_total, total, balance_due,
    tax_code_id, memo, notes, created_by
  ) values (
    v_estimate.customer_id, v_estimate.job_id, current_date, v_estimate.expiry_date, v_estimate.terms, 'draft',
    v_estimate.subtotal, v_estimate.discount_total, v_estimate.tax_total, v_estimate.total, v_estimate.total,
    v_estimate.tax_code_id, v_estimate.memo, v_estimate.notes, auth.uid()
  ) returning id into v_invoice_id;

  -- Copy the lines (estimate_lines → invoice_lines), preserving order + dimensions.
  insert into accounting.invoice_lines (
    invoice_id, item_id, description, quantity, unit_price, line_total, discount,
    tax_code_id, taxable, income_account_id, job_id, class_id, location_id, department_id, sort_order
  )
  select
    v_invoice_id, item_id, description, quantity, unit_price, line_total, discount,
    tax_code_id, taxable, income_account_id, job_id, class_id, location_id, department_id, sort_order
  from accounting.estimate_lines
  where estimate_id = p_estimate_id;

  -- Mark the estimate converted + link the two.
  update accounting.estimates
     set status = 'converted',
         converted_invoice_id = v_invoice_id
   where id = p_estimate_id;

  return v_invoice_id;
end;
$$;

select accounting._apply_standard_table('estimates');
select accounting._apply_standard_table('estimate_lines', false);

grant select, insert, update, delete on all tables in schema accounting to authenticated, service_role;
grant execute on function accounting.convert_estimate_to_invoice(uuid) to authenticated;

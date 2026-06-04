-- WorkTrackAccounting — Foundation 5/11: customers & vendors
--
-- First-class AR/AP party masters. Reconciliation with existing data is by
-- reference, never by moving data:
--   • customers.source_proposal_id links back to a converted public.customer_proposals
--     lead (proposals stay untouched — they are inbound leads, not the AR master).
--   • vendor_aliases maps free-text public.inventory.vendor strings to a canonical
--     vendor over time (public.inventory is untouched).
--
-- Also defines accounting._apply_standard_table(), a helper that attaches the
-- standard RLS (read=can_read, write=can_write) + audit + updated_at triggers,
-- reused by migrations 5–10 to keep the many simple tables consistent.
--
-- This migration is IDEMPOTENT.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS accounting.vendor_aliases CASCADE;
--   DROP TABLE IF EXISTS accounting.vendors CASCADE;
--   DROP TABLE IF EXISTS accounting.customers CASCADE;
--   DROP FUNCTION IF EXISTS accounting._apply_standard_table(text, boolean, text);

-- Standard table wiring helper (RLS + audit + touch). p_write_check lets payroll
-- tables pass accounting.can_payroll() instead of the default can_write().
create or replace function accounting._apply_standard_table(
  p_table text,
  p_has_updated_at boolean default true,
  p_write_check text default 'accounting.can_write()'
)
returns void
language plpgsql
as $$
begin
  execute format('alter table accounting.%I enable row level security', p_table);

  execute format('drop policy if exists %I on accounting.%I', p_table || ' read', p_table);
  execute format('create policy %I on accounting.%I for select to authenticated using (accounting.can_read())',
                 p_table || ' read', p_table);

  execute format('drop policy if exists %I on accounting.%I', p_table || ' write', p_table);
  execute format('create policy %I on accounting.%I for all to authenticated using (%s) with check (%s)',
                 p_table || ' write', p_table, p_write_check, p_write_check);

  execute format('drop trigger if exists audit_%I on accounting.%I', p_table, p_table);
  execute format('create trigger audit_%I after insert or update or delete on accounting.%I for each row execute function accounting.audit()',
                 p_table, p_table);

  if p_has_updated_at then
    execute format('drop trigger if exists touch_%I on accounting.%I', p_table, p_table);
    execute format('create trigger touch_%I before update on accounting.%I for each row execute function accounting.touch_updated_at()',
                   p_table, p_table);
  end if;
end;
$$;

create table if not exists accounting.customers (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  company_name text,
  contact_name text,
  email text,
  phone text,
  billing_address jsonb,
  shipping_address jsonb,
  tax_exempt boolean not null default false,
  resale_certificate text,
  -- default_tax_code_id is a plain uuid here (accounting.tax_codes is created in
  -- migration 7, after this one). The invoice layer resolves it.
  default_tax_code_id uuid,
  terms text,
  is_active boolean not null default true,
  notes text,
  source_proposal_id uuid references public.customer_proposals(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists accounting.vendors (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  company_name text,
  email text,
  phone text,
  address jsonb,
  terms text,
  default_expense_account_id uuid references accounting.accounts(id) on delete set null,
  tax_id text, -- deferred: pgcrypto field encryption target
  is_1099 boolean not null default false,
  is_active boolean not null default true,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists accounting.vendor_aliases (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references accounting.vendors(id) on delete cascade,
  raw_name text not null unique,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_customers_name') then
    create index idx_acct_customers_name on accounting.customers(display_name);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_vendors_name') then
    create index idx_acct_vendors_name on accounting.vendors(display_name);
  end if;
end $$;

select accounting._apply_standard_table('customers');
select accounting._apply_standard_table('vendors');
select accounting._apply_standard_table('vendor_aliases', false);

grant select, insert, update, delete on all tables in schema accounting to authenticated, service_role;

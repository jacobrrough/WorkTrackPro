-- WorkTrackAccounting — Foundation 9/11: bills, vendor payments & applications
--
-- AP side, symmetric to migration 8. bill_lines may target a GL account directly
-- (account-based) or an item (item-based). source_inventory_id links a received
-- line back to existing stock (additive). A trigger keeps bill/vendor-payment
-- rollups consistent and rejects over-application.
--
-- This migration is IDEMPOTENT.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS accounting.vendor_payment_applications CASCADE;
--   DROP TABLE IF EXISTS accounting.vendor_payments CASCADE;
--   DROP TABLE IF EXISTS accounting.bill_lines CASCADE;
--   DROP TABLE IF EXISTS accounting.bills CASCADE;
--   DROP FUNCTION IF EXISTS accounting.sync_bill_payment() CASCADE;

create table if not exists accounting.bills (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references accounting.vendors(id) on delete restrict,
  bill_number text,
  bill_date date not null default current_date,
  due_date date,
  terms text,
  status text not null default 'open'
    check (status in ('draft', 'open', 'partially_paid', 'paid', 'void')),
  subtotal numeric(14,2) not null default 0,
  tax_total numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  amount_paid numeric(14,2) not null default 0,
  balance_due numeric(14,2) not null default 0,
  job_id uuid references public.jobs(id) on delete set null,
  journal_entry_id uuid references accounting.journal_entries(id) on delete set null,
  memo text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists accounting.bill_lines (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references accounting.bills(id) on delete cascade,
  account_id uuid references accounting.accounts(id) on delete set null,
  item_id uuid references accounting.items(id) on delete set null,
  description text,
  quantity numeric(14,4) not null default 1,
  unit_cost numeric(14,4) not null default 0,
  line_total numeric(14,2) not null default 0,
  job_id uuid references public.jobs(id) on delete set null,
  source_inventory_id uuid references public.inventory(id) on delete set null,
  sort_order int not null default 0,
  constraint bill_lines_has_target check (account_id is not null or item_id is not null)
);

create table if not exists accounting.vendor_payments (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references accounting.vendors(id) on delete restrict,
  payment_date date not null default current_date,
  amount numeric(14,2) not null check (amount > 0),
  method text not null default 'other' check (method in ('cash', 'check', 'card', 'ach', 'other')),
  reference text,
  pay_from_account_id uuid references accounting.accounts(id) on delete set null,
  unapplied_amount numeric(14,2) not null default 0,
  journal_entry_id uuid references accounting.journal_entries(id) on delete set null,
  memo text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists accounting.vendor_payment_applications (
  id uuid primary key default gen_random_uuid(),
  vendor_payment_id uuid not null references accounting.vendor_payments(id) on delete cascade,
  bill_id uuid not null references accounting.bills(id) on delete cascade,
  amount_applied numeric(14,2) not null check (amount_applied > 0),
  created_at timestamptz not null default now(),
  unique (vendor_payment_id, bill_id)
);

do $$
begin
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_bills_vendor') then
    create index idx_acct_bills_vendor on accounting.bills(vendor_id);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_bills_status') then
    create index idx_acct_bills_status on accounting.bills(status);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_bill_lines_bill') then
    create index idx_acct_bill_lines_bill on accounting.bill_lines(bill_id);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_vpayapp_bill') then
    create index idx_acct_vpayapp_bill on accounting.vendor_payment_applications(bill_id);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_vpayapp_payment') then
    create index idx_acct_vpayapp_payment on accounting.vendor_payment_applications(vendor_payment_id);
  end if;
end $$;

create or replace function accounting.sync_bill_payment()
returns trigger
language plpgsql
security definer
set search_path = accounting, pg_catalog
as $$
declare
  v_bill uuid := coalesce(new.bill_id, old.bill_id);
  v_payment uuid := coalesce(new.vendor_payment_id, old.vendor_payment_id);
  v_bill_total numeric(14,2);
  v_paid numeric(14,2);
  v_pay_amount numeric(14,2);
  v_applied numeric(14,2);
begin
  if v_bill is not null then
    select total into v_bill_total from accounting.bills where id = v_bill;
    if found then
      select coalesce(sum(amount_applied), 0) into v_paid
        from accounting.vendor_payment_applications where bill_id = v_bill;
      if v_paid > v_bill_total then
        raise exception 'payments applied (%) exceed bill % total (%)', v_paid, v_bill, v_bill_total
          using errcode = 'check_violation';
      end if;
      update accounting.bills
         set amount_paid = v_paid,
             balance_due = v_bill_total - v_paid,
             status = case
                        when status = 'void' then status
                        when v_bill_total > 0 and v_paid >= v_bill_total then 'paid'
                        when v_paid > 0 then 'partially_paid'
                        when status in ('paid', 'partially_paid') then 'open'
                        else status
                      end
       where id = v_bill;
    end if;
  end if;

  if v_payment is not null then
    select amount into v_pay_amount from accounting.vendor_payments where id = v_payment;
    if found then
      select coalesce(sum(amount_applied), 0) into v_applied
        from accounting.vendor_payment_applications where vendor_payment_id = v_payment;
      if v_applied > v_pay_amount then
        raise exception 'applied amount (%) exceeds vendor payment % (%)', v_applied, v_payment, v_pay_amount
          using errcode = 'check_violation';
      end if;
      update accounting.vendor_payments set unapplied_amount = v_pay_amount - v_applied where id = v_payment;
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists sync_bill_payment on accounting.vendor_payment_applications;
create trigger sync_bill_payment after insert or update or delete on accounting.vendor_payment_applications
  for each row execute function accounting.sync_bill_payment();

select accounting._apply_standard_table('bills');
select accounting._apply_standard_table('bill_lines', false);
select accounting._apply_standard_table('vendor_payments');
select accounting._apply_standard_table('vendor_payment_applications', false);

grant select, insert, update, delete on all tables in schema accounting to authenticated, service_role;

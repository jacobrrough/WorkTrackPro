-- WorkTrackAccounting — Foundation 8/11: invoices, payments & applications
--
-- AR side. invoices.job_id is the additive job→invoice link (FK on this child
-- table; public.jobs untouched). payment_applications is the many-to-many between
-- payments and invoices; a trigger keeps invoice amount_paid/balance_due/status and
-- payment unapplied_amount consistent and rejects over-application.
--
-- This migration is IDEMPOTENT.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS accounting.payment_applications CASCADE;
--   DROP TABLE IF EXISTS accounting.payments CASCADE;
--   DROP TABLE IF EXISTS accounting.invoice_lines CASCADE;
--   DROP TABLE IF EXISTS accounting.invoices CASCADE;
--   DROP FUNCTION IF EXISTS accounting.sync_invoice_payment() CASCADE;

create table if not exists accounting.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text unique,
  customer_id uuid not null references accounting.customers(id) on delete restrict,
  job_id uuid references public.jobs(id) on delete set null,
  invoice_date date not null default current_date,
  due_date date,
  terms text,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'partially_paid', 'paid', 'void')),
  subtotal numeric(14,2) not null default 0,
  discount_total numeric(14,2) not null default 0,
  tax_total numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  amount_paid numeric(14,2) not null default 0,
  balance_due numeric(14,2) not null default 0,
  tax_code_id uuid references accounting.tax_codes(id) on delete set null,
  journal_entry_id uuid references accounting.journal_entries(id) on delete set null,
  memo text,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists accounting.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references accounting.invoices(id) on delete cascade,
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
  sort_order int not null default 0
);

create table if not exists accounting.payments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references accounting.customers(id) on delete restrict,
  payment_date date not null default current_date,
  amount numeric(14,2) not null check (amount > 0),
  method text not null default 'other' check (method in ('cash', 'check', 'card', 'ach', 'other')),
  reference text,
  deposit_account_id uuid references accounting.accounts(id) on delete set null,
  unapplied_amount numeric(14,2) not null default 0,
  journal_entry_id uuid references accounting.journal_entries(id) on delete set null,
  memo text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists accounting.payment_applications (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references accounting.payments(id) on delete cascade,
  invoice_id uuid not null references accounting.invoices(id) on delete cascade,
  amount_applied numeric(14,2) not null check (amount_applied > 0),
  created_at timestamptz not null default now(),
  unique (payment_id, invoice_id)
);

do $$
begin
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_invoices_customer') then
    create index idx_acct_invoices_customer on accounting.invoices(customer_id);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_invoices_job') then
    create index idx_acct_invoices_job on accounting.invoices(job_id);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_invoices_status') then
    create index idx_acct_invoices_status on accounting.invoices(status);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_invoice_lines_invoice') then
    create index idx_acct_invoice_lines_invoice on accounting.invoice_lines(invoice_id);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_payapp_invoice') then
    create index idx_acct_payapp_invoice on accounting.payment_applications(invoice_id);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_payapp_payment') then
    create index idx_acct_payapp_payment on accounting.payment_applications(payment_id);
  end if;
end $$;

-- Keep invoice/payment rollups consistent; reject over-application.
create or replace function accounting.sync_invoice_payment()
returns trigger
language plpgsql
security definer
set search_path = accounting, pg_catalog
as $$
declare
  v_invoice uuid := coalesce(new.invoice_id, old.invoice_id);
  v_payment uuid := coalesce(new.payment_id, old.payment_id);
  v_inv_total numeric(14,2);
  v_paid numeric(14,2);
  v_pay_amount numeric(14,2);
  v_applied numeric(14,2);
begin
  if v_invoice is not null then
    select total into v_inv_total from accounting.invoices where id = v_invoice;
    if found then
      select coalesce(sum(amount_applied), 0) into v_paid
        from accounting.payment_applications where invoice_id = v_invoice;
      if v_paid > v_inv_total then
        raise exception 'payments applied (%) exceed invoice % total (%)', v_paid, v_invoice, v_inv_total
          using errcode = 'check_violation';
      end if;
      update accounting.invoices
         set amount_paid = v_paid,
             balance_due = v_inv_total - v_paid,
             status = case
                        when status = 'void' then status
                        when v_inv_total > 0 and v_paid >= v_inv_total then 'paid'
                        when v_paid > 0 then 'partially_paid'
                        when status in ('paid', 'partially_paid') then 'sent'
                        else status
                      end
       where id = v_invoice;
    end if;
  end if;

  if v_payment is not null then
    select amount into v_pay_amount from accounting.payments where id = v_payment;
    if found then
      select coalesce(sum(amount_applied), 0) into v_applied
        from accounting.payment_applications where payment_id = v_payment;
      if v_applied > v_pay_amount then
        raise exception 'applied amount (%) exceeds payment % (%)', v_applied, v_payment, v_pay_amount
          using errcode = 'check_violation';
      end if;
      update accounting.payments set unapplied_amount = v_pay_amount - v_applied where id = v_payment;
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists sync_invoice_payment on accounting.payment_applications;
create trigger sync_invoice_payment after insert or update or delete on accounting.payment_applications
  for each row execute function accounting.sync_invoice_payment();

select accounting._apply_standard_table('invoices');
select accounting._apply_standard_table('invoice_lines', false);
select accounting._apply_standard_table('payments');
select accounting._apply_standard_table('payment_applications', false);

grant select, insert, update, delete on all tables in schema accounting to authenticated, service_role;

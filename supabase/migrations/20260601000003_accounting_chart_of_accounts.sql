-- WorkTrackAccounting — Foundation 3/11: chart of accounts
--
-- Double-entry account master with a self-referential parent hierarchy and a
-- seeded default chart. is_system accounts are structural and protected from
-- deletion by convention (enforced in the service layer / future guard).
--
-- This migration is IDEMPOTENT.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS accounting.accounts CASCADE;
--   DROP FUNCTION IF EXISTS accounting.touch_updated_at() CASCADE;

-- Shared updated_at trigger util (defined here, reused by later accounting migrations).
create or replace function accounting.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table if not exists accounting.accounts (
  id uuid primary key default gen_random_uuid(),
  account_number text unique,
  name text not null,
  account_type text not null check (account_type in ('asset', 'liability', 'equity', 'income', 'expense')),
  account_subtype text check (account_subtype in (
    'bank', 'accounts_receivable', 'other_current_asset', 'inventory', 'fixed_asset',
    'accumulated_depreciation', 'other_asset',
    'accounts_payable', 'credit_card', 'other_current_liability', 'long_term_liability',
    'equity',
    'income', 'other_income',
    'cost_of_goods_sold', 'expense', 'other_expense'
  )),
  parent_account_id uuid references accounting.accounts(id) on delete restrict,
  normal_balance text not null check (normal_balance in ('debit', 'credit')),
  currency text not null default 'USD',
  is_active boolean not null default true,
  is_system boolean not null default false,
  description text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accounts_no_self_parent check (parent_account_id is null or parent_account_id <> id)
);

do $$
begin
  if not exists (select 1 from pg_indexes where schemaname = 'accounting' and indexname = 'idx_accounting_accounts_type') then
    create index idx_accounting_accounts_type on accounting.accounts(account_type);
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'accounting' and indexname = 'idx_accounting_accounts_parent') then
    create index idx_accounting_accounts_parent on accounting.accounts(parent_account_id);
  end if;
end $$;

-- Seeded default chart of accounts. is_system = true marks structural accounts.
-- normal_balance: assets/expenses = debit; liabilities/equity/income = credit;
-- contra-asset (accumulated depreciation) = credit.
insert into accounting.accounts (account_number, name, account_type, account_subtype, normal_balance, is_system) values
  ('1000', 'Cash',                     'asset',     'bank',                     'debit',  true),
  ('1050', 'Undeposited Funds',        'asset',     'other_current_asset',      'debit',  true),
  ('1200', 'Accounts Receivable',      'asset',     'accounts_receivable',      'debit',  true),
  ('1300', 'Inventory Asset',          'asset',     'inventory',                'debit',  true),
  ('1500', 'Fixed Assets',             'asset',     'fixed_asset',              'debit',  true),
  ('1510', 'Accumulated Depreciation', 'asset',     'accumulated_depreciation', 'credit', true),
  ('2000', 'Accounts Payable',         'liability', 'accounts_payable',         'credit', true),
  ('2100', 'Credit Card',              'liability', 'credit_card',              'credit', true),
  ('2200', 'Sales Tax Payable',        'liability', 'other_current_liability',  'credit', true),
  ('2300', 'Payroll Liabilities',      'liability', 'other_current_liability',  'credit', true),
  ('3000', 'Owner Equity',             'equity',    'equity',                   'credit', true),
  ('3900', 'Retained Earnings',        'equity',    'equity',                   'credit', true),
  ('4000', 'Sales',                    'income',    'income',                   'credit', true),
  ('4100', 'Service Income',           'income',    'income',                   'credit', true),
  ('5000', 'Cost of Goods Sold',       'expense',   'cost_of_goods_sold',       'debit',  true),
  ('6000', 'Operating Expenses',       'expense',   'expense',                  'debit',  true)
on conflict (account_number) do nothing;

-- Record the default account ids in module settings so document-posting code can
-- resolve AR/AP/COGS/etc. without hardcoding. Rebuilt idempotently from the seed.
update accounting.settings
   set setting_value = jsonb_build_object(
         'cash',                (select id from accounting.accounts where account_number = '1000'),
         'undeposited_funds',   (select id from accounting.accounts where account_number = '1050'),
         'accounts_receivable', (select id from accounting.accounts where account_number = '1200'),
         'inventory_asset',     (select id from accounting.accounts where account_number = '1300'),
         'accounts_payable',    (select id from accounting.accounts where account_number = '2000'),
         'sales_tax_payable',   (select id from accounting.accounts where account_number = '2200'),
         'sales_income',        (select id from accounting.accounts where account_number = '4000'),
         'service_income',      (select id from accounting.accounts where account_number = '4100'),
         'cogs',                (select id from accounting.accounts where account_number = '5000'),
         'operating_expenses',  (select id from accounting.accounts where account_number = '6000')
       ),
       updated_at = now()
 where setting_key = 'default_accounts';

-- updated_at + audit triggers
drop trigger if exists touch_accounts on accounting.accounts;
create trigger touch_accounts before update on accounting.accounts
  for each row execute function accounting.touch_updated_at();

drop trigger if exists audit_accounts on accounting.accounts;
create trigger audit_accounts after insert or update or delete on accounting.accounts
  for each row execute function accounting.audit();

-- RLS
alter table accounting.accounts enable row level security;

drop policy if exists "acct accounts read" on accounting.accounts;
create policy "acct accounts read" on accounting.accounts
  for select to authenticated using (accounting.can_read());

drop policy if exists "acct accounts write" on accounting.accounts;
create policy "acct accounts write" on accounting.accounts
  for all to authenticated
  using (accounting.can_write())
  with check (accounting.can_write());

grant select, insert, update, delete on all tables in schema accounting to authenticated, service_role;

-- WorkTrackAccounting — Foundation 10/11: banking, feeds, rules & reconciliation
--
-- bank_accounts wrap a GL bank/credit-card account. bank_transactions hold imported
-- feed rows (dedup via unique (bank_account_id, external_id)). bank_rules is a stub
-- for auto-categorization (engine deferred). reconciliations is the statement-match
-- header (line-level matching deferred).
--
-- This migration is IDEMPOTENT.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS accounting.reconciliations CASCADE;
--   DROP TABLE IF EXISTS accounting.bank_rules CASCADE;
--   DROP TABLE IF EXISTS accounting.bank_transactions CASCADE;
--   DROP TABLE IF EXISTS accounting.bank_accounts CASCADE;

create table if not exists accounting.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  account_id uuid references accounting.accounts(id) on delete set null,
  account_type text check (account_type in ('checking', 'savings', 'credit_card')),
  institution text,
  mask text, -- deferred: pgcrypto field encryption target
  current_balance numeric(14,2) not null default 0,
  last_reconciled_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists accounting.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references accounting.bank_accounts(id) on delete cascade,
  txn_date date not null,
  -- sign convention: positive = deposit/credit-to-bank, negative = withdrawal
  amount numeric(14,2) not null,
  description text,
  merchant text,
  external_id text,
  status text not null default 'unreviewed'
    check (status in ('unreviewed', 'categorized', 'matched', 'excluded')),
  category_account_id uuid references accounting.accounts(id) on delete set null,
  matched_journal_entry_id uuid references accounting.journal_entries(id) on delete set null,
  matched_payment_id uuid references accounting.payments(id) on delete set null,
  matched_bill_id uuid references accounting.bills(id) on delete set null,
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (bank_account_id, external_id)
);

create table if not exists accounting.bank_rules (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid references accounting.bank_accounts(id) on delete cascade,
  match_field text check (match_field in ('description', 'merchant', 'amount')),
  match_op text check (match_op in ('contains', 'equals', 'regex', 'gt', 'lt')),
  match_value text,
  set_account_id uuid references accounting.accounts(id) on delete set null,
  set_vendor_id uuid references accounting.vendors(id) on delete set null,
  priority int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists accounting.reconciliations (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references accounting.bank_accounts(id) on delete cascade,
  statement_date date not null,
  statement_ending_balance numeric(14,2),
  beginning_balance numeric(14,2),
  status text not null default 'in_progress' check (status in ('in_progress', 'completed')),
  reconciled_by uuid references public.profiles(id) on delete set null,
  reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_banktxn_acct') then
    create index idx_acct_banktxn_acct on accounting.bank_transactions(bank_account_id, txn_date desc);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_banktxn_status') then
    create index idx_acct_banktxn_status on accounting.bank_transactions(status);
  end if;
end $$;

select accounting._apply_standard_table('bank_accounts');
select accounting._apply_standard_table('bank_transactions', false);
select accounting._apply_standard_table('bank_rules');
select accounting._apply_standard_table('reconciliations');

grant select, insert, update, delete on all tables in schema accounting to authenticated, service_role;

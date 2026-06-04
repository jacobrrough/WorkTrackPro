-- WorkTrackAccounting — Foundation 6/11: items (products/services) → GL mapping
--
-- Bridges sellable/purchasable things to income/expense/inventory-asset accounts.
-- Additive, nullable crosswalk to existing catalog (a public.parts row → a service/
-- assembly item; a public.inventory row → an inventory/non_inventory item). Nothing
-- in public is modified.
--
-- This migration is IDEMPOTENT.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS accounting.items CASCADE;

create table if not exists accounting.items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sku text,
  item_type text not null default 'service'
    check (item_type in ('inventory', 'non_inventory', 'service', 'assembly', 'bundle')),
  income_account_id uuid references accounting.accounts(id) on delete set null,
  expense_account_id uuid references accounting.accounts(id) on delete set null,
  inventory_asset_account_id uuid references accounting.accounts(id) on delete set null,
  default_tax_code_id uuid, -- accounting.tax_codes created in migration 7
  sales_price numeric(14,4),
  purchase_cost numeric(14,4),
  is_active boolean not null default true,
  -- crosswalk to existing catalog (at most one source)
  source_inventory_id uuid references public.inventory(id) on delete set null,
  source_part_id uuid references public.parts(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint items_single_source check (not (source_inventory_id is not null and source_part_id is not null))
);

do $$
begin
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_items_name') then
    create index idx_acct_items_name on accounting.items(name);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_items_src_inv') then
    create index idx_acct_items_src_inv on accounting.items(source_inventory_id);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_items_src_part') then
    create index idx_acct_items_src_part on accounting.items(source_part_id);
  end if;
end $$;

select accounting._apply_standard_table('items');

grant select, insert, update, delete on all tables in schema accounting to authenticated, service_role;

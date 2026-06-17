-- Inventory reconciliation + cost sync — inventory revaluation account, gated revaluation queue,
-- inventory price-change history with accounting cost sync, and the opening-inventory seeder plus
-- reconciliation views.
--
-- PROVENANCE: this migration was applied to production (project bbqudyybacwbubkgktwf) on
-- 2026-06-16 as version 20260616231127 but the file was never committed to the repo, which left
-- the remote migration history with a version that had no local file ("Remote migration versions
-- not found in local migrations directory"). Recovered verbatim from
-- supabase_migrations.schema_migrations.statements and committed here so repo == live.
--
-- IDEMPOTENT: every object uses if-not-exists / create-or-replace / drop-if-exists guards, so
-- re-applying on an environment that already has it is a no-op.

-- ============================ 1/4: revaluation account (chart-agnostic) ============================
do $$
declare
  v_reval uuid;
begin
  select id into v_reval
    from accounting.accounts
   where name = 'Inventory Revaluation' and account_type = 'asset'
   order by created_at
   limit 1;

  if v_reval is null then
    insert into accounting.accounts
      (account_number, name, account_type, account_subtype, normal_balance, is_system)
    values
      (null, 'Inventory Revaluation', 'asset', 'inventory', 'debit', true)
    returning id into v_reval;
  end if;

  update accounting.settings
     set setting_value = setting_value || jsonb_build_object('inventory_revaluation', v_reval),
         updated_at = now()
   where setting_key = 'default_accounts';
end $$;

grant select, insert, update, delete on all tables in schema accounting to authenticated, service_role;

-- ============================ 2/4: gated revaluation queue ============================
create table if not exists accounting.inventory_revaluations (
  id uuid primary key default gen_random_uuid(),
  source_inventory_id uuid not null references public.inventory(id) on delete cascade,
  item_id uuid references accounting.items(id) on delete set null,
  old_cost numeric(14,4) not null default 0,
  new_cost numeric(14,4) not null default 0,
  on_hand_qty numeric(14,4) not null default 0,
  delta_amount numeric(14,2) not null default 0,
  status text not null default 'pending' check (status in ('pending', 'posted', 'void')),
  journal_entry_id uuid references accounting.journal_entries(id) on delete set null,
  reason text,
  enqueued_at timestamptz not null default now(),
  posted_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_inv_reval_status') then
    create index idx_acct_inv_reval_status on accounting.inventory_revaluations(status, enqueued_at desc);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_inv_reval_src') then
    create index idx_acct_inv_reval_src on accounting.inventory_revaluations(source_inventory_id);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_inv_reval_je') then
    create index idx_acct_inv_reval_je on accounting.inventory_revaluations(journal_entry_id);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='uq_acct_inv_reval_pending') then
    create unique index uq_acct_inv_reval_pending
      on accounting.inventory_revaluations(source_inventory_id)
      where status = 'pending';
  end if;
end $$;

select accounting._apply_standard_table('inventory_revaluations');

create or replace function accounting.post_inventory_revaluation(p_revaluation_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = accounting, public, pg_catalog
as $$
declare
  v_inv_acct uuid;
  v_reval_acct uuid;
  v_row record;
  v_row_cents bigint;
  v_net_cents bigint := 0;
  v_amount numeric(14,2);
  v_entry_id uuid;
  v_count int := 0;
begin
  if not accounting.can_write() then
    raise exception 'insufficient privileges to post inventory revaluations'
      using errcode = 'insufficient_privilege';
  end if;

  if p_revaluation_ids is null or array_length(p_revaluation_ids, 1) is null then
    return null;
  end if;

  select (setting_value ->> 'inventory_asset')::uuid,
         (setting_value ->> 'inventory_revaluation')::uuid
    into v_inv_acct, v_reval_acct
    from accounting.settings
   where setting_key = 'default_accounts';
  if v_inv_acct is null or v_reval_acct is null then
    raise exception 'default Inventory-Asset/Inventory-Revaluation accounts are not configured in accounting.settings'
      using errcode = 'check_violation';
  end if;

  for v_row in
    select id, on_hand_qty, old_cost, new_cost
      from accounting.inventory_revaluations
     where id = any(p_revaluation_ids)
       and status = 'pending'
     order by id
     for update
  loop
    v_count := v_count + 1;
    v_row_cents := round(v_row.on_hand_qty * (v_row.new_cost - v_row.old_cost) * 100)::bigint;
    v_net_cents := v_net_cents + v_row_cents;
  end loop;

  if v_count = 0 then
    return null;
  end if;

  if v_net_cents <> 0 then
    v_amount := (abs(v_net_cents)::numeric) / 100.0;

    insert into accounting.journal_entries (entry_date, memo, source_type, status, created_by)
    values (current_date, 'Inventory revaluation (' || v_count || ' item(s))', 'adjustment', 'draft', auth.uid())
    returning id into v_entry_id;

    if v_net_cents > 0 then
      insert into accounting.journal_lines (journal_entry_id, account_id, debit, credit, line_memo, sort_order)
      values (v_entry_id, v_inv_acct,   v_amount, 0, 'Inventory revaluation (increase)', 0);
      insert into accounting.journal_lines (journal_entry_id, account_id, debit, credit, line_memo, sort_order)
      values (v_entry_id, v_reval_acct, 0, v_amount, 'Inventory revaluation offset',     1);
    else
      insert into accounting.journal_lines (journal_entry_id, account_id, debit, credit, line_memo, sort_order)
      values (v_entry_id, v_reval_acct, v_amount, 0, 'Inventory revaluation offset',     0);
      insert into accounting.journal_lines (journal_entry_id, account_id, debit, credit, line_memo, sort_order)
      values (v_entry_id, v_inv_acct,   0, v_amount, 'Inventory revaluation (decrease)', 1);
    end if;

    perform accounting.post_journal_entry(v_entry_id);
  else
    v_entry_id := null;
  end if;

  for v_row in
    select id, source_inventory_id, new_cost
      from accounting.inventory_revaluations
     where id = any(p_revaluation_ids)
       and status = 'pending'
     order by id
     for update
  loop
    update accounting.inventory_revaluations
       set status = 'posted', journal_entry_id = v_entry_id, posted_at = now()
     where id = v_row.id;

    update accounting.inventory_layers
       set unit_cost = v_row.new_cost
     where source_inventory_id = v_row.source_inventory_id
       and qty_remaining > 0;
  end loop;

  return v_entry_id;
end;
$$;

grant select, insert, update, delete on all tables in schema accounting to authenticated, service_role;
grant usage, select on all sequences in schema accounting to authenticated, service_role;
grant execute on all functions in schema accounting to authenticated, service_role;

-- ============================ 3/4: price history + cost sync ============================
create table if not exists public.inventory_price_history (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null references public.inventory(id) on delete cascade,
  old_price numeric,
  new_price numeric,
  change_amount numeric,
  source text not null default 'manual' check (source in ('manual', 'bill', 'seed', 'reval')),
  user_id uuid,
  reason text,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='idx_inventory_price_history_inv') then
    create index idx_inventory_price_history_inv on public.inventory_price_history(inventory_id, created_at desc);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='idx_inventory_price_history_created') then
    create index idx_inventory_price_history_created on public.inventory_price_history(created_at desc);
  end if;
end $$;

alter table public.inventory_price_history enable row level security;

drop policy if exists "Approved read inventory price history" on public.inventory_price_history;
create policy "Approved read inventory price history" on public.inventory_price_history
  for select to authenticated
  using (public.is_approved_user());

create or replace function public.inventory_log_price_change()
returns trigger
language plpgsql
security definer
set search_path = public, accounting, pg_catalog
as $$
declare
  v_source text;
  v_on_hand numeric(14,4);
  v_item_id uuid;
  v_reval_acct uuid;
begin
  v_source := coalesce(nullif(current_setting('app.price_change_source', true), ''), 'manual');
  if v_source not in ('manual', 'bill', 'seed', 'reval') then
    v_source := 'manual';
  end if;

  insert into public.inventory_price_history
    (inventory_id, old_price, new_price, change_amount, source, user_id, reason)
  values
    (NEW.id, OLD.price, NEW.price,
     coalesce(NEW.price, 0) - coalesce(OLD.price, 0),
     v_source, auth.uid(),
     nullif(current_setting('app.price_change_reason', true), ''));

  select (setting_value ->> 'inventory_revaluation')::uuid
    into v_reval_acct
    from accounting.settings
   where setting_key = 'default_accounts';
  if v_reval_acct is null then
    return NEW;
  end if;

  update accounting.items
     set purchase_cost = NEW.price
   where source_inventory_id = NEW.id
     and purchase_cost is distinct from NEW.price;

  if v_source = 'reval' then
    return NEW;
  end if;

  select coalesce(sum(qty_remaining), 0)
    into v_on_hand
    from accounting.inventory_layers
   where source_inventory_id = NEW.id
     and qty_remaining > 0;

  select id into v_item_id
    from accounting.items
   where source_inventory_id = NEW.id
   order by created_at
   limit 1;

  insert into accounting.inventory_revaluations
    (source_inventory_id, item_id, old_cost, new_cost, on_hand_qty, delta_amount, status, created_by)
  values
    (NEW.id, v_item_id,
     coalesce(OLD.price, 0), coalesce(NEW.price, 0), v_on_hand,
     round(v_on_hand * (coalesce(NEW.price, 0) - coalesce(OLD.price, 0)) * 100) / 100.0,
     'pending', auth.uid())
  on conflict (source_inventory_id) where (status = 'pending')
  do update set
    new_cost = excluded.new_cost,
    item_id = coalesce(excluded.item_id, accounting.inventory_revaluations.item_id),
    on_hand_qty = excluded.on_hand_qty,
    delta_amount = round(excluded.on_hand_qty
                         * (excluded.new_cost - accounting.inventory_revaluations.old_cost) * 100) / 100.0,
    enqueued_at = now(),
    updated_at = now();

  return NEW;
end;
$$;

drop trigger if exists trg_inventory_price_history on public.inventory;
create trigger trg_inventory_price_history
  after update of price on public.inventory
  for each row
  when (OLD.price is distinct from NEW.price)
  execute function public.inventory_log_price_change();

revoke execute on function public.inventory_log_price_change() from public;
revoke execute on function public.inventory_log_price_change() from anon, authenticated;

grant select, insert, update, delete on public.inventory_price_history to authenticated, service_role;

-- ============================ 4/4: seeder + reconciliation views ============================
create or replace function accounting.seed_opening_inventory_layers(
  p_as_of date default current_date,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = accounting, public, pg_catalog
as $$
declare
  v_inv_acct uuid;
  v_obe_acct uuid;
  v_already_je uuid;
  v_total_cents bigint := 0;
  v_item_count int := 0;
  v_total_qty numeric(14,4) := 0;
  v_preview jsonb := '[]'::jsonb;
  v_exceptions jsonb := '[]'::jsonb;
  v_row record;
  v_item_id uuid;
  v_entry_id uuid := null;
  v_cost_dollars numeric(14,2);
  v_inv_asset_acct_id uuid;
begin
  if not accounting.can_write() then
    raise exception 'insufficient privileges to seed opening inventory'
      using errcode = 'insufficient_privilege';
  end if;

  select (setting_value ->> 'inventory_asset')::uuid,
         (setting_value ->> 'opening_balance_equity')::uuid
    into v_inv_acct, v_obe_acct
    from accounting.settings
   where setting_key = 'default_accounts';
  if v_inv_acct is null or v_obe_acct is null then
    raise exception 'default Inventory-Asset/Opening-Balance-Equity accounts are not configured in accounting.settings'
      using errcode = 'check_violation';
  end if;
  v_inv_asset_acct_id := v_inv_acct;

  select je.id into v_already_je
    from accounting.journal_entries je
   where je.source_type = 'opening_balance'
     and je.status = 'posted'
     and exists (
       select 1 from accounting.journal_lines jl
       where jl.journal_entry_id = je.id
         and jl.account_id = v_inv_acct
         and jl.debit > 0
     )
   order by je.created_at
   limit 1;

  for v_row in
    select i.id, i.name, i.in_stock, i.price
      from public.inventory i
     where not exists (select 1 from accounting.inventory_layers l where l.source_inventory_id = i.id)
       and (i.price is null or coalesce(i.in_stock, 0) <= 0)
  loop
    v_exceptions := v_exceptions || jsonb_build_object(
      'source_inventory_id', v_row.id, 'name', v_row.name, 'in_stock', v_row.in_stock, 'price', v_row.price,
      'reason', case when v_row.price is null then 'null_price'
                     when coalesce(v_row.in_stock, 0) <= 0 then 'non_positive_stock'
                     else 'unknown' end);
  end loop;

  for v_row in
    select i.id, i.name, i.in_stock, i.price, i.unit, i.vendor, i.description
      from public.inventory i
     where coalesce(i.in_stock, 0) > 0
       and i.price is not null
       and not exists (select 1 from accounting.inventory_layers l where l.source_inventory_id = i.id)
     order by i.name
  loop
    v_item_count := v_item_count + 1;
    v_total_qty := v_total_qty + v_row.in_stock;
    v_total_cents := v_total_cents + round(v_row.in_stock * v_row.price * 100)::bigint;

    v_preview := v_preview || jsonb_build_object(
      'source_inventory_id', v_row.id, 'name', v_row.name, 'in_stock', v_row.in_stock,
      'unit_cost', v_row.price, 'extended', round(v_row.in_stock * v_row.price, 2));

    if not p_dry_run and v_already_je is null then
      select id into v_item_id from accounting.items where source_inventory_id = v_row.id order by created_at limit 1;

      if v_item_id is null then
        insert into accounting.items
          (name, item_type, inventory_asset_account_id, purchase_cost, source_inventory_id, sku, is_active, created_by)
        values
          (v_row.name, 'inventory', v_inv_asset_acct_id, v_row.price, v_row.id, nullif(v_row.unit, ''), true, auth.uid())
        returning id into v_item_id;
      else
        update accounting.items
           set purchase_cost = v_row.price,
               inventory_asset_account_id = coalesce(inventory_asset_account_id, v_inv_asset_acct_id)
         where id = v_item_id and purchase_cost is distinct from v_row.price;
      end if;

      insert into accounting.inventory_layers
        (item_id, source_inventory_id, bill_line_id, qty_received, qty_remaining, unit_cost, received_at, created_by)
      values
        (v_item_id, v_row.id, null, v_row.in_stock, v_row.in_stock, v_row.price, p_as_of::timestamptz, auth.uid());
    end if;
  end loop;

  v_cost_dollars := (v_total_cents::numeric) / 100.0;

  if not p_dry_run and v_already_je is null and v_total_cents > 0 then
    insert into accounting.journal_entries (entry_date, memo, source_type, status, created_by)
    values (p_as_of, 'Opening inventory balance', 'opening_balance', 'draft', auth.uid())
    returning id into v_entry_id;

    insert into accounting.journal_lines (journal_entry_id, account_id, debit, credit, line_memo, sort_order)
    values (v_entry_id, v_inv_acct, v_cost_dollars, 0, 'Opening inventory', 0);
    insert into accounting.journal_lines (journal_entry_id, account_id, debit, credit, line_memo, sort_order)
    values (v_entry_id, v_obe_acct, 0, v_cost_dollars, 'Opening balance equity', 1);

    perform accounting.post_journal_entry(v_entry_id);
  end if;

  return jsonb_build_object(
    'as_of', p_as_of, 'dry_run', p_dry_run, 'already_seeded', v_already_je is not null,
    'posted', (not p_dry_run and v_already_je is null and v_total_cents > 0),
    'journal_entry_id', v_entry_id, 'total_qty', v_total_qty, 'total_value', v_cost_dollars,
    'item_count', v_item_count, 'preview', v_preview, 'exceptions', v_exceptions);
end;
$$;

create or replace view accounting.v_inventory_reconciliation with (security_invoker = true) as
with val as (
  select v.source_inventory_id, v.qty_on_hand, v.asset_value, v.avg_unit_cost, v.item_id
    from accounting.v_inventory_valuation v
),
pending as (
  select r.source_inventory_id, sum(r.delta_amount) as pending_reval_amount, count(*) as pending_reval_count
    from accounting.inventory_revaluations r
   where r.status = 'pending'
   group by r.source_inventory_id
),
op as (
  select i.id as source_inventory_id, i.name, i.in_stock, i.price, i.unit, i.vendor
    from public.inventory i
)
select coalesce(op.source_inventory_id, val.source_inventory_id) as source_inventory_id,
       op.name as inventory_name, op.unit, op.vendor,
       coalesce(op.in_stock, 0) as in_stock,
       op.price as unit_price,
       round(coalesce(op.in_stock, 0) * coalesce(op.price, 0), 2) as op_value,
       coalesce(val.qty_on_hand, 0) as qty_on_hand,
       coalesce(val.asset_value, 0) as asset_value,
       coalesce(val.avg_unit_cost, 0) as avg_unit_cost,
       coalesce(op.in_stock, 0) - coalesce(val.qty_on_hand, 0) as qty_variance,
       round(coalesce(op.in_stock, 0) * coalesce(op.price, 0), 2) - coalesce(val.asset_value, 0) as value_variance,
       coalesce(pending.pending_reval_amount, 0) as pending_reval_amount,
       coalesce(pending.pending_reval_count, 0) as pending_reval_count,
       (val.source_inventory_id is null) as uncosted,
       (op.price is null) as null_price,
       (coalesce(op.in_stock, 0) < 0) as negative_stock,
       (coalesce(op.in_stock, 0) <> coalesce(val.qty_on_hand, 0)) as qty_mismatch
  from op
  full outer join val on val.source_inventory_id = op.source_inventory_id
  left join pending on pending.source_inventory_id = coalesce(op.source_inventory_id, val.source_inventory_id);

create or replace view accounting.v_inventory_reconciliation_header with (security_invoker = true) as
with inv_acct as (
  select (setting_value ->> 'inventory_asset')::uuid as id
    from accounting.settings where setting_key = 'default_accounts'
),
gl as (
  select coalesce(sum(jl.debit) - sum(jl.credit), 0) as bal
    from accounting.journal_lines jl
    join accounting.journal_entries je on je.id = jl.journal_entry_id
   where je.status = 'posted' and jl.account_id = (select id from inv_acct)
)
select
  coalesce((select sum(asset_value) from accounting.v_inventory_reconciliation), 0) as total_asset_value,
  coalesce((select sum(op_value) from accounting.v_inventory_reconciliation), 0) as total_op_value,
  coalesce((select sum(pending_reval_amount) from accounting.v_inventory_reconciliation), 0) as total_pending_reval,
  (select bal from gl) as gl_1300_balance,
  coalesce((select sum(asset_value) from accounting.v_inventory_reconciliation), 0) - (select bal from gl) as asset_value_vs_gl_variance;

grant select on accounting.v_inventory_reconciliation, accounting.v_inventory_reconciliation_header to authenticated, service_role;

create or replace function accounting.receive_inventory_layer(p_bill_line_id uuid)
returns uuid
language plpgsql
security definer
set search_path = accounting, public, pg_catalog
as $$
declare
  v_existing uuid;
  v_item_id uuid;
  v_src_inv uuid;
  v_qty numeric(14,4);
  v_unit_cost numeric(14,4);
  v_received_at timestamptz;
  v_layer_id uuid;
  v_current_price numeric;
begin
  if not accounting.can_write() then
    raise exception 'insufficient privileges to receive inventory layers'
      using errcode = 'insufficient_privilege';
  end if;

  select id into v_existing from accounting.inventory_layers where bill_line_id = p_bill_line_id;
  if found then
    return v_existing;
  end if;

  select bl.item_id, bl.source_inventory_id, bl.quantity, bl.unit_cost, coalesce(b.bill_date::timestamptz, now())
    into v_item_id, v_src_inv, v_qty, v_unit_cost, v_received_at
    from accounting.bill_lines bl
    join accounting.bills b on b.id = bl.bill_id
   where bl.id = p_bill_line_id;

  if not found then
    raise exception 'bill line % not found', p_bill_line_id using errcode = 'no_data_found';
  end if;

  if v_qty is null or v_qty <= 0 then
    raise exception 'bill line % has non-positive quantity (%); cannot create a FIFO layer', p_bill_line_id, v_qty using errcode = 'check_violation';
  end if;
  if v_src_inv is null then
    raise exception 'bill line % has no source_inventory_id; it is not an inventory receipt', p_bill_line_id using errcode = 'check_violation';
  end if;

  insert into accounting.inventory_layers
    (item_id, source_inventory_id, bill_line_id, qty_received, qty_remaining, unit_cost, received_at, created_by)
  values
    (v_item_id, v_src_inv, p_bill_line_id, v_qty, v_qty, coalesce(v_unit_cost, 0), v_received_at, auth.uid())
  returning id into v_layer_id;

  select price into v_current_price from public.inventory where id = v_src_inv;
  if coalesce(v_unit_cost, 0) is distinct from v_current_price then
    perform set_config('app.price_change_source', 'bill', true);
    perform set_config('app.price_change_reason', 'Bill receipt unit cost (bill line ' || p_bill_line_id::text || ')', true);
    update public.inventory set price = coalesce(v_unit_cost, 0) where id = v_src_inv;
    perform set_config('app.price_change_source', '', true);
    perform set_config('app.price_change_reason', '', true);
  end if;

  return v_layer_id;
end;
$$;

grant select, insert, update, delete on all tables in schema accounting to authenticated, service_role;
grant usage, select on all sequences in schema accounting to authenticated, service_role;
grant execute on all functions in schema accounting to authenticated, service_role;

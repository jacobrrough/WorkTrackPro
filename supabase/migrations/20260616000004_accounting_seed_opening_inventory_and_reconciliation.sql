-- WorkTrackAccounting — Inventory↔Accounting Reconciliation 4/4: seeder + reconciliation views
--
-- Three pieces, all additive:
--   1) accounting.seed_opening_inventory_layers(p_as_of date, p_dry_run boolean default true)
--      — seeds opening FIFO cost layers + ONE balanced opening JE so GL 1300 ties to real
--        on-hand stock. Dry-run by default: returns totals + per-item preview + EXCEPTIONS
--        without writing.
--   2) accounting.v_inventory_reconciliation (+ _header) — per-item operational↔accounting
--      variance view, plus the GL-1300 header tie.
--   3) AUGMENT accounting.receive_inventory_layer — Q2 ("Update + log"): a posted bill line at
--      a unit cost ≠ the stored Price Per Unit overwrites public.inventory.price (source='bill')
--      via the price-history trigger, in the same transaction as the layer insert.
--
-- DOUBLE-ENTRY (G3)
--   Opening seed posts ONE balanced entry via accounting.post_journal_entry (accounts RESOLVED
--   via accounting.settings.default_accounts KEYS — chart-agnostic; prod runs the imported chart):
--       Dr Inventory Asset            = Σ(in_stock × price) over seeded items
--       Cr Opening Balance Equity     = same total
--   source_type='opening_balance' (already in the GL enum — no enum change). Dry-run posts
--   nothing. The bill-cost overwrite posts NO new JE here (value-only; the Inventory-Asset debit
--   was already booked when the bill posted — A2 Dr Inventory Asset / Cr A/P — so no double count).
--
-- MONEY MATH (G6): the opening total is accumulated in INTEGER CENTS
--   (round(in_stock × price × 100)) and divided back to dollars once for the JE lines.
--
-- IDEMPOTENCY (double-guarded so seed never double-counts)
--   • Per item: seeds only stock that has NO existing inventory_layers row at all (an opening
--     layer or a bill layer both count as "already costed").
--   • Whole run: if an opening JE (source_type='opening_balance' whose lines hit the Inventory Asset account) already
--     exists, the seeder reports it and posts nothing more.
--   • CREATE OR REPLACE everywhere → safely re-runnable.
--
-- ROLLBACK:
--   -- restore receive_inventory_layer to its pre-augment body (migration 20260603164636), then:
--   DROP VIEW     IF EXISTS accounting.v_inventory_reconciliation_header;
--   DROP VIEW     IF EXISTS accounting.v_inventory_reconciliation;
--   DROP FUNCTION IF EXISTS accounting.seed_opening_inventory_layers(date, boolean);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1) Opening-balance seeder
-- ═══════════════════════════════════════════════════════════════════════════════
-- Returns a JSON object:
--   { as_of, dry_run, posted, journal_entry_id, already_seeded,
--     total_qty, total_value, item_count,
--     preview:    [ { source_inventory_id, name, in_stock, unit_cost, extended } ... ],
--     exceptions: [ { source_inventory_id, name, in_stock, price, reason } ... ] }
-- Eligible: in_stock > 0 AND price IS NOT NULL AND no existing inventory_layers row.
-- Exceptions (reported, never seeded): null price, in_stock <= 0 (for rows not already costed).
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
  v_inv_asset_acct_id uuid;  -- the asset-account id to stamp on newly-created items
begin
  if not accounting.can_write() then
    raise exception 'insufficient privileges to seed opening inventory'
      using errcode = 'insufficient_privilege';
  end if;

  -- Resolve posting accounts (Inventory Asset / Opening Balance Equity keys).
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

  -- Whole-run idempotency guard: any existing posted opening-balance JE that debited the
  -- RESOLVED Inventory Asset account (by id from settings — NOT a hardcoded number; prod's
  -- Inventory Asset is null-numbered in the imported chart).
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

  -- ── Exceptions: rows that look like they SHOULD be seedable but cannot be ──
  -- (null price, or non-positive stock) AND are not already costed by a layer.
  for v_row in
    select i.id, i.name, i.in_stock, i.price
      from public.inventory i
     where not exists (
             select 1 from accounting.inventory_layers l where l.source_inventory_id = i.id
           )
       and (
             i.price is null
          or coalesce(i.in_stock, 0) <= 0
           )
  loop
    v_exceptions := v_exceptions || jsonb_build_object(
      'source_inventory_id', v_row.id,
      'name', v_row.name,
      'in_stock', v_row.in_stock,
      'price', v_row.price,
      'reason', case
                  when v_row.price is null then 'null_price'
                  when coalesce(v_row.in_stock, 0) <= 0 then 'non_positive_stock'
                  else 'unknown'
                end
    );
  end loop;

  -- ── Eligible rows: in_stock > 0, price not null, no existing layer ──
  for v_row in
    select i.id, i.name, i.in_stock, i.price, i.unit, i.vendor, i.description
      from public.inventory i
     where coalesce(i.in_stock, 0) > 0
       and i.price is not null
       and not exists (
             select 1 from accounting.inventory_layers l where l.source_inventory_id = i.id
           )
     order by i.name
  loop
    v_item_count := v_item_count + 1;
    v_total_qty := v_total_qty + v_row.in_stock;
    v_total_cents := v_total_cents + round(v_row.in_stock * v_row.price * 100)::bigint;

    v_preview := v_preview || jsonb_build_object(
      'source_inventory_id', v_row.id,
      'name', v_row.name,
      'in_stock', v_row.in_stock,
      'unit_cost', v_row.price,
      'extended', round(v_row.in_stock * v_row.price, 2)
    );

    -- WRITE PATH (only when not a dry run AND no prior opening JE blocks us).
    if not p_dry_run and v_already_je is null then
      -- Create or map the accounting item for this stock row (carry vendor/unit/description).
      select id into v_item_id
        from accounting.items
       where source_inventory_id = v_row.id
       order by created_at
       limit 1;

      if v_item_id is null then
        insert into accounting.items
          (name, item_type, inventory_asset_account_id, purchase_cost, source_inventory_id,
           sku, is_active, created_by)
        values
          (v_row.name, 'inventory', v_inv_asset_acct_id, v_row.price, v_row.id,
           nullif(v_row.unit, ''), true, auth.uid())
        returning id into v_item_id;
      else
        -- Keep the item's purchase_cost aligned to the opening cost (value sync).
        update accounting.items
           set purchase_cost = v_row.price,
               inventory_asset_account_id = coalesce(inventory_asset_account_id, v_inv_asset_acct_id)
         where id = v_item_id
           and purchase_cost is distinct from v_row.price;
      end if;

      -- Seed the opening FIFO layer (qty_received = qty_remaining = in_stock, unit_cost = price).
      insert into accounting.inventory_layers
        (item_id, source_inventory_id, bill_line_id, qty_received, qty_remaining, unit_cost,
         received_at, created_by)
      values
        (v_item_id, v_row.id, null, v_row.in_stock, v_row.in_stock, v_row.price,
         p_as_of::timestamptz, auth.uid());
    end if;
  end loop;

  v_cost_dollars := (v_total_cents::numeric) / 100.0;

  -- ── Post ONE balanced opening JE (only when writing, have value, and no prior opening JE) ──
  if not p_dry_run and v_already_je is null and v_total_cents > 0 then
    insert into accounting.journal_entries (entry_date, memo, source_type, status, created_by)
    values (p_as_of, 'Opening inventory balance', 'opening_balance', 'draft', auth.uid())
    returning id into v_entry_id;

    -- Dr Inventory Asset
    insert into accounting.journal_lines (journal_entry_id, account_id, debit, credit, line_memo, sort_order)
    values (v_entry_id, v_inv_acct, v_cost_dollars, 0, 'Opening inventory', 0);
    -- Cr Opening Balance Equity
    insert into accounting.journal_lines (journal_entry_id, account_id, debit, credit, line_memo, sort_order)
    values (v_entry_id, v_obe_acct, 0, v_cost_dollars, 'Opening balance equity', 1);

    perform accounting.post_journal_entry(v_entry_id);
  end if;

  return jsonb_build_object(
    'as_of', p_as_of,
    'dry_run', p_dry_run,
    'already_seeded', v_already_je is not null,
    'posted', (not p_dry_run and v_already_je is null and v_total_cents > 0),
    'journal_entry_id', v_entry_id,
    'total_qty', v_total_qty,
    'total_value', v_cost_dollars,
    'item_count', v_item_count,
    'preview', v_preview,
    'exceptions', v_exceptions
  );
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2) Reconciliation views (security_invoker — caller RLS applies)
-- ═══════════════════════════════════════════════════════════════════════════════
-- Per source_inventory_id: operational (in_stock, price, op_value) vs accounting valuation
-- (qty_on_hand, asset_value, avg_unit_cost) with variances, the open pending-reval amount, and
-- exception flags. FULL OUTER JOIN so stock with no layer (uncosted) and orphan layers both show.
create or replace view accounting.v_inventory_reconciliation with (security_invoker = true) as
with val as (
  select v.source_inventory_id,
         v.qty_on_hand,
         v.asset_value,
         v.avg_unit_cost,
         v.item_id
    from accounting.v_inventory_valuation v
),
pending as (
  select r.source_inventory_id,
         sum(r.delta_amount) as pending_reval_amount,
         count(*)            as pending_reval_count
    from accounting.inventory_revaluations r
   where r.status = 'pending'
   group by r.source_inventory_id
),
op as (
  select i.id as source_inventory_id,
         i.name,
         i.in_stock,
         i.price,
         i.unit,
         i.vendor
    from public.inventory i
)
select coalesce(op.source_inventory_id, val.source_inventory_id) as source_inventory_id,
       op.name                                          as inventory_name,
       op.unit,
       op.vendor,
       coalesce(op.in_stock, 0)                         as in_stock,
       op.price                                         as unit_price,
       -- operational value = in_stock × price (per VERIFIED FACT, price IS the unit cost).
       round(coalesce(op.in_stock, 0) * coalesce(op.price, 0), 2) as op_value,
       coalesce(val.qty_on_hand, 0)                     as qty_on_hand,
       coalesce(val.asset_value, 0)                     as asset_value,
       coalesce(val.avg_unit_cost, 0)                   as avg_unit_cost,
       -- qty variance = operational on-hand − accounting (FIFO) on-hand.
       coalesce(op.in_stock, 0) - coalesce(val.qty_on_hand, 0)        as qty_variance,
       -- value variance = operational value − accounting asset value.
       round(coalesce(op.in_stock, 0) * coalesce(op.price, 0), 2)
         - coalesce(val.asset_value, 0)                              as value_variance,
       coalesce(pending.pending_reval_amount, 0)        as pending_reval_amount,
       coalesce(pending.pending_reval_count, 0)         as pending_reval_count,
       -- flags
       (val.source_inventory_id is null)                as uncosted,        -- no FIFO layer exists
       (op.price is null)                               as null_price,
       (coalesce(op.in_stock, 0) < 0)                   as negative_stock,
       (coalesce(op.in_stock, 0) <> coalesce(val.qty_on_hand, 0)) as qty_mismatch
  from op
  full outer join val     on val.source_inventory_id = op.source_inventory_id
  left join pending on pending.source_inventory_id = coalesce(op.source_inventory_id, val.source_inventory_id);

-- Header tie: Σ accounting asset value vs the LIVE GL Inventory-Asset balance + Σ operational
-- value + Σ pending reval. One row. The GL balance is computed from POSTED journal lines on the
-- Inventory Asset account RESOLVED VIA the default_accounts settings KEY (by id) — NOT a hardcoded
-- number — because prod runs the imported chart (Inventory Asset is null-numbered; there is no 1300).
-- Column name kept as gl_1300_balance to preserve the API/UI contract: it IS the inventory-asset GL balance.
create or replace view accounting.v_inventory_reconciliation_header with (security_invoker = true) as
with inv_acct as (
  select (setting_value ->> 'inventory_asset')::uuid as id
    from accounting.settings
   where setting_key = 'default_accounts'
),
gl as (
  select coalesce(sum(jl.debit) - sum(jl.credit), 0) as bal
    from accounting.journal_lines jl
    join accounting.journal_entries je on je.id = jl.journal_entry_id
   where je.status = 'posted'
     and jl.account_id = (select id from inv_acct)
)
select
  coalesce((select sum(asset_value)          from accounting.v_inventory_reconciliation), 0) as total_asset_value,
  coalesce((select sum(op_value)             from accounting.v_inventory_reconciliation), 0) as total_op_value,
  coalesce((select sum(pending_reval_amount) from accounting.v_inventory_reconciliation), 0) as total_pending_reval,
  (select bal from gl)                                                                       as gl_1300_balance,
  coalesce((select sum(asset_value) from accounting.v_inventory_reconciliation), 0)
    - (select bal from gl)                                                                   as asset_value_vs_gl_variance;

grant select on accounting.v_inventory_reconciliation, accounting.v_inventory_reconciliation_header
  to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3) AUGMENT receive_inventory_layer — bill-cost → operational price (Q2 "Update + log")
-- ═══════════════════════════════════════════════════════════════════════════════
-- Same contract + body as migration 20260603164636 (idempotent layer seed, no JE), PLUS: after
-- the layer is created, if the bill's unit cost differs from the stored public.inventory.price,
-- overwrite the operational price (labeled source='bill' via the GUC) so the price-history
-- trigger logs it, syncs accounting.items.purchase_cost, and enqueues a pending revaluation.
-- This is the single DB chokepoint every received layer flows through, so the cost stays a
-- single number kept in sync both directions (decision 3) for ALL bill-post UI paths.
--
-- WRITE-TO-public NOTE (G1): the only mutation of public.inventory is `update ... set price`
-- (additive value sync, the user-authorized cost seam). No public column/table is altered.
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

  -- Idempotent: a layer already exists for this bill line → return it unchanged.
  select id into v_existing
    from accounting.inventory_layers
   where bill_line_id = p_bill_line_id;
  if found then
    return v_existing;
  end if;

  -- Pull cost basis + crosswalk from the bill line, with the bill's date as received_at.
  select bl.item_id,
         bl.source_inventory_id,
         bl.quantity,
         bl.unit_cost,
         coalesce(b.bill_date::timestamptz, now())
    into v_item_id, v_src_inv, v_qty, v_unit_cost, v_received_at
    from accounting.bill_lines bl
    join accounting.bills b on b.id = bl.bill_id
   where bl.id = p_bill_line_id;

  if not found then
    raise exception 'bill line % not found', p_bill_line_id using errcode = 'no_data_found';
  end if;

  -- A FIFO layer needs a positive quantity AND a stock crosswalk to be consumable.
  if v_qty is null or v_qty <= 0 then
    raise exception 'bill line % has non-positive quantity (%); cannot create a FIFO layer',
      p_bill_line_id, v_qty using errcode = 'check_violation';
  end if;
  if v_src_inv is null then
    raise exception 'bill line % has no source_inventory_id; it is not an inventory receipt',
      p_bill_line_id using errcode = 'check_violation';
  end if;

  insert into accounting.inventory_layers
    (item_id, source_inventory_id, bill_line_id, qty_received, qty_remaining, unit_cost, received_at, created_by)
  values
    (v_item_id, v_src_inv, p_bill_line_id, v_qty, v_qty, coalesce(v_unit_cost, 0), v_received_at, auth.uid())
  returning id into v_layer_id;

  -- ── Q2: bill unit cost ≠ stored Price Per Unit → UPDATE the operational price + LOG it ──
  -- The price-history trigger (migration 20260616000003) records source='bill', syncs the
  -- item purchase_cost, and enqueues a gated revaluation. Distinct-from is null-safe; we only
  -- write when the cost actually differs so the trigger's WHEN guard isn't tripped needlessly.
  select price into v_current_price from public.inventory where id = v_src_inv;
  if coalesce(v_unit_cost, 0) is distinct from v_current_price then
    perform set_config('app.price_change_source', 'bill', true);
    perform set_config('app.price_change_reason',
                       'Bill receipt unit cost (bill line ' || p_bill_line_id::text || ')', true);
    update public.inventory
       set price = coalesce(v_unit_cost, 0)
     where id = v_src_inv;
    -- Reset the GUC so the label cannot leak to a later statement in this session.
    perform set_config('app.price_change_source', '', true);
    perform set_config('app.price_change_reason', '', true);
  end if;

  return v_layer_id;
end;
$$;

-- Belt-and-suspenders explicit grants.
grant select, insert, update, delete on all tables in schema accounting to authenticated, service_role;
grant usage, select on all sequences in schema accounting to authenticated, service_role;
grant execute on all functions in schema accounting to authenticated, service_role;

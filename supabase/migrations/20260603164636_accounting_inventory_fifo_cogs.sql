-- WorkTrackAccounting — B3: inventory valuation (FIFO) → COGS postings
--
-- Bridges the EXISTING public job-consumption moment to double-entry COGS, additively.
--
-- WHY THIS SHAPE
--   public.inventory has NO cost column (only `price`, the SELL price), so a FIFO COST
--   basis cannot come from public.*. It is captured on the accounting side when stock is
--   received via a bill: accounting.bill_lines.unit_cost. This migration therefore:
--     1) accounting.inventory_layers  — one open FIFO cost layer per received bill line
--        (qty_received, qty_remaining, unit_cost), keyed back to public.inventory by the
--        crosswalk source_inventory_id and to its cost origin by bill_line_id.
--     2) accounting.inventory_cogs_events — one immutable row per FIFO consumption posting,
--        pointing at the balanced COGS journal entry it produced.
--
-- READ-ONLY BRIDGE TO public.* (G1/G4)
--   We NEVER add a trigger to public.jobs / public.job_inventory / public.inventory and we
--   NEVER write them. The existing trigger public.jobs_reconcile_inventory_on_status()
--   (migration 20260509000003) is the authoritative stock-consumption moment: it sets
--   public.jobs.consumed_at and deducts public.inventory.in_stock for each
--   public.job_inventory line. COGS posting is APP-INITIATED: accounting.consume_job_cogs()
--   READS that moment (consumed_at + job_inventory lines) read-only and posts. This mirrors
--   the established B2 recurring pattern (the table never posts; the app's action posts
--   through post_journal_entry).
--
-- DOUBLE-ENTRY (G3)
--   On consumption the app posts ONE balanced entry via accounting.post_journal_entry:
--       Dr 5000 Cost of Goods Sold   = FIFO-consumed cost
--       Cr 1300 Inventory Asset      = FIFO-consumed cost
--   Equal by construction (a single FIFO-cost figure on both sides); the GL guard +
--   deferred balance trigger are the final gates. NO new JE is posted on RECEIVE — the
--   1300 debit was already booked when the bill posted (A2: Dr 1300 / Cr 2000). Receiving
--   only records the cost LAYER for later depletion (no double-count: asset in at bill,
--   asset → COGS out at consumption).
--
-- MONEY MATH (G6)
--   DB columns are numeric(14,2)/(14,4). FIFO cost is accumulated in INTEGER CENTS inside
--   the RPC (round(qty * unit_cost * 100)) and divided back to dollars once for the JE
--   lines, so no float drift accumulates across layers.
--
-- IDEMPOTENCY / IMMUTABILITY
--   • receive_inventory_layer is a no-op if a layer already exists for that bill_line_id.
--   • consume_job_cogs records ONE inventory_cogs_event per consumed stock item (so the
--     valuation view's per-item COGS is exact) and is a no-op if events already exist for
--     the job (partial unique index on (job_id, source_inventory_id)), matching the spirit
--     of public.jobs.consumed_at's once-only sentinel. Posted COGS entries are immutable
--     (void/reverse only).
--   • CREATE TABLE IF NOT EXISTS + guarded index creation + CREATE OR REPLACE FUNCTION +
--     idempotent _apply_standard_table make the whole migration safely re-runnable.
--
-- RLS / AUDIT
--   Both tables wired with accounting._apply_standard_table (read=can_read, write=can_write,
--   audit + touch_updated_at). All cross-schema FKs (public.inventory, public.jobs) live on
--   the accounting child side only.
--
-- ROLLBACK:
--   DROP VIEW     IF EXISTS accounting.v_inventory_valuation;
--   DROP FUNCTION IF EXISTS accounting.consume_job_cogs(uuid);
--   DROP FUNCTION IF EXISTS accounting.receive_inventory_layer(uuid);
--   DROP TABLE    IF EXISTS accounting.inventory_cogs_events CASCADE;
--   DROP TABLE    IF EXISTS accounting.inventory_layers CASCADE;

-- ── Tables ───────────────────────────────────────────────────────────────────

-- Open FIFO cost layers. One row per received bill line (the cost origin). FIFO
-- depletion decrements qty_remaining oldest-received-first.
create table if not exists accounting.inventory_layers (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references accounting.items(id) on delete set null,
  -- read-only crosswalk to core stock; the FIFO match key against job_inventory lines.
  source_inventory_id uuid references public.inventory(id) on delete set null,
  -- cost origin: the posted inventory bill line whose unit_cost seeds this layer.
  bill_line_id uuid references accounting.bill_lines(id) on delete set null,
  qty_received numeric(14,4) not null check (qty_received > 0),
  qty_remaining numeric(14,4) not null,
  unit_cost numeric(14,4) not null default 0 check (unit_cost >= 0),
  received_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- qty_remaining is bounded: never negative, never more than was received.
  constraint inventory_layers_remaining_bounds
    check (qty_remaining >= 0 and qty_remaining <= qty_received)
);

-- One immutable row per FIFO consumption posting (audit of what COGS was booked).
create table if not exists accounting.inventory_cogs_events (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references accounting.items(id) on delete set null,
  -- the balanced COGS journal entry this consumption produced. restrict: an event must
  -- not be orphaned from its ledger proof.
  journal_entry_id uuid not null references accounting.journal_entries(id) on delete restrict,
  qty numeric(14,4) not null check (qty > 0),
  cost numeric(14,2) not null check (cost >= 0), -- extended COGS in dollars (cents-derived)
  consumed_at timestamptz not null default now(),
  -- read-only reporting links to the core job-consumption moment.
  job_id uuid references public.jobs(id) on delete set null,
  source_inventory_id uuid references public.inventory(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

do $$
begin
  -- FIFO ordering / open-layer lookups.
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_inv_layers_src_recv') then
    create index idx_acct_inv_layers_src_recv
      on accounting.inventory_layers(source_inventory_id, received_at);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_inv_layers_item_recv') then
    create index idx_acct_inv_layers_item_recv
      on accounting.inventory_layers(item_id, received_at);
  end if;
  -- only-open layers (the hot path for FIFO depletion + valuation).
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_inv_layers_open') then
    create index idx_acct_inv_layers_open
      on accounting.inventory_layers(source_inventory_id, received_at)
      where qty_remaining > 0;
  end if;
  -- one layer per bill line (idempotent receive). UNIQUE so a re-run cannot double-seed.
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='uq_acct_inv_layers_bill_line') then
    create unique index uq_acct_inv_layers_bill_line
      on accounting.inventory_layers(bill_line_id)
      where bill_line_id is not null;
  end if;

  -- COGS-event lookups by job (work-list joins) and by JE (drill-through).
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_cogs_events_job') then
    create index idx_acct_cogs_events_job on accounting.inventory_cogs_events(job_id);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_cogs_events_je') then
    create index idx_acct_cogs_events_je on accounting.inventory_cogs_events(journal_entry_id);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_cogs_events_item') then
    create index idx_acct_cogs_events_item on accounting.inventory_cogs_events(item_id);
  end if;
  -- IDEMPOTENCY GUARD: at most one COGS event per (job, stock item). consume_job_cogs
  -- emits one event row per consumed inventory line (so per-item COGS is exact in the
  -- valuation view), all sharing the same journal entry. A second consume_job_cogs(job)
  -- attempt cannot double-post COGS for the same consumption moment because every
  -- (job_id, source_inventory_id) pair it would re-insert already exists.
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='uq_acct_cogs_events_job') then
    create unique index uq_acct_cogs_events_job
      on accounting.inventory_cogs_events(job_id, source_inventory_id)
      where job_id is not null;
  end if;
end $$;

-- RLS + audit + touch_updated_at via the standard helper.
-- inventory_cogs_events has no updated_at (append-only) → second arg false.
select accounting._apply_standard_table('inventory_layers');
select accounting._apply_standard_table('inventory_cogs_events', false);

-- ── RPC: receive a FIFO cost layer from a posted inventory bill line ──────────
-- Idempotent. Resolves item / source_inventory / unit_cost / qty from the bill line.
-- Creating the layer is the ONLY thing this does — no journal entry is posted here
-- (the inventory-asset debit was already booked when the bill posted).
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

  return v_layer_id;
end;
$$;

-- ── RPC: post FIFO COGS for a consumed job (the heart of B3) ──────────────────
-- Reads the EXISTING public job-consumption moment READ-ONLY, FIFO-depletes open cost
-- layers, posts ONE balanced JE (Dr 5000 / Cr 1300) through post_journal_entry, and
-- records ONE inventory_cogs_events row PER consumed stock item (so per-item COGS is
-- exact in the valuation view), all sharing the posted JE. Idempotent (no-op if events
-- already exist for the job). Returns the posted journal_entry_id, or NULL when there is
-- no cost to post.
create or replace function accounting.consume_job_cogs(p_job_id uuid)
returns uuid
language plpgsql
security definer
set search_path = accounting, public, pg_catalog
as $$
declare
  v_consumed_at timestamptz;
  v_job_code text;
  v_cogs_acct uuid;
  v_inv_acct uuid;
  v_existing uuid;

  v_line record;          -- one public.job_inventory consumption line
  v_layer record;         -- one open accounting.inventory_layers row (locked)
  v_need numeric(14,4);   -- remaining qty to satisfy for the current line
  v_take numeric(14,4);   -- qty drawn from the current layer

  -- Per-line results, collected for one-event-per-stock-item recording after the JE posts.
  v_src_invs uuid[]    := array[]::uuid[];   -- source_inventory_id per costed line
  v_items    uuid[]    := array[]::uuid[];   -- representative item_id per costed line
  v_qtys     numeric[] := array[]::numeric[];-- qty actually costed per line
  v_cents    bigint[]  := array[]::bigint[]; -- extended cost in cents per line

  v_line_cents bigint;              -- per-line FIFO cost in cents
  v_line_qty numeric(14,4);         -- per-line qty actually costed
  v_line_item uuid;                 -- representative item for the current line
  v_total_cents bigint := 0;        -- whole-job FIFO cost, accumulated in integer cents
  v_cost_dollars numeric(14,2);
  v_entry_id uuid;
  i int;
begin
  if not accounting.can_write() then
    raise exception 'insufficient privileges to post job COGS'
      using errcode = 'insufficient_privilege';
  end if;

  -- Idempotency: a COGS event already exists for this job → return its entry, no re-post.
  select journal_entry_id into v_existing
    from accounting.inventory_cogs_events
   where job_id = p_job_id
   limit 1;
  if found then
    return v_existing;
  end if;

  -- READ-ONLY: confirm the core trigger has actually consumed this job's stock.
  select consumed_at, job_code into v_consumed_at, v_job_code
    from public.jobs where id = p_job_id;
  if not found then
    raise exception 'job % not found', p_job_id using errcode = 'no_data_found';
  end if;
  if v_consumed_at is null then
    raise exception 'job % has not consumed inventory yet (consumed_at is null)', p_job_id
      using errcode = 'check_violation';
  end if;

  -- Resolve posting accounts from module settings (5000 COGS / 1300 Inventory Asset).
  select (setting_value ->> 'cogs')::uuid,
         (setting_value ->> 'inventory_asset')::uuid
    into v_cogs_acct, v_inv_acct
    from accounting.settings
   where setting_key = 'default_accounts';
  if v_cogs_acct is null or v_inv_acct is null then
    raise exception 'default COGS/Inventory-Asset accounts are not configured in accounting.settings'
      using errcode = 'check_violation';
  end if;

  -- Walk each consumed line and FIFO-deplete matching open layers.
  -- Deterministic inventory_id order mirrors the core trigger (deadlock-safe).
  for v_line in
    select ji.inventory_id, ji.quantity
      from public.job_inventory ji
     where ji.job_id = p_job_id
       and ji.quantity is not null
       and ji.quantity > 0
     order by ji.inventory_id
  loop
    v_need := v_line.quantity;
    v_line_cents := 0;
    v_line_item := null;

    -- Oldest-received-first open layers for this stock item, locked so concurrent
    -- consumption cannot double-spend the same remaining qty.
    for v_layer in
      select id, item_id, qty_remaining, unit_cost
        from accounting.inventory_layers
       where source_inventory_id = v_line.inventory_id
         and qty_remaining > 0
       order by received_at asc, created_at asc
       for update
    loop
      exit when v_need <= 0;

      v_take := least(v_need, v_layer.qty_remaining);

      -- Cost in integer cents (G6): no float drift across layers.
      v_line_cents := v_line_cents + round(v_take * v_layer.unit_cost * 100)::bigint;

      update accounting.inventory_layers
         set qty_remaining = qty_remaining - v_take
       where id = v_layer.id;

      if v_line_item is null then
        v_line_item := v_layer.item_id;
      end if;

      v_need := v_need - v_take;
    end loop;

    -- Qty we COULD cost from open layers (v_line.quantity minus any shortfall).
    -- v_need > 0 here means an uncosted shortfall (no open layer / legacy stock with no
    -- bill): we cost only the covered qty; the shortfall books no phantom cost. The API
    -- work-list surfaces such jobs as "uncosted" so a user can add an opening-cost layer.
    v_line_qty := v_line.quantity - greatest(v_need, 0);

    -- Only record lines that actually drew cost (skip pure-shortfall / zero-cost lines).
    if v_line_cents > 0 then
      v_src_invs := v_src_invs || v_line.inventory_id;
      v_items    := v_items    || v_line_item;
      v_qtys     := v_qtys     || v_line_qty;
      v_cents    := v_cents    || v_line_cents;
      v_total_cents := v_total_cents + v_line_cents;
    end if;
  end loop;

  -- Nothing costable (no open layers / zero-cost) → post nothing, record nothing.
  -- Returning NULL keeps the action idempotent and avoids a degenerate 0/0 entry.
  if v_total_cents <= 0 then
    return null;
  end if;

  v_cost_dollars := (v_total_cents::numeric) / 100.0;

  -- Build a DRAFT balanced entry, then post it through the permission-checked RPC.
  insert into accounting.journal_entries (entry_date, memo, source_type, source_id, status, created_by)
  values (
    current_date,
    'COGS — Job ' || coalesce(v_job_code, p_job_id::text),
    'adjustment',           -- allowed by the GL source_type enum (no enum change needed)
    p_job_id,
    'draft',
    auth.uid()
  )
  returning id into v_entry_id;

  -- Dr 5000 Cost of Goods Sold
  insert into accounting.journal_lines
    (journal_entry_id, account_id, debit, credit, job_id, line_memo, sort_order)
  values
    (v_entry_id, v_cogs_acct, v_cost_dollars, 0, p_job_id, 'FIFO COGS', 0);

  -- Cr 1300 Inventory Asset
  insert into accounting.journal_lines
    (journal_entry_id, account_id, debit, credit, job_id, line_memo, sort_order)
  values
    (v_entry_id, v_inv_acct, 0, v_cost_dollars, p_job_id, 'FIFO inventory relief', 1);

  -- Posts only if balanced with >=2 lines (guard_journal_entry). Balanced by construction.
  perform accounting.post_journal_entry(v_entry_id);

  -- Record one immutable consumption event PER costed stock item, all tied to the JE.
  -- Per-item source_inventory_id makes v_inventory_valuation.cogs_total exact, and the
  -- (job_id, source_inventory_id) unique guard makes a re-consume a no-op.
  for i in 1 .. array_length(v_src_invs, 1) loop
    insert into accounting.inventory_cogs_events
      (item_id, journal_entry_id, qty, cost, consumed_at, job_id, source_inventory_id, created_by)
    values
      (v_items[i], v_entry_id, v_qtys[i], (v_cents[i]::numeric) / 100.0,
       v_consumed_at, p_job_id, v_src_invs[i], auth.uid());
  end loop;

  return v_entry_id;
end;
$$;

-- ── Read-model: inventory valuation (powers the report) ──────────────────────
-- Per item/stock crosswalk: on-hand qty, FIFO asset value (ties to GL 1300), weighted-avg
-- unit cost from OPEN layers, and lifetime COGS booked from inventory_cogs_events.
-- security_invoker so the caller's RLS (accounting.can_read + public read) applies.
create or replace view accounting.v_inventory_valuation with (security_invoker = true) as
with layers as (
  select l.source_inventory_id,
         -- representative item for the row: any item_id from an OPEN layer (uuid has no
         -- max()/min() aggregate, so take the first of an array_agg). Reporting-only.
         (array_agg(l.item_id) filter (where l.qty_remaining > 0 and l.item_id is not null))[1] as item_id,
         sum(l.qty_remaining)                       as qty_on_hand,
         sum(l.qty_remaining * l.unit_cost)         as asset_value,
         sum(l.qty_received)                        as qty_received_total
    from accounting.inventory_layers l
   group by l.source_inventory_id
),
cogs as (
  select e.source_inventory_id,
         sum(e.cost) as cogs_total,
         sum(e.qty)  as qty_consumed_total
    from accounting.inventory_cogs_events e
   group by e.source_inventory_id
)
select coalesce(la.source_inventory_id, co.source_inventory_id) as source_inventory_id,
       inv.name                                                 as inventory_name,
       la.item_id,
       coalesce(la.qty_on_hand, 0)        as qty_on_hand,
       coalesce(la.asset_value, 0)        as asset_value,
       case
         when coalesce(la.qty_on_hand, 0) > 0
           then round(la.asset_value / la.qty_on_hand, 4)
         else 0
       end                                as avg_unit_cost,
       coalesce(la.qty_received_total, 0) as qty_received_total,
       coalesce(co.qty_consumed_total, 0) as qty_consumed_total,
       coalesce(co.cogs_total, 0)         as cogs_total
  from layers la
  full outer join cogs co on co.source_inventory_id = la.source_inventory_id
  left join public.inventory inv
    on inv.id = coalesce(la.source_inventory_id, co.source_inventory_id);

grant select on accounting.v_inventory_valuation to authenticated, service_role;

-- Belt-and-suspenders explicit grants (default privileges already cover new objects).
grant select, insert, update, delete on all tables in schema accounting to authenticated, service_role;
grant usage, select on all sequences in schema accounting to authenticated, service_role;
grant execute on all functions in schema accounting to authenticated, service_role;

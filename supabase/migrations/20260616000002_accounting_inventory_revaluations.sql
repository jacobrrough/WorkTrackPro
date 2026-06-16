-- WorkTrackAccounting — Inventory↔Accounting Reconciliation 2/4: gated revaluation queue
--
-- WHY THIS SHAPE (decision 1, locked → "Gated revaluation")
--   When the per-unit COST of stock ALREADY on hand changes, the cost VALUE must reflect
--   instantly on BOTH sides (public.inventory.price ↔ accounting.items.purchase_cost — done by
--   the price-sync trigger in migration 3), but the JOURNAL ENTRY that moves GL 1300 is NOT
--   auto-posted. Instead a PENDING row lands here, the reconciliation screen shows it, and an
--   accountant posts it in an APPROVED batch. This table is that queue.
--
--   At most ONE open pending reval per stock item: a partial unique index on
--   (source_inventory_id) WHERE status='pending'. Successive cost edits before a post UPDATE
--   the open row's new_cost / on_hand_qty / delta (the trigger in migration 3 does the upsert),
--   so the queue always reflects the LATEST target cost, not a backlog of intermediate edits.
--
-- DOUBLE-ENTRY (G3) — accounting.post_inventory_revaluation(uuid[]):
--   For each still-pending row, Δ = on_hand_qty × (new_cost − old_cost), computed in INTEGER
--   CENTS (G6). The batch posts ONE balanced journal entry via accounting.post_journal_entry:
--       Σ Δ>0 (cost rose)  → Dr Inventory Asset        / Cr Inventory Revaluation
--       Σ Δ<0 (cost fell)  → Dr Inventory Revaluation  / Cr Inventory Asset
--   (both accounts resolved via accounting.settings.default_accounts KEYS — inventory_asset /
--    inventory_revaluation — never by account number; prod runs the imported chart.)
--   Net direction is by the SIGNED cents sum across the batch; the two lines are equal by
--   construction (a single |net| figure on both sides). A row whose Δ rounds to 0 cents (e.g.
--   on_hand_qty = 0) posts no GL movement — it is marked 'posted' with journal_entry_id = NULL
--   (the cost VALUE already synced on the item/operational side; the gated GL move is a no-op).
--   If the WHOLE batch nets to 0 cents, no JE is created and every row is still closed out.
--   After posting, each open FIFO layer for the row's source_inventory_id is re-marked to
--   unit_cost = new_cost so the asset basis matches the revalued cost going forward.
--
-- IDEMPOTENCY / IMMUTABILITY
--   • post_inventory_revaluation skips any id that is not 'pending' (already posted/void), so a
--     re-run cannot double-post. Rows are locked FOR UPDATE while posting.
--   • Posted JEs are immutable (void/reverse only) via the GL guard.
--   • CREATE TABLE IF NOT EXISTS + guarded index creation + CREATE OR REPLACE FUNCTION +
--     idempotent _apply_standard_table make the whole migration safely re-runnable.
--
-- RLS / AUDIT: wired with accounting._apply_standard_table (read=can_read, write=can_write,
--   audit + touch_updated_at). All cross-schema FKs (public.inventory, public.profiles) live on
--   the accounting child side only.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS accounting.post_inventory_revaluation(uuid[]);
--   DROP TABLE    IF EXISTS accounting.inventory_revaluations CASCADE;

-- ── Table ──────────────────────────────────────────────────────────────────────
create table if not exists accounting.inventory_revaluations (
  id uuid primary key default gen_random_uuid(),
  -- read-only crosswalk to core stock (the enqueue key from the price-sync trigger).
  source_inventory_id uuid not null references public.inventory(id) on delete cascade,
  -- the accounting item this stock maps to (reporting / metadata; nullable if unmapped).
  item_id uuid references accounting.items(id) on delete set null,
  old_cost numeric(14,4) not null default 0,
  new_cost numeric(14,4) not null default 0,
  -- on-hand qty SNAPSHOT at enqueue (FIFO qty_on_hand from open layers). Refreshed on each
  -- re-enqueue so delta_amount tracks the current basis, not a stale one.
  on_hand_qty numeric(14,4) not null default 0,
  -- = on_hand_qty × (new_cost − old_cost), cents-derived (G6). Informational/UI; the poster
  -- recomputes from cost+qty in cents at post time (this column is the preview).
  delta_amount numeric(14,2) not null default 0,
  status text not null default 'pending' check (status in ('pending', 'posted', 'void')),
  -- the balanced revaluation JE this row was posted in (NULL for a zero-delta no-op post).
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
  -- Work-list lookups by status (the reconciliation pending panel).
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_inv_reval_status') then
    create index idx_acct_inv_reval_status on accounting.inventory_revaluations(status, enqueued_at desc);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_inv_reval_src') then
    create index idx_acct_inv_reval_src on accounting.inventory_revaluations(source_inventory_id);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_inv_reval_je') then
    create index idx_acct_inv_reval_je on accounting.inventory_revaluations(journal_entry_id);
  end if;
  -- AT MOST ONE open pending reval per stock item. The trigger upserts onto this constraint so
  -- successive edits collapse into one row carrying the latest target cost.
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='uq_acct_inv_reval_pending') then
    create unique index uq_acct_inv_reval_pending
      on accounting.inventory_revaluations(source_inventory_id)
      where status = 'pending';
  end if;
end $$;

-- RLS + audit + touch_updated_at via the standard helper.
select accounting._apply_standard_table('inventory_revaluations');

-- ── RPC: gated batch poster for pending revaluations (the heart of decision 1) ──
-- Posts the GL movement for the given pending revaluation ids. Skips non-pending ids (so a
-- re-run is a no-op). Accumulates the SIGNED cents delta across the batch into ONE balanced JE
-- (Dr/Cr Inventory Asset ↔ Inventory Revaluation by net sign), re-marks each affected stock item's open FIFO layers to the
-- new cost, then closes every targeted pending row (linking the JE, or NULL for a net-zero
-- post). Returns the posted journal_entry_id, or NULL when the batch nets to zero cents.
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
  v_row_cents bigint;             -- signed per-row delta in cents
  v_net_cents bigint := 0;        -- signed batch net in cents (G6: integer math)
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

  -- Resolve posting accounts from module settings (Inventory Asset / Inventory Revaluation keys).
  select (setting_value ->> 'inventory_asset')::uuid,
         (setting_value ->> 'inventory_revaluation')::uuid
    into v_inv_acct, v_reval_acct
    from accounting.settings
   where setting_key = 'default_accounts';
  if v_inv_acct is null or v_reval_acct is null then
    raise exception 'default Inventory-Asset/Inventory-Revaluation accounts are not configured in accounting.settings'
      using errcode = 'check_violation';
  end if;

  -- First pass: lock the still-pending targeted rows and accumulate the signed net in cents.
  -- Deterministic id order keeps concurrent batch posts deadlock-safe.
  for v_row in
    select id, on_hand_qty, old_cost, new_cost
      from accounting.inventory_revaluations
     where id = any(p_revaluation_ids)
       and status = 'pending'
     order by id
     for update
  loop
    v_count := v_count + 1;
    -- Δ in integer cents (no float drift): qty × (new − old), rounded once.
    v_row_cents := round(v_row.on_hand_qty * (v_row.new_cost - v_row.old_cost) * 100)::bigint;
    v_net_cents := v_net_cents + v_row_cents;
  end loop;

  -- No still-pending rows in the batch → nothing to do (idempotent re-run).
  if v_count = 0 then
    return null;
  end if;

  -- Build + post ONE balanced JE only when the batch nets to a non-zero GL movement.
  if v_net_cents <> 0 then
    v_amount := (abs(v_net_cents)::numeric) / 100.0;

    insert into accounting.journal_entries (entry_date, memo, source_type, status, created_by)
    values (
      current_date,
      'Inventory revaluation (' || v_count || ' item(s))',
      'adjustment',          -- allowed by the GL source_type enum (no enum change needed)
      'draft',
      auth.uid()
    )
    returning id into v_entry_id;

    if v_net_cents > 0 then
      -- Cost rose on net: asset basis goes UP.
      insert into accounting.journal_lines (journal_entry_id, account_id, debit, credit, line_memo, sort_order)
      values (v_entry_id, v_inv_acct,   v_amount, 0, 'Inventory revaluation (increase)', 0);
      insert into accounting.journal_lines (journal_entry_id, account_id, debit, credit, line_memo, sort_order)
      values (v_entry_id, v_reval_acct, 0, v_amount, 'Inventory revaluation offset',     1);
    else
      -- Cost fell on net: asset basis goes DOWN.
      insert into accounting.journal_lines (journal_entry_id, account_id, debit, credit, line_memo, sort_order)
      values (v_entry_id, v_reval_acct, v_amount, 0, 'Inventory revaluation offset',     0);
      insert into accounting.journal_lines (journal_entry_id, account_id, debit, credit, line_memo, sort_order)
      values (v_entry_id, v_inv_acct,   0, v_amount, 'Inventory revaluation (decrease)', 1);
    end if;

    -- Posts only if balanced with >=2 lines (guard_journal_entry). Balanced by construction.
    perform accounting.post_journal_entry(v_entry_id);
  else
    -- Net-zero batch (e.g. every row has on_hand_qty = 0): no GL movement, no JE.
    v_entry_id := null;
  end if;

  -- Second pass: close each still-pending targeted row and re-mark its open layers to the new
  -- cost. Re-selected FOR UPDATE in the same txn; rows already flipped above stay locked.
  for v_row in
    select id, source_inventory_id, new_cost
      from accounting.inventory_revaluations
     where id = any(p_revaluation_ids)
       and status = 'pending'
     order by id
     for update
  loop
    update accounting.inventory_revaluations
       set status = 'posted',
           journal_entry_id = v_entry_id,
           posted_at = now()
     where id = v_row.id;

    -- Re-mark OPEN FIFO layers to the revalued cost so the asset basis matches going forward.
    -- (Depleted layers are historical and left untouched.)
    update accounting.inventory_layers
       set unit_cost = v_row.new_cost
     where source_inventory_id = v_row.source_inventory_id
       and qty_remaining > 0;
  end loop;

  return v_entry_id;
end;
$$;

-- Belt-and-suspenders explicit grants (default privileges already cover new objects).
grant select, insert, update, delete on all tables in schema accounting to authenticated, service_role;
grant usage, select on all sequences in schema accounting to authenticated, service_role;
grant execute on all functions in schema accounting to authenticated, service_role;

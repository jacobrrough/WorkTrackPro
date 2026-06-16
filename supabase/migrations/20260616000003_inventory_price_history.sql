-- WorkTrackAccounting — Inventory↔Accounting Reconciliation 3/4: price history + cost sync
--
-- public.inventory.price IS the per-unit COST (vendor price per unit), NOT a sell price. This
-- migration records every cost change and keeps the ONE cost number synced on BOTH sides
-- (operational public.inventory.price ↔ accounting.items.purchase_cost) automatically.
--
-- ───────────────────────────────────────────────────────────────────────────────────────────
-- THE ONE WRITE-TO-public SEAM (G1 — additive, no ALTER/DROP)
--   This is the single authorized exception to "accounting writes only accounting.*". It is
--   ADDITIVE: it creates a NEW table (public.inventory_price_history) and a NEW trigger on
--   public.inventory. It does NOT alter public.inventory's shape and does NOT drop anything.
--   PRECEDENT: an accounting-adjacent AFTER-UPDATE trigger already lives on public.inventory —
--   public.notify_low_stock / trg_notify_low_stock (migration 20260508000001, fires `after
--   update of available`). This mirrors it exactly (fires `after update of price`).
--
-- WHAT THE TRIGGER DOES (fires only WHEN OLD.price IS DISTINCT FROM NEW.price):
--   (a) INSERT a public.inventory_price_history row (old→new, Δ, source, who, reason).
--   (b) SYNC accounting.items.purchase_cost := NEW.price for items crosswalked by
--       source_inventory_id (the cost VALUE auto-reflects on the accounting side instantly).
--   (c) ENQUEUE / UPDATE a single PENDING accounting.inventory_revaluations row for this stock
--       item with the new cost + a snapshot of on-hand qty from open FIFO layers. It NEVER
--       posts a journal entry — the GL move is gated (decision 1, "Gated revaluation").
--
-- NO TRIGGER RECURSION (the loop guard)
--   • The trigger writes accounting.items and accounting.inventory_revaluations — DIFFERENT
--     tables. It NEVER writes back to public.inventory, so it cannot re-fire itself. The
--     price→purchase_cost→(no write back to price) path is strictly one-way.
--   • The revaluation poster (migration 2) touches only inventory_layers + the reval row — it
--     never writes public.inventory.price, so it cannot start a loop either.
--   • The bill-receive path and the opening-balance seeder DO write public.inventory.price and
--     WILL re-fire this trigger (intended — we want the history + item sync). They self-label
--     via the GUC `app.price_change_source` so the history row records 'bill' / 'seed' instead
--     of 'manual'. Reading the GUC with the missing-ok flag means a normal manual UI edit (no
--     GUC set) defaults to 'manual'. set_config(..., true) scopes it to the txn so the label
--     never leaks to a later statement.
--
-- MONEY MATH (G6): purchase_cost mirrors price exactly (numeric→numeric, no arithmetic). The
--   reval Δ preview is computed in INTEGER CENTS: round(on_hand × (new − old) × 100) / 100.
--
-- RLS: public.inventory_price_history is readable by approved users (consistent with
--   public.inventory_history); the SECURITY DEFINER trigger is the only writer (no authenticated
--   write policy → append-only from the app, like accounting.audit_log). The reval-enqueue
--   write succeeds because the trigger is SECURITY DEFINER (runs as owner, bypassing the
--   accounting RLS on inventory_revaluations) — matching how notify_low_stock inserts
--   system_notifications for other users.
--
-- IDEMPOTENCY: CREATE TABLE IF NOT EXISTS + guarded indexes + CREATE OR REPLACE FUNCTION + a
--   re-created trigger make this safely re-runnable.
--
-- ROLLBACK:
--   DROP TRIGGER  IF EXISTS trg_inventory_price_history ON public.inventory;
--   DROP FUNCTION IF EXISTS public.inventory_log_price_change() CASCADE;
--   DROP TABLE    IF EXISTS public.inventory_price_history CASCADE;

-- ── Table (additive; new object — does NOT alter public.inventory) ─────────────
-- Distinct from the EXISTING public.inventory_history (which tracks STOCK qty changes, not
-- cost). public.inventory.price is plain `numeric` (no fixed scale), so old/new/Δ are numeric.
create table if not exists public.inventory_price_history (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null references public.inventory(id) on delete cascade,
  old_price numeric,
  new_price numeric,
  change_amount numeric,
  source text not null default 'manual' check (source in ('manual', 'bill', 'seed', 'reval')),
  -- plain uuid (no FK) so a price change can never fail because of a missing/edge profile row,
  -- matching accounting.audit_log.actor_id's reasoning. auth.uid() is captured when present.
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

-- ── RLS (consistent with other public.* tables; trigger-only writes) ───────────
alter table public.inventory_price_history enable row level security;

-- Approved users may read the price-history feed (same audience as public.inventory itself).
drop policy if exists "Approved read inventory price history" on public.inventory_price_history;
create policy "Approved read inventory price history" on public.inventory_price_history
  for select to authenticated
  using (public.is_approved_user());

-- No authenticated write policy: only the SECURITY DEFINER trigger (running as owner) inserts,
-- making the log append-only from the application's perspective.

-- ── Trigger function: log price change + sync accounting cost + enqueue reval ──
-- SECURITY DEFINER + search_path pinned so it can write accounting.* from a public-schema
-- trigger context. Fires only on an actual price change (see WHEN clause on the trigger).
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
  v_reval_acct uuid;   -- presence gates the enqueue (skip if the accounting module isn't set up)
begin
  -- Source label: bill/seed/reval paths set the GUC; a manual UI edit leaves it unset → 'manual'.
  v_source := coalesce(nullif(current_setting('app.price_change_source', true), ''), 'manual');
  if v_source not in ('manual', 'bill', 'seed', 'reval') then
    v_source := 'manual';
  end if;

  -- (a) Append the price-history row (always, on any real price change).
  insert into public.inventory_price_history
    (inventory_id, old_price, new_price, change_amount, source, user_id, reason)
  values
    (NEW.id, OLD.price, NEW.price,
     coalesce(NEW.price, 0) - coalesce(OLD.price, 0),
     v_source, auth.uid(),
     nullif(current_setting('app.price_change_reason', true), ''));

  -- The remaining steps touch accounting.*; do them only if the accounting module is installed
  -- (the Inventory Revaluation account is configured). Resolve by the default_accounts KEY —
  -- never a hardcoded number — because prod runs the imported chart (no standard 1300/1310;
  -- '1310' there is "Due from Officer"). On a core-only DB (no such key) these are skipped.
  select (setting_value ->> 'inventory_revaluation')::uuid
    into v_reval_acct
    from accounting.settings
   where setting_key = 'default_accounts';
  if v_reval_acct is null then
    return NEW;
  end if;

  -- (b) SYNC the cost VALUE onto the accounting item(s) crosswalked to this stock row. One-way
  --     write to a DIFFERENT table → no recursion back into this trigger.
  update accounting.items
     set purchase_cost = NEW.price
   where source_inventory_id = NEW.id
     and purchase_cost is distinct from NEW.price;

  -- A 'reval'-sourced price write originates FROM the revaluation post itself (cost already
  -- reconciled there) — do not enqueue another pending reval for it.
  if v_source = 'reval' then
    return NEW;
  end if;

  -- (c) ENQUEUE / UPDATE the single PENDING revaluation for this stock item. Snapshot on-hand
  --     qty from OPEN FIFO layers; preview Δ in integer cents (G6). NEVER posts a JE.
  select coalesce(sum(qty_remaining), 0)
    into v_on_hand
    from accounting.inventory_layers
   where source_inventory_id = NEW.id
     and qty_remaining > 0;

  -- representative item (any crosswalked item) for reporting on the reval row.
  select id into v_item_id
    from accounting.items
   where source_inventory_id = NEW.id
   order by created_at
   limit 1;

  -- Upsert onto the partial-unique (source_inventory_id) WHERE status='pending' index, so
  -- successive cost edits before a post collapse into ONE row carrying the LATEST target cost.
  -- old_cost stays the cost as of the FIRST enqueue (the basis the open layers were carried at),
  -- so a multi-edit Δ measures the full move from the last-posted basis to the latest cost.
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
    -- recompute Δ from the PRESERVED old_cost (first-enqueue basis) to the new target cost.
    delta_amount = round(excluded.on_hand_qty
                         * (excluded.new_cost - accounting.inventory_revaluations.old_cost) * 100) / 100.0,
    enqueued_at = now(),
    updated_at = now();

  return NEW;
end;
$$;

-- Fire only when price actually changes (mirrors trg_notify_low_stock's `after update of`).
drop trigger if exists trg_inventory_price_history on public.inventory;
create trigger trg_inventory_price_history
  after update of price on public.inventory
  for each row
  when (OLD.price is distinct from NEW.price)
  execute function public.inventory_log_price_change();

-- Trigger-only function: revoke EXECUTE from the PostgREST roles so it cannot be invoked
-- directly over /rest/v1/rpc with forged arguments (it is meaningless outside trigger context,
-- where NEW/OLD are bound). Revoking does NOT affect trigger firing — the trigger runs as the
-- table owner regardless of grants. Mirrors the established convention in migration
-- 20260608232336 (section 2) for public trigger functions, and clears the advisor's
-- anon/authenticated SECURITY DEFINER finding for this function. PUBLIC is revoked first
-- because Postgres grants EXECUTE to PUBLIC by default on a new function, and anon/authenticated
-- inherit it through PUBLIC — revoking only the named roles would leave the inherited grant.
revoke execute on function public.inventory_log_price_change() from public;
revoke execute on function public.inventory_log_price_change() from anon, authenticated;

-- Grant read on the new public table (RLS still gates per-row).
grant select, insert, update, delete on public.inventory_price_history to authenticated, service_role;

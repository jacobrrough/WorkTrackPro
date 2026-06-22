-- Idempotency support for the generalized offline write queue.
--
-- The offline action queue replays queued mutations on reconnect. Field/status writes
-- and creates are made idempotent on the client (last-write-wins, existence checks,
-- client-supplied PK UUIDs). Inventory stock DELTAS are the exception: the
-- adjust_inventory_stock RPC is lost-update-safe but NOT idempotent — replaying a
-- delta that already landed server-side (a lost ACK: the write succeeded but the
-- response never came back) would double-apply it.
--
-- This migration adds a small dedup ledger keyed by a client-generated action id and
-- an idempotent delta RPC that records the id and applies the delta in a single
-- transaction. The SAME client_action_id is used by both the initial online write and
-- any later queued replay, so a lost-ACK replay is a no-op.

-- ── Dedup ledger ────────────────────────────────────────────────────────────────
-- NOTE (retention): every inventory delta (online or replayed) records a row here.
-- The table grows unbounded; add a scheduled purge of old rows, e.g.
--   delete from public.offline_action_log where applied_at < now() - interval '90 days';
-- (90d >> any realistic offline-queue lifetime, so purged ids can never collide with a
-- still-queued action.)
create table if not exists public.offline_action_log (
  client_action_id uuid primary key,
  applied_at timestamptz not null default now()
);

alter table public.offline_action_log enable row level security;

-- The ledger is written exclusively by the SECURITY DEFINER RPC below; no direct
-- client access is needed or granted. (RLS on with no policies = deny-all for clients.)
revoke all on table public.offline_action_log from anon, authenticated;

-- ── Idempotent delta RPC ────────────────────────────────────────────────────────
-- Records p_client_action_id; only applies the delta the first time that id is seen.
-- Returns the post-state plus `applied` so the client knows whether to write a
-- matching inventory_history audit row (skipped on a deduped replay).
create or replace function public.adjust_inventory_stock_idem(
  p_id uuid,
  p_in_stock_delta int,
  p_on_order_delta int,
  p_client_action_id uuid
) returns table(in_stock int, on_order int, applied boolean)
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_inserted int;
begin
  -- Authorize the caller — this is SECURITY DEFINER and bypasses RLS, so mirror the
  -- guard added to adjust_inventory_stock in 20260618154128. Without this, any
  -- authenticated (even unapproved) user could adjust stock via this RPC.
  if not public.is_approved_user() then
    raise exception 'not authorized';
  end if;

  insert into public.offline_action_log(client_action_id)
  values (p_client_action_id)
  on conflict (client_action_id) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted > 0 then
    -- First time we've seen this action: apply the delta.
    return query
      update public.inventory
      set in_stock = in_stock + p_in_stock_delta,
          on_order = greatest(0, on_order + p_on_order_delta),
          updated_at = now()
      where id = p_id
      returning inventory.in_stock, inventory.on_order, true;
  else
    -- Already applied (lost-ACK replay): return current state without re-applying.
    return query
      select i.in_stock, i.on_order, false
      from public.inventory i
      where i.id = p_id;
  end if;
end;
$$;

revoke all on function public.adjust_inventory_stock_idem(uuid, int, int, uuid) from public, anon;
grant execute on function public.adjust_inventory_stock_idem(uuid, int, int, uuid) to authenticated;

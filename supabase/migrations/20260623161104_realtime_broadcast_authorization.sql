-- Realtime Broadcast authorization (PRIVATE channels).
--
-- Replaces the two wide-open starter policies on realtime.messages
-- (authenticated_can_receive_broadcasts / authenticated_can_send_broadcasts, which let
-- ANY authenticated user read/write ANY broadcast topic) with topic-scoped policies.
--
-- Scope: these policies govern ONLY Broadcast/Presence on PRIVATE channels
-- (config.private = true). They do NOT affect the existing public postgres_changes
-- channels (realtime-core, chat-*), which are authorized by each table's own RLS, not
-- by realtime.messages. So this change cannot break current realtime.
--
-- Topic conventions (kept in lockstep with broadcastTopics in
-- src/services/api/realtimeBroadcast.ts):
--   'accounting' / 'accounting:%' -> accounting.can_read()   (DB-driven accounting realtime)
--   'user:<uuid>'                 -> the owner only
--   'chat:<conv>'                 -> active members of the conversation
--   'typing:<conv>'               -> active members of the conversation
--   'presence:<conv>'             -> active members of the conversation
-- Unknown topics are denied by default.
--
-- Server-side realtime.broadcast_changes() triggers insert as the (definer) trigger
-- owner and bypass RLS, so the INSERT policy here governs only CLIENT sends (e.g. the
-- typing indicator). The SELECT policy governs who may RECEIVE on a topic.
--
-- Idempotent: safe to re-run.

create or replace function public.realtime_authorize(p_topic text, p_extension text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_conv uuid;
begin
  if v_uid is null or p_topic is null then
    return false;
  end if;

  -- Accounting realtime: only users who may read the accounting ledgers.
  if p_topic = 'accounting' or p_topic like 'accounting:%' then
    return accounting.can_read();
  end if;

  -- Per-user private topic: owner only.
  if p_topic like 'user:%' then
    return p_topic = 'user:' || v_uid::text;
  end if;

  -- Chat message / typing / presence topics: active conversation members only.
  if p_topic like 'chat:%' or p_topic like 'typing:%' or p_topic like 'presence:%' then
    begin
      v_conv := split_part(p_topic, ':', 2)::uuid;
    exception when others then
      return false;  -- malformed topic (non-uuid suffix)
    end;
    return exists (
      select 1
      from public.conversation_members cm
      where cm.conversation_id = v_conv
        and cm.user_id = v_uid
        and cm.left_at is null
    );
  end if;

  -- Unknown topic: deny.
  return false;
end;
$$;

-- The RLS evaluator runs as the connecting user's role (authenticated); it needs
-- execute. Keep it off anon/public so it isn't a callable PostgREST RPC.
grant execute on function public.realtime_authorize(text, text) to authenticated;
revoke execute on function public.realtime_authorize(text, text) from anon, public;

-- Drop the permissive starter policies and any prior run of this migration's policies.
drop policy if exists authenticated_can_receive_broadcasts on realtime.messages;
drop policy if exists authenticated_can_send_broadcasts on realtime.messages;
drop policy if exists rt_broadcast_select_authorized on realtime.messages;
drop policy if exists rt_broadcast_insert_authorized on realtime.messages;

create policy rt_broadcast_select_authorized
  on realtime.messages
  for select
  to authenticated
  using ( public.realtime_authorize((select realtime.topic()), extension) );

create policy rt_broadcast_insert_authorized
  on realtime.messages
  for insert
  to authenticated
  with check ( public.realtime_authorize((select realtime.topic()), extension) );

-- Security hardening: lock down over-exposed SECURITY DEFINER functions flagged by the
-- Supabase security advisor (lints 0028 anon / 0029 authenticated "can execute SECURITY
-- DEFINER function"). Two of these are reachable from the browser client and MUTATE data
-- while bypassing RLS (SECURITY DEFINER) with NO caller-authorization check; the rest must
-- simply not be callable by the anon (unauthenticated) role.
--
-- WHAT CHANGES
--   • adjust_inventory_stock(...)   — add an is_approved_user() guard. It was UNGUARDED:
--       any authenticated caller could mutate inventory stock via /rpc, sidestepping the
--       inventory table's own is_approved_user() RLS. Still called by the client
--       (src/services/api/inventory.ts adjustStock). Behavior + return shape preserved.
--   • notify_mention(...)           — add an is_approved_user() guard. It was UNGUARDED:
--       any caller could insert a system_notification for ANY user_id with arbitrary
--       title/body text (notification spoofing/phishing). Still called by the client
--       (src/services/api/systemNotifications.ts notifyMention).
--   • find_direct_conversation(...) — require the CALLER to be one of the two participants
--       (auth.uid() = user_a OR user_b), so it can't be used to probe whether two
--       arbitrary users share a DM. The client always passes the current user as user_a.
--   • enforce_paid_entry_lock()     — REVOKE EXECUTE entirely: it is a TRIGGER function and
--       must never be invokable as a /rpc endpoint (triggers fire regardless of grants).
--   • EXECUTE on all of the above + should_notify(...) is revoked from PUBLIC and anon;
--       the four client-called functions keep EXECUTE for `authenticated` (service_role
--       bypasses RLS/grants and is unaffected).
--
-- NOT CHANGED (intentional): the boolean RLS-helper predicates is_approved_user,
-- is_admin_approved, is_conversation_member, can_see_board, can_edit_board KEEP EXECUTE for
-- `authenticated` — RLS policies call them, so revoking would break row access. The advisor
-- lint is a known false-positive for RLS helper functions.
--
-- IDEMPOTENT: create-or-replace + plain REVOKE/GRANT. No table data is touched.
-- ROLLBACK: re-grant EXECUTE to the prior roles and restore the pre-guard bodies (see
--   migration 20250216/parts/notifications history for the originals).

-- 1) adjust_inventory_stock: authorize the caller, preserve behavior and return shape.
create or replace function public.adjust_inventory_stock(
  p_id uuid, p_in_stock_delta integer, p_on_order_delta integer
)
returns table(in_stock integer, on_order integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_approved_user() then
    raise exception 'not authorized';
  end if;
  return query
    update public.inventory
       set in_stock = in_stock + p_in_stock_delta,
           on_order = greatest(0, on_order + p_on_order_delta),
           updated_at = now()
     where id = p_id
     returning inventory.in_stock, inventory.on_order;
end;
$function$;

-- 2) notify_mention: authorize the caller (was insertable by anyone, for any user_id).
create or replace function public.notify_mention(
  p_mentioned_user_id uuid, p_job_id uuid, p_commenter_name text,
  p_job_code integer, p_comment_preview text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_approved_user() then
    raise exception 'not authorized';
  end if;
  if not public.should_notify(p_mentioned_user_id, 'comment_mention', 'in_app') then
    return;
  end if;
  insert into public.system_notifications (user_id, type, title, message, link, metadata)
  values (
    p_mentioned_user_id,
    'comment_mention',
    'Mentioned in Comment',
    p_commenter_name || ' mentioned you on Job #' || p_job_code || ': "' || left(p_comment_preview, 100) || '"',
    'job-detail:' || p_job_id::text,
    jsonb_build_object('job_id', p_job_id, 'job_code', p_job_code, 'commenter_name', p_commenter_name)
  );
end;
$function$;

-- 3) find_direct_conversation: only resolve a conversation the caller participates in.
create or replace function public.find_direct_conversation(user_a uuid, user_b uuid)
returns uuid
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select cm1.conversation_id
  from public.conversation_members cm1
  join public.conversation_members cm2 on cm1.conversation_id = cm2.conversation_id
  join public.conversations c on c.id = cm1.conversation_id
  where cm1.user_id = user_a
    and cm2.user_id = user_b
    and c.type = 'direct'
    and cm1.left_at is null
    and cm2.left_at is null
    and (auth.uid() = user_a or auth.uid() = user_b)
  limit 1;
$function$;

-- 4) Tighten EXECUTE grants.
-- Trigger function — never callable as an RPC.
revoke all on function public.enforce_paid_entry_lock() from public, anon, authenticated;

-- Client-called functions — deny PUBLIC + anon, allow only authenticated.
revoke all on function public.adjust_inventory_stock(uuid, integer, integer) from public, anon;
grant execute on function public.adjust_inventory_stock(uuid, integer, integer) to authenticated;

revoke all on function public.notify_mention(uuid, uuid, text, integer, text) from public, anon;
grant execute on function public.notify_mention(uuid, uuid, text, integer, text) to authenticated;

revoke all on function public.find_direct_conversation(uuid, uuid) from public, anon;
grant execute on function public.find_direct_conversation(uuid, uuid) to authenticated;

revoke all on function public.should_notify(uuid, text, text) from public, anon;
grant execute on function public.should_notify(uuid, text, text) to authenticated;

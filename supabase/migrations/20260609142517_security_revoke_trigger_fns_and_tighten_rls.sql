-- Security follow-ups (live-advisor driven), applied live as 20260609142517.
--
-- 1. REVOKE EXECUTE FROM public/anon/authenticated on the 10 trigger-only SECURITY DEFINER
--    functions. They fire ONLY from triggers (which run as the table owner regardless of
--    grants), so this is functionally a no-op — it just stops them being callable over
--    PostgREST /rpc/. RLS-helper functions (is_approved_user, is_admin_approved, can_see_board,
--    can_edit_board, is_conversation_member) and app-invoked RPCs (should_notify, notify_mention,
--    find_direct_conversation, adjust_inventory_stock) are deliberately LEFT executable — they
--    are referenced in RLS policies or called by the client via .rpc(). Verified post-apply:
--    is_approved_user / should_notify / adjust_inventory_stock remain executable by authenticated;
--    the 10 trigger fns are no longer executable by anon/authenticated.
-- 2. Tighten the 4 overly-permissive USING(true) RLS policies to require an approved user
--    (matches sibling operational tables; every real app user is approved). The
--    part_revision_history USING(true) policy was a redundant duplicate of existing granular
--    is_approved_user()/is_admin_approved() policies, so it is simply dropped.

-- 1. Trigger-only function lockdown
do $$
declare fn text;
  fns text[] := array[
    'public.create_default_dashboard_preferences()','public.create_default_notification_preferences()',
    'public.enforce_shift_update()','public.handle_new_user()','public.job_inventory_allocate_guard()',
    'public.job_inventory_no_mutate_on_consumed()','public.jobs_reconcile_inventory_on_status()',
    'public.notify_job_status_change()','public.notify_low_stock()','public.update_conversation_timestamp()'];
begin
  foreach fn in array fns loop
    if to_regprocedure(fn) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', fn);
    end if;
  end loop;
end $$;

-- 2. RLS tightening
drop policy if exists "Authenticated deliveries" on public.deliveries;
create policy "Approved users manage deliveries" on public.deliveries
  for all to authenticated using (is_approved_user()) with check (is_approved_user());

drop policy if exists "Authenticated job_parts" on public.job_parts;
create policy "Approved users manage job_parts" on public.job_parts
  for all to authenticated using (is_approved_user()) with check (is_approved_user());

drop policy if exists "Authenticated insert job status history" on public.job_status_history;
create policy "Approved insert job status history" on public.job_status_history
  for insert to authenticated with check (is_approved_user());

-- redundant permissive duplicate; granular is_approved_user()/is_admin_approved() policies remain
drop policy if exists "Authenticated part_revision_history" on public.part_revision_history;

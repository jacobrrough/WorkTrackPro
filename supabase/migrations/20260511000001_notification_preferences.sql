-- User Notification Preferences: per-user opt-in/out for each notification type and channel.
-- Idempotent migration — safe to re-run.

-- =============================================
-- 1. TABLE
-- =============================================
create table if not exists public.user_notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  preferences jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

-- =============================================
-- 2. INDEXES
-- =============================================
do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'idx_unp_updated') then
    create index if not exists idx_unp_updated on public.user_notification_preferences(updated_at desc);
  end if;
end $$;

-- =============================================
-- 3. RLS
-- =============================================
alter table public.user_notification_preferences enable row level security;

drop policy if exists "Users read own preferences" on public.user_notification_preferences;
create policy "Users read own preferences" on public.user_notification_preferences
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users update own preferences" on public.user_notification_preferences;
create policy "Users update own preferences" on public.user_notification_preferences
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Approved users insert own preferences" on public.user_notification_preferences;
create policy "Approved users insert own preferences" on public.user_notification_preferences
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_approved_user());

-- =============================================
-- 4. REALTIME
-- =============================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_notification_preferences'
  ) then
    alter publication supabase_realtime add table public.user_notification_preferences;
  end if;
end $$;

-- =============================================
-- 5. DEFAULT PREFERENCES BUILDER
-- =============================================
create or replace function public.build_default_notification_preferences(p_is_admin boolean default false)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'in_app', jsonb_build_object(
      -- Jobs & Boards
      'status_change', true,
      'assignment', true,
      'unassignment', true,
      'rush', true,
      'overdue', true,
      'comment_mention', true,
      'checklist_complete', true,
      'delivery_update', true,
      'variant_update', true,
      -- Inventory
      'low_stock', true,
      'critical_stock', p_is_admin,
      'allocation_complete', p_is_admin,
      'allocation_reversal', p_is_admin,
      'reorder_point_hit', true,
      -- Time Clock
      'shift_edit_approved', true,
      'shift_edit_requested', true,
      'clock_anomaly', true,
      'lunch_break_reminder', true,
      -- Chat
      'chat_mention', true,
      'new_direct_message', true,
      'thread_reply', true,
      -- Admin
      'new_user_pending_approval', p_is_admin,
      'user_approved', true,
      'user_rejected', true,
      'proposal_submitted', p_is_admin,
      -- Quotes
      'new_customer_proposal', true,
      'quote_assigned', true,
      'quote_updated', true,
      -- Deliveries
      'delivery_scheduled', true,
      'delivery_completed', true,
      'delivery_delayed', true,
      -- System
      'daily_summary', false,
      'system_alert', true,
      'maintenance_notice', false
    ),
    'email', jsonb_build_object(
      'status_change', false,
      'assignment', false,
      'unassignment', false,
      'rush', false,
      'overdue', false,
      'comment_mention', false,
      'checklist_complete', false,
      'delivery_update', false,
      'variant_update', false,
      'low_stock', false,
      'critical_stock', false,
      'allocation_complete', false,
      'allocation_reversal', false,
      'reorder_point_hit', false,
      'shift_edit_approved', false,
      'shift_edit_requested', false,
      'clock_anomaly', false,
      'lunch_break_reminder', false,
      'chat_mention', false,
      'new_direct_message', false,
      'thread_reply', false,
      'new_user_pending_approval', false,
      'user_approved', false,
      'user_rejected', false,
      'proposal_submitted', false,
      'new_customer_proposal', false,
      'quote_assigned', false,
      'quote_updated', false,
      'delivery_scheduled', false,
      'delivery_completed', false,
      'delivery_delayed', false,
      'daily_summary', false,
      'system_alert', false,
      'maintenance_notice', false
    )
  );
$$;

-- =============================================
-- 6. AUTO-CREATE TRIGGER ON PROFILE INSERT
-- =============================================
create or replace function public.create_default_notification_preferences()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_notification_preferences (user_id, preferences)
  values (NEW.id, public.build_default_notification_preferences(NEW.is_admin))
  on conflict (user_id) do nothing;
  return NEW;
end;
$$;

drop trigger if exists trg_create_notification_preferences on public.profiles;
create trigger trg_create_notification_preferences
  after insert on public.profiles
  for each row execute function public.create_default_notification_preferences();

-- =============================================
-- 7. BACKFILL EXISTING USERS
-- =============================================
insert into public.user_notification_preferences (user_id, preferences)
select
  p.id,
  public.build_default_notification_preferences(p.is_admin)
from public.profiles p
where not exists (
  select 1 from public.user_notification_preferences unp where unp.user_id = p.id
)
on conflict (user_id) do nothing;

-- =============================================
-- 8. should_notify() — fast, inlineable check
-- =============================================
create or replace function public.should_notify(
  p_user_id uuid,
  p_notif_type text,
  p_channel text default 'in_app'
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select (preferences -> p_channel ->> p_notif_type)::boolean
      from public.user_notification_preferences
      where user_id = p_user_id
    ),
    true
  );
$$;

-- =============================================
-- 9. UPDATE EXISTING TRIGGERS — add should_notify gate
-- =============================================

-- 9a. Job status change trigger
create or replace function public.notify_job_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job record;
  v_changer_name text;
  v_user_id uuid;
begin
  select id, job_code, name, assigned_users
  into v_job
  from public.jobs
  where id = NEW.job_id;

  if v_job is null or v_job.assigned_users is null or array_length(v_job.assigned_users, 1) is null then
    return NEW;
  end if;

  select coalesce(name, email, 'Someone') into v_changer_name
  from public.profiles
  where id = NEW.user_id;

  foreach v_user_id in array v_job.assigned_users loop
    if v_user_id = NEW.user_id then
      continue;
    end if;

    if not public.should_notify(v_user_id, 'status_change', 'in_app') then
      continue;
    end if;

    insert into public.system_notifications (user_id, type, title, message, link, metadata)
    values (
      v_user_id,
      'status_change',
      'Job Status Changed',
      'Job #' || v_job.job_code || ' moved from ' || NEW.previous_status || ' to ' || NEW.new_status || ' by ' || v_changer_name,
      'job-detail:' || v_job.id::text,
      jsonb_build_object('job_id', v_job.id, 'job_code', v_job.job_code, 'previous_status', NEW.previous_status, 'new_status', NEW.new_status)
    );
  end loop;

  return NEW;
end;
$$;

-- 9b. Low stock trigger
create or replace function public.notify_low_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin record;
begin
  if NEW.reorder_point is null or NEW.reorder_point <= 0 then
    return NEW;
  end if;

  if NEW.available > NEW.reorder_point then
    return NEW;
  end if;

  if OLD.available <= OLD.reorder_point and OLD.reorder_point > 0 then
    return NEW;
  end if;

  for v_admin in
    select id from public.profiles where is_admin = true and is_approved = true
  loop
    if not public.should_notify(v_admin.id, 'low_stock', 'in_app') then
      continue;
    end if;

    insert into public.system_notifications (user_id, type, title, message, link, metadata)
    values (
      v_admin.id,
      'low_stock',
      'Low Stock Alert',
      'Low stock: ' || NEW.name || ' (' || NEW.available || ' available, reorder point: ' || NEW.reorder_point || ')',
      'inventory-detail:' || NEW.id::text,
      jsonb_build_object('inventory_id', NEW.id, 'available', NEW.available, 'reorder_point', NEW.reorder_point)
    );
  end loop;

  return NEW;
end;
$$;

-- 9c. Mention RPC — update type to 'comment_mention', add should_notify gate
create or replace function public.notify_mention(
  p_mentioned_user_id uuid,
  p_job_id uuid,
  p_commenter_name text,
  p_job_code int,
  p_comment_preview text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
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
$$;

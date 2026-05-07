-- System Notifications: persistent, per-user notification feed integrated into chat UI.
-- Idempotent migration — safe to re-run; creates prerequisites if missing.

-- =============================================
-- 0. PREREQUISITE: job_status_history
--    (defined in 20260506000001 but may not be applied yet)
-- =============================================
create table if not exists public.job_status_history (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  previous_status text not null,
  new_status text not null,
  created_at timestamptz default now()
);

do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'idx_job_status_history_job') then
    create index idx_job_status_history_job on public.job_status_history(job_id);
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'idx_job_status_history_created') then
    create index idx_job_status_history_created on public.job_status_history(created_at desc);
  end if;
end $$;

alter table public.job_status_history enable row level security;

drop policy if exists "Admin select job status history" on public.job_status_history;
create policy "Admin select job status history" on public.job_status_history
  for select to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true));

drop policy if exists "Authenticated insert job status history" on public.job_status_history;
create policy "Authenticated insert job status history" on public.job_status_history
  for insert to authenticated with check (true);

-- =============================================
-- 1. TABLE
-- =============================================
create table if not exists public.system_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  message text not null,
  link text,
  metadata jsonb default '{}',
  read_at timestamptz,
  created_at timestamptz default now()
);

-- =============================================
-- 2. INDEXES
-- =============================================
do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'idx_sn_user_created') then
    create index idx_sn_user_created on public.system_notifications(user_id, created_at desc);
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'idx_sn_user_unread') then
    create index idx_sn_user_unread on public.system_notifications(user_id) where read_at is null;
  end if;
end $$;

-- =============================================
-- 3. RLS
-- =============================================
alter table public.system_notifications enable row level security;

drop policy if exists "Users read own notifications" on public.system_notifications;
create policy "Users read own notifications" on public.system_notifications
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Approved users insert notifications" on public.system_notifications;
create policy "Approved users insert notifications" on public.system_notifications
  for insert to authenticated
  with check (public.is_approved_user());

drop policy if exists "Users update own notifications" on public.system_notifications;
create policy "Users update own notifications" on public.system_notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- =============================================
-- 4. REALTIME — enable for live subscriptions
--    Guarded: no-op if already in the publication.
-- =============================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'system_notifications'
  ) then
    alter publication supabase_realtime add table public.system_notifications;
  end if;
end $$;

-- =============================================
-- 5. TRIGGER FUNCTION: job status changes → notify assigned users
-- =============================================
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

drop trigger if exists trg_notify_job_status_change on public.job_status_history;
create trigger trg_notify_job_status_change
  after insert on public.job_status_history
  for each row execute function public.notify_job_status_change();

-- =============================================
-- 6. TRIGGER FUNCTION: inventory low stock → notify admins
-- =============================================
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

drop trigger if exists trg_notify_low_stock on public.inventory;
create trigger trg_notify_low_stock
  after update of available on public.inventory
  for each row execute function public.notify_low_stock();

-- =============================================
-- 7. RPC: create mention notification
-- =============================================
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
  insert into public.system_notifications (user_id, type, title, message, link, metadata)
  values (
    p_mentioned_user_id,
    'mention',
    'Mentioned in Comment',
    p_commenter_name || ' mentioned you on Job #' || p_job_code || ': "' || left(p_comment_preview, 100) || '"',
    'job-detail:' || p_job_id::text,
    jsonb_build_object('job_id', p_job_id, 'job_code', p_job_code, 'commenter_name', p_commenter_name)
  );
end;
$$;

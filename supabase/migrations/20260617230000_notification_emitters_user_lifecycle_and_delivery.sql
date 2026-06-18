-- Wire previously-dormant notification types to real DB events.
-- Each emitter is gated by public.should_notify() and mirrors the existing
-- notify_job_status_change / notify_low_stock conventions (SECURITY DEFINER,
-- pinned search_path, trigger-only — execute revoked from app roles).
-- Idempotent: safe to re-run.
--
-- Types wired here:
--   * new_user_pending_approval        -> admins, when an unapproved profile is created
--   * user_approved                    -> the affected user, on is_approved false->true
--   * delivery_completed / _scheduled  -> a job's assigned users, when a delivery row is
--                                         recorded (scheduled if delivered_at is in the future)
--
-- Deliberately NOT wired (see this change's summary):
--   user_rejected (rejected users lose data access via RLS, so could never read it),
--   checklist_complete (completion already auto-advances status -> status_change),
--   delivery_delayed (no "delayed" signal exists without a promised-date model),
--   and types needing a scheduler / product decision / missing infra.
--
-- Each trigger emitter body is wrapped in a best-effort exception block: a notification
-- failure must never roll back the signup / approval / delivery transaction that fired
-- the trigger. Section 4 retrofits the same guard onto the pre-existing trigger emitters
-- (notify_job_status_change, notify_low_stock) for parity. notify_mention is intentionally
-- left unwrapped: it is a client-invoked RPC, not a trigger, so it cannot roll back any
-- parent write and its caller already handles the error.

-- =============================================
-- 1. New user pending approval -> notify admins
-- =============================================
create or replace function public.notify_new_user_pending()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin record;
  v_name text;
begin
  -- Only brand-new unapproved signups need admin attention. Pre-approved
  -- (admin-created) profiles insert with is_approved = true and are skipped.
  if NEW.is_approved is distinct from false then
    return NEW;
  end if;

  begin
    v_name := coalesce(NEW.name, NEW.email, 'A new user');

    -- The new row is unapproved, so it can never match this approved-admin set;
    -- no self-notify guard needed.
    for v_admin in
      select id from public.profiles where is_admin = true and is_approved = true
    loop
      if not public.should_notify(v_admin.id, 'new_user_pending_approval', 'in_app') then
        continue;
      end if;
      insert into public.system_notifications (user_id, type, title, message, link, metadata)
      values (
        v_admin.id,
        'new_user_pending_approval',
        'New User Pending Approval',
        v_name || ' signed up and is waiting for approval',
        null,
        jsonb_build_object('pending_user_id', NEW.id)
      );
    end loop;
  exception when others then
    raise warning 'notify_new_user_pending failed: %', sqlerrm;
  end;

  return NEW;
end;
$$;

drop trigger if exists trg_notify_new_user_pending on public.profiles;
create trigger trg_notify_new_user_pending
  after insert on public.profiles
  for each row execute function public.notify_new_user_pending();

-- =============================================
-- 2. User approved -> notify the affected user
-- =============================================
create or replace function public.notify_user_approved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Fire only on the false/null -> true approval transition. Rejection
  -- (true -> false) is intentionally not notified: a rejected user loses
  -- data access via RLS and could not read the notification anyway.
  if NEW.is_approved = true and coalesce(OLD.is_approved, false) = false then
    begin
      if public.should_notify(NEW.id, 'user_approved', 'in_app') then
        insert into public.system_notifications (user_id, type, title, message, link, metadata)
        values (
          NEW.id,
          'user_approved',
          'Account Approved',
          'Your account has been approved. Welcome aboard!',
          null,
          jsonb_build_object('approved_by', NEW.approved_by)
        );
      end if;
    exception when others then
      raise warning 'notify_user_approved failed: %', sqlerrm;
    end;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_notify_user_approved on public.profiles;
create trigger trg_notify_user_approved
  after update of is_approved on public.profiles
  for each row
  when (OLD.is_approved is distinct from NEW.is_approved)
  execute function public.notify_user_approved();

-- =============================================
-- 3. Delivery recorded -> notify a job's assigned users
-- =============================================
create or replace function public.notify_delivery_recorded()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job record;
  v_user_id uuid;
  v_type text;
  v_title text;
  v_detail text;
begin
  begin
    select id, job_code, assigned_users
    into v_job
    from public.jobs
    where id = NEW.job_id;

    if v_job is null
      or v_job.assigned_users is null
      or array_length(v_job.assigned_users, 1) is null then
      return NEW;
    end if;

    -- A future delivered_at is a scheduled delivery, not a completed one. Each
    -- maps to a distinct, separately-toggleable notification type.
    if NEW.delivered_at > current_date then
      v_type := 'delivery_scheduled';
      v_title := 'Delivery Scheduled';
      v_detail := 'is scheduled for ' || to_char(NEW.delivered_at, 'FMMon FMDD, YYYY');
    else
      v_type := 'delivery_completed';
      v_title := 'Delivery Recorded';
      v_detail := 'was recorded';
    end if;

    foreach v_user_id in array v_job.assigned_users loop
      -- Skip whoever recorded the delivery. A null created_by skips no one,
      -- so every assigned user is notified.
      if v_user_id = NEW.created_by then
        continue;
      end if;
      if not public.should_notify(v_user_id, v_type, 'in_app') then
        continue;
      end if;
      insert into public.system_notifications (user_id, type, title, message, link, metadata)
      values (
        v_user_id,
        v_type,
        v_title,
        'Delivery #' || NEW.delivery_number || ' for Job #' || v_job.job_code || ' ' || v_detail,
        'job-detail:' || v_job.id::text,
        jsonb_build_object(
          'job_id', v_job.id,
          'job_code', v_job.job_code,
          'delivery_id', NEW.id,
          'delivery_number', NEW.delivery_number,
          'delivered_at', NEW.delivered_at
        )
      );
    end loop;
  exception when others then
    raise warning 'notify_delivery_recorded failed: %', sqlerrm;
  end;

  return NEW;
end;
$$;

drop trigger if exists trg_notify_delivery_recorded on public.deliveries;
create trigger trg_notify_delivery_recorded
  after insert on public.deliveries
  for each row execute function public.notify_delivery_recorded();

-- =============================================
-- 4. Parity retrofit: best-effort guard on the pre-existing trigger emitters.
--    Bodies are reproduced verbatim from 20260511000001 (the should_notify-gated
--    versions) with only an inner exception block added, so a notification failure
--    can no longer roll back the inventory update / status-history insert that fired
--    the trigger. The existing triggers already point at these function names, so
--    replacing the function is sufficient — no trigger DDL needed.
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
  exception when others then
    raise warning 'notify_job_status_change failed: %', sqlerrm;
  end;

  return NEW;
end;
$$;

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

  begin
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
  exception when others then
    raise warning 'notify_low_stock failed: %', sqlerrm;
  end;

  return NEW;
end;
$$;

-- =============================================
-- 5. Trigger-only function lockdown (match security convention)
--    These fire only from triggers (owner context), so revoking execute
--    just stops them being callable over PostgREST /rpc/. notify_mention is
--    deliberately omitted — it stays client-callable.
-- =============================================
do $$
declare
  fn text;
  fns text[] := array[
    'public.notify_new_user_pending()',
    'public.notify_user_approved()',
    'public.notify_delivery_recorded()',
    'public.notify_job_status_change()',
    'public.notify_low_stock()'
  ];
begin
  foreach fn in array fns loop
    if to_regprocedure(fn) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', fn);
    end if;
  end loop;
end $$;

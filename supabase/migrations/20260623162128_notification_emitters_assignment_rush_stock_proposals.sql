-- Activate dormant notification types that have a clear, unambiguous DB signal on an
-- existing table. Mirrors the conventions of 20260617230000 (SECURITY DEFINER, pinned
-- search_path, should_notify()-gated, best-effort exception block so a notification
-- failure never rolls back the parent write, trigger-only with execute revoked).
--
-- Wired here:
--   * assignment / unassignment  -> users added/removed from jobs.assigned_users
--   * rush                       -> a job's assigned users, on is_rush false/null -> true
--   * critical_stock             -> admins, when inventory.available crosses to <= 0
--   * new_customer_proposal      -> admins, when a customer_proposals row is inserted
--
-- Deliberately NOT wired (see this change's summary):
--   shift_edit_requested/approved (shift_edits is an audit log of completed edits, not a
--     request/approval workflow — no status/reviewer columns to drive the transition),
--   quote_assigned/quote_updated (quotes has no assignee column; "updated" would only
--     self-notify the creator),
--   overdue / lunch_break_reminder / daily_summary (time-based -> scheduler phase),
--   chat_mention / new_direct_message / thread_reply (chat is E2E-encrypted; needs
--     client-side detection), and the redundant/manual types.
--
-- Idempotent: safe to re-run.

-- =============================================
-- 1. Job assignment / unassignment / rush
-- =============================================
create or replace function public.notify_job_assignment_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_added uuid[];
  v_removed uuid[];
  v_label text;
begin
  begin
    v_label := 'Job #' || NEW.job_code ||
      case when coalesce(NEW.name, '') <> '' then ' — ' || NEW.name else '' end;

    if TG_OP = 'INSERT' then
      v_added := coalesce(NEW.assigned_users, '{}'::uuid[]);
      v_removed := '{}'::uuid[];
    else
      v_added := array(
        select unnest(coalesce(NEW.assigned_users, '{}'::uuid[]))
        except
        select unnest(coalesce(OLD.assigned_users, '{}'::uuid[]))
      );
      v_removed := array(
        select unnest(coalesce(OLD.assigned_users, '{}'::uuid[]))
        except
        select unnest(coalesce(NEW.assigned_users, '{}'::uuid[]))
      );
    end if;

    -- Newly assigned users
    if cardinality(v_added) > 0 then
      foreach v_uid in array v_added loop
        if public.should_notify(v_uid, 'assignment', 'in_app') then
          insert into public.system_notifications (user_id, type, title, message, link, metadata)
          values (v_uid, 'assignment', 'Assigned to a Job',
            'You were assigned to ' || v_label,
            'job-detail:' || NEW.id::text,
            jsonb_build_object('job_id', NEW.id, 'job_code', NEW.job_code));
        end if;
      end loop;
    end if;

    -- Removed users
    if cardinality(v_removed) > 0 then
      foreach v_uid in array v_removed loop
        if public.should_notify(v_uid, 'unassignment', 'in_app') then
          insert into public.system_notifications (user_id, type, title, message, link, metadata)
          values (v_uid, 'unassignment', 'Removed from a Job',
            'You were removed from ' || v_label,
            'job-detail:' || NEW.id::text,
            jsonb_build_object('job_id', NEW.id, 'job_code', NEW.job_code));
        end if;
      end loop;
    end if;

    -- Rush escalation: notify current assignees on the false/null -> true transition only.
    if TG_OP = 'UPDATE'
       and NEW.is_rush = true
       and OLD.is_rush is distinct from true
       and NEW.assigned_users is not null then
      foreach v_uid in array NEW.assigned_users loop
        if public.should_notify(v_uid, 'rush', 'in_app') then
          insert into public.system_notifications (user_id, type, title, message, link, metadata)
          values (v_uid, 'rush', 'Job Marked Rush',
            v_label || ' was marked RUSH',
            'job-detail:' || NEW.id::text,
            jsonb_build_object('job_id', NEW.id, 'job_code', NEW.job_code));
        end if;
      end loop;
    end if;
  exception when others then
    raise warning 'notify_job_assignment_changes failed: %', sqlerrm;
  end;

  return NEW;
end;
$$;

drop trigger if exists trg_notify_job_assignment_changes on public.jobs;
create trigger trg_notify_job_assignment_changes
  after insert or update of assigned_users, is_rush on public.jobs
  for each row execute function public.notify_job_assignment_changes();

-- =============================================
-- 2. Critical stock (out of stock) -> notify admins
-- =============================================
create or replace function public.notify_critical_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin record;
begin
  -- Fire only on the transition INTO out-of-stock, so a row that is already at/below
  -- zero does not re-alert on every subsequent update.
  if NEW.available > 0 then
    return NEW;
  end if;
  if OLD.available <= 0 then
    return NEW;
  end if;

  begin
    for v_admin in
      select id from public.profiles where is_admin = true and is_approved = true
    loop
      if not public.should_notify(v_admin.id, 'critical_stock', 'in_app') then
        continue;
      end if;
      insert into public.system_notifications (user_id, type, title, message, link, metadata)
      values (
        v_admin.id,
        'critical_stock',
        'Out of Stock',
        NEW.name || ' is out of stock (' || NEW.available || ' available)',
        'inventory-detail:' || NEW.id::text,
        jsonb_build_object('inventory_id', NEW.id, 'available', NEW.available)
      );
    end loop;
  exception when others then
    raise warning 'notify_critical_stock failed: %', sqlerrm;
  end;

  return NEW;
end;
$$;

drop trigger if exists trg_notify_critical_stock on public.inventory;
create trigger trg_notify_critical_stock
  after update of available on public.inventory
  for each row execute function public.notify_critical_stock();

-- =============================================
-- 3. New customer proposal -> notify admins
-- =============================================
create or replace function public.notify_new_customer_proposal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin record;
begin
  begin
    for v_admin in
      select id from public.profiles where is_admin = true and is_approved = true
    loop
      if not public.should_notify(v_admin.id, 'new_customer_proposal', 'in_app') then
        continue;
      end if;
      insert into public.system_notifications (user_id, type, title, message, link, metadata)
      values (
        v_admin.id,
        'new_customer_proposal',
        'New Customer Proposal',
        coalesce(nullif(NEW.contact_name, ''), 'A customer') || ' submitted a proposal request',
        null,
        jsonb_build_object(
          'proposal_id', NEW.id,
          'submission_id', NEW.submission_id,
          'contact_name', NEW.contact_name
        )
      );
    end loop;
  exception when others then
    raise warning 'notify_new_customer_proposal failed: %', sqlerrm;
  end;

  return NEW;
end;
$$;

drop trigger if exists trg_notify_new_customer_proposal on public.customer_proposals;
create trigger trg_notify_new_customer_proposal
  after insert on public.customer_proposals
  for each row execute function public.notify_new_customer_proposal();

-- =============================================
-- 4. Trigger-only function lockdown (match security convention)
-- =============================================
do $$
declare
  fn text;
  fns text[] := array[
    'public.notify_job_assignment_changes()',
    'public.notify_critical_stock()',
    'public.notify_new_customer_proposal()'
  ];
begin
  foreach fn in array fns loop
    if to_regprocedure(fn) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', fn);
    end if;
  end loop;
end $$;

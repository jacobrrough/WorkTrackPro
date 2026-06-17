-- Unified jobs ↔ billing — auto-sync a job's status from its real invoice payment state.
--
-- accounting.sync_job_paid_from_invoice() reacts to changes on accounting.invoices and, via the
-- SECURITY DEFINER helper accounting._apply_job_paid_state(job_id), keeps public.jobs.status in
-- step with the money:
--   • FULLY PAID  → advance the job to 'paid' (aggressive: from ANY status except already-'paid'),
--                   and rebuild the stored name to the paid convention (Part REV x).
--   • A BALANCE REAPPEARS while the job is 'paid' → revert to 'waitingForPayment' (money-only state;
--     we never assert a production state we did not observe).
--   • INDETERMINATE (no non-void, positive-total invoice) → leave the status untouched.
--
-- We react to the INVOICE ROW (not payments) because the upstream trigger sync_invoice_payment
-- (20260603164151_accounting_sales.sql) already maintains amount_paid/balance_due/status on
-- accounting.invoices for both app payments AND imported/QBO fully-paid invoices — one consistent
-- signal. This trigger fires AFTER that maintenance as a nested trigger.
--
-- "FULLY PAID (job)" ⇔ ≥1 non-void invoice with total > 0 AND every non-void invoice has
-- balance_due <= 0. A draft invoice carries balance_due = total, so an unsent draft naturally keeps
-- the job "owed" until it is paid (it is real intended billing, not yet settled).
--
-- AUDIT: public.job_status_history previously required a non-null user_id (app-only writes). System
-- fires (service-role / QBO / cron) have no JWT, so we relax that column exactly like
-- 20260509000002 did for inventory_history. The reader jobStatusHistoryService.getByJob already
-- optional-chains the profile join, so a NULL actor renders as "system" with no UI change.
--
-- SECURITY: both functions are SECURITY DEFINER with a pinned search_path and are NOT directly
-- executable (revoked from public/anon/authenticated); they run only from the trigger. Definer
-- rights are needed because accounting.* writing public.jobs is a cross-schema bridge, mirroring
-- accounting._maybe_link_job_to_customer (20260610200100).
--
-- IDEMPOTENT: every write is guarded with `where status is distinct from <new>`, so re-fires never
-- produce spurious job_status_history rows. This migration is itself idempotent (create or replace).
--
-- NOTE: advancing to 'paid' / reverting to 'waitingForPayment' fires the existing
-- jobs_reconcile_inventory_on_status trigger, but neither status is a consumed/production status,
-- so inventory is never disturbed (verified against is_consumed_status/is_production_status).
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS sync_job_paid_from_invoice ON accounting.invoices;
--   DROP FUNCTION IF EXISTS accounting.sync_job_paid_from_invoice();
--   DROP FUNCTION IF EXISTS accounting._apply_job_paid_state(uuid);
--   -- The job_status_history.user_id NOT NULL relaxation is intentionally NOT auto-reverted:
--   -- re-adding NOT NULL fails once any system (NULL-actor) row exists.

-- Allow NULL user_id for system-context fires (service-role / QBO / cron — no JWT).
alter table public.job_status_history alter column user_id drop not null;

-- Evaluate one job's invoices and reconcile public.jobs.status. Pure side-effecting helper.
create or replace function accounting._apply_job_paid_state(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = accounting, public, pg_catalog
as $$
declare
  v_billable int;
  v_open     int;
  v_cur      text;
  v_name     text;
begin
  if p_job_id is null then
    return;
  end if;

  -- v_billable: count of real (non-void, positive-total) invoices.
  -- v_open:     count of non-void invoices still carrying a balance.
  select count(*) filter (where status <> 'void' and coalesce(total, 0) > 0),
         count(*) filter (where status <> 'void' and coalesce(balance_due, 0) > 0)
    into v_billable, v_open
    from accounting.invoices
   where job_id = p_job_id;

  -- Indeterminate: no real invoice to judge by → never touch the status.
  if v_billable = 0 then
    return;
  end if;

  select status into v_cur from public.jobs where id = p_job_id for update;
  if not found then
    return;
  end if;

  if v_open = 0 then
    -- Fully paid → advance to 'paid' from ANY status except already-'paid' (aggressive policy).
    -- Rebuild the stored name to the paid convention, mirroring formatJob.partAndRev exactly:
    --   "<part_number> REV <revision>"  (or just "<part_number>" when no revision),
    -- falling back to the existing name when there is no part number.
    select coalesce(
             nullif(
               btrim(coalesce(j.part_number, '')) ||
               case when nullif(btrim(coalesce(j.revision, '')), '') is not null
                    then ' REV ' || btrim(j.revision)
                    else '' end,
               ''),
             j.name)
      into v_name
      from public.jobs j
     where j.id = p_job_id;

    update public.jobs
       set status = 'paid',
           name   = v_name
     where id = p_job_id
       and status is distinct from 'paid';

    if found then
      insert into public.job_status_history (job_id, user_id, previous_status, new_status)
      values (p_job_id, auth.uid(), v_cur, 'paid');
    end if;

  elsif v_cur = 'paid' then
    -- A balance reappeared while the job was terminal-'paid' → revert to the money-only state.
    update public.jobs
       set status = 'waitingForPayment'
     where id = p_job_id
       and status is distinct from 'waitingForPayment';

    if found then
      insert into public.job_status_history (job_id, user_id, previous_status, new_status)
      values (p_job_id, auth.uid(), v_cur, 'waitingForPayment');
    end if;
  end if;
end;
$$;

revoke execute on function accounting._apply_job_paid_state(uuid) from public, anon, authenticated;

-- Trigger glue: re-evaluate the affected job(s). On a job_id re-link, evaluate BOTH the old and the
-- new job so a moved invoice settles both sides.
create or replace function accounting.sync_job_paid_from_invoice()
returns trigger
language plpgsql
security definer
set search_path = accounting, public, pg_catalog
as $$
begin
  if tg_op = 'UPDATE' and new.job_id is distinct from old.job_id then
    perform accounting._apply_job_paid_state(old.job_id);
    perform accounting._apply_job_paid_state(new.job_id);
  else
    perform accounting._apply_job_paid_state(coalesce(new.job_id, old.job_id));
  end if;
  return null; -- AFTER trigger: return value is ignored.
end;
$$;

revoke execute on function accounting.sync_job_paid_from_invoice() from public, anon, authenticated;

-- Fire on INSERT and on the UPDATEs that can change the paid math. No WHEN clause: a WHEN cannot
-- reference OLD on an INSERT, and the helper is idempotent + cheap, so the `UPDATE OF <cols>` scope
-- plus the in-helper guards make redundant fires harmless.
drop trigger if exists sync_job_paid_from_invoice on accounting.invoices;
create trigger sync_job_paid_from_invoice
  after insert or update of status, balance_due, amount_paid, total, job_id
  on accounting.invoices
  for each row
  execute function accounting.sync_job_paid_from_invoice();

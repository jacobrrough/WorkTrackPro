-- Accounting notification emitters (AR/AP document lifecycle).
--
-- Recipients are ACCOUNTING READERS only (approved admins + accounting.user_roles),
-- mirroring accounting.can_read() — so invoice/bill financials never notify shop-floor
-- (non-accounting) staff. Gated by should_notify(); best-effort exception block so a
-- notification failure never rolls back the AR/AP write.
--
-- Flood guard: rows carrying external_qbo_id (QBO-managed / replica-synced) are SKIPPED,
-- so a QBO sync or import cannot flood the bell. App-native documents (external_qbo_id
-- null) notify normally. Realtime broadcast (separate migration) still fires for synced
-- rows, so their screens live-update — they just don't create notification rows.
--
-- Types wired:
--   invoice_sent              draft -> sent (or inserted as sent)
--   invoice_payment_received  amount_paid increased, not yet fully paid
--   invoice_paid              -> paid
--   invoice_voided            -> void
--   bill_received             draft -> open (or inserted as open)
--   bill_paid                 -> paid
--
-- Idempotent: safe to re-run.

-- Shared fan-out: insert one notification per accounting reader (preference-gated).
create or replace function accounting.emit_accounting_notification(
  p_type text,
  p_title text,
  p_message text,
  p_link text,
  p_metadata jsonb
) returns void
language plpgsql
security definer
set search_path = accounting, public, pg_catalog
as $$
declare
  v_uid uuid;
begin
  for v_uid in
    select p.id
    from public.profiles p
    where p.is_approved = true
      and (p.is_admin = true
           or exists (select 1 from accounting.user_roles ur where ur.user_id = p.id))
  loop
    if not public.should_notify(v_uid, p_type, 'in_app') then
      continue;
    end if;
    insert into public.system_notifications (user_id, type, title, message, link, metadata)
    values (v_uid, p_type, p_title, p_message, p_link, coalesce(p_metadata, '{}'::jsonb));
  end loop;
end;
$$;

-- ── Invoices (AR) ────────────────────────────────────────────────────────────
create or replace function accounting.notify_invoice_events()
returns trigger
language plpgsql
security definer
set search_path = accounting, public, pg_catalog
as $$
declare
  v_old_status text := case when TG_OP = 'UPDATE' then OLD.status else null end;
  v_old_paid numeric := case when TG_OP = 'UPDATE' then coalesce(OLD.amount_paid, 0) else 0 end;
  v_type text;
  v_title text;
  v_cust text;
  v_amount text;
  v_msg text;
begin
  -- QBO-managed rows never notify (flood guard).
  if NEW.external_qbo_id is not null then
    return NEW;
  end if;

  if NEW.status = 'void' and v_old_status is distinct from 'void' then
    v_type := 'invoice_voided'; v_title := 'Invoice Voided';
  elsif NEW.status = 'paid' and v_old_status is distinct from 'paid' then
    v_type := 'invoice_paid'; v_title := 'Invoice Paid';
  elsif coalesce(NEW.amount_paid, 0) > v_old_paid and NEW.status <> 'paid' then
    v_type := 'invoice_payment_received'; v_title := 'Payment Received';
  elsif NEW.status = 'sent' and v_old_status is distinct from 'sent' then
    v_type := 'invoice_sent'; v_title := 'Invoice Sent';
  else
    return NEW;  -- not a notify-worthy transition
  end if;

  begin
    select coalesce(display_name, company_name, contact_name, 'a customer')
      into v_cust
      from accounting.customers
      where id = NEW.customer_id;

    v_msg := 'Invoice ' || coalesce(NEW.invoice_number, '(draft)') || ' for ' ||
             coalesce(v_cust, 'a customer') ||
             case v_type
               when 'invoice_paid' then ' — paid in full'
               when 'invoice_voided' then ' — voided'
               when 'invoice_payment_received'
                 then ' — payment received, balance $' || to_char(coalesce(NEW.balance_due, 0), 'FM999G999G990D00')
               else ' — $' || to_char(coalesce(NEW.total, 0), 'FM999G999G990D00') || ' sent'
             end;

    perform accounting.emit_accounting_notification(
      v_type, v_title, v_msg,
      'accounting-invoice:' || NEW.id::text,
      jsonb_build_object(
        'invoice_id', NEW.id,
        'invoice_number', NEW.invoice_number,
        'status', NEW.status,
        'total', NEW.total,
        'balance_due', NEW.balance_due
      )
    );
  exception when others then
    raise warning 'notify_invoice_events failed: %', sqlerrm;
  end;

  return NEW;
end;
$$;

drop trigger if exists trg_notify_invoice_events on accounting.invoices;
create trigger trg_notify_invoice_events
  after insert or update on accounting.invoices
  for each row execute function accounting.notify_invoice_events();

-- ── Bills (AP) ───────────────────────────────────────────────────────────────
create or replace function accounting.notify_bill_events()
returns trigger
language plpgsql
security definer
set search_path = accounting, public, pg_catalog
as $$
declare
  v_old_status text := case when TG_OP = 'UPDATE' then OLD.status else null end;
  v_type text;
  v_title text;
  v_vendor text;
  v_msg text;
begin
  if NEW.external_qbo_id is not null then
    return NEW;
  end if;

  if NEW.status = 'paid' and v_old_status is distinct from 'paid' then
    v_type := 'bill_paid'; v_title := 'Bill Paid';
  elsif NEW.status = 'open' and v_old_status is distinct from 'open' then
    v_type := 'bill_received'; v_title := 'Bill Recorded';
  else
    return NEW;
  end if;

  begin
    select coalesce(display_name, company_name, 'a vendor')
      into v_vendor
      from accounting.vendors
      where id = NEW.vendor_id;

    v_msg := 'Bill ' || coalesce(NEW.bill_number, '') || ' from ' ||
             coalesce(v_vendor, 'a vendor') ||
             case v_type
               when 'bill_paid' then ' — paid'
               else ' — $' || to_char(coalesce(NEW.total, 0), 'FM999G999G990D00') || ' due ' ||
                    coalesce(to_char(NEW.due_date, 'FMMon FMDD'), 'on receipt')
             end;

    perform accounting.emit_accounting_notification(
      v_type, v_title, v_msg,
      'accounting-bill:' || NEW.id::text,
      jsonb_build_object(
        'bill_id', NEW.id,
        'bill_number', NEW.bill_number,
        'status', NEW.status,
        'total', NEW.total,
        'balance_due', NEW.balance_due,
        'due_date', NEW.due_date
      )
    );
  exception when others then
    raise warning 'notify_bill_events failed: %', sqlerrm;
  end;

  return NEW;
end;
$$;

drop trigger if exists trg_notify_bill_events on accounting.bills;
create trigger trg_notify_bill_events
  after insert or update on accounting.bills
  for each row execute function accounting.notify_bill_events();

-- Trigger-only lockdown (match security convention).
do $$
declare
  fn text;
  fns text[] := array[
    'accounting.emit_accounting_notification(text,text,text,text,jsonb)',
    'accounting.notify_invoice_events()',
    'accounting.notify_bill_events()'
  ];
begin
  foreach fn in array fns loop
    if to_regprocedure(fn) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', fn);
    end if;
  end loop;
end $$;

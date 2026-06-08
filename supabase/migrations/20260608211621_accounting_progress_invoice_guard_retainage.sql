-- WorkTrackAccounting — #10 follow-up: strengthen the progress-invoice line guard (retainage)
--
-- accounting.guard_progress_invoice_line() (migration 20260608183926) already rejects negative
-- period billing, over-billing past the SOV scheduled value, and billing a non-approved
-- change-order line. It did NOT, however, sanity-check retainage_this_period. This migration
-- REPLACES the function (the BEFORE INSERT/UPDATE trigger binding is preserved) to also reject:
--   • a negative retainage_this_period, and
--   • retainage_this_period GREATER THAN current_period (you can never withhold more than the
--     work earned this period — this also catches a mis-configured retainage_percent > 1).
-- Everything else is byte-for-byte the original guard (accounting review #8). Additive: it only
-- adds rejections, never relaxes one, and existing rows are not re-validated (BEFORE-row).
--
-- This migration is IDEMPOTENT (CREATE OR REPLACE).
--
-- ROLLBACK: re-apply the function body from 20260608183926_accounting_progress_billing.sql.

create or replace function accounting.guard_progress_invoice_line()
returns trigger
language plpgsql
security definer
set search_path = accounting, pg_catalog
as $$
declare
  v_scheduled numeric(14,2);
  v_co uuid;
  v_co_status text;
begin
  -- No negative period billing.
  if new.current_period < 0 then
    raise exception 'progress billing current_period (%) cannot be negative', new.current_period
      using errcode = 'check_violation';
  end if;

  -- Retainage withheld this period must be non-negative and cannot exceed the work earned this
  -- period — you can never hold back more than you billed (also catches retainage_percent > 1).
  if new.retainage_this_period < 0 then
    raise exception 'progress billing retainage_this_period (%) cannot be negative',
      new.retainage_this_period using errcode = 'check_violation';
  end if;
  if new.retainage_this_period > new.current_period then
    raise exception 'retainage_this_period (%) cannot exceed current_period (%)',
      new.retainage_this_period, new.current_period using errcode = 'check_violation';
  end if;

  -- Cumulative billed cannot exceed the SOV line's scheduled value (the line already includes
  -- any approved change-order scope it represents).
  select scheduled_value, change_order_id into v_scheduled, v_co
    from accounting.sov_lines where id = new.sov_line_id;
  if not found then
    raise exception 'SOV line % not found', new.sov_line_id using errcode = 'no_data_found';
  end if;
  if new.completed_to_date > v_scheduled then
    raise exception 'completed-to-date (%) exceeds the SOV line scheduled value (%)',
      new.completed_to_date, v_scheduled using errcode = 'check_violation';
  end if;

  -- A change-order SOV line is billable only once its change order is approved.
  if v_co is not null then
    select status into v_co_status from accounting.change_orders where id = v_co;
    if v_co_status is distinct from 'approved' then
      raise exception 'cannot bill SOV line tied to a non-approved change order (status %)',
        coalesce(v_co_status, 'missing') using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;
